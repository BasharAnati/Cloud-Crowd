(function confirmationFoundation(global) {
  "use strict";

  let active = false;
  let sequence = 0;

  function request(message, options) {
    if (active || typeof document === "undefined" || !document.body) return Promise.resolve(false);
    active = true;
    const settings = options || {};
    const destructive = settings.intent === "danger" || settings.intent === "destructive";
    const previousFocus = document.activeElement;

    return new Promise((resolve) => {
      const id = `cc-confirmation-overlay-${++sequence}`;
      const backdrop = document.createElement("div");
      backdrop.id = id;
      backdrop.className = "cc-confirmation-backdrop cc-dialog";

      const dialog = document.createElement("section");
      dialog.className = "cc-confirmation cc-dialog__panel cc-dialog__panel--sm";
      dialog.setAttribute("data-cc-overlay-panel", "");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "cc-confirmation-title");
      dialog.setAttribute("aria-describedby", "cc-confirmation-message");

      const title = document.createElement("h2");
      title.id = "cc-confirmation-title";
      title.className = "cc-confirmation__title cc-dialog__title";
      title.textContent = settings.title || "Please confirm";

      const copy = document.createElement("p");
      copy.id = "cc-confirmation-message";
      copy.className = "cc-confirmation__message";
      copy.textContent = String(message || "Are you sure?");

      const actions = document.createElement("div");
      actions.className = "cc-confirmation__actions";

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "cc-button cc-button--secondary cc-button--md";
      cancel.textContent = settings.cancelLabel || "Cancel";

      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = `cc-button cc-button--${destructive ? "danger" : "primary"} cc-button--md`;
      confirm.textContent = settings.confirmLabel || "Confirm";

      actions.append(cancel, confirm);
      dialog.append(title, copy, actions);
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);

      if (global.CloudCrowdIcons) {
        global.CloudCrowdIcons.leadingIcon(cancel, "x");
        global.CloudCrowdIcons.leadingIcon(confirm, destructive ? "trash-2" : "check");
      }

      if (!global.CloudCrowdOverlay) {
        let legacySettled = false;
        function legacyFinish(value) {
          if (legacySettled) return;
          legacySettled = true;
          document.removeEventListener("keydown", legacyKeydown);
          backdrop.remove();
          active = false;
          if (previousFocus?.isConnected !== false) previousFocus?.focus?.();
          resolve(value);
        }
        function legacyKeydown(event) {
          if (event.key === "Escape") { event.preventDefault(); legacyFinish(false); return; }
          if (event.key !== "Tab") return;
          if (event.shiftKey && document.activeElement === cancel) { event.preventDefault(); confirm.focus(); }
          else if (!event.shiftKey && document.activeElement === confirm) { event.preventDefault(); cancel.focus(); }
        }
        cancel.addEventListener("click", () => legacyFinish(false));
        confirm.addEventListener("click", () => legacyFinish(true));
        backdrop.addEventListener("click", (event) => { if (event.target === backdrop) legacyFinish(false); });
        document.addEventListener("keydown", legacyKeydown);
        global.setTimeout?.(() => cancel.focus(), 0);
        return;
      }

      let settled = false;
      let result = false;
      function finish(nextResult, reason) {
        if (settled) return;
        result = nextResult;
        global.CloudCrowdOverlay.close(id, { reason });
      }

      global.CloudCrowdOverlay.register(backdrop, {
        type: "confirmation",
        panel: dialog,
        dismissOnEscape: true,
        dismissOnBackdrop: true,
        initialFocus: cancel,
        lockScroll: true,
        onAfterClose() {
          if (settled) return;
          settled = true;
          backdrop.remove();
          global.CloudCrowdOverlay.unregister(id);
          active = false;
          resolve(result);
        }
      });

      cancel.addEventListener("click", () => finish(false, "cancel"));
      confirm.addEventListener("click", () => finish(true, "confirm"));
      global.CloudCrowdOverlay.open(id);
    });
  }

  global.CloudCrowdConfirmation = Object.freeze({ request });
})(typeof window !== "undefined" ? window : globalThis);
