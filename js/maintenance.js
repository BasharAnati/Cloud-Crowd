(function () {
  const MAINTENANCE_ENDPOINT = '/.netlify/functions/maintenance';
  const POLL_INTERVAL = 3000;
  const REQUEST_DEADLINE = 10 * 1000;

  function readToken() {
    if (typeof window.readSessionValue === 'function') {
      return window.readSessionValue('cc_token') || '';
    }
    return window.sessionStorage?.getItem?.('cc_token') || '';
  }

  function unavailableState(reason = 'maintenance-unavailable') {
    return { status: 'unavailable', maintenance: null, admin: false, reason };
  }

  function availableState(data) {
    if (!data || typeof data.maintenance !== 'boolean' || typeof data.admin !== 'boolean') {
      throw new Error('Maintenance response is malformed');
    }
    return {
      status: 'available',
      maintenance: data.maintenance,
      admin: data.admin,
      reason: ''
    };
  }

  function createAuthorityReader(onPublication) {
    let generation = 0;
    let pending = null;
    let tornDown = false;

    function request() {
      if (tornDown) return Promise.resolve(null);
      if (pending) return pending.promise;

      const requestGeneration = ++generation;
      let finish;
      const promise = new Promise((resolve) => {
        let settled = false;
        const timeoutId = window.setTimeout(() => {
          finish(unavailableState('maintenance-timeout'));
        }, REQUEST_DEADLINE);

        finish = (state) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          if (pending?.generation === requestGeneration) pending = null;
          if (!tornDown && generation === requestGeneration && state) {
            onPublication(state, requestGeneration);
          }
          resolve(state);
        };

        Promise.resolve().then(() => fetch(MAINTENANCE_ENDPOINT, {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${readToken()}` }
        })).then((response) => {
          if (!response.ok) throw new Error(`Maintenance check failed: ${response.status}`);
          return response.json();
        }).then((data) => availableState(data)).then((nextState) => {
          finish(nextState);
        }, (error) => {
          console.warn('Maintenance check failed.', error);
          finish(unavailableState('maintenance-request-failed'));
        });
      });

      pending = {
        generation: requestGeneration,
        promise,
        cancel() { finish(null); }
      };
      return promise;
    }

    function supersede() {
      generation += 1;
    }

    function invalidate() {
      generation += 1;
      pending?.cancel();
      pending = null;
    }

    function teardown() {
      if (tornDown) return;
      tornDown = true;
      invalidate();
    }

    return {
      request,
      supersede,
      invalidate,
      teardown,
      hasPending() { return pending !== null; }
    };
  }

  function createLifecycle(options = {}) {
    const button = options.button || null;
    let state = {
      status: 'unknown',
      maintenance: null,
      admin: false,
      reason: 'maintenance-not-checked'
    };
    let enforcementStarted = false;
    let toggleStarted = false;
    let mutationInFlight = false;
    let mutationGeneration = 0;
    let intervalId = null;
    let buttonListenerBound = false;
    let pageLifecycleBound = false;
    let restorationGate = null;
    let suspended = false;
    let tornDown = false;

    function snapshot() {
      return { ...state };
    }

    function renderToggle() {
      if (!button || !toggleStarted) return;
      if (state.status !== 'available' || state.admin !== true) {
        button.hidden = true;
        return;
      }
      button.hidden = false;
      button.textContent = state.maintenance ? 'ON' : 'OFF';
      button.classList.toggle('is-active', state.maintenance);
      button.setAttribute('aria-pressed', String(state.maintenance));
      button.title = state.maintenance ? 'Maintenance mode is ON' : 'Maintenance mode is OFF';
    }

    function enforcePublishedState() {
      if (state.status === 'unavailable' ||
          (state.status === 'available' && state.maintenance === true && state.admin !== true)) {
        window.location.href = 'system-update.html';
      }
    }

    function publish(nextState, options = {}) {
      if (tornDown) return false;
      state = { ...nextState };
      renderToggle();
      if (options.enforce !== false) enforcePublishedState();
      return true;
    }

    const reader = createAuthorityReader((nextState) => publish(nextState));

    function ensureRestorationGate() {
      if (restorationGate) return restorationGate;
      let resolve;
      const promise = new Promise((onResolve) => { resolve = onResolve; });
      restorationGate = { promise, resolve };
      return restorationGate;
    }

    function completeRestorationGate(nextState) {
      if (tornDown || suspended || !restorationGate) return;
      const gate = restorationGate;
      restorationGate = null;
      gate.resolve(nextState);
    }

    function requestPublishedAuthority() {
      bindPageLifecycle();
      return reader.request().then(() => snapshot());
    }

    function enforceMaintenanceMode() {
      if (tornDown || suspended) return ensureRestorationGate().promise;
      if (mutationInFlight) return Promise.resolve(snapshot());
      return requestPublishedAuthority().then((nextState) => {
        if (restorationGate) return restorationGate.promise;
        return nextState;
      });
    }

    async function toggleMaintenanceMode() {
      if (tornDown || suspended || mutationInFlight || state.status !== 'available' || state.admin !== true) {
        renderToggle();
        return false;
      }

      const message = state.maintenance
        ? 'Maintenance mode is currently ON.\nEmployees currently cannot access the internal system.\nIf you turn it OFF, employees will be able to access the system normally again.\nDo you want to continue?'
        : 'Maintenance mode is currently OFF.\nIf you turn it ON, all employee accounts will be redirected to the system update page and will not be able to access the internal system.\nDo you want to continue?';
      if (!await window.CloudCrowdConfirmation.request(message, {
        title: 'Change maintenance mode',
        confirmLabel: 'Continue'
      })) return false;

      if (state.status !== 'available' || state.admin !== true) {
        renderToggle();
        return false;
      }

      const requestedMaintenance = !state.maintenance;
      const requestMutationGeneration = ++mutationGeneration;
      mutationInFlight = true;
      reader.supersede();
      if (button) button.disabled = true;
      try {
        const response = await fetch(MAINTENANCE_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${readToken()}`
          },
          body: JSON.stringify({ maintenance: requestedMaintenance })
        });
        if (!response.ok) throw new Error(`Maintenance update failed: ${response.status}`);
        const data = await response.json();
        if (!data || typeof data.maintenance !== 'boolean') {
          throw new Error('Maintenance update response is malformed');
        }
        if (tornDown || suspended || mutationGeneration !== requestMutationGeneration) return false;
        return publish({
          status: 'available',
          maintenance: data.maintenance,
          admin: true,
          reason: ''
        });
      } catch (error) {
        console.warn('Maintenance update failed.', error);
        if (!tornDown && !suspended && mutationGeneration === requestMutationGeneration) renderToggle();
        return false;
      } finally {
        if (mutationGeneration === requestMutationGeneration) {
          mutationInFlight = false;
          if (button) button.disabled = false;
        }
      }
    }

    function clearEnforcementInterval() {
      if (intervalId === null) return;
      window.clearInterval(intervalId);
      intervalId = null;
    }

    function suspendForBfcache() {
      if (tornDown || suspended) return;
      suspended = true;
      ensureRestorationGate();
      reader.invalidate();
      mutationGeneration += 1;
      mutationInFlight = false;
      clearEnforcementInterval();
      state = {
        status: 'unknown',
        maintenance: null,
        admin: false,
        reason: 'maintenance-bfcache-suspended'
      };
      if (button) button.disabled = false;
      renderToggle();
    }

    function restoreFromBfcache() {
      if (tornDown || !suspended) return;
      suspended = false;
      enforcementStarted = true;
      bindToggleHandler();
      requestPublishedAuthority().then(completeRestorationGate);
      intervalId = window.setInterval(enforceMaintenanceMode, POLL_INTERVAL);
    }

    function handlePagehide(event) {
      if (event?.persisted === true) suspendForBfcache();
      else teardown();
    }

    function handlePageshow(event) {
      if (event?.persisted === true) restoreFromBfcache();
    }

    function bindPageLifecycle() {
      if (pageLifecycleBound || typeof window.addEventListener !== 'function') return;
      pageLifecycleBound = true;
      window.addEventListener('pagehide', handlePagehide);
      window.addEventListener('pageshow', handlePageshow);
    }

    function bindToggleHandler() {
      if (!button || buttonListenerBound) return;
      buttonListenerBound = true;
      button.addEventListener('click', toggleMaintenanceMode);
    }

    function startEnforcement() {
      if (tornDown || suspended || enforcementStarted) return;
      enforcementStarted = true;
      bindToggleHandler();
      bindPageLifecycle();
      if (state.status === 'unknown') enforceMaintenanceMode();
      else enforcePublishedState();
      intervalId = window.setInterval(enforceMaintenanceMode, POLL_INTERVAL);
    }

    function startToggleUpdates() {
      if (tornDown || toggleStarted) return;
      toggleStarted = true;
      renderToggle();
    }

    function teardown() {
      if (tornDown) return;
      tornDown = true;
      suspended = false;
      ensureRestorationGate();
      mutationGeneration += 1;
      mutationInFlight = false;
      reader.teardown();
      clearEnforcementInterval();
      if (button && buttonListenerBound) {
        button.removeEventListener('click', toggleMaintenanceMode);
        buttonListenerBound = false;
      }
      if (pageLifecycleBound && typeof window.removeEventListener === 'function') {
        window.removeEventListener('pagehide', handlePagehide);
        window.removeEventListener('pageshow', handlePageshow);
        pageLifecycleBound = false;
      }
      enforcementStarted = false;
      toggleStarted = false;
    }

    return {
      startEnforcement,
      startToggleUpdates,
      enforceMaintenanceMode,
      updateMaintenanceToggleButton() {
        startToggleUpdates();
        return Promise.resolve(snapshot());
      },
      toggleMaintenanceMode,
      getState: snapshot,
      teardown
    };
  }

  function createRecoveryLifecycle(options = {}) {
    const returnRoute = options.returnRoute || 'dashboard.html';
    let intervalId = null;
    let started = false;
    let pageLifecycleBound = false;
    let suspended = false;
    let tornDown = false;

    function acceptRecoveryState(state) {
      if (state.status === 'available' && (state.maintenance === false || state.admin === true)) {
        window.location.replace(returnRoute);
      }
    }

    const reader = createAuthorityReader(acceptRecoveryState);

    function check() {
      if (tornDown || suspended) return Promise.resolve(null);
      return reader.request();
    }

    function clearRecoveryInterval() {
      if (intervalId === null) return;
      window.clearInterval(intervalId);
      intervalId = null;
    }

    function suspendForBfcache() {
      if (tornDown || suspended) return;
      suspended = true;
      reader.invalidate();
      clearRecoveryInterval();
    }

    function restoreFromBfcache() {
      if (tornDown || !suspended) return;
      suspended = false;
      check();
      intervalId = window.setInterval(check, POLL_INTERVAL);
    }

    function handlePagehide(event) {
      if (event?.persisted === true) suspendForBfcache();
      else teardown();
    }

    function handlePageshow(event) {
      if (event?.persisted === true) restoreFromBfcache();
    }

    function bindPageLifecycle() {
      if (pageLifecycleBound || typeof window.addEventListener !== 'function') return;
      pageLifecycleBound = true;
      window.addEventListener('pagehide', handlePagehide);
      window.addEventListener('pageshow', handlePageshow);
    }

    function start() {
      if (tornDown || suspended || started) return;
      started = true;
      check();
      intervalId = window.setInterval(check, POLL_INTERVAL);
      bindPageLifecycle();
    }

    function teardown() {
      if (tornDown) return;
      tornDown = true;
      suspended = false;
      reader.teardown();
      clearRecoveryInterval();
      if (pageLifecycleBound && typeof window.removeEventListener === 'function') {
        window.removeEventListener('pagehide', handlePagehide);
        window.removeEventListener('pageshow', handlePageshow);
        pageLifecycleBound = false;
      }
      started = false;
    }

    return { start, check, teardown };
  }

  window.CloudCrowdMaintenance = {
    endpoint: MAINTENANCE_ENDPOINT,
    pollInterval: POLL_INTERVAL,
    requestDeadline: REQUEST_DEADLINE,
    createLifecycle,
    createRecoveryLifecycle
  };
})();
