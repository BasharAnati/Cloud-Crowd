(function () {
  const MAINTENANCE_ENDPOINT = '/.netlify/functions/maintenance';
  const POLL_INTERVAL = 3000;

  function createLifecycle(options = {}) {
    const button = options.button || null;
    let latestMaintenanceState = false;
    let latestAdminAuthority = false;

    async function fetchMaintenanceStatus() {
      try {
        const response = await fetch(MAINTENANCE_ENDPOINT, {
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${readSessionValue('cc_token') || ''}`
          }
        });
        if (!response.ok) throw new Error(`Maintenance check failed: ${response.status}`);
        const data = await response.json();
        if (!data || typeof data.maintenance !== 'boolean' || typeof data.admin !== 'boolean') {
          throw new Error('Maintenance response is malformed');
        }
        const status = {
          maintenance: data.maintenance === true,
          admin: data.admin === true
        };
        latestMaintenanceState = status.maintenance;
        latestAdminAuthority = status.admin;
        return status;
      } catch (error) {
        latestAdminAuthority = false;
        console.warn('Maintenance check failed.', error);
        return { maintenance: latestMaintenanceState === true ? true : null, admin: false, unavailable: true };
      }
    }

    async function enforceMaintenanceMode() {
      const status = await fetchMaintenanceStatus();
      if (status?.unavailable === true && button) button.hidden = true;
      if (status?.admin !== true && (status?.maintenance === true || status?.unavailable === true)) {
        window.location.href = 'system-update.html';
      }
    }

    async function updateMaintenanceToggleButton() {
      if (!button) return;
      const status = await fetchMaintenanceStatus();
      if (!status || status.unavailable === true || status.admin !== true) {
        button.hidden = true;
        return;
      }
      latestMaintenanceState = status.maintenance;
      button.hidden = false;
      button.textContent = latestMaintenanceState ? 'ON' : 'OFF';
      button.classList.toggle('is-active', latestMaintenanceState);
      button.setAttribute('aria-pressed', String(latestMaintenanceState));
      button.title = latestMaintenanceState ? 'Maintenance mode is ON' : 'Maintenance mode is OFF';
    }

    async function toggleMaintenanceMode() {
      if (latestAdminAuthority !== true) {
        if (button) button.hidden = true;
        return;
      }
      const message = latestMaintenanceState
        ? 'Maintenance mode is currently ON.\nEmployees currently cannot access the internal system.\nIf you turn it OFF, employees will be able to access the system normally again.\nDo you want to continue?'
        : 'Maintenance mode is currently OFF.\nIf you turn it ON, all employee accounts will be redirected to the system update page and will not be able to access the internal system.\nDo you want to continue?';
      if (!await window.CloudCrowdConfirmation.request(message, {
        title: 'Change maintenance mode',
        confirmLabel: 'Continue'
      })) return;

      if (button) button.disabled = true;
      try {
        const response = await fetch(MAINTENANCE_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${readSessionValue('cc_token') || ''}`
          },
          body: JSON.stringify({ maintenance: !latestMaintenanceState })
        });
        if (!response.ok) throw new Error(`Maintenance update failed: ${response.status}`);
        const data = await response.json();
        latestMaintenanceState = data.maintenance === true;
      } catch (error) {
        console.warn('Maintenance update failed.', error);
      } finally {
        if (button) button.disabled = false;
      }
      updateMaintenanceToggleButton();
    }

    function startEnforcement() {
      button?.addEventListener('click', toggleMaintenanceMode);
      enforceMaintenanceMode();
      window.setInterval(enforceMaintenanceMode, POLL_INTERVAL);
    }

    function startToggleUpdates() {
      updateMaintenanceToggleButton();
      window.setInterval(updateMaintenanceToggleButton, POLL_INTERVAL);
    }

    return {
      startEnforcement,
      startToggleUpdates,
      enforceMaintenanceMode,
      updateMaintenanceToggleButton,
      toggleMaintenanceMode
    };
  }

  window.CloudCrowdMaintenance = {
    endpoint: MAINTENANCE_ENDPOINT,
    pollInterval: POLL_INTERVAL,
    createLifecycle
  };
})();
