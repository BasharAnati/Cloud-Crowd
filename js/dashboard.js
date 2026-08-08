(function () {
  async function startDashboard() {
    const maintenanceButton = document.getElementById('maintenance-toggle-btn');
    const maintenance = window.CloudCrowdMaintenance.createLifecycle({
      button: maintenanceButton
    });
    maintenance.startEnforcement();

    const shellResult = await window.CloudCrowdAppShell.initializeAppShell({
      shell: document.getElementById('dashboard-shell'),
      sidebar: document.getElementById('dashboard-app-sidebar'),
      topbar: document.getElementById('dashboard-app-topbar'),
      backdrop: document.getElementById('dashboard-nav-backdrop'),
      activeModule: window.CloudCrowdAppShell.getModuleById('dashboard'),
      fallbackMode: 'legacy',
      brandImage: 'assets/images/logo.png',
      userId: 'dashboard-user-name',
      roleId: 'dashboard-role-badge',
      utilityActions: [maintenanceButton],
      onLogout: window.logout
    });
    await window.CloudCrowdAppShell.renderDashboardModules(
      document.getElementById('dashboard-modules'),
      {
        modules: shellResult.permittedModules.filter((module) => module.showInDashboard),
        modulesArePermitted: true
      }
    );

    maintenance.startToggleUpdates();
  }

  startDashboard().catch((error) => {
    console.error('Dashboard shell initialization failed.', error);
  });
})();
