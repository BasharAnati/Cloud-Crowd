(function () {
  const ACCESS_ENDPOINT = '/.netlify/functions/admin-users?my-access=1';

  function readSessionValue(key) {
    return sessionStorage.getItem(key) || '';
  }

  function currentUser() {
    return {
      username: readSessionValue('cc_user'),
      role: readSessionValue('cc_role').trim().toLowerCase(),
      token: readSessionValue('cc_token')
    };
  }

  function fullAccess(moduleKey, legacyFallback = false) {
    return {
      moduleKey,
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
      legacyFallback
    };
  }

  function isAnatiAdmin() {
    const user = currentUser();
    return user.username.trim().toLowerCase() === 'anati' && user.role === 'admin';
  }

  function legacyAccessModel() {
    return {
      legacyFallback: true,
      hasConfiguredAccess: false,
      fullAccess: true,
      access: []
    };
  }

  async function getMyAccessModel() {
    const user = currentUser();
    if (isAnatiAdmin()) {
      return {
        legacyFallback: false,
        hasConfiguredAccess: true,
        fullAccess: true,
        access: []
      };
    }

    try {
      const response = await fetch(ACCESS_ENDPOINT, {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${user.token}`
        }
      });
      if (!response.ok) throw new Error(`Access check failed: ${response.status}`);

      const data = await response.json();
      if (!data.ok || data.legacyFallback || !data.hasConfiguredAccess || !Array.isArray(data.access)) {
        return legacyAccessModel();
      }

      return {
        legacyFallback: false,
        hasConfiguredAccess: true,
        fullAccess: false,
        access: data.access.slice()
      };
    } catch (error) {
      console.warn('Permission check failed; using legacy page behavior.', error);
      return legacyAccessModel();
    }
  }

  function getModuleAccess(accessModel, moduleKey) {
    if (!accessModel || accessModel.legacyFallback || accessModel.fullAccess) {
      return fullAccess(moduleKey, Boolean(accessModel?.legacyFallback));
    }

    return accessModel.access.find((record) => record.moduleKey === moduleKey) || {
      moduleKey,
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      legacyFallback: false
    };
  }

  async function getMyAccess(moduleKey) {
    const accessModel = await getMyAccessModel();
    return getModuleAccess(accessModel, moduleKey);
  }

  async function requirePageAccess(moduleKey) {
    const access = await getMyAccess(moduleKey);
    window.CC_PAGE_ACCESS = access;

    if (access.canView === false) {
      window.location.href = 'dashboard.html';
      return access;
    }

    applyPermissionVisibility(access);
    observePermissionVisibility();
    return access;
  }

  function hideSelector(selector, shouldHide) {
    document.querySelectorAll(selector).forEach((element) => {
      element.hidden = shouldHide;
      if ('disabled' in element) element.disabled = shouldHide;
    });
  }

  function applyPermissionVisibility(access = window.CC_PAGE_ACCESS || {}) {
    if (access.legacyFallback) return;
    hideSelector('[data-permission-create]', access.canCreate === false);
    hideSelector('[data-permission-edit]', access.canEdit === false);
    hideSelector('[data-permission-delete]', access.canDelete === false);
  }

  function observePermissionVisibility() {
    if (window.CC_PERMISSION_OBSERVER) return;
    window.CC_PERMISSION_OBSERVER = new MutationObserver(() => {
      if (window.CC_PAGE_ACCESS) applyPermissionVisibility(window.CC_PAGE_ACCESS);
    });
    window.CC_PERMISSION_OBSERVER.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  window.CCPermissions = {
    getMyAccessModel,
    getModuleAccess,
    getMyAccess,
    requirePageAccess,
    applyPermissionVisibility,
    isAnatiAdmin
  };
})();
