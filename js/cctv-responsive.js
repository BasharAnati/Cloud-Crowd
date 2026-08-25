(function (global) {
  'use strict';

  const MOBILE_QUERY = '(max-width: 768px)';
  const STATUS_ORDER = ['Escalated', 'Under Review', 'Closed'];
  let activeStatus = '';
  let filterPanelOpen = false;
  let shellController = null;
  let initialized = false;

  function mobileMedia() {
    return typeof global.matchMedia === 'function'
      ? global.matchMedia(MOBILE_QUERY)
      : { matches: false };
  }

  function activeSecondaryFilterCount() {
    return [
      'cctv-status-filter',
      'cctv-branch-filter',
      'cctv-review-filter',
      'cctv-policy-filter',
      'cctv-staff-filter'
    ].reduce((count, id) => count + (document.getElementById(id)?.value ? 1 : 0), 0);
  }

  function updateFilterToggleLabel() {
    const label = document.querySelector('[data-cctv-filter-label]');
    if (!label) return;
    const count = activeSecondaryFilterCount();
    label.textContent = count ? `Filters · ${count}` : 'Filters';
  }

  function syncFilterPanelMode() {
    const panel = document.getElementById('cctv-secondary-filters');
    const toggle = document.getElementById('cctv-filter-toggle');
    if (!panel || !toggle) return;
    const isMobile = mobileMedia().matches;
    panel.hidden = isMobile && !filterPanelOpen;
    toggle.setAttribute('aria-expanded', String(isMobile && filterPanelOpen));
    updateFilterToggleLabel();
  }

  function setFilterPanel(open) {
    filterPanelOpen = Boolean(open);
    syncFilterPanelMode();
  }

  function bindFilterDisclosure() {
    const toggle = document.getElementById('cctv-filter-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', () => setFilterPanel(!filterPanelOpen));
    document.getElementById('cctv-secondary-filters')?.addEventListener('change', updateFilterToggleLabel);

    const media = mobileMedia();
    const handleModeChange = () => {
      filterPanelOpen = false;
      syncFilterPanelMode();
    };
    if (typeof media.addEventListener === 'function') media.addEventListener('change', handleModeChange);
    else if (typeof media.addListener === 'function') media.addListener(handleModeChange);
    syncFilterPanelMode();
  }

  function laneButtons() {
    return [...document.querySelectorAll('#cctv-status-switcher [data-cctv-lane]')];
  }

  function applyActiveLane() {
    const buttons = laneButtons();
    buttons.forEach((button) => {
      const selected = button.dataset.cctvLane === activeStatus;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });

    document.querySelectorAll('#tickets > .cctv-column').forEach((column) => {
      const selected = column.dataset.cctvStatus === activeStatus;
      column.classList.toggle('is-mobile-active', selected);
      column.setAttribute('aria-hidden', String(mobileMedia().matches && !selected));
    });
  }

  function chooseActiveStatus(counts) {
    const filteredStatus = document.getElementById('cctv-status-filter')?.value || '';
    if (STATUS_ORDER.includes(filteredStatus)) return filteredStatus;
    if (STATUS_ORDER.includes(activeStatus)) return activeStatus;
    return STATUS_ORDER.find((status) => Number(counts[status] || 0) > 0) || STATUS_ORDER[0];
  }

  function syncWorkflow(counts = {}) {
    activeStatus = chooseActiveStatus(counts);
    laneButtons().forEach((button) => {
      const count = Number(counts[button.dataset.cctvLane] || 0);
      const countNode = button.querySelector('[data-cctv-lane-count]');
      if (countNode) countNode.textContent = String(count);
    });
    applyActiveLane();
  }

  function selectLane(status, focus = false) {
    if (!STATUS_ORDER.includes(status)) return;
    activeStatus = status;
    applyActiveLane();
    if (focus) document.querySelector(`[data-cctv-lane="${status}"]`)?.focus();
  }

  function bindStatusSwitcher() {
    const buttons = laneButtons();
    buttons.forEach((button) => {
      button.addEventListener('click', () => selectLane(button.dataset.cctvLane));
      button.addEventListener('keydown', (event) => {
        const current = STATUS_ORDER.indexOf(button.dataset.cctvLane);
        let next = current;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % STATUS_ORDER.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + STATUS_ORDER.length) % STATUS_ORDER.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = STATUS_ORDER.length - 1;
        else return;
        event.preventDefault();
        selectLane(STATUS_ORDER[next], true);
      });
    });
  }

  function visibleFocusableElements(container) {
    return [...container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((element) => element.getClientRects().length > 0 && !element.hidden);
  }

  function bindNavigationContainment() {
    const shell = document.querySelector('.cctv-module-shell');
    const sidebar = document.getElementById('cctv-app-sidebar');
    const trigger = shellController?.topbar?.navigationButton;
    if (!shell || !sidebar || !trigger) return;

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || !shell.classList.contains('is-nav-open')) return;
      const focusable = visibleFocusableElements(sidebar);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!sidebar.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    trigger.addEventListener('click', () => {
      if (document.getElementById('ticket-drawer')?.classList.contains('open')) global.closeTicketDrawer?.();
      if (document.getElementById('modal')?.classList.contains('open')) global.closeModal?.();
    });
  }

  function wrapOverlayOpeners() {
    if (typeof global.openTicketDrawer === 'function') {
      const openTicketDrawer = global.openTicketDrawer;
      global.openTicketDrawer = function (...args) {
        shellController?.navigation?.close({ restoreFocus: false });
        return openTicketDrawer.apply(this, args);
      };
    }
    if (typeof global.openModal === 'function') {
      const openModal = global.openModal;
      global.openModal = function (...args) {
        shellController?.navigation?.close({ restoreFocus: false });
        return openModal.apply(this, args);
      };
    }
  }

  function initialize(controller) {
    if (initialized) return;
    initialized = true;
    shellController = controller || null;
    bindFilterDisclosure();
    bindStatusSwitcher();
    bindNavigationContainment();
    wrapOverlayOpeners();
    global.CloudCrowdIcons?.enhanceAll(document);
    const shell = document.querySelector('.cctv-module-shell');
    global.requestAnimationFrame?.(() => global.requestAnimationFrame?.(() => shell?.classList.add('is-nav-ready')));
  }

  global.CloudCrowdCctvResponsive = Object.freeze({
    initialize,
    syncWorkflow,
    setFilterPanel,
    selectLane
  });
})(window);
