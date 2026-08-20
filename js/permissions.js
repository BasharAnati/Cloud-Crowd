(function () {
  const ACCESS_ENDPOINT = '/.netlify/functions/admin-users?my-access=1';
  const ACCESS_CACHE_TTL_MS = 30 * 1000;
  let cachedAccessModel = null;
  let cacheExpiresAt = 0;
  let accessModelPromise = null;
  let requestGeneration = 0;
  let revalidationScheduled = false;

  function readSessionValue(key) {
    return sessionStorage.getItem(key) || '';
  }

  function unavailableAccess(moduleKey, reason = 'permission-unavailable') {
    return {
      moduleKey,
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      unavailable: true,
      reason
    };
  }

  function deniedAccess(moduleKey) {
    return {
      moduleKey,
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      unavailable: false,
      reason: 'denied'
    };
  }

  function validAccessRecord(record) {
    return record && typeof record.moduleKey === 'string' && record.moduleKey.trim() &&
      ['canView', 'canCreate', 'canEdit', 'canDelete'].every((field) => typeof record[field] === 'boolean');
  }

  function unavailableModel(reason, status = 0) {
    return {
      available: false,
      reason,
      status,
      hasConfiguredAccess: false,
      access: []
    };
  }

  async function fetchMyAccessModel() {
    const token = readSessionValue('cc_token');
    if (!token) return unavailableModel('missing-session', 401);
    try {
      const response = await fetch(ACCESS_ENDPOINT, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.status === 401) {
        window.clearStoredSession?.();
        return unavailableModel('invalid-session', 401);
      }
      if (!response.ok) return unavailableModel('permission-service-unavailable', response.status);
      const data = await response.json();
      if (!data || data.ok !== true || data.unavailable === true || data.legacyFallback === true ||
          !Array.isArray(data.access) || !data.access.every(validAccessRecord)) {
        return unavailableModel('malformed-permission-response', response.status);
      }
      const keys = new Set();
      for (const record of data.access) {
        if (keys.has(record.moduleKey)) return unavailableModel('malformed-permission-response', response.status);
        keys.add(record.moduleKey);
      }
      return {
        available: true,
        reason: '',
        status: response.status,
        hasConfiguredAccess: data.hasConfiguredAccess === true,
        access: data.access.slice()
      };
    } catch (error) {
      console.warn('Permission check unavailable.', error);
      return unavailableModel('permission-service-unavailable');
    }
  }

  function getMyAccessModel(options = {}) {
    const now = Date.now();
    if (options.force !== true && cachedAccessModel && now < cacheExpiresAt) {
      return Promise.resolve(cachedAccessModel);
    }
    if (options.force !== true && accessModelPromise) return accessModelPromise;

    const generation = ++requestGeneration;
    cachedAccessModel = null;
    cacheExpiresAt = 0;
    if (window.CC_PAGE_ACCESS?.canView === true) {
      window.CC_PAGE_ACCESS = unavailableAccess(window.CC_PAGE_MODULE_KEY || '', 'permission-refresh');
      applyPermissionVisibility(window.CC_PAGE_ACCESS);
    }
    const request = fetchMyAccessModel().then((model) => {
      if (generation !== requestGeneration) return unavailableModel('superseded-permission-response');
      cachedAccessModel = model;
      cacheExpiresAt = model.available === true ? Date.now() + ACCESS_CACHE_TTL_MS : 0;
      return model;
    }).finally(() => {
      if (generation === requestGeneration) accessModelPromise = null;
    });
    accessModelPromise = request;
    return request;
  }

  function invalidateAccessModel() {
    requestGeneration += 1;
    cachedAccessModel = null;
    cacheExpiresAt = 0;
    accessModelPromise = null;
    window.CC_PAGE_ACCESS = null;
  }

  function getModuleAccess(accessModel, moduleKey) {
    if (!accessModel || accessModel.available !== true) {
      return unavailableAccess(moduleKey, accessModel?.reason);
    }
    return accessModel.access.find((record) => record.moduleKey === moduleKey) || deniedAccess(moduleKey);
  }

  async function getMyAccess(moduleKey, options = {}) {
    return getModuleAccess(await getMyAccessModel(options), moduleKey);
  }

  function renderPermissionUnavailable(message) {
    if (!document?.body) return;
    if (document.body.dataset) document.body.dataset.permissionState = 'unavailable';
    let region = document.getElementById('cc-permission-state');
    if (!region) {
      region = document.createElement('div');
      region.id = 'cc-permission-state';
      region.className = 'cc-feedback cc-feedback--banner cc-feedback--error';
      const main = document.querySelector('main') || document.body;
      main.insertBefore?.(region, main.firstChild || null);
    }
    if (window.CloudCrowdFeedback) window.CloudCrowdFeedback.banner(region, message, 'error');
    else {
      region.setAttribute('role', 'alert');
      region.textContent = message;
    }
  }

  async function requirePageAccess(moduleKey, options = {}) {
    window.CC_PAGE_MODULE_KEY = moduleKey;
    const access = await getMyAccess(moduleKey, options);
    window.CC_PAGE_ACCESS = access;
    if (access.unavailable) {
      applyPermissionVisibility(access);
      renderPermissionUnavailable('Permissions could not be verified. Reload or sign in again.');
      if (access.reason === 'invalid-session' || access.reason === 'missing-session') {
        window.location.href = 'login.html?expired=1';
      }
      return access;
    }
    if (access.canView === false) {
      if (document?.body?.dataset) document.body.dataset.permissionState = 'denied';
      window.location.href = 'dashboard.html?access=denied';
      return access;
    }
    if (document?.body?.dataset) document.body.dataset.permissionState = 'allowed';
    applyPermissionVisibility(access);
    observePermissionVisibility();
    return access;
  }

  async function revalidateCurrentPage() {
    const moduleKey = window.CC_PAGE_MODULE_KEY;
    if (!moduleKey) return;
    await requirePageAccess(moduleKey, { force: true });
  }

  function scheduleCurrentPageRevalidation() {
    if (revalidationScheduled) return;
    revalidationScheduled = true;
    Promise.resolve().then(async () => {
      try {
        await revalidateCurrentPage();
      } finally {
        revalidationScheduled = false;
      }
    });
  }

  if (!window.CC_PERMISSION_REVALIDATION_BOUND) {
    window.CC_PERMISSION_REVALIDATION_BOUND = true;
    window.addEventListener?.('focus', scheduleCurrentPageRevalidation);
    document.addEventListener?.('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleCurrentPageRevalidation();
    });
  }

  function hideSelector(selector, shouldHide) {
    document.querySelectorAll(selector).forEach((element) => {
      element.hidden = shouldHide;
      if ('disabled' in element) element.disabled = shouldHide;
    });
  }

  function applyPermissionVisibility(access = window.CC_PAGE_ACCESS || {}) {
    const unavailable = access.unavailable === true;
    hideSelector('[data-permission-create]', unavailable || access.canCreate !== true);
    hideSelector('[data-permission-edit]', unavailable || access.canEdit !== true);
    hideSelector('[data-permission-delete]', unavailable || access.canDelete !== true);
  }

  function observePermissionVisibility() {
    if (window.CC_PERMISSION_OBSERVER) return;
    window.CC_PERMISSION_OBSERVER = new MutationObserver(() => {
      if (window.CC_PAGE_ACCESS) applyPermissionVisibility(window.CC_PAGE_ACCESS);
    });
    window.CC_PERMISSION_OBSERVER.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.CCPermissions = {
    getMyAccessModel,
    invalidateAccessModel,
    getModuleAccess,
    getMyAccess,
    requirePageAccess,
    applyPermissionVisibility
  };
  window.CCPermissions.cacheTtlMs = ACCESS_CACHE_TTL_MS;
})();
