(function () {
  const GROUPS = ['Dashboard', 'Operations', 'HR', 'Business', 'Administration'];

  const MODULES = [
    {
      id: 'dashboard',
      title: 'Dashboard',
      description: 'Main operations dashboard and module launcher.',
      route: 'dashboard.html',
      group: 'Dashboard',
      icon: 'layout-dashboard',
      order: 0,
      permissionKey: '',
      showInSidebar: true,
      showInDashboard: false
    },
    {
      id: 'cctv',
      title: 'CCTV Operator Observations',
      description: 'Track CCTV operator notes and document observed violations to support stronger security and discipline.',
      route: 'cctv.html',
      group: 'Operations',
      icon: 'video',
      order: 10,
      permissionKey: 'cctv',
      showInSidebar: true,
      showInDashboard: true
    },
    {
      id: 'customer-experience',
      title: 'Customer Experience',
      description: 'Collect customer feedback through calls and record complaints or comments that require follow-up.',
      route: 'ce.html',
      group: 'Operations',
      icon: 'messages-square',
      order: 20,
      permissionKey: 'customer_experience',
      showInSidebar: true,
      showInDashboard: true
    },
    {
      id: 'daily-complaints',
      title: 'Daily Complaints',
      description: 'Document all complaints received by the call center and keep daily operational follow-up visible.',
      route: 'complaints.html',
      group: 'Operations',
      icon: 'clipboard-list',
      order: 30,
      permissionKey: 'daily_complaints',
      showInSidebar: true,
      showInDashboard: true
    },
    {
      id: 'complimentary-orders',
      title: 'Complimentary Orders',
      description: 'Record order and customer details for discounts or compensations, including approval details.',
      route: 'free-orders.html',
      group: 'Operations',
      icon: 'shopping-bag',
      order: 40,
      permissionKey: 'complimentary_orders',
      showInSidebar: true,
      showInDashboard: true
    },
    {
      id: 'free-order-requests',
      title: 'Free Order Requests',
      description: 'Manage immediate free order compensation requests from entry to sharing readiness.',
      route: 'free-order-requests.html',
      group: 'Operations',
      icon: 'file-text',
      order: 50,
      permissionKey: 'free_order_requests',
      showInSidebar: true,
      showInDashboard: true
    },
    {
      id: 'free-order-share',
      title: 'Free Order Share',
      description: 'Review ready free order requests, request clarifications, and mark completed shares.',
      route: 'free-order-share.html',
      group: 'Operations',
      icon: 'truck',
      order: 60,
      permissionKey: 'free_order_share',
      showInSidebar: true,
      showInDashboard: true
    },
    {
      id: 'call-queue',
      title: 'Call Queue',
      description: 'Manage customer follow-up calls through Need Call, In Call, Called, Pending, and Done workflows.',
      route: 'call-queue.html',
      group: 'Operations',
      icon: 'phone-call',
      order: 70,
      permissionKey: 'call_queue',
      hidden: true,
      showInSidebar: true,
      showInDashboard: true
    },
    {
      id: 'employee-profiles',
      title: 'Employee Profiles',
      description: 'Maintain central employee records, contact details, emergency contacts, and restaurant assignments.',
      route: 'employee-profiles.html',
      group: 'HR',
      icon: 'users',
      order: 100,
      permissionKey: 'employee_profiles',
      showInSidebar: true,
      showInDashboard: true
    },
    {
      id: 'attendance',
      title: 'Attendance & Shift Tracking',
      description: 'Track employee attendance, shift schedules, and extra hours.',
      route: 'attendance.html',
      group: 'HR',
      icon: 'calendar-check',
      order: 110,
      permissionKey: 'attendance',
      showInSidebar: true,
      showInDashboard: true
    },
    {
      id: 'weekly-quality',
      title: 'Weekly Quality Sheet',
      description: 'Evaluate weekly call quality, calculate performance scores, and track pending or reviewed calls.',
      route: 'weekly-quality.html',
      group: 'HR',
      icon: 'badge-check',
      order: 120,
      permissionKey: 'weekly_quality',
      showInSidebar: true,
      showInDashboard: true
    },
    {
      id: 'agent-training',
      title: 'Agent Training',
      description: 'Manage brand assignments, training status, coaching needs, and employee training progress.',
      route: 'agent-training.html',
      group: 'HR',
      icon: 'graduation-cap',
      order: 130,
      permissionKey: 'agent_training',
      showInSidebar: true,
      showInDashboard: true
    },
    {
      id: 'employee-deductions',
      title: 'Employee Deductions',
      description: 'Track employee deductions, personal orders, discounts, and financial adjustments.',
      route: 'employee-deductions.html',
      group: 'HR',
      icon: 'receipt',
      order: 140,
      permissionKey: 'employee_deductions',
      showInSidebar: true,
      showInDashboard: true
    },
    {
      id: 'client-profiles',
      title: 'Client Profiles',
      description: 'Maintain restaurant and brand profiles, ownership contacts, numbers, logos, and operational notes.',
      route: 'client-profiles.html',
      group: 'Business',
      icon: 'briefcase-business',
      order: 200,
      permissionKey: 'client_profiles',
      showInSidebar: true,
      showInDashboard: true
    },
    {
      id: 'restaurant-ratings',
      title: 'Restaurant Ratings',
      description: 'Track weekly Talabat and Careem ratings across active restaurant and brand profiles.',
      route: 'restaurant-ratings.html',
      group: 'Business',
      icon: 'star',
      order: 210,
      permissionKey: 'restaurant_ratings',
      showInSidebar: true,
      showInDashboard: true
    },
    {
      id: 'anati-admin',
      title: 'Anati Admin Center',
      description: 'Manage user profiles, roles, module access planning, and future workflow permissions.',
      route: 'anati-admin.html',
      group: 'Administration',
      icon: 'shield-check',
      order: 300,
      permissionKey: 'anati_admin',
      anatiOnly: true,
      showInSidebar: true,
      showInDashboard: true
    }
  ];

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

  function isAnatiAdmin() {
    const user = currentUser();
    return user.username.trim().toLowerCase() === 'anati' && user.role === 'admin';
  }

  function cloneModule(module) {
    return { ...module };
  }

  function byOrderThenTitle(a, b) {
    return (a.order - b.order) || a.title.localeCompare(b.title);
  }

  function getAllModules() {
    return MODULES.slice().sort(byOrderThenTitle).map(cloneModule);
  }

  function getSidebarModules() {
    return getAllModules().filter((module) => module.showInSidebar && module.hidden !== true);
  }

  function getDashboardModules() {
    return getAllModules().filter((module) => module.showInDashboard && module.hidden !== true);
  }

  function getModuleById(id) {
    const normalizedId = String(id || '').trim();
    const module = MODULES.find((item) => item.id === normalizedId);
    return module ? cloneModule(module) : null;
  }

  function normalizePath(path) {
    const rawPath = String(path || '').split(/[?#]/)[0].replace(/\\/g, '/');
    return rawPath.substring(rawPath.lastIndexOf('/') + 1) || 'dashboard.html';
  }

  function getActiveModuleByPath(path) {
    const activePath = normalizePath(path || window.location.pathname);
    const module = MODULES.find((item) => normalizePath(item.route) === activePath);
    return module ? cloneModule(module) : null;
  }

  function fallbackModules(modules, fallbackMode) {
    if (fallbackMode === 'legacy') {
      return modules.filter((module) => module.anatiOnly !== true || isAnatiAdmin());
    }
    return modules.filter((module) => module.id === 'dashboard' || (module.anatiOnly === true && isAnatiAdmin()));
  }

  function canViewModule(module, accessModel) {
    if (module.anatiOnly === true) return isAnatiAdmin();
    if (!module.permissionKey) return true;
    if (!window.CCPermissions || typeof window.CCPermissions.getModuleAccess !== 'function') {
      throw new Error('Permissions helper unavailable');
    }

    const access = window.CCPermissions.getModuleAccess(accessModel, module.permissionKey);
    if (access?.legacyFallback) throw new Error('Permission state unavailable');
    return access?.canView !== false;
  }

  async function filterPermittedModules(modules, options = {}) {
    const candidates = modules.filter((module) => module.hidden !== true);
    if (!readSessionValue('cc_token') || !window.CCPermissions ||
        typeof window.CCPermissions.getMyAccessModel !== 'function' ||
        typeof window.CCPermissions.getModuleAccess !== 'function') {
      return fallbackModules(candidates, options.fallbackMode);
    }

    try {
      const accessModel = options.accessModel || await window.CCPermissions.getMyAccessModel();
      if (accessModel?.legacyFallback) throw new Error('Permission state unavailable');
      return candidates.filter((module) => canViewModule(module, accessModel)).map(cloneModule);
    } catch (error) {
      console.warn('App shell permission filtering failed.', error);
      return fallbackModules(candidates, options.fallbackMode).map(cloneModule);
    }
  }

  function clearElement(container) {
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  function createIcon(name) {
    const span = document.createElement('span');
    span.className = 'cc-shell-module-icon';
    span.setAttribute('aria-hidden', 'true');
    span.dataset.icon = name || 'circle';
    span.dataset.ccIcon = name || 'circle';
    if (window.CloudCrowdIcons) window.CloudCrowdIcons.render(span, name || 'circle');
    return span;
  }

  function createModuleLink(module, activeId) {
    const link = document.createElement('a');
    link.className = 'cc-shell-nav-link';
    link.href = module.route;
    link.dataset.moduleId = module.id;
    link.dataset.permissionKey = module.permissionKey || '';
    if (module.id === activeId) {
      link.classList.add('is-active');
      link.setAttribute('aria-current', 'page');
    }

    link.appendChild(createIcon(module.icon));
    const text = document.createElement('span');
    text.className = 'cc-shell-nav-text';
    text.textContent = module.title;
    link.appendChild(text);
    return link;
  }

  function groupModules(modules) {
    return GROUPS.map((group) => ({
      group,
      modules: modules.filter((module) => module.group === group).sort(byOrderThenTitle)
    })).filter((entry) => entry.modules.length > 0);
  }

  function createBrand(options) {
    const brand = document.createElement('a');
    brand.className = 'cc-shell-brand';
    brand.href = options.brandRoute || 'dashboard.html';
    brand.setAttribute('aria-label', options.brandAriaLabel || 'Cloud Crowd dashboard');

    if (options.brandImage) {
      const image = document.createElement('img');
      image.className = 'cc-shell-brand-logo';
      image.src = options.brandImage;
      image.alt = '';
      brand.appendChild(image);
    }

    const label = document.createElement('span');
    label.textContent = options.brandLabel || 'Cloud Crowd';
    brand.appendChild(label);
    return brand;
  }

  async function buildSidebar(container, options = {}) {
    if (!container) return [];

    const activeModule = options.activeModule || getActiveModuleByPath();
    const baseModules = (options.modules || getSidebarModules()).filter((module) => (
      module.showInSidebar !== false && module.hidden !== true
    ));
    const visibleModules = options.modulesArePermitted
      ? baseModules.map(cloneModule)
      : await filterPermittedModules(baseModules, options);

    clearElement(container);
    container.classList.add('cc-shell-sidebar');

    if (options.responsiveNavigation) {
      const header = document.createElement('div');
      header.className = 'cc-shell-sidebar-header';
      header.appendChild(createBrand(options));
      const closeButton = document.createElement('button');
      closeButton.className = 'cc-shell-mobile-close cc-button cc-button--secondary cc-button--md';
      closeButton.type = 'button';
      closeButton.setAttribute('aria-label', 'Close application navigation');
      closeButton.textContent = 'Close';
      if (window.CloudCrowdIcons) window.CloudCrowdIcons.leadingIcon(closeButton, 'x');
      header.appendChild(closeButton);
      container.appendChild(header);
    } else {
      container.appendChild(createBrand(options));
    }

    const nav = document.createElement('nav');
    nav.className = 'cc-shell-nav';
    nav.setAttribute('aria-label', options.ariaLabel || 'Application navigation');

    groupModules(visibleModules).forEach((entry) => {
      const section = document.createElement('section');
      section.className = 'cc-shell-nav-group';
      section.dataset.group = entry.group;

      const heading = document.createElement('h2');
      heading.className = 'cc-shell-nav-heading';
      heading.textContent = entry.group;
      section.appendChild(heading);

      entry.modules.forEach((module) => {
        section.appendChild(createModuleLink(module, activeModule?.id));
      });
      nav.appendChild(section);
    });

    container.appendChild(nav);
    return visibleModules.map(cloneModule);
  }

  function buildTopbar(container, options = {}) {
    if (!container) return null;

    const user = currentUser();
    const activeModule = options.activeModule || getActiveModuleByPath();
    clearElement(container);
    container.classList.add('cc-shell-topbar');

    let navigationButton = null;
    let context = null;
    if (options.responsiveNavigation) {
      context = document.createElement('div');
      context.className = 'cc-shell-topbar-context';
      navigationButton = document.createElement('button');
      navigationButton.className = 'cc-shell-nav-trigger cc-button cc-button--secondary cc-button--md';
      navigationButton.type = 'button';
      navigationButton.setAttribute('aria-label', 'Open application navigation');
      navigationButton.setAttribute('aria-expanded', 'false');
      if (options.sidebarId) navigationButton.setAttribute('aria-controls', options.sidebarId);
      navigationButton.textContent = 'Menu';
      if (window.CloudCrowdIcons) window.CloudCrowdIcons.leadingIcon(navigationButton, 'menu');
      context.appendChild(navigationButton);
    }

    const titleGroup = document.createElement('div');
    titleGroup.className = 'cc-shell-topbar-title';
    const eyebrow = document.createElement('span');
    eyebrow.className = 'cc-shell-topbar-eyebrow';
    eyebrow.textContent = options.eyebrow || activeModule?.group || 'Cloud Crowd';
    titleGroup.appendChild(eyebrow);
    const title = document.createElement('strong');
    title.textContent = options.title || activeModule?.title || 'Dashboard';
    titleGroup.appendChild(title);
    if (context) {
      context.appendChild(titleGroup);
      container.appendChild(context);
    } else {
      container.appendChild(titleGroup);
    }

    const actions = document.createElement('div');
    actions.className = 'cc-shell-topbar-actions';
    if (window.CloudCrowdTheme && typeof window.CloudCrowdTheme.createToggle === 'function') {
      const themeToggle = window.CloudCrowdTheme.createToggle();
      if (themeToggle) actions.appendChild(themeToggle);
    }

    const userBadge = document.createElement('span');
    userBadge.className = 'cc-shell-user-badge';
    if (options.userId) userBadge.id = options.userId;
    userBadge.textContent = user.username || 'Team Member';
    actions.appendChild(userBadge);

    const roleBadge = document.createElement('span');
    roleBadge.className = 'cc-shell-role-badge';
    if (options.roleId) roleBadge.id = options.roleId;
    roleBadge.textContent = user.role || 'operator';
    actions.appendChild(roleBadge);

    (options.utilityActions || []).filter(Boolean).forEach((element) => actions.appendChild(element));

    if (typeof options.onLogout === 'function' || options.logoutHref) {
      const logoutButton = document.createElement('button');
      logoutButton.className = 'cc-shell-logout cc-button cc-button--outline cc-button--md';
      logoutButton.type = 'button';
      logoutButton.textContent = options.logoutLabel || 'Log out';
      if (window.CloudCrowdIcons) window.CloudCrowdIcons.leadingIcon(logoutButton, 'log-out');
      logoutButton.addEventListener('click', () => {
        if (typeof options.onLogout === 'function') options.onLogout();
        else window.location.href = options.logoutHref;
      });
      actions.appendChild(logoutButton);
    }

    container.appendChild(actions);
    return {
      user,
      navigationButton,
      activeModule: activeModule ? cloneModule(activeModule) : null
    };
  }

  function createModuleCard(module) {
    const link = document.createElement('a');
    link.className = 'cc-shell-module-card';
    link.href = module.route;
    link.dataset.moduleId = module.id;
    link.dataset.permissionKey = module.permissionKey || '';

    link.appendChild(createIcon(module.icon));
    const title = document.createElement('h3');
    title.className = 'cc-shell-module-card-title';
    title.textContent = module.title;
    link.appendChild(title);
    const description = document.createElement('p');
    description.className = 'cc-shell-module-card-description';
    description.textContent = module.description;
    link.appendChild(description);
    const action = document.createElement('span');
    action.className = 'cc-shell-module-card-action';
    action.textContent = 'Open Section';
    link.appendChild(action);
    return link;
  }

  async function renderDashboardModules(container, options = {}) {
    if (!container) return [];
    const baseModules = (options.modules || getDashboardModules()).filter((module) => (
      module.showInDashboard !== false && module.hidden !== true
    ));
    const visibleModules = options.modulesArePermitted
      ? baseModules.map(cloneModule)
      : await filterPermittedModules(baseModules, { fallbackMode: 'legacy' });

    clearElement(container);
    groupModules(visibleModules).filter((entry) => entry.group !== 'Dashboard').forEach((entry) => {
      const section = document.createElement('section');
      section.className = 'cc-dashboard-module-group';
      section.dataset.group = entry.group;
      const heading = document.createElement('h2');
      heading.className = 'cc-dashboard-module-group-title';
      heading.textContent = entry.group;
      section.appendChild(heading);
      const grid = document.createElement('div');
      grid.className = 'cc-shell-dashboard-grid';
      entry.modules.forEach((module) => grid.appendChild(createModuleCard(module)));
      section.appendChild(grid);
      container.appendChild(section);
    });
    return visibleModules.map(cloneModule);
  }

  function setupResponsiveNavigation(options = {}) {
    const shell = options.shell;
    const sidebar = options.sidebar;
    const trigger = options.trigger;
    const backdrop = options.backdrop;
    if (!shell || !sidebar || !trigger || !backdrop) return null;

    const mediaQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 1024px)')
      : { matches: false };
    let isOpen = false;

    function applyState() {
      const compact = mediaQuery.matches;
      shell.classList.toggle('is-nav-open', compact && isOpen);
      document.body.classList.toggle('cc-shell-nav-lock', compact && isOpen);
      trigger.setAttribute('aria-expanded', String(compact && isOpen));
      sidebar.setAttribute('aria-hidden', String(compact && !isOpen));
      backdrop.hidden = !(compact && isOpen);
      if ('inert' in sidebar) sidebar.inert = compact && !isOpen;
    }

    function openNavigation() {
      if (!mediaQuery.matches) return;
      isOpen = true;
      applyState();
      const focusTarget = sidebar.querySelector('.cc-shell-mobile-close, .cc-shell-nav-link');
      if (focusTarget) focusTarget.focus();
    }

    function closeNavigation(options = {}) {
      const wasOpen = isOpen;
      isOpen = false;
      applyState();
      if (wasOpen && options.restoreFocus !== false) trigger.focus();
    }

    trigger.addEventListener('click', openNavigation);
    backdrop.addEventListener('click', closeNavigation);
    sidebar.querySelector('.cc-shell-mobile-close')?.addEventListener('click', closeNavigation);
    sidebar.querySelectorAll('.cc-shell-nav-link').forEach((link) => {
      link.addEventListener('click', () => closeNavigation({ restoreFocus: false }));
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen) closeNavigation();
    });

    const handleMediaChange = () => {
      isOpen = false;
      applyState();
    };
    if (typeof mediaQuery.addEventListener === 'function') mediaQuery.addEventListener('change', handleMediaChange);
    else if (typeof mediaQuery.addListener === 'function') mediaQuery.addListener(handleMediaChange);
    applyState();

    return { open: openNavigation, close: closeNavigation };
  }

  async function initializeAppShell(options = {}) {
    const activeModule = options.activeModule || getActiveModuleByPath();
    const permittedModules = await filterPermittedModules(
      options.modules || getAllModules(),
      { fallbackMode: options.fallbackMode }
    );
    const sidebarModules = permittedModules.filter((module) => module.showInSidebar);

    await buildSidebar(options.sidebar, {
      activeModule,
      modules: sidebarModules,
      modulesArePermitted: true,
      responsiveNavigation: true,
      brandImage: options.brandImage,
      ariaLabel: options.navigationLabel || 'Application navigation'
    });
    const topbar = buildTopbar(options.topbar, {
      activeModule,
      eyebrow: options.eyebrow,
      title: options.title,
      userId: options.userId,
      roleId: options.roleId,
      utilityActions: options.utilityActions,
      onLogout: options.onLogout,
      responsiveNavigation: true,
      sidebarId: options.sidebar?.id
    });
    const navigation = setupResponsiveNavigation({
      shell: options.shell,
      sidebar: options.sidebar,
      trigger: topbar?.navigationButton,
      backdrop: options.backdrop
    });
    return { permittedModules, navigation, topbar };
  }

  window.CloudCrowdAppShell = {
    groups: GROUPS.slice(),
    getAllModules,
    getSidebarModules,
    getDashboardModules,
    getModuleById,
    getActiveModuleByPath,
    filterPermittedModules,
    buildSidebar,
    buildTopbar,
    renderDashboardModules,
    setupResponsiveNavigation,
    initializeAppShell
  };
})();
