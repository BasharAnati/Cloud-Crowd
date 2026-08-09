(function confirmationFoundation(global) {
  "use strict";

  let active = false;

  function request(message, options) {
    if (active || typeof document === "undefined" || !document.body) return Promise.resolve(false);
    active = true;
    const settings = options || {};
    const destructive = settings.intent === "danger" || settings.intent === "destructive";
    const previousFocus = document.activeElement;

    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "cc-confirmation-backdrop";

      const dialog = document.createElement("section");
      dialog.className = "cc-confirmation";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "cc-confirmation-title");
      dialog.setAttribute("aria-describedby", "cc-confirmation-message");

      const title = document.createElement("h2");
      title.id = "cc-confirmation-title";
      title.className = "cc-confirmation__title";
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
      document.body.classList.add("cc-confirmation-open");

      if (global.CloudCrowdIcons) {
        global.CloudCrowdIcons.leadingIcon(cancel, "x");
        global.CloudCrowdIcons.leadingIcon(confirm, destructive ? "trash-2" : "check");
      }

      let settled = false;
      function finish(result) {
        if (settled) return;
        settled = true;
        document.removeEventListener("keydown", onKeydown);
        backdrop.remove();
        document.body.classList.remove("cc-confirmation-open");
        active = false;
        if (previousFocus && typeof previousFocus.focus === "function" && previousFocus.isConnected !== false) {
          previousFocus.focus();
        }
        resolve(result);
      }

      function onKeydown(event) {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
          return;
        }
        if (event.key !== "Tab") return;
        const first = cancel;
        const last = confirm;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }

      cancel.addEventListener("click", () => finish(false));
      confirm.addEventListener("click", () => finish(true));
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) finish(false);
      });
      document.addEventListener("keydown", onKeydown);
      global.setTimeout(() => cancel.focus(), 0);
    });
  }

  global.CloudCrowdConfirmation = Object.freeze({ request });
})(typeof window !== "undefined" ? window : globalThis);
