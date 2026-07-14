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
      description: 'Track CCTV operator notes and observed operational violations.',
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
      description: 'Collect customer feedback and manage service follow-up cases.',
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
      description: 'Record daily complaints, issue categories, and resolution actions.',
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
      description: 'Track customer compensation orders, discounts, and usage details.',
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
      description: 'Manage immediate free order compensation requests and approvals.',
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
      description: 'Review ready free order requests and mark shared orders complete.',
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
      description: 'Manage customer follow-up calls and call result workflows.',
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
      description: 'Maintain employee records, contacts, emergency details, and assignments.',
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
      description: 'Track employee attendance, shift timing, extra hours, and notes.',
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
      description: 'Record weekly call quality evaluations and score breakdowns.',
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
      description: 'Manage training assignments, progress, notes, and coaching status.',
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
      description: 'Track employee deductions, personal orders, and financial adjustments.',
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
      description: 'Maintain restaurant and brand profiles, contacts, logos, and notes.',
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
      description: 'Track weekly platform ratings across restaurant and brand profiles.',
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
      description: 'Manage users, roles, module access, and administrative controls.',
      route: 'anati-admin.html',
      group: 'Administration',
      icon: 'shield-check',
      order: 300,
      permissionKey: 'anati_admin',
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

  function isAdminUser() {
    return currentUser().role === 'admin';
  }

  function fallbackModules(modules) {
    return modules.filter((module) => {
      if (module.id === 'dashboard') return true;
      return module.id === 'anati-admin' && isAdminUser();
    });
  }

  async function canViewModule(module) {
    if (!module.permissionKey) return true;
    if (!window.CCPermissions || typeof window.CCPermissions.getMyAccess !== 'function') {
      throw new Error('Permissions helper unavailable');
    }

    const access = await window.CCPermissions.getMyAccess(module.permissionKey);
    if (access?.legacyFallback) throw new Error('Permission state unavailable');
    return access?.canView !== false;
  }

  async function filterPermittedModules(modules) {
    if (!readSessionValue('cc_token')) return fallbackModules(modules);
    if (!window.CCPermissions || typeof window.CCPermissions.getMyAccess !== 'function') {
      return fallbackModules(modules);
    }

    try {
      const checks = await Promise.all(modules.map(async (module) => ({
        module,
        canView: await canViewModule(module)
      })));
      return checks.filter((item) => item.canView).map((item) => item.module);
    } catch (error) {
      console.warn('App shell permission filtering failed.', error);
      return fallbackModules(modules);
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

  async function buildSidebar(container, options = {}) {
    if (!container) return [];

    const activeModule = options.activeModule || getActiveModuleByPath();
    const baseModules = (options.modules || getSidebarModules()).filter((module) => (
      module.showInSidebar !== false && module.hidden !== true
    ));
    const visibleModules = await filterPermittedModules(baseModules);

    clearElement(container);
    container.classList.add('cc-shell-sidebar');

    const brand = document.createElement('a');
    brand.className = 'cc-shell-brand';
    brand.href = options.brandRoute || 'dashboard.html';
    brand.textContent = options.brandLabel || 'Cloud Crowd';
    container.appendChild(brand);

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

    const titleGroup = document.createElement('div');
    titleGroup.className = 'cc-shell-topbar-title';

    const eyebrow = document.createElement('span');
    eyebrow.className = 'cc-shell-topbar-eyebrow';
    eyebrow.textContent = options.eyebrow || activeModule?.group || 'Cloud Crowd';
    titleGroup.appendChild(eyebrow);

    const title = document.createElement('strong');
    title.textContent = options.title || activeModule?.title || 'Dashboard';
    titleGroup.appendChild(title);

    container.appendChild(titleGroup);

    const actions = document.createElement('div');
    actions.className = 'cc-shell-topbar-actions';

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

    if (typeof options.onLogout === 'function' || options.logoutHref) {
      const logoutButton = document.createElement('button');
      logoutButton.className = 'cc-shell-logout';
      logoutButton.type = 'button';
      logoutButton.textContent = options.logoutLabel || 'Log out';
      logoutButton.addEventListener('click', () => {
        if (typeof options.onLogout === 'function') {
          options.onLogout();
        } else {
          window.location.href = options.logoutHref;
        }
      });
      actions.appendChild(logoutButton);
    }

    container.appendChild(actions);
    return {
      user,
      activeModule: activeModule ? cloneModule(activeModule) : null
    };
  }

  window.CloudCrowdAppShell = {
    groups: GROUPS.slice(),
    getAllModules,
    getSidebarModules,
    getDashboardModules,
    getModuleById,
    getActiveModuleByPath,
    buildSidebar,
    buildTopbar
  };
})();
