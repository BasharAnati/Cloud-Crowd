(function () {
  const LOGIN_ROUTE = 'login.html?expired=1';
  const SYSTEM_UPDATE_ROUTE = 'system-update.html';
  const AUTHORITY_TIMEOUT_MS = 10 * 1000;
  const AUTHORITY_TIMEOUT_CODE = 'DASHBOARD_AUTHORITY_TIMEOUT';
  let shellController = null;
  let refreshGeneration = 0;
  let refreshInFlight = null;
  let lifecycleListenersBound = false;
  const initializedTiltCards = new WeakSet();

  function initDashboardTiltCards() {
    const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)');
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!finePointer?.matches || reducedMotion?.matches) return;

    modulesElement()?.querySelectorAll('.cc-shell-module-card').forEach((card) => {
      if (initializedTiltCards.has(card)) return;
      initializedTiltCards.add(card);
      card.dataset.dashboardTilt = 'ready';

      let frameId = 0;
      let pointerPosition = null;

      const renderTilt = () => {
        frameId = 0;
        if (!pointerPosition) return;

        const bounds = card.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;

        const relativeX = Math.min(Math.max(pointerPosition.x - bounds.left, 0), bounds.width);
        const relativeY = Math.min(Math.max(pointerPosition.y - bounds.top, 0), bounds.height);
        const normalizedX = (relativeX / bounds.width) * 2 - 1;
        const normalizedY = (relativeY / bounds.height) * 2 - 1;

        card.style.setProperty('--mouse-x', `${((relativeX / bounds.width) * 100).toFixed(2)}%`);
        card.style.setProperty('--mouse-y', `${((relativeY / bounds.height) * 100).toFixed(2)}%`);
        card.style.setProperty('--tilt-x', `${(-normalizedY * 4).toFixed(2)}deg`);
        card.style.setProperty('--tilt-y', `${(normalizedX * 4).toFixed(2)}deg`);
      };

      const scheduleTilt = (event) => {
        pointerPosition = { x: event.clientX, y: event.clientY };
        if (!frameId) frameId = window.requestAnimationFrame(renderTilt);
      };

      card.addEventListener('pointerenter', (event) => {
        card.classList.remove('is-dashboard-tilt-resetting');
        card.classList.add('is-dashboard-tilting');
        scheduleTilt(event);
      });
      card.addEventListener('pointermove', scheduleTilt);
      card.addEventListener('pointerleave', () => {
        pointerPosition = null;
        if (frameId) {
          window.cancelAnimationFrame(frameId);
          frameId = 0;
        }
        card.classList.remove('is-dashboard-tilting');
        card.classList.add('is-dashboard-tilt-resetting');
        card.style.setProperty('--mouse-x', '50%');
        card.style.setProperty('--mouse-y', '50%');
        card.style.setProperty('--tilt-x', '0deg');
        card.style.setProperty('--tilt-y', '0deg');
      });
      card.addEventListener('transitionend', (event) => {
        if (event.propertyName === 'transform' && !card.classList.contains('is-dashboard-tilting')) {
          card.classList.remove('is-dashboard-tilt-resetting');
        }
      });
    });
  }

  function launcherStateElement() {
    return document.getElementById('dashboard-launcher-state');
  }

  function modulesElement() {
    return document.getElementById('dashboard-modules');
  }

  function clearElement(element) {
    while (element?.firstChild) element.removeChild(element.firstChild);
  }

  function createStateAction(action) {
    const element = document.createElement(action.href ? 'a' : 'button');
    element.className = action.className || 'cc-button cc-button--secondary cc-button--md';
    element.textContent = action.label;
    if (action.href) element.href = action.href;
    else {
      element.type = 'button';
      element.addEventListener('click', action.onClick);
    }
    return element;
  }

  function renderLauncherState(state, title, message, actions = []) {
    const region = launcherStateElement();
    const modules = modulesElement();
    if (!region || !modules) throw new Error('Dashboard launcher containers unavailable');

    modules.hidden = true;
    modules.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    region.hidden = false;
    region.dataset.state = state;
    region.className = state === 'unavailable' || state === 'error'
      ? 'dashboard-launcher-state cc-feedback cc-feedback--banner cc-feedback--error'
      : 'dashboard-launcher-state cc-empty-state';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    clearElement(region);

    const heading = document.createElement('h2');
    heading.className = 'dashboard-launcher-state-title';
    heading.textContent = title;
    region.appendChild(heading);
    const description = document.createElement('p');
    description.textContent = message;
    region.appendChild(description);

    if (actions.length) {
      const actionGroup = document.createElement('div');
      actionGroup.className = 'dashboard-launcher-state-actions';
      actions.forEach((action) => actionGroup.appendChild(createStateAction(action)));
      region.appendChild(actionGroup);
    }
  }

  function showAuthorizedModules() {
    const region = launcherStateElement();
    const modules = modulesElement();
    region.hidden = true;
    modules.hidden = false;
    modules.setAttribute('aria-busy', 'false');
  }

  function clearPresentedAuthority() {
    const modules = modulesElement();
    if (modules) {
      modules.hidden = true;
      modules.setAttribute('aria-busy', 'true');
      clearElement(modules);
    }
    shellController?.clearPermissionModules();
  }

  function withAuthorityTimeout(authorityPromise, authority) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = new Error(`${authority} authority timed out`);
        error.code = AUTHORITY_TIMEOUT_CODE;
        error.authority = authority;
        reject(error);
      }, AUTHORITY_TIMEOUT_MS);

      Promise.resolve(authorityPromise).then((value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(value);
      }, (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  function isInvalidSession(model) {
    return model?.reason === 'invalid-session' || model?.reason === 'missing-session';
  }

  function isNavigatingTo(route) {
    const href = String(window.location?.href || '');
    return href === route || href.endsWith(`/${route}`) || href.includes(`/${route}?`);
  }

  function redirectInvalidSession() {
    clearPresentedAuthority();
    renderLauncherState(
      'invalid-session',
      'Session expired',
      'Your session is no longer valid. Redirecting you to sign in.'
    );
    window.clearStoredSession?.();
    window.location.href = LOGIN_ROUTE;
  }

  async function ensureShell(accessModel) {
    if (shellController) return shellController.refreshModules(accessModel);
    shellController = await window.CloudCrowdAppShell.initializeAppShell({
      shell: document.getElementById('dashboard-shell'),
      sidebar: document.getElementById('dashboard-app-sidebar'),
      topbar: document.getElementById('dashboard-app-topbar'),
      backdrop: document.getElementById('dashboard-nav-backdrop'),
      activeModule: window.CloudCrowdAppShell.getModuleById('dashboard'),
      fallbackMode: 'legacy',
      accessModel,
      brandImage: 'assets/images/logo.png',
      userId: 'dashboard-user-name',
      roleId: 'dashboard-role-badge',
      utilityActions: [document.getElementById('maintenance-toggle-btn')],
      onLogout: window.logout
    });
    return shellController.permittedModules;
  }

  async function renderAccessModel(accessModel, generation) {
    if (generation !== refreshGeneration) return;
    if (isInvalidSession(accessModel)) {
      redirectInvalidSession();
      return;
    }

    const permittedModules = await ensureShell(accessModel);
    if (generation !== refreshGeneration) return;

    if (accessModel?.available !== true) {
      renderLauncherState(
        'unavailable',
        'Sections temporarily unavailable',
        'Permissions could not be verified. Retry the check or sign in again.',
        [
          { label: 'Retry access check', onClick: () => schedulePermissionRefresh(true) },
          { label: 'Sign in again', href: LOGIN_ROUTE }
        ]
      );
      return;
    }

    const dashboardModules = permittedModules.filter((module) => module.showInDashboard);
    await window.CloudCrowdAppShell.renderDashboardModules(modulesElement(), {
      modules: dashboardModules,
      modulesArePermitted: true
    });
    if (generation !== refreshGeneration) return;
    initDashboardTiltCards();

    if (dashboardModules.length === 0) {
      renderLauncherState(
        'empty',
        'No sections available',
        'No application sections are currently available to this account.'
      );
      return;
    }
    showAuthorizedModules();
  }

  async function refreshPermissions(options = {}) {
    const generation = ++refreshGeneration;
    if (options.loadingPrepared !== true) {
      clearPresentedAuthority();
      renderLauncherState(
        'loading',
        'Checking available sections',
        'Verifying your access and system availability.'
      );
    }

    try {
      const accessModel = await withAuthorityTimeout(
        window.CCPermissions.getMyAccessModel({ force: options.force === true }),
        'permission'
      );
      if (generation !== refreshGeneration) return;
      await renderAccessModel(accessModel, generation);
    } catch (error) {
      if (generation !== refreshGeneration) return;
      console.error('Dashboard permission refresh failed.', error);
      if (error?.code === AUTHORITY_TIMEOUT_CODE) {
        renderLauncherState(
          'unavailable',
          'Sections temporarily unavailable',
          'Permissions could not be verified. Retry the check or sign in again.',
          [
            { label: 'Retry access check', onClick: () => schedulePermissionRefresh(true) },
            { label: 'Sign in again', href: LOGIN_ROUTE }
          ]
        );
        return;
      }
      renderLauncherState(
        'error',
        'Dashboard unavailable',
        'The Dashboard could not be initialized. Reload the page to try again.',
        [{ label: 'Reload Dashboard', href: 'dashboard.html' }]
      );
    }
  }

  function schedulePermissionRefresh(force = true) {
    if (refreshInFlight) return refreshInFlight;
    clearPresentedAuthority();
    renderLauncherState(
      'loading',
      'Checking available sections',
      'Refreshing your current module access.'
    );
    const pending = refreshPermissions({ force, loadingPrepared: true });
    refreshInFlight = pending.finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  function bindPermissionLifecycle() {
    if (lifecycleListenersBound) return;
    lifecycleListenersBound = true;
    window.addEventListener('focus', () => schedulePermissionRefresh(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') schedulePermissionRefresh(true);
    });
  }

  async function startDashboard() {
    renderLauncherState(
      'loading',
      'Checking available sections',
      'Verifying your access and system availability.'
    );

    try {
      const maintenanceButton = document.getElementById('maintenance-toggle-btn');
      const maintenance = window.CloudCrowdMaintenance.createLifecycle({
        button: maintenanceButton
      });

      try {
        await withAuthorityTimeout(maintenance.enforceMaintenanceMode(), 'maintenance');
      } catch (error) {
        if (error?.code !== AUTHORITY_TIMEOUT_CODE) throw error;
        console.error('Dashboard maintenance authority timed out.', error);
        clearPresentedAuthority();
        window.location.href = SYSTEM_UPDATE_ROUTE;
        return;
      }
      if (isNavigatingTo(SYSTEM_UPDATE_ROUTE)) return;
      maintenance.startEnforcement();

      await refreshPermissions({ force: true, loadingPrepared: true });
      if (isNavigatingTo(LOGIN_ROUTE) || isNavigatingTo(SYSTEM_UPDATE_ROUTE)) return;

      bindPermissionLifecycle();
      maintenance.startToggleUpdates();
    } catch (error) {
      console.error('Dashboard shell initialization failed.', error);
      clearPresentedAuthority();
      renderLauncherState(
        'error',
        'Dashboard unavailable',
        'The Dashboard could not be initialized. Reload the page to try again.',
        [{ label: 'Reload Dashboard', href: 'dashboard.html' }]
      );
    }
  }

  startDashboard();
})();
