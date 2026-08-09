(function feedbackFoundation(global) {
  "use strict";

  const VARIANTS = new Set(["info", "success", "warning", "error"]);
  const timers = new WeakMap();
  const generations = new WeakMap();

  function documentAvailable() {
    return typeof document !== "undefined" && document.body;
  }

  function resolveTarget(target) {
    if (!documentAvailable()) return null;
    if (typeof target === "string") return document.getElementById(target) || document.querySelector(target);
    return target || null;
  }

  function normalizeVariant(variant) {
    return VARIANTS.has(variant) ? variant : "info";
  }

  function clearTimer(target) {
    const timer = timers.get(target);
    if (timer) global.clearTimeout(timer);
    timers.delete(target);
  }

  function apply(target, message, variant, presentation, options) {
    const element = resolveTarget(target);
    if (!element) return null;

    clearTimer(element);
    const nextGeneration = (generations.get(element) || 0) + 1;
    generations.set(element, nextGeneration);

    const normalized = normalizeVariant(variant);
    element.classList.add("cc-feedback", `cc-feedback--${presentation}`);
    VARIANTS.forEach((candidate) => element.classList.remove(`cc-feedback--${candidate}`));
    element.classList.add(`cc-feedback--${normalized}`);
    element.setAttribute("role", normalized === "error" ? "alert" : "status");
    element.setAttribute("aria-live", normalized === "error" ? "assertive" : "polite");
    element.setAttribute("aria-atomic", "true");
    element.textContent = String(message || "");
    element.hidden = !message;

    const duration = Number(options && options.duration);
    if (message && duration > 0) {
      timers.set(element, global.setTimeout(() => {
        if (generations.get(element) !== nextGeneration) return;
        element.textContent = "";
        element.hidden = true;
        timers.delete(element);
      }, duration));
    }

    return element;
  }

  function ensureInlineRegion(id, container) {
    if (!documentAvailable()) return null;
    const host = resolveTarget(container) || document.querySelector("main") || document.body;
    const existing = id ? document.getElementById(id) : null;
    if (existing) {
      if (existing.parentNode !== host) host.appendChild(existing);
      return existing;
    }
    const region = document.createElement("div");
    if (id) region.id = id;
    region.hidden = true;
    region.className = "cc-feedback cc-feedback--inline cc-feedback--info";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    host.appendChild(region);
    return region;
  }

  function ensureToastRegion(assertive) {
    if (!documentAvailable()) return null;
    const id = assertive ? "cc-toast-region-assertive" : "cc-toast-region-polite";
    let region = document.getElementById(id);
    if (region) return region;
    region = document.createElement("div");
    region.id = id;
    region.className = "cc-toast-region";
    region.setAttribute("aria-live", assertive ? "assertive" : "polite");
    region.setAttribute("aria-atomic", "false");
    region.setAttribute("aria-relevant", "additions");
    document.body.appendChild(region);
    return region;
  }

  function toast(message, variant, options) {
    const normalized = normalizeVariant(variant);
    const region = ensureToastRegion(normalized === "error");
    if (!region) return null;
    const element = document.createElement("div");
    element.className = `cc-feedback cc-feedback--toast cc-feedback--${normalized}`;
    element.textContent = String(message || "");
    region.appendChild(element);
    const duration = Math.max(1000, Number(options && options.duration) || 5000);
    global.setTimeout(() => element.remove(), duration);
    return element;
  }

  function clear(target) {
    const element = resolveTarget(target);
    if (!element) return;
    clearTimer(element);
    generations.set(element, (generations.get(element) || 0) + 1);
    element.textContent = "";
    element.hidden = true;
  }

  global.CloudCrowdFeedback = Object.freeze({
    ensureInlineRegion,
    inline(target, message, variant, options) {
      return apply(target, message, variant, "inline", options || {});
    },
    banner(target, message, variant) {
      return apply(target, message, variant, "banner", {});
    },
    toast,
    clear
  });
})(typeof window !== "undefined" ? window : globalThis);
