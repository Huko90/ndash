// Runtime configuration bootstrap for local deployments.
// Local overrides are stored in localStorage and merged into base config.
(function() {
var baseConfig = (typeof window !== 'undefined' && window.BTCT_BASE_CONFIG) ? window.BTCT_BASE_CONFIG : {};
var appBase = baseConfig.app || {};
var RUNTIME_CONFIG_KEY = appBase.runtimeConfigKey || 'btct_runtime_config_v1';
var DESKTOP_CONFIG_URL = '/btct-runtime-config.json';

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function deepMerge(target, source) {
    if (!isObj(source)) return target;
    Object.keys(source).forEach(function(k) {
        var sv = source[k];
        if (isObj(sv)) {
            if (!isObj(target[k])) target[k] = {};
            deepMerge(target[k], sv);
        } else {
            target[k] = sv;
        }
    });
    return target;
}
function clone(v) {
    return JSON.parse(JSON.stringify(v || {}));
}
function readLocalOverrides() {
    try {
        var raw = localStorage.getItem(RUNTIME_CONFIG_KEY);
        if (!raw) return {};
        var parsed = JSON.parse(raw);
        return isObj(parsed) ? parsed : {};
    } catch (_e) {
        return {};
    }
}
function fetchDesktopOverrides() {
    if (typeof fetch !== 'function') return Promise.resolve({});
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function() {
        if (ctrl) ctrl.abort();
    }, 1500);
    return fetch(DESKTOP_CONFIG_URL, {
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined
    })
    .then(function(r) {
        if (!r.ok) return {};
        return r.json().catch(function() { return {}; });
    })
    .then(function(data) {
        return isObj(data) ? data : {};
    })
    .catch(function() {
        return {};
    })
    .finally(function() {
        clearTimeout(timer);
    });
}

// Expose utilities for app.js and other modules
window.BTCT_UTILS = { isObj: isObj, deepMerge: deepMerge, clone: clone };

var localOverrides = readLocalOverrides();
window.BTCT_CONFIG = deepMerge(clone(baseConfig), localOverrides);
window.BTCT_CONFIG_READY = fetchDesktopOverrides().then(function(desktopOverrides) {
    if (!isObj(desktopOverrides) || !Object.keys(desktopOverrides).length) {
        return window.BTCT_CONFIG;
    }
    // Desktop-provided defaults are merged first, then local Settings overrides re-applied.
    window.BTCT_CONFIG = deepMerge(clone(baseConfig), desktopOverrides);
    window.BTCT_CONFIG = deepMerge(window.BTCT_CONFIG, localOverrides);
    try {
        window.dispatchEvent(new CustomEvent('btct:config-updated', {
            detail: { config: window.BTCT_CONFIG, source: 'desktop-runtime' }
        }));
    } catch (_e) {}
    return window.BTCT_CONFIG;
});
})();
