(function overlayFoundation(global) {
  "use strict";

  const registry = new Map();
  const stack = [];
  const lockOwners = new Set();
  const FOCUSABLE = [
    "a[href]", "area[href]", "button:not([disabled])", "input:not([disabled]):not([type='hidden'])",
    "select:not([disabled])", "textarea:not([disabled])", "iframe", "object", "embed",
    "[contenteditable]", "[tabindex]:not([tabindex='-1'])"
  ].join(",");

  function resolveElement(value, root) {
    if (!value) return null;
    if (typeof value === "function") return value(root) || null;
    if (typeof value === "string") return root?.querySelector?.(value) || null;
    return value;
  }

  function focusables(entry) {
    if (!entry?.panel?.querySelectorAll) return [];
    return Array.from(entry.panel.querySelectorAll(FOCUSABLE)).filter((element) => {
      if (element.hidden || element.getAttribute?.("aria-hidden") === "true") return false;
      if (typeof element.getClientRects === "function" && element.getClientRects().length === 0) return false;
      return true;
    });
  }

  function focusElement(element) {
    if (!element || typeof element.focus !== "function") return false;
    if (element.isConnected === false || element.hidden || element.getAttribute?.("aria-hidden") === "true") return false;
    for (const candidate of registry.values()) {
      if (!isOpen(candidate.id) && candidate.element !== element && candidate.element.contains?.(element)) return false;
    }
    try { element.focus({ preventScroll: true }); }
    catch { element.focus(); }
    const ownerDocument = element.ownerDocument || (typeof document !== "undefined" ? document : null);
    return !ownerDocument || !("activeElement" in ownerDocument) || ownerDocument.activeElement === element;
  }

  function focusPageFallback() {
    if (typeof document === "undefined") return false;
    const candidates = document.querySelectorAll?.(
      "[data-cc-focus-fallback], main, button:not([disabled]), a[href], input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), [tabindex]"
    ) || [];
    return Array.from(candidates).some((candidate) => focusElement(candidate));
  }

  function transferRestorationAncestry(entry, index) {
    for (let position = index + 1; position < stack.length; position += 1) {
      const descendant = stack[position];
      if (descendant.trigger && entry.element.contains?.(descendant.trigger)) descendant.trigger = entry.trigger;
    }
  }

  function syncLock() {
    if (typeof document === "undefined" || !document.body) return;
    document.body.classList.toggle("cc-modal-lock", lockOwners.size > 0);
  }

  function acquire(ownerId) {
    if (!ownerId) return;
    lockOwners.add(ownerId);
    syncLock();
  }

  function release(ownerId) {
    if (!ownerId) return;
    lockOwners.delete(ownerId);
    syncLock();
  }

  function normalize(elementOrId, options) {
    const element = typeof elementOrId === "string"
      ? document.getElementById(elementOrId)
      : elementOrId;
    if (!element) throw new Error("Overlay element not found.");
    if (!element.id) throw new Error("Overlay elements require a stable id.");
    const settings = options || {};
    const panel = resolveElement(settings.panel, element)
      || element.querySelector?.("[data-cc-overlay-panel], .cc-dialog__panel, .cc-drawer__panel, [role='dialog']")
      || element;
    if (settings.type === "drawer") {
      element.classList.add("cc-drawer");
      panel.classList.add("cc-drawer__panel");
    } else if (settings.type !== "media") {
      element.classList.add("cc-dialog");
      panel.classList.add("cc-dialog__panel");
      panel.querySelector?.(".modal-header")?.classList.add("cc-dialog__header");
      panel.querySelector?.(".modal-body")?.classList.add("cc-dialog__body");
      panel.querySelector?.(".cc-modal-title")?.classList.add("cc-dialog__title");
      const closeControl = panel.querySelector?.("[data-cc-overlay-close], [data-close-modal], #details-modal-close, .modal-close");
      if (closeControl) {
        closeControl.classList.add("cc-dialog__close");
        if (closeControl.tagName === "BUTTON" && !closeControl.getAttribute("type")) closeControl.setAttribute("type", "button");
      }
    }
    if (settings.panelClass) panel.classList.add(settings.panelClass);
    if (panel !== element && element.getAttribute?.("role") === "dialog") {
      for (const attribute of ["role", "aria-modal", "aria-labelledby", "aria-describedby"]) {
        const value = element.getAttribute(attribute);
        if (value !== null) panel.setAttribute(attribute, value);
      }
      element.removeAttribute("role");
      element.removeAttribute("aria-modal");
      element.removeAttribute("aria-labelledby");
      element.removeAttribute("aria-describedby");
    }
    return {
      id: element.id,
      element,
      panel,
      type: settings.type || "dialog",
      openClass: settings.openClass || (settings.type === "media" || settings.type === "history" ? "is-open" : "open"),
      dismissOnEscape: settings.dismissOnEscape !== false,
      dismissOnBackdrop: settings.dismissOnBackdrop === true,
      backdrop: settings.backdrop || null,
      initialFocus: settings.initialFocus || null,
      lockScroll: settings.lockScroll !== false,
      onBeforeClose: settings.onBeforeClose,
      onAfterClose: settings.onAfterClose,
      trigger: null
    };
  }

  function register(elementOrId, options) {
    const entry = normalize(elementOrId, options);
    registry.set(entry.id, entry);
    entry.element.setAttribute("aria-hidden", isOpen(entry.id) ? "false" : "true");
    return entry;
  }

  function unregister(id) {
    if (isOpen(id)) close(id, { reason: "unregister", restoreFocus: false });
    registry.delete(id);
  }

  function find(id) {
    return registry.get(typeof id === "string" ? id : id?.id);
  }

  function top() {
    return stack.length ? stack[stack.length - 1] : null;
  }

  function isOpen(id) {
    return stack.some((entry) => entry.id === (typeof id === "string" ? id : id?.id));
  }

  function chooseInitial(entry, override) {
    if (!entry) return null;
    const explicit = resolveElement(override || entry.initialFocus, entry.element);
    if (explicit) return explicit;
    const autofocus = entry.element.querySelector?.("[autofocus]");
    if (autofocus) return autofocus;
    if (entry.type === "dialog" || entry.type === "confirmation") {
      const field = entry.element.querySelector?.("input:not([type='hidden']):not([disabled]), select:not([disabled]), textarea:not([disabled])");
      if (field) return field;
    }
    return entry.element.querySelector?.("[data-cc-overlay-close], .cc-dialog__close, .drawer-close, .history-modal__close, .cc-media-viewer__close")
      || focusables(entry)[0]
      || entry.panel;
  }

  function open(id, options) {
    const entry = find(id);
    if (!entry) throw new Error(`Overlay is not registered: ${id}`);
    const settings = options || {};
    const previousIndex = stack.indexOf(entry);
    if (previousIndex >= 0) stack.splice(previousIndex, 1);
    entry.trigger = settings.trigger || document.activeElement || entry.trigger;
    stack.push(entry);
    if (entry.element.parentNode?.appendChild) entry.element.parentNode.appendChild(entry.element);
    entry.element.classList.add(entry.openClass);
    entry.element.removeAttribute?.("hidden");
    entry.element.setAttribute("aria-hidden", "false");
    if (entry.lockScroll) acquire(entry.id);
    global.setTimeout?.(() => focusElement(chooseInitial(entry, settings.initialFocus)), 0);
    return entry;
  }

  function close(id, options) {
    const entry = find(id);
    if (!entry) return false;
    const index = stack.indexOf(entry);
    if (index < 0) return false;
    const settings = options || {};
    const detail = { reason: settings.reason || "api", entry };
    if (typeof entry.onBeforeClose === "function" && entry.onBeforeClose(detail) === false) return false;
    const wasTopmost = index === stack.length - 1;
    transferRestorationAncestry(entry, index);
    stack.splice(index, 1);
    entry.element.classList.remove(entry.openClass);
    entry.element.setAttribute("aria-hidden", "true");
    if (entry.lockScroll) release(entry.id);
    const parent = top();
    if (wasTopmost && settings.restoreFocus !== false) {
      if (!focusElement(entry.trigger) && !focusElement(chooseInitial(parent))) focusPageFallback();
    }
    if (typeof entry.onAfterClose === "function") entry.onAfterClose(detail);
    return true;
  }

  function backdropMatches(entry, target) {
    if (target === entry.element) return true;
    if (!entry.backdrop) return false;
    if (typeof entry.backdrop === "string") return Boolean(target?.matches?.(entry.backdrop));
    return target === entry.backdrop;
  }

  function onClick(event) {
    const entry = top();
    if (!entry || !backdropMatches(entry, event.target)) return;
    if (!entry.dismissOnBackdrop) {
      event.stopImmediatePropagation?.();
      event.stopPropagation?.();
      return;
    }
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
    close(entry.id, { reason: "backdrop" });
  }

  function onKeydown(event) {
    const entry = top();
    if (!entry) return;
    if (event.key === "Escape" && entry.dismissOnEscape) {
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      event.stopPropagation?.();
      close(entry.id, { reason: "escape" });
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(entry);
    if (!items.length) {
      event.preventDefault?.();
      focusElement(entry.panel);
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !entry.element.contains?.(active))) {
      event.preventDefault?.();
      focusElement(last);
    } else if (!event.shiftKey && (active === last || !entry.element.contains?.(active))) {
      event.preventDefault?.();
      focusElement(first);
    }
  }

  if (typeof document !== "undefined") {
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("DOMContentLoaded", () => {
      document.querySelectorAll(".modal[role='dialog']").forEach((element) => {
        if (registry.has(element.id)) return;
        register(element, {
          type: "dialog",
          panel: ".modal-panel",
          dismissOnEscape: true,
          dismissOnBackdrop: element.dataset.ccDismissBackdrop !== "false",
          lockScroll: true
        });
      });
    });
  }

  global.CloudCrowdOverlay = Object.freeze({
    register, unregister, open, close, top, isOpen,
    locks: Object.freeze({ acquire, release, has: (id) => lockOwners.has(id), size: () => lockOwners.size })
  });
})(typeof window !== "undefined" ? window : globalThis);
