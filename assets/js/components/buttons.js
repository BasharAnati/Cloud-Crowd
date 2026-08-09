(function (global) {
  "use strict";

  const ORIGINAL_LABEL = "ccOriginalLabel";

  function variantFor(control) {
    if (control.id === "save-negative-btn") return "warning";
    if (control.id === "positive-btn") return "success";
    if (control.classList.contains("cc-shell-logout")) return "outline";
    if (control.classList.contains("cc-shell-maintenance-toggle")) return "warning";
    if (control.matches("a[href='free-order-requests.html']")) return "outline";
    if (control.matches(".danger-btn, .delete-btn, .remove-row, .btn.danger")) return "danger";
    if (control.matches(".done-btn")) return "success";
    if (control.matches(".warn-btn, .btn.warning")) return "warning";
    if (control.matches(".secondary-btn, .cancel-btn, .small-btn, .details-btn, .modal-close, .btn.secondary")) return "secondary";
    if (control.matches(".drawer-close, .icon-btn, .cc-media-viewer__close, .history-modal__close")) return "ghost";
    if (control.matches(".primary-btn, .add-ticket-btn, .submit-btn, .save-btn, .edit-btn, .btn")) return "primary";
    if (control.matches(".cc-theme-toggle, .cc-shell-nav-trigger, .cc-shell-mobile-close")) return "secondary";
    return "ghost";
  }

  function sizeFor(control) {
    if (control.matches(".small-btn, .details-btn, .delete-btn, .remove-row")) return "sm";
    return "md";
  }

  function isButtonLike(control) {
    return control.matches([
      "button", "a.primary-btn", "a.secondary-btn", "a.small-btn", "a.danger-btn",
      ".cc-shell-logout", ".cc-shell-maintenance-toggle", ".cc-theme-toggle"
    ].join(","));
  }

  function enhance(control) {
    if (!control || control.nodeType !== 1 || !isButtonLike(control)) return control;
    if (control.classList.contains("ticket") || control.classList.contains("employee-select") ||
        control.classList.contains("cc-shell-nav-backdrop")) return control;

    const variant = variantFor(control);
    const size = sizeFor(control);
    control.classList.add("cc-button", `cc-button--${variant}`, `cc-button--${size}`);
    if (control.matches(".drawer-close, .icon-btn, .cc-media-viewer__close, .remove-row")) {
      control.classList.add("cc-icon-button");
    }
    return control;
  }

  function enhanceAll(root) {
    const scope = root && root.querySelectorAll ? root : document;
    if (scope.nodeType === 1) enhance(scope);
    scope.querySelectorAll([
      "button", "a.primary-btn", "a.secondary-btn", "a.small-btn", "a.danger-btn",
      ".cc-shell-logout", ".cc-shell-maintenance-toggle", ".cc-theme-toggle"
    ].join(",")).forEach(enhance);
  }

  function setLoading(control, loading, label) {
    if (!control) return;
    enhance(control);
    if (loading) {
      if (control.dataset[ORIGINAL_LABEL] === undefined) {
        control.dataset[ORIGINAL_LABEL] = control.textContent || "";
      }
      if (control.dataset.ccLoadingMinWidth === undefined) {
        control.dataset.ccLoadingMinWidth = control.style.minWidth || "";
        const width = control.getBoundingClientRect ? control.getBoundingClientRect().width : control.offsetWidth;
        if (width) control.style.minWidth = `${width}px`;
      }
      if (control.dataset.ccLoadingDisabled === undefined) {
        control.dataset.ccLoadingDisabled = control.disabled ? "true" : "false";
      }
      control.disabled = true;
      control.classList.add("is-loading");
      control.setAttribute("aria-busy", "true");
      if (label) control.textContent = label;
      return;
    }
    if (control.dataset.ccLoadingDisabled !== undefined) {
      control.disabled = control.dataset.ccLoadingDisabled === "true";
      delete control.dataset.ccLoadingDisabled;
    }
    control.classList.remove("is-loading");
    control.removeAttribute("aria-busy");
    if (control.dataset[ORIGINAL_LABEL] !== undefined) {
      control.textContent = control.dataset[ORIGINAL_LABEL];
      delete control.dataset[ORIGINAL_LABEL];
    }
    if (control.dataset.ccLoadingMinWidth !== undefined) {
      control.style.minWidth = control.dataset.ccLoadingMinWidth;
      delete control.dataset.ccLoadingMinWidth;
    }
    global.CloudCrowdIcons?.enhance(control);
  }

  function init() {
    enhanceAll(document);
    if (typeof global.MutationObserver === "function") {
      const observer = new global.MutationObserver((records) => {
        records.forEach((record) => record.addedNodes.forEach((node) => {
          if (node.nodeType === 1) enhanceAll(node);
        }));
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  global.CloudCrowdButtons = Object.freeze({ enhance, enhanceAll, setLoading });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
