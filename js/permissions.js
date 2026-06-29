(function () {
  const ACCESS_ENDPOINT = '/.netlify/functions/admin-users?my-access=1';

  function currentUser() {
    return {
      username: localStorage.getItem('cc_user') || '',
      role: (localStorage.getItem('cc_role') || '').toLowerCase(),
      token: localStorage.getItem('cc_token') || ''
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
    return user.username === 'Anati' && user.role === 'admin';
  }

  async function getMyAccess(moduleKey) {
    const user = currentUser();
    if (isAnatiAdmin()) return fullAccess(moduleKey);

    try {
      const response = await fetch(ACCESS_ENDPOINT, {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${user.token}`
        }
      });
      if (!response.ok) throw new Error(`Access check failed: ${response.status}`);

      const data = await response.json();
      if (data.legacyFallback || !data.hasConfiguredAccess) {
        return fullAccess(moduleKey, true);
      }

      return (data.access || []).find((record) => record.moduleKey === moduleKey) || {
        moduleKey,
        canView: false,
        canCreate: false,
        canEdit: false,
        canDelete: false,
        legacyFallback: false
      };
    } catch (error) {
      console.warn('Permission check failed; using legacy page behavior.', error);
      return fullAccess(moduleKey, true);
    }
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
    getMyAccess,
    requirePageAccess,
    applyPermissionVisibility,
    isAnatiAdmin
  };
})();
