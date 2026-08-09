(function (global) {
  "use strict";

  function icon(name, size = "md") {
    const svg = global.CloudCrowdLucide.createIcon(name);
    svg.classList.add("cc-icon", `cc-icon--${size}`);
    return svg;
  }

  function setIcon(host, name, size = "md") {
    if (!host || !name) return null;
    while (host.firstChild) host.removeChild(host.firstChild);
    const svg = icon(name, size);
    host.appendChild(svg);
    host.dataset.ccIconRendered = name;
    return svg;
  }

  function leadingIcon(control, name, size = "md") {
    if (!control || !name || control.querySelector(":scope > [data-cc-leading-icon-host]")) return;
    const host = document.createElement("span");
    host.className = "cc-icon-host";
    host.dataset.ccLeadingIconHost = name;
    host.setAttribute("aria-hidden", "true");
    host.appendChild(icon(name, size));
    control.insertBefore(host, control.firstChild);
  }

  function inferredLeadingIcon(control) {
    const text = (control.textContent || "").trim().toLowerCase();
    if (control.id === "refresh-users-btn") return "refresh-cw";
    if (control.matches("[data-back-to-directory]")) return "arrow-left";
    if (control.matches("[data-archive-id]") || text.startsWith("archive")) return "archive";
    if (control.matches("[data-delete-id], #drawer-delete-btn, [data-disable-user]") || text.startsWith("delete") || text.startsWith("disable")) return "trash-2";
    if (control.matches("[data-edit-id], [data-edit-user], #drawer-edit-btn") || text === "edit") return "pencil";
    if (control.matches("[data-view-id], [data-details-id]") || /^view\b/.test(text)) return "eye";
    if (control.matches(".cc-media-viewer-trigger") || /^open\b/.test(text)) return "external-link";
    if (/^(\+\s*)?(add|new|create)\b/.test(text)) return "plus";
    return "";
  }

  function cleanLeadingPlus(control) {
    for (const node of control.childNodes) {
      if (node.nodeType === 3 && /^\s*\+\s*/.test(node.textContent)) {
        node.textContent = node.textContent.replace(/^\s*\+\s*/, "");
        break;
      }
    }
  }

  function enhance(control) {
    if (!control || control.nodeType !== 1) return;
    if (control.matches(".cc-shell-module-icon[data-cc-icon]")) {
      setIcon(control, control.dataset.ccIcon, "lg");
      return;
    }
    if (control.matches("[data-cc-icon]")) {
      setIcon(control, control.dataset.ccIcon, control.dataset.ccIconSize || "md");
      return;
    }
    if (control.matches(".cc-theme-toggle__icon")) {
      const preference = control.closest(".cc-theme-toggle")?.dataset.themePreference || "system";
      setIcon(control, { light: "sun", dark: "moon", system: "monitor" }[preference], "sm");
      return;
    }
    if (control.matches(".drawer-close, .icon-btn, .cc-media-viewer__close, .remove-row")) {
      if (!control.getAttribute("aria-label")) return;
      setIcon(control, "x", "md");
      return;
    }
    if (control.matches(".cc-shell-nav-trigger")) leadingIcon(control, "menu");
    else if (control.matches(".cc-shell-mobile-close")) leadingIcon(control, "x");
    else if (control.matches(".cc-shell-logout")) leadingIcon(control, "log-out");
    else if (control.matches(".history-link")) leadingIcon(control, "history", "sm");
    else {
      const inferred = inferredLeadingIcon(control);
      if (inferred) {
        if (inferred === "plus") cleanLeadingPlus(control);
        leadingIcon(control, inferred, control.matches(".small-btn, .details-btn, .delete-btn") ? "sm" : "md");
      }
    }
  }

  function enhanceAll(root) {
    const scope = root && root.querySelectorAll ? root : document;
    if (scope.nodeType === 1) enhance(scope);
    scope.querySelectorAll([
      ".cc-shell-module-icon[data-cc-icon]", "[data-cc-icon]", ".cc-theme-toggle__icon",
      ".drawer-close", ".icon-btn", ".cc-media-viewer__close", ".remove-row",
      ".cc-shell-nav-trigger", ".cc-shell-mobile-close", ".cc-shell-logout", ".history-link",
      "button", "a.primary-btn", "a.secondary-btn", "a.small-btn"
    ].join(",")).forEach(enhance);
  }

  function init() {
    enhanceAll(document);
    if (typeof global.MutationObserver === "function") {
      const observer = new global.MutationObserver((records) => records.forEach((record) => {
        record.addedNodes.forEach((node) => { if (node.nodeType === 1) enhanceAll(node); });
      }));
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  global.CloudCrowdIcons = Object.freeze({ icon, setIcon, render: setIcon, leadingIcon, enhance, enhanceAll });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
