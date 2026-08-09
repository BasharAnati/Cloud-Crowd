(function (root, factory) {
  "use strict";

  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (!root || !root.document) return;

  const manager = root.CloudCrowdTheme && root.CloudCrowdTheme.__isCloudCrowdThemeManager
    ? root.CloudCrowdTheme
    : api.createThemeManager(root);

  root.CloudCrowdTheme = manager;
  manager.init();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "cc_theme";
  const PREFERENCES = Object.freeze(["light", "dark", "system"]);
  const ICONS = Object.freeze({ light: "sun", dark: "moon", system: "monitor" });
  const LABELS = Object.freeze({ light: "Light", dark: "Dark", system: "System" });

  function isValidPreference(value) {
    return PREFERENCES.includes(value);
  }

  function normalizePreference(value) {
    return isValidPreference(value) ? value : "system";
  }

  function systemTheme(mediaQuery) {
    return mediaQuery && mediaQuery.matches ? "dark" : "light";
  }

  function resolvedTheme(preference, mediaQuery) {
    const normalized = normalizePreference(preference);
    return normalized === "system" ? systemTheme(mediaQuery) : normalized;
  }

  function safeReadPreference(storage) {
    try {
      return normalizePreference(storage && storage.getItem(STORAGE_KEY));
    } catch (_error) {
      return "system";
    }
  }

  function safeWritePreference(storage, preference) {
    if (!isValidPreference(preference)) return false;
    try {
      if (storage) storage.setItem(STORAGE_KEY, preference);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function createThemeManager(environment) {
    const env = environment || {};
    const documentRef = env.document || null;
    const rootElement = documentRef && documentRef.documentElement;
    let storage = null;
    let mediaQuery = null;
    let preference = "system";
    let currentTheme = "light";
    let initialized = false;
    let mediaListenerInstalled = false;
    let storageListenerInstalled = false;
    let announcer = null;
    const toggles = new Set();

    try {
      storage = env.localStorage || null;
    } catch (_error) {
      storage = null;
    }

    try {
      mediaQuery = typeof env.matchMedia === "function"
        ? env.matchMedia("(prefers-color-scheme: dark)")
        : null;
    } catch (_error) {
      mediaQuery = null;
    }

    function preferenceLabel() {
      return preference === "system"
        ? `${LABELS[preference]}, currently ${LABELS[currentTheme]}`
        : LABELS[preference];
    }

    function nextPreference() {
      const currentIndex = PREFERENCES.indexOf(preference);
      return PREFERENCES[(currentIndex + 1) % PREFERENCES.length];
    }

    function ensureAnnouncer() {
      if (announcer || !documentRef || !documentRef.body) return announcer;
      announcer = documentRef.createElement("span");
      announcer.className = "cc-theme-announcer";
      announcer.setAttribute("role", "status");
      announcer.setAttribute("aria-live", "polite");
      announcer.setAttribute("aria-atomic", "true");
      documentRef.body.appendChild(announcer);
      return announcer;
    }

    function updateToggle(toggle) {
      if (!toggle || !toggle.__ccThemeParts) return;
      const label = preferenceLabel();
      const nextLabel = LABELS[nextPreference()];
      const icon = toggle.__ccThemeParts.icon;
      icon.textContent = "";
      icon.dataset.ccIcon = ICONS[preference];
      if (env.CloudCrowdIcons && typeof env.CloudCrowdIcons.render === "function") {
        env.CloudCrowdIcons.render(icon, ICONS[preference], "sm");
      }
      toggle.__ccThemeParts.label.textContent = LABELS[preference];
      toggle.setAttribute("aria-label", `Theme: ${label}. Activate to switch to ${nextLabel}.`);
      toggle.setAttribute("data-theme-preference", preference);
      toggle.setAttribute("data-resolved-theme", currentTheme);
      toggle.title = `Theme: ${label}. Switch to ${nextLabel}.`;
    }

    function notify() {
      toggles.forEach(updateToggle);
      const liveRegion = ensureAnnouncer();
      if (liveRegion) liveRegion.textContent = `Theme set to ${preferenceLabel()}.`;

      if (typeof env.CustomEvent === "function" && typeof env.dispatchEvent === "function") {
        env.dispatchEvent(new env.CustomEvent("cc:themechange", {
          detail: { preference, theme: currentTheme }
        }));
      }
    }

    function apply(options) {
      currentTheme = resolvedTheme(preference, mediaQuery);
      if (rootElement) rootElement.setAttribute("data-theme", currentTheme);
      if (!options || options.announce !== false) notify();
      else toggles.forEach(updateToggle);
      return currentTheme;
    }

    function handleSystemChange() {
      if (preference === "system") apply();
    }

    function handleStorageChange(event) {
      if (!event || event.key !== STORAGE_KEY) return;
      preference = normalizePreference(event.newValue);
      apply();
    }

    function installListeners() {
      if (!mediaListenerInstalled && mediaQuery) {
        if (typeof mediaQuery.addEventListener === "function") {
          mediaQuery.addEventListener("change", handleSystemChange);
          mediaListenerInstalled = true;
        } else if (typeof mediaQuery.addListener === "function") {
          mediaQuery.addListener(handleSystemChange);
          mediaListenerInstalled = true;
        }
      }

      if (!storageListenerInstalled && typeof env.addEventListener === "function") {
        env.addEventListener("storage", handleStorageChange);
        storageListenerInstalled = true;
      }
    }

    function init() {
      if (!initialized) {
        preference = safeReadPreference(storage);
        installListeners();
        initialized = true;
      }
      return apply({ announce: false });
    }

    function setPreference(nextPreference) {
      if (!isValidPreference(nextPreference)) return false;
      preference = nextPreference;
      safeWritePreference(storage, preference);
      apply();
      return true;
    }

    function cyclePreference() {
      const currentIndex = PREFERENCES.indexOf(preference);
      const nextPreference = PREFERENCES[(currentIndex + 1) % PREFERENCES.length];
      setPreference(nextPreference);
      return nextPreference;
    }

    function createToggle(options) {
      if (!documentRef) return null;
      init();

      const settings = options || {};
      const button = documentRef.createElement("button");
      const icon = documentRef.createElement("span");
      const label = documentRef.createElement("span");

      button.type = "button";
      button.className = "cc-theme-toggle cc-button cc-button--secondary cc-button--md";
      button.setAttribute("data-theme-toggle", "");
      icon.className = "cc-theme-toggle__icon";
      icon.setAttribute("aria-hidden", "true");
      label.className = "cc-theme-toggle__label";

      button.appendChild(icon);
      button.appendChild(label);
      button.__ccThemeParts = { icon, label };
      button.addEventListener("click", cyclePreference);

      if (settings.className) button.classList.add(settings.className);
      toggles.add(button);
      updateToggle(button);
      return button;
    }

    return {
      __isCloudCrowdThemeManager: true,
      init,
      apply,
      setPreference,
      cyclePreference,
      createToggle,
      getPreference: function () { return preference; },
      getTheme: function () { return currentTheme; },
      storageKey: STORAGE_KEY,
      preferences: PREFERENCES
    };
  }

  return Object.freeze({
    STORAGE_KEY,
    PREFERENCES,
    isValidPreference,
    normalizePreference,
    systemTheme,
    resolvedTheme,
    safeReadPreference,
    safeWritePreference,
    createThemeManager
  });
});
