(function () {
  async function startInternalPageShell() {
    const page = document.body;
    const maintenanceButton = document.getElementById('maintenance-toggle-btn');
    const maintenance = window.CloudCrowdMaintenance.createLifecycle({
      button: maintenanceButton
    });
    maintenance.startEnforcement();

    await window.CloudCrowdAppShell.initializeAppShell({
      shell: document.getElementById('internal-page-shell'),
      sidebar: document.getElementById('internal-app-sidebar'),
      topbar: document.getElementById('internal-app-topbar'),
      backdrop: document.getElementById('internal-nav-backdrop'),
      activeModule: window.CloudCrowdAppShell.getModuleById(page.dataset.shellModule),
      fallbackMode: 'legacy',
      brandImage: 'assets/images/logo.png',
      userId: page.dataset.shellUserId,
      roleId: page.dataset.shellRoleId,
      utilityActions: [maintenanceButton],
      onLogout: window.logout
    });

    maintenance.startToggleUpdates();
  }

  startInternalPageShell().catch((error) => {
    console.error('Internal page shell initialization failed.', error);
  });
})();
