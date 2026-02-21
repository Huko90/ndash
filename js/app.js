var App = (function() {
    var $ = function(id) { return document.getElementById(id); };
    var appConfig = (window.BTCT_CONFIG && window.BTCT_CONFIG.app) || {};
    var storageKey = appConfig.storageKey || 'btct_settings_v1';
    var runtimeConfigKey = appConfig.runtimeConfigKey || 'btct_runtime_config_v1';
    var dashboards = {};
    var dashOrder = [];
    var currentMode = null;
    var msgCount = 0, lastCheck = Date.now();
    var settings = loadSettings();

    // === DOM REFS ===
    var el = {
        app: $('app'),
        logo: $('logo'),
        brandName: $('brandName'),
        brandSub: $('brandSub'),
        orb1: $('orb1'),
        orb2: $('orb2'),
        alertFlash: $('alertFlash'),
        liveBadge: $('liveBadge'),
        liveText: $('liveText'),
        clockEl: $('clock'),
        msgRateEl: $('msgRate'),
        modeToggle: $('modeToggle'),
        brandFsBtn: $('brandFsBtn'),
        settingsBtn: $('settingsBtn'),
        settingsDrawer: $('settingsDrawer'),
        settingsMainPanel: $('settingsMainPanel'),
        settingsCryptoPanel: $('settingsCryptoPanel'),
        settingsCryptoBtn: $('settingsCryptoBtn'),
        settingsCryptoBackBtn: $('settingsCryptoBackBtn'),
        settingsCryptoCancelBtn: $('settingsCryptoCancelBtn'),
        settingsCryptoApplyBtn: $('settingsCryptoApplyBtn'),
        settingsCryptoGrid: $('settingsCryptoGrid'),
        cryptoSymbolOptions: $('cryptoSymbolOptions'),
        settingsWizardBtn: $('settingsWizardBtn'),
        settingsApplyBtn: $('settingsApplyBtn'),
        settingsSaveBtn: $('settingsSaveBtn'),
        settingsResetBtn: $('settingsResetBtn'),
        btcStamp: $('btcStamp'),
        weatherStamp: $('weatherStamp'),
        pcStamp: $('pcStamp'),
        setWeatherName: $('setWeatherName'),
        setWeatherResolveBtn: $('setWeatherResolveBtn'),
        setWeatherUseCurrentBtn: $('setWeatherUseCurrentBtn'),
        setWeatherLat: $('setWeatherLat'),
        setWeatherLon: $('setWeatherLon'),
        setBtcSymbol: $('setBtcSymbol'),
        setWeatherRefresh: $('setWeatherRefresh'),
        setPcPoll: $('setPcPoll'),
        setAlertAudioEnabled: $('setAlertAudioEnabled'),
        setAlertAudioVolume: $('setAlertAudioVolume'),
        setBtcDim: $('setBtcDim'),
        setWeatherDim: $('setWeatherDim'),
        setPcTopDim: $('setPcTopDim'),
        setPcBottomDim: $('setPcBottomDim'),
        setFinalUrl: $('setFinalUrl'),
        setFinalUrlCopyBtn: $('setFinalUrlCopyBtn'),
        setRuntimeMode: $('setRuntimeMode'),
        settingsInfo: $('settingsInfo'),
        settingsHealth: $('settingsHealth'),
        settingsMatches: $('settingsMatches'),
        wpBtcPreview: $('wpBtcPreview'),
        wpBtcUpload: $('wpBtcUpload'),
        wpBtcReset: $('wpBtcReset'),
        wpBtcFile: $('wpBtcFile'),
        wpWeatherPreview: $('wpWeatherPreview'),
        wpWeatherUpload: $('wpWeatherUpload'),
        wpWeatherReset: $('wpWeatherReset'),
        wpWeatherFile: $('wpWeatherFile'),
        wpPcPreview: $('wpPcPreview'),
        wpPcUpload: $('wpPcUpload'),
        wpPcReset: $('wpPcReset'),
        wpPcFile: $('wpPcFile')
    };
    var sourceMap = { binance: el.btcStamp, weather: el.weatherStamp, pc: el.pcStamp };
    var sectionMap = {
        btc: { el: el.btcStamp, label: 'BTC' },
        weather: { el: el.weatherStamp, label: 'WTH' },
        pc: { el: el.pcStamp, label: 'PC' }
    };
    var sectionTouchAt = { btc: 0, weather: 0, pc: 0 };

    // === PARTICLES ===
    var pCanvas = document.getElementById('particles'), px = pCanvas.getContext('2d'), pts = [];
    var CONNECT_DIST = 7000, CELL_SIZE = 84; // √7000 ≈ 84
    var grid = {};
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var prefersReducedMotion = reducedMotion.matches;
    reducedMotion.addEventListener('change', function(e) {
        var wasReduced = prefersReducedMotion;
        prefersReducedMotion = e.matches;
        if (wasReduced && !prefersReducedMotion) drawP(); // Restart RAF loop
        else if (prefersReducedMotion) drawP(); // Draw static frame
    });
    function initP() {
        pCanvas.width = innerWidth; pCanvas.height = innerHeight; pts = [];
        for (var i = 0, c = Math.floor(pCanvas.width * pCanvas.height / 40000); i < c; i++)
            pts.push({x:Math.random()*pCanvas.width, y:Math.random()*pCanvas.height, r:Math.random()*1.1+.3, vx:(Math.random()-.5)*.08, vy:(Math.random()-.5)*.08, a:Math.random()*.2+.04});
    }
    function drawP() {
        if (currentMode !== 'btc') { requestAnimationFrame(drawP); return; }
        px.clearRect(0, 0, pCanvas.width, pCanvas.height);
        if (prefersReducedMotion) {
            // Static dots only — no movement, no connection lines
            for (var i = 0; i < pts.length; i++) {
                var p = pts[i];
                px.beginPath(); px.arc(p.x, p.y, p.r, 0, 6.28);
                px.fillStyle = 'rgba(245,200,66,' + p.a + ')'; px.fill();
            }
            return; // No RAF loop — redraw only on resize
        }
        grid = {};
        for (var i = 0; i < pts.length; i++) {
            var p = pts[i];
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0) p.x = pCanvas.width; if (p.x > pCanvas.width) p.x = 0;
            if (p.y < 0) p.y = pCanvas.height; if (p.y > pCanvas.height) p.y = 0;
            px.beginPath(); px.arc(p.x, p.y, p.r, 0, 6.28);
            px.fillStyle = 'rgba(245,200,66,' + p.a + ')'; px.fill();
            var cx = Math.floor(p.x / CELL_SIZE), cy = Math.floor(p.y / CELL_SIZE);
            var key = cx + ',' + cy;
            if (!grid[key]) grid[key] = [];
            grid[key].push(i);
        }
        px.lineWidth = .5;
        var checked = {};
        var keys = Object.keys(grid);
        for (var k = 0; k < keys.length; k++) {
            var parts = keys[k].split(','), gcx = +parts[0], gcy = +parts[1];
            var cell = grid[keys[k]];
            for (var ni = -1; ni <= 1; ni++) for (var nj = -1; nj <= 1; nj++) {
                var nkey = (gcx+ni) + ',' + (gcy+nj);
                var ncell = grid[nkey];
                if (!ncell) continue;
                for (var a = 0; a < cell.length; a++) for (var b = 0; b < ncell.length; b++) {
                    var ii = cell[a], jj = ncell[b];
                    if (ii >= jj) continue;
                    var pairKey = ii * 10000 + jj;
                    if (checked[pairKey]) continue;
                    checked[pairKey] = 1;
                    var dx = pts[ii].x - pts[jj].x, dy = pts[ii].y - pts[jj].y, d = dx*dx + dy*dy;
                    if (d < CONNECT_DIST) {
                        px.beginPath(); px.moveTo(pts[ii].x, pts[ii].y); px.lineTo(pts[jj].x, pts[jj].y);
                        px.strokeStyle = 'rgba(245,200,66,' + (0.025 * (1 - d/CONNECT_DIST)) + ')';
                        px.stroke();
                    }
                }
            }
        }
        requestAnimationFrame(drawP);
    }
    initP(); drawP(); addEventListener('resize', function() { initP(); if (prefersReducedMotion) drawP(); });

    // === CLOCK ===
    setInterval(function() {
        el.clockEl.textContent = new Date().toUTCString().slice(17, 25) + ' UTC';
    }, 1000);

    // === MSG RATE ===
    setInterval(function() {
        var now = Date.now(), dt = (now - lastCheck) / 1000;
        el.msgRateEl.textContent = Math.round(msgCount / dt);
        msgCount = 0; lastCheck = now;
    }, 2000);

    // === FULLSCREEN ===
    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(function(){});
            el.app.classList.add('fullscreen');
            setSetting('fullscreenPreferred', true);
        } else {
            document.exitFullscreen();
            el.app.classList.remove('fullscreen');
            setSetting('fullscreenPreferred', false);
        }
    }
    el.brandFsBtn.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', function() {
        if (!document.fullscreenElement) el.app.classList.remove('fullscreen');
        setSetting('fullscreenPreferred', !!document.fullscreenElement);
    });

    // === HELPERS ===
    function escapeHTML(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function fmtP(n) { return parseFloat(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}); }
    function fmtI(n) { return Math.floor(parseFloat(n)).toLocaleString('en-US'); }
    function fmtV(n) { var v = parseFloat(n); return v >= 1e9 ? '$' + (v/1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v/1e6).toFixed(1) + 'M' : '$' + v.toFixed(0); }
    function utcNow() { return new Date().toUTCString().slice(17, 25) + ' UTC'; }

    // === LIVE BADGE ===
    function setLive(on, text) {
        el.liveBadge.classList.toggle('off', !on);
        el.liveText.textContent = text || (on ? 'Live' : 'Offline');
    }
    function setSourceStatus(source, ok) {
        var stamp = sourceMap[source];
        if (!stamp) return;
        stamp.classList.remove('ok', 'down');
        stamp.classList.add(ok ? 'ok' : 'down');
    }
    function touchSection(id) {
        var stamp = sectionMap[id];
        if (!stamp || !stamp.el) return;
        sectionTouchAt[id] = Date.now();
        stamp.el.textContent = stamp.label + ' ' + utcNow().replace(' UTC', '');
    }

    setInterval(function() {
        if (document.hidden) return;
        var now = Date.now();
        ['btc', 'weather', 'pc'].forEach(function(id) {
            var t = sectionTouchAt[id] || 0;
            if (!t) return;
            if (now - t > 3 * 60 * 1000) {
                var s = sectionMap[id];
                if (s && s.el) s.el.classList.add('down');
            }
        });
    }, 15000);

    // === REGISTER DASHBOARD ===
    function registerDashboard(id, config) {
        dashboards[id] = config;
        dashOrder.push(id);
        var btn = document.createElement('button');
        btn.className = 'mode-btn';
        btn.title = config.name;
        btn.setAttribute('aria-label', config.name);
        btn.setAttribute('aria-pressed', 'false');
        btn.textContent = config.icon;
        btn.addEventListener('click', function() { switchMode(id); });
        config._btn = btn;
        el.modeToggle.appendChild(btn);
        if (typeof config.syncConfig === 'function') {
            window.addEventListener('btct:config-updated', function() { config.syncConfig(); });
        }
    }

    // === SWITCH MODE ===
    function switchMode(mode) {
        if (!dashboards[mode]) return;
        if (currentMode === mode) return;
        closeSettings();

        // Destroy previous
        if (currentMode && dashboards[currentMode] && dashboards[currentMode].destroy) {
            dashboards[currentMode].destroy();
        }

        // Deactivate all
        dashOrder.forEach(function(id) {
            dashboards[id]._btn.classList.remove('active');
            dashboards[id]._btn.setAttribute('aria-pressed', 'false');
            var container = document.getElementById(dashboards[id].containerId);
            if (container) container.classList.remove('active');
        });

        currentMode = mode;
        setSetting('mode', mode);
        document.title = 'nDash';
        var dash = dashboards[mode];
        dash._btn.classList.add('active');
        dash._btn.setAttribute('aria-pressed', 'true');

        // Show container
        var container = document.getElementById(dash.containerId);
        if (container) container.classList.add('active');

        // Update branding
        el.logo.textContent = dash.icon;
        el.logo.style.background = dash.logoGradient;
        el.brandName.innerHTML = dash.brandHTML;
        el.brandSub.textContent = dash.brandSub;

        // Update orbs
        if (dash.orbColors) {
            el.orb1.style.background = 'radial-gradient(circle,' + dash.orbColors[0] + ',transparent 70%)';
            el.orb2.style.background = 'radial-gradient(circle,' + dash.orbColors[1] + ',transparent 70%)';
        }

        // Pulse logo
        el.logo.classList.remove('pulse');
        void el.logo.offsetWidth;
        el.logo.classList.add('pulse');

        // Init new dashboard
        if (dash.init) dash.init();
    }

    // Anti-burn-in handled by CSS antiburn animation in shared.css

    // === SETTINGS STORAGE ===
    function loadSettings() {
        try {
            var raw = localStorage.getItem(storageKey);
            if (!raw) return {};
            var parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) {
            return {};
        }
    }
    function saveSettings() {
        try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch (e) {}
    }
    function getSetting(key, fallback) {
        return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback;
    }
    function setSetting(key, value) {
        settings[key] = value;
        saveSettings();
    }
    function loadRuntimeOverrides() {
        try {
            var raw = localStorage.getItem(runtimeConfigKey);
            if (!raw) return {};
            var parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) {
            return {};
        }
    }
    function saveRuntimeOverrides(overrides) {
        try { localStorage.setItem(runtimeConfigKey, JSON.stringify(overrides)); } catch (e) {}
    }
    // isObj / deepMerge provided by config.js via window.BTCT_UTILS
    var isObj = window.BTCT_UTILS.isObj;
    var deepMerge = window.BTCT_UTILS.deepMerge;
    function applyThemeVars(theme) {
        theme = theme || {};
        var root = document.documentElement.style;
        if (typeof theme.btcImageOpacity === 'number') root.setProperty('--btc-image-opacity', String(theme.btcImageOpacity));
        if (typeof theme.weatherImageOpacity === 'number') root.setProperty('--weather-image-opacity', String(theme.weatherImageOpacity));
        if (typeof theme.pcOverlayTop === 'number') root.setProperty('--pc-overlay-top', String(theme.pcOverlayTop));
        if (typeof theme.pcOverlayBottom === 'number') root.setProperty('--pc-overlay-bottom', String(theme.pcOverlayBottom));
        if (typeof theme.btcWallpaper === 'string') root.setProperty('--btc-wallpaper', theme.btcWallpaper ? 'url("' + theme.btcWallpaper + '")' : '');
        if (typeof theme.weatherWallpaper === 'string') root.setProperty('--weather-wallpaper', theme.weatherWallpaper ? 'url("' + theme.weatherWallpaper + '")' : '');
        if (typeof theme.pcWallpaper === 'string') root.setProperty('--pc-wallpaper', theme.pcWallpaper ? 'url("' + theme.pcWallpaper + '")' : '');
    }
    function ensureToastWrap() {
        var node = document.getElementById('appToastWrap');
        if (node) return node;
        node = document.createElement('div');
        node.id = 'appToastWrap';
        node.className = 'app-toast-wrap';
        document.body.appendChild(node);
        return node;
    }
    function toast(message, kind, durationMs) {
        if (!message) return;
        var wrap = ensureToastWrap();
        var t = document.createElement('div');
        t.className = 'app-toast ' + (kind || 'info');
        t.textContent = message;
        wrap.appendChild(t);
        requestAnimationFrame(function() { t.classList.add('show'); });
        var aliveMs = Math.max(1200, parseInt(durationMs || 3200, 10));
        setTimeout(function() {
            t.classList.remove('show');
            setTimeout(function() {
                if (t.parentNode) t.parentNode.removeChild(t);
            }, 220);
        }, aliveMs);
    }
    function mergeRuntimeConfig(overrides) {
        if (!window.BTCT_CONFIG || typeof window.BTCT_CONFIG !== 'object') window.BTCT_CONFIG = {};
        deepMerge(window.BTCT_CONFIG, overrides || {});
        applyThemeVars((window.BTCT_CONFIG && window.BTCT_CONFIG.theme) || {});
        try {
            window.dispatchEvent(new CustomEvent('btct:config-updated', {
                detail: { config: window.BTCT_CONFIG, overrides: overrides || {} }
            }));
        } catch (e) {}
    }
    function reloadCurrentDashboard() {
        if (!currentMode || !dashboards[currentMode]) return;
        var dash = dashboards[currentMode];
        if (dash.destroy) dash.destroy();
        if (dash.init) dash.init();
    }
    function setSettingsOpen(isOpen) {
        dashOrder.forEach(function(id) {
            var container = document.getElementById(dashboards[id].containerId);
            if (container) {
                if (isOpen) container.setAttribute('inert', '');
                else container.removeAttribute('inert');
            }
        });
    }
    function closeSettings() {
        if (el.settingsDrawer) {
            el.settingsDrawer.classList.remove('open');
            el.settingsDrawer.classList.remove('crypto-open');
        }
        setSettingsOpen(false);
    }

    // Settings UI handled by js/settings.js via _initSettings

    // === DYNAMIC TITLE ===
    var lastTitleUpdate = 0;
    function setTitle(prefix) {
        var now = Date.now();
        if (now - lastTitleUpdate < 1000) return;
        lastTitleUpdate = now;
        document.title = prefix ? prefix + ' | nDash' : 'nDash';
    }

    // === DYNAMIC FAVICON ===
    var faviconLink = $('favicon');
    var lastFaviconUpdate = 0;
    var lastFaviconDir = 0;
    function updateFavicon(direction) {
        var now = Date.now();
        if (now - lastFaviconUpdate < 5000 && direction === lastFaviconDir) return;
        lastFaviconUpdate = now;
        lastFaviconDir = direction;
        var c = document.createElement('canvas'); c.width = 32; c.height = 32;
        var x = c.getContext('2d');
        x.fillStyle = '#06070b'; x.fillRect(0, 0, 32, 32);
        x.fillStyle = direction > 0 ? '#00e676' : direction < 0 ? '#ff1744' : '#f5c842';
        x.font = 'bold 22px Inter, sans-serif';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText('n', 16, 17);
        if (faviconLink) faviconLink.href = c.toDataURL();
    }
    updateFavicon(0);

    // === ONLINE/OFFLINE DETECTION ===
    var isOnline = navigator.onLine;
    var onOnlineCallbacks = [];
    window.addEventListener('online', function() {
        isOnline = true;
        toast('Back online', 'ok');
        onOnlineCallbacks.forEach(function(cb) { try { cb(); } catch (_) {} });
    });
    window.addEventListener('offline', function() {
        isOnline = false;
        setLive(false, 'No Internet');
    });

    // === KEYBOARD SHORTCUTS ===
    document.addEventListener('keydown', function(e) {
        var tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        if (e.key === 'Escape') {
            closeSettings();
            return;
        }
        if (e.key === 'f' || e.key === 'F') {
            toggleFullscreen();
            return;
        }
        var idx = parseInt(e.key);
        if (idx >= 1 && idx <= dashOrder.length) {
            switchMode(dashOrder[idx - 1]);
        }
    });

    // === GLOBAL ERROR HANDLER ===
    var lastErrorToastAt = 0;
    window.onerror = function(msg, src, line, col) {
        console.error('[nDash]', msg, src + ':' + line + ':' + col);
        if (Date.now() - lastErrorToastAt > 10000) {
            lastErrorToastAt = Date.now();
            toast('Something went wrong \u2014 check console', 'err', 4000);
        }
    };
    window.addEventListener('unhandledrejection', function(e) {
        console.error('[nDash] Unhandled rejection:', e.reason);
        if (Date.now() - lastErrorToastAt > 10000) {
            lastErrorToastAt = Date.now();
            toast('Something went wrong \u2014 check console', 'err', 4000);
        }
    });

    // === START ===
    function start(defaultMode) {
        applyThemeVars((window.BTCT_CONFIG && window.BTCT_CONFIG.theme) || {});
        if (getSetting('fullscreenPreferred', false)) {
            el.app.classList.add('fullscreen');
        }
        var fallbackMode = defaultMode || dashOrder[0];
        var preferredMode = getSetting('mode', fallbackMode);
        if (!dashboards[preferredMode]) preferredMode = fallbackMode;
        switchMode(preferredMode || fallbackMode);
    }

    return {
        $: $,
        el: el,
        registerDashboard: registerDashboard,
        switchMode: switchMode,
        start: start,
        toggleFullscreen: toggleFullscreen,
        setLive: setLive,
        setSourceStatus: setSourceStatus,
        touchSection: touchSection,
        getCurrentMode: function() { return currentMode; },
        reloadCurrentDashboard: reloadCurrentDashboard,
        toast: toast,
        getSetting: getSetting,
        setSetting: setSetting,
        setTitle: setTitle,
        updateFavicon: updateFavicon,
        isOnline: function() { return isOnline; },
        onOnline: function(cb) { onOnlineCallbacks.push(cb); },
        offOnline: function(cb) { onOnlineCallbacks = onOnlineCallbacks.filter(function(f) { return f !== cb; }); },
        incMsg: function() { msgCount++; },
        fmtP: fmtP,
        fmtI: fmtI,
        fmtV: fmtV,
        escapeHTML: escapeHTML,
        _initSettings: function(factory) {
            factory({
                el: el,
                getSetting: getSetting,
                setSetting: setSetting,
                loadRuntimeOverrides: loadRuntimeOverrides,
                saveRuntimeOverrides: saveRuntimeOverrides,
                mergeRuntimeConfig: mergeRuntimeConfig,
                applyThemeVars: applyThemeVars,
                toast: toast,
                reloadCurrentDashboard: reloadCurrentDashboard,
                closeSettings: closeSettings,
                setSettingsOpen: setSettingsOpen,
                switchMode: switchMode,
                getSettings: function() { return settings; },
                replaceSettings: function(obj) { settings = obj; saveSettings(); },
                runtimeConfigKey: runtimeConfigKey
            });
        }
    };
})();
