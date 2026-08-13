(function (global) {
  'use strict';

  const DEFAULT_BREAKPOINT = '(max-width: 900px)';
  const STYLESHEET = 'assets/css/components/master-detail.css';

  function ensureStylesheet() {
    const document = global.document;
    if (!document?.head || document.querySelector?.(`link[href="${STYLESHEET}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLESHEET;
    link.dataset.ccComponent = 'master-detail';
    document.head.appendChild(link);
  }

  ensureStylesheet();

  function safeFocus(element) {
    if (!element || typeof element.focus !== 'function') return false;
    try { element.focus({ preventScroll: true }); }
    catch { element.focus(); }
    return true;
  }

  function create(options = {}) {
    const root = options.root;
    const list = options.list;
    const detail = options.detail;
    if (!root || !list || !detail) throw new Error('Master/Detail requires root, list, and detail elements.');

    const media = options.mediaQuery || global.matchMedia?.(options.breakpoint || DEFAULT_BREAKPOINT);
    const historyAdapter = options.history || null;
    const announcement = options.announcement || null;
    const hiddenNotice = options.hiddenNotice || null;
    const historyKey = String(options.historyKey || 'master-detail');
    let selectedId = '';
    let routeId = '';
    let originId = '';
    let view = 'list';

    function isMobile() {
      return Boolean(media?.matches);
    }

    function applyView(nextView) {
      view = nextView === 'detail' ? 'detail' : 'list';
      root.dataset.view = view;
      if (!isMobile()) {
        list.hidden = false;
        detail.hidden = false;
        return;
      }
      list.hidden = view !== 'list';
      detail.hidden = view !== 'detail';
    }

    function announce(message) {
      if (!announcement) return;
      announcement.textContent = '';
      global.setTimeout?.(() => { announcement.textContent = String(message || ''); }, 0);
    }

    function focusDetail() {
      if (!isMobile()) return false;
      return safeFocus(options.getDetailFocus?.() || detail);
    }

    function focusList(preferredId = originId || selectedId) {
      const preferred = preferredId ? options.getItem?.(preferredId) : null;
      if (preferred && !preferred.hidden && preferred.getClientRects?.().length !== 0) return safeFocus(preferred);
      return safeFocus(options.getListFallback?.() || list);
    }

    function historyMarker(nextView, fromList = false) {
      return { key: historyKey, view: nextView, fromList };
    }

    function readHistoryMarker() {
      const marker = historyAdapter?.readState?.()?.ccMasterDetail;
      return marker?.key === historyKey ? marker : null;
    }

    function writeHistory(id, mode, marker, force = false) {
      if (!historyAdapter || mode === 'none') return;
      const current = String(historyAdapter.read?.() || '');
      const next = String(id || '');
      if (current === next && !force) return;
      historyAdapter.write?.(next, mode, { ccMasterDetail: marker });
    }

    function showDetail(id, settings = {}) {
      selectedId = String(id || '');
      routeId = String(settings.routeId === undefined ? selectedId : settings.routeId || '');
      if (settings.rememberOrigin !== false && selectedId) originId = selectedId;
      const historyMode = settings.historyMode || (isMobile() ? 'push' : 'replace');
      if (settings.updateHistory !== false && historyMode === 'push' && isMobile()) {
        writeHistory('', 'replace', historyMarker('list'), true);
        writeHistory(routeId, 'push', historyMarker('detail', true));
      } else {
        writeHistory(routeId, settings.updateHistory === false ? 'none' : historyMode, historyMarker('detail'));
      }
      applyView('detail');
      if (settings.focus === true) {
        if (isMobile()) focusDetail();
        else focusList(selectedId);
      }
    }

    function showList(settings = {}) {
      if (settings.clearSelection !== false) selectedId = '';
      routeId = '';
      writeHistory('', settings.updateHistory === false ? 'none' : (settings.historyMode || 'replace'), historyMarker('list'));
      applyView('list');
      if (settings.restoreFocus !== false) focusList(settings.restoreId);
    }

    function backToList(settings = {}) {
      const marker = readHistoryMarker();
      if (isMobile() && marker?.view === 'detail' && marker.fromList && historyAdapter?.back) {
        historyAdapter.back();
        return 'history';
      }
      showList({
        historyMode: 'replace',
        restoreFocus: settings.restoreFocus,
        restoreId: settings.restoreId,
        updateHistory: true
      });
      return 'replace';
    }

    function setSelectionHidden(hidden) {
      if (!hiddenNotice) return;
      hiddenNotice.hidden = !hidden;
    }

    function renderState(settings = {}) {
      const state = String(settings.state || 'empty-selection');
      const semanticRole = ['status', 'alert'].includes(settings.role) ? ` role="${settings.role}"` : '';
      detail.innerHTML = `
        <div class="cc-master-detail__state" data-state="${state}"${semanticRole}>
          ${settings.eyebrow ? `<p>${settings.eyebrow}</p>` : ''}
          <h2 class="cc-section-title" tabindex="-1" data-cc-detail-focus>${settings.title || ''}</h2>
          ${settings.message ? `<p>${settings.message}</p>` : ''}
          ${settings.action || ''}
        </div>
      `;
    }

    async function handlePopState() {
      const id = String(historyAdapter?.read?.() || '');
      if (!id) {
        showList({ updateHistory: false, restoreFocus: false });
        await options.onNavigate?.('', { source: 'popstate' });
        focusList();
        return;
      }
      routeId = id;
      selectedId = id;
      originId = id;
      applyView('detail');
      await options.onNavigate?.(id, { source: 'popstate' });
    }

    function syncInitial(id, settings = {}) {
      routeId = String(id || '');
      selectedId = String(settings.selectedId === undefined ? routeId : settings.selectedId || '');
      if (selectedId) originId = selectedId;
      if (routeId) {
        applyView('detail');
      } else {
        applyView('list');
      }
    }

    function handleMediaChange() {
      applyView(view);
      if (!isMobile()) return;
      const activeElement = global.document?.activeElement;
      if (view === 'detail' && list.contains?.(activeElement)) focusDetail();
      if (view === 'list' && detail.contains?.(activeElement)) focusList();
    }

    hiddenNotice?.querySelector?.('[data-cc-master-detail-reset]')?.addEventListener('click', () => {
      options.onResetFilters?.();
    });
    media?.addEventListener?.('change', handleMediaChange);
    global.addEventListener?.('popstate', handlePopState);

    return {
      announce,
      applyView,
      backToList,
      focusDetail,
      focusList,
      getFocusOriginId: () => originId,
      getRouteId: () => routeId,
      getSelectedId: () => selectedId,
      getView: () => view,
      isMobile,
      renderState,
      setSelectionHidden,
      showDetail,
      showList,
      syncInitial
    };
  }

  global.CloudCrowdMasterDetail = { create, ensureStylesheet, safeFocus };
})(window);
