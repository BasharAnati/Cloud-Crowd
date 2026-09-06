(function () {
  'use strict';

  const PAGE_CONFIGS = [
    {
      bodyClass: 'ce-page',
      boardSelector: '#tickets',
      metricsSelector: '.ce-stats',
      columnSelector: '.ce-column',
      cardSelector: '.ce-ticket-card',
      filterSelector: '.ce-filters',
      filterFieldSelector: '.ce-filter-field',
      snapshotSelector: '.ce-ticket-grid',
      snapshotLabel: 'Case snapshot',
      metadataLabels: ['Phone']
    },
    {
      bodyClass: 'complaints-page',
      boardSelector: '#tickets',
      metricsSelector: '.complaints-stats',
      columnSelector: '.complaints-column',
      cardSelector: '.complaints-ticket-card',
      filterSelector: '.complaints-filters',
      filterFieldSelector: '.complaints-filter-field',
      snapshotSelector: '.complaints-ticket-grid',
      snapshotLabel: 'Complaint snapshot',
      metadataLabels: ['Department', 'Phone']
    },
    {
      bodyClass: 'free-orders-page',
      boardSelector: '#tickets',
      metricsSelector: '.free-orders-stats',
      columnSelector: '.free-orders-column',
      cardSelector: '.free-orders-ticket-card',
      filterSelector: '.free-orders-filters',
      filterFieldSelector: '.free-orders-filter-field',
      snapshotSelector: '.free-orders-ticket-discount',
      snapshotLabel: 'Order snapshot',
      metadataSelector: '.free-orders-ticket-grid'
    },
    {
      bodyClass: 'free-order-requests-page',
      boardSelector: '#requests-board',
      metricsSelector: '.stats-grid',
      columnSelector: '.stage-column',
      cardSelector: '.request-card',
      snapshotSelector: '.request-card-summary',
      metadataSelector: '.request-card-workflow'
    },
    {
      bodyClass: 'free-order-share-page',
      boardSelector: '#share-board',
      metricsSelector: '.stats-grid',
      columnSelector: '.share-column',
      cardSelector: '.share-card',
      snapshotSelector: '.share-card-summary',
      metadataSelector: '.share-card-decision, .share-card-creation'
    }
  ];

  const config = PAGE_CONFIGS.find((item) => document.body.classList.contains(item.bodyClass));
  if (!config) return;

  const mobileQuery = window.matchMedia('(max-width: 768px)');
  let activeStage = '';
  let filterExpanded = false;
  let board;
  let switcher;
  let filterToggle;
  let filterSecondary;

  function slug(value) {
    return String(value || 'stage')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'stage';
  }

  function directColumns() {
    return Array.from(board.children).filter((child) => child.matches(config.columnSelector));
  }

  function columnLabel(column) {
    return String(
      column.getAttribute('aria-label') ||
      column.querySelector('.cc-kanban__title, .col-title, h2')?.textContent ||
      'Stage'
    ).trim();
  }

  function columnCount(column) {
    return String(column.querySelector('.cc-kanban__count, .col-count, .count-pill')?.textContent || '0').trim();
  }

  function selectedFilterLabel() {
    const select = document.querySelector('#stage-filter, [id$="status-filter"]');
    if (!select || !select.value) return '';
    return String(select.selectedOptions?.[0]?.textContent || '').trim();
  }

  function applyMobileStage() {
    if (!board || !switcher) return;
    const columns = directColumns();
    const buttons = Array.from(switcher.querySelectorAll('[data-ticket-stage]'));
    const isMobile = mobileQuery.matches;

    columns.forEach((column) => {
      const isActive = columnLabel(column) === activeStage;
      column.classList.toggle('is-mobile-active', isActive);
      if (isMobile) column.setAttribute('aria-hidden', String(!isActive));
      else column.removeAttribute('aria-hidden');
    });

    buttons.forEach((button) => {
      const isActive = button.dataset.ticketStage === activeStage;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    });
  }

  function activateStage(label, moveFocus) {
    activeStage = label;
    applyMobileStage();
    if (moveFocus) {
      switcher.querySelector(`[data-ticket-stage="${CSS.escape(label)}"]`)?.focus();
    }
  }

  function onSwitcherKeydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(switcher.querySelectorAll('[data-ticket-stage]'));
    if (!buttons.length) return;
    const currentIndex = Math.max(0, buttons.indexOf(event.currentTarget));
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = buttons.length - 1;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % buttons.length;
    event.preventDefault();
    activateStage(buttons[nextIndex].dataset.ticketStage, true);
  }

  function enhanceCard(card) {
    if (card.dataset.ticketHarmonized === 'true') return;
    card.dataset.ticketHarmonized = 'true';
    card.classList.add('ticket-record');

    card.querySelector(
      '.ce-ticket-order, .complaints-ticket-case, .free-orders-ticket-order, .request-card-identity h3, .share-card-identity h3'
    )?.classList.add('ticket-record-title');
    card.querySelector(
      '.ce-ticket-customer, .complaints-ticket-customer, .free-orders-ticket-customer, .request-card-identity p, .share-card-identity p'
    )?.classList.add('ticket-record-secondary');

    const accent = document.createElement('div');
    accent.className = 'ticket-status-accent';
    accent.setAttribute('aria-hidden', 'true');
    const identityAnchor = card.querySelector(
      '.ce-ticket-customer, .complaints-ticket-customer, .free-orders-ticket-phone, .free-orders-ticket-customer, .card-head'
    );
    identityAnchor?.insertAdjacentElement('afterend', accent);

    const snapshot = card.querySelector(config.snapshotSelector);
    if (snapshot) {
      snapshot.classList.add('ticket-snapshot');
      if (config.snapshotLabel && !snapshot.querySelector('.ticket-snapshot-heading')) {
        const heading = document.createElement('div');
        heading.className = 'ticket-snapshot-heading';
        heading.textContent = config.snapshotLabel;
        snapshot.prepend(heading);
        snapshot.setAttribute('aria-label', config.snapshotLabel);
      }
    }

    if (config.metadataLabels?.length && snapshot) {
      const metadataFields = Array.from(snapshot.children).filter((field) => {
        const label = field.querySelector('strong')?.textContent?.trim();
        return label && config.metadataLabels.includes(label);
      });
      if (metadataFields.length) {
        const metadata = document.createElement('div');
        metadata.className = 'ticket-metadata-rows';
        metadataFields.forEach((field) => metadata.appendChild(field));
        snapshot.insertAdjacentElement('afterend', metadata);
      }
    }

    if (config.metadataSelector) {
      card.querySelectorAll(config.metadataSelector).forEach((metadata) => {
        metadata.classList.add('ticket-metadata-rows');
      });
    }
  }

  function syncBoard() {
    const columns = directColumns();
    columns.forEach((column) => column.classList.add('ticket-lane'));
    board.querySelectorAll(config.cardSelector).forEach(enhanceCard);

    if (!columns.length) {
      switcher.hidden = true;
      return;
    }

    switcher.hidden = false;
    switcher.style.setProperty('--switcher-count', String(columns.length));
    const labels = columns.map(columnLabel);
    const filteredLabel = selectedFilterLabel();
    if (filteredLabel && labels.includes(filteredLabel)) activeStage = filteredLabel;
    if (!labels.includes(activeStage)) {
      activeStage = columnLabel(columns.find((column) => Number(columnCount(column)) > 0) || columns[0]);
    }

    switcher.replaceChildren();
    columns.forEach((column, index) => {
      const label = columnLabel(column);
      const panelId = `${config.bodyClass}-${slug(label)}-panel`;
      const tabId = `${config.bodyClass}-${slug(label)}-tab`;
      column.id = panelId;
      column.setAttribute('role', 'tabpanel');
      column.setAttribute('aria-labelledby', tabId);

      const button = document.createElement('button');
      button.type = 'button';
      button.id = tabId;
      button.className = 'ticket-stage-tab';
      button.dataset.ticketStage = label;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', panelId);
      button.innerHTML = `<span>${label}</span><strong>${columnCount(column)}</strong>`;
      button.addEventListener('click', () => activateStage(label, false));
      button.addEventListener('keydown', onSwitcherKeydown);
      switcher.appendChild(button);
      if (index === 0 && !activeStage) activeStage = label;
    });

    applyMobileStage();
  }

  function syncFilterDisclosure() {
    if (!filterToggle || !filterSecondary) return;
    const isMobile = mobileQuery.matches;
    filterToggle.hidden = !isMobile;
    filterSecondary.hidden = isMobile && !filterExpanded;
    filterToggle.setAttribute('aria-expanded', String(isMobile && filterExpanded));
  }

  function setupFilterDisclosure() {
    if (!config.filterSelector || !config.filterFieldSelector) return;
    const filter = document.querySelector(config.filterSelector);
    if (!filter) return;
    const fields = Array.from(filter.querySelectorAll(`:scope > ${config.filterFieldSelector}`));
    if (fields.length < 2) return;

    filterToggle = document.createElement('button');
    filterToggle.type = 'button';
    filterToggle.className = 'ticket-filter-toggle';
    filterToggle.textContent = 'Filters';
    filterToggle.setAttribute('aria-controls', `${config.bodyClass}-secondary-filters`);
    filterToggle.addEventListener('click', () => {
      filterExpanded = !filterExpanded;
      syncFilterDisclosure();
    });

    filterSecondary = document.createElement('div');
    filterSecondary.id = `${config.bodyClass}-secondary-filters`;
    filterSecondary.className = 'ticket-filter-secondary';
    fields.slice(1).forEach((field) => filterSecondary.appendChild(field));
    fields[0].insertAdjacentElement('afterend', filterToggle);
    filterToggle.insertAdjacentElement('afterend', filterSecondary);
    syncFilterDisclosure();
  }

  function initialize() {
    board = document.querySelector(config.boardSelector);
    if (!board) return;
    document.body.classList.add('ticket-harmonized-page');
    document.querySelector(config.metricsSelector)?.classList.add('ticket-metrics');
    const filters = config.filterSelector ? document.querySelector(config.filterSelector) : null;
    filters?.classList.add('ticket-filters');
    filters?.querySelector('input[type="search"]')?.classList.add('ticket-filter-search');
    board.classList.add('ticket-board');
    switcher = document.createElement('div');
    switcher.className = 'ticket-stage-switcher';
    switcher.setAttribute('role', 'tablist');
    switcher.setAttribute('aria-label', 'Workflow stages');
    board.insertAdjacentElement('beforebegin', switcher);
    setupFilterDisclosure();
    syncBoard();

    new MutationObserver(syncBoard).observe(board, { childList: true });
    mobileQuery.addEventListener('change', () => {
      applyMobileStage();
      syncFilterDisclosure();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
