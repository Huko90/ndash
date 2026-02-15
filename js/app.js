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
        settingsMatches: $('settingsMatches')
    };
    var sourceMap = { binance: el.btcStamp, weather: el.weatherStamp, pc: el.pcStamp };
    var sectionMap = {
        btc: { el: el.btcStamp, label: 'BTC' },
        weather: { el: el.weatherStamp, label: 'WTH' },
        pc: { el: el.pcStamp, label: 'PC' }
    };

    // === PARTICLES ===
    var pCanvas = document.getElementById('particles'), px = pCanvas.getContext('2d'), pts = [];
    function initP() {
        pCanvas.width = innerWidth; pCanvas.height = innerHeight; pts = [];
        for (var i = 0, c = Math.floor(pCanvas.width * pCanvas.height / 20000); i < c; i++)
            pts.push({x:Math.random()*pCanvas.width, y:Math.random()*pCanvas.height, r:Math.random()*1.1+.3, vx:(Math.random()-.5)*.12, vy:(Math.random()-.5)*.12, a:Math.random()*.2+.04});
    }
    function drawP() {
        px.clearRect(0, 0, pCanvas.width, pCanvas.height);
        for (var i = 0; i < pts.length; i++) {
            var p = pts[i];
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0) p.x = pCanvas.width; if (p.x > pCanvas.width) p.x = 0;
            if (p.y < 0) p.y = pCanvas.height; if (p.y > pCanvas.height) p.y = 0;
            px.beginPath(); px.arc(p.x, p.y, p.r, 0, 6.28);
            px.fillStyle = 'rgba(245,200,66,' + p.a + ')'; px.fill();
        }
        for (var i = 0; i < pts.length; i++)
            for (var j = i + 1; j < pts.length; j++) {
                var dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d = dx*dx + dy*dy;
                if (d < 7000) {
                    px.beginPath(); px.moveTo(pts[i].x, pts[i].y); px.lineTo(pts[j].x, pts[j].y);
                    px.strokeStyle = 'rgba(245,200,66,' + (0.025 * (1 - d/7000)) + ')';
                    px.lineWidth = .5; px.stroke();
                }
            }
        requestAnimationFrame(drawP);
    }
    initP(); drawP(); addEventListener('resize', initP);

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
        stamp.el.textContent = stamp.label + ' ' + utcNow().replace(' UTC', '');
    }

    // === REGISTER DASHBOARD ===
    function registerDashboard(id, config) {
        dashboards[id] = config;
        dashOrder.push(id);
        var btn = document.createElement('button');
        btn.className = 'mode-btn';
        btn.title = config.name;
        btn.textContent = config.icon;
        btn.addEventListener('click', function() { switchMode(id); });
        config._btn = btn;
        el.modeToggle.appendChild(btn);
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
            var container = document.getElementById(dashboards[id].containerId);
            if (container) container.classList.remove('active');
        });

        currentMode = mode;
        setSetting('mode', mode);
        var dash = dashboards[mode];
        dash._btn.classList.add('active');

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

    // === ANTI-BURN-IN GPU NUDGE ===
    setInterval(function() {
        document.body.style.transform = 'translateZ(0)';
        requestAnimationFrame(function() { document.body.style.transform = ''; });
    }, 600000);

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
    function applyThemeVars(theme) {
        theme = theme || {};
        var root = document.documentElement.style;
        if (typeof theme.btcImageOpacity === 'number') root.setProperty('--btc-image-opacity', String(theme.btcImageOpacity));
        if (typeof theme.weatherImageOpacity === 'number') root.setProperty('--weather-image-opacity', String(theme.weatherImageOpacity));
        if (typeof theme.pcOverlayTop === 'number') root.setProperty('--pc-overlay-top', String(theme.pcOverlayTop));
        if (typeof theme.pcOverlayBottom === 'number') root.setProperty('--pc-overlay-bottom', String(theme.pcOverlayBottom));
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
    var lastDesktopState = null;
    function getFinalAccessUrlFromState(state) {
        if (!state || !state.server || !state.config || !state.config.network) return '';
        var preferHttps = state.config.network.preferHttps !== false;
        return preferHttps ? (state.server.httpsUrl || '') : (state.server.httpUrl || '');
    }
    function openSettings() {
        if (!el.settingsDrawer) return;
        el.settingsDrawer.classList.remove('crypto-open');
        var cfg = window.BTCT_CONFIG || {};
        var btc = cfg.btc || {};
        var alerts = btc.alerts || {};
        var weather = cfg.weather || {};
        var pc = cfg.pc || {};
        var theme = cfg.theme || {};
        if (el.setWeatherName) el.setWeatherName.value = weather.name || '';
        if (el.setWeatherLat) el.setWeatherLat.value = weather.lat;
        if (el.setWeatherLon) el.setWeatherLon.value = weather.lon;
        if (el.setWeatherRefresh) el.setWeatherRefresh.value = Math.round((weather.refreshMs || 600000) / 1000);
        if (el.setPcPoll) el.setPcPoll.value = pc.pollMs || 2000;
        if (el.setAlertAudioEnabled) el.setAlertAudioEnabled.checked = alerts.audio !== false;
        if (el.setAlertAudioVolume) el.setAlertAudioVolume.value = (typeof alerts.volume === 'number') ? alerts.volume : 0.06;
        if (el.setBtcSymbol) {
            el.setBtcSymbol.innerHTML = '';
            var defs = btc.symbols || {};
            Object.keys(defs).forEach(function(sym) {
                var opt = document.createElement('option');
                opt.value = sym;
                opt.textContent = sym.replace('USDT', '') + ' (' + (defs[sym].name || sym) + ')';
                el.setBtcSymbol.appendChild(opt);
            });
            el.setBtcSymbol.value = btc.defaultSymbol || 'BTCUSDT';
        }
        if (el.setBtcDim) el.setBtcDim.value = theme.btcImageOpacity;
        if (el.setWeatherDim) el.setWeatherDim.value = theme.weatherImageOpacity;
        if (el.setPcTopDim) el.setPcTopDim.value = theme.pcOverlayTop;
        if (el.setPcBottomDim) el.setPcBottomDim.value = theme.pcOverlayBottom;
        if (el.settingsInfo) {
            el.settingsInfo.textContent = '';
            el.settingsInfo.classList.remove('ok', 'err');
        }
        if (el.settingsMatches) el.settingsMatches.innerHTML = '';
        if (window.DesktopApi && typeof window.DesktopApi.getState === 'function') {
            window.DesktopApi.getState().then(function(state) {
                var finalUrl = getFinalAccessUrlFromState(state) || '-';
                if (el.setFinalUrl) el.setFinalUrl.value = finalUrl;
                if (el.setRuntimeMode && state && state.config) el.setRuntimeMode.value = state.config.runtimeMode || 'app_open';
                lastDesktopState = state || null;
            }).catch(function() {});
        }
        el.settingsDrawer.classList.add('open');
    }
    function closeSettings() {
        if (el.settingsDrawer) {
            el.settingsDrawer.classList.remove('open');
            el.settingsDrawer.classList.remove('crypto-open');
        }
    }
    function bindSettingsUi() {
        var copyFlashTimer = null;
        var cryptoRowsReady = false;
        var cryptoSymbolCache = null;
        var cryptoLoadPromise = null;
        function setCryptoMenuOpen(open) {
            if (!el.settingsDrawer) return;
            el.settingsDrawer.classList.toggle('crypto-open', !!open);
        }
        function normalizeHeatmapSymbol(raw) {
            var s = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (!s) return '';
            if (!/USDT$/.test(s)) s += 'USDT';
            if (!/^[A-Z0-9]{2,20}USDT$/.test(s)) return '';
            return s;
        }
        function defaultHeatmapCoins() {
            return ['BTCUSDT','ETHUSDT','BNBUSDT','XRPUSDT','SOLUSDT','ADAUSDT','DOGEUSDT','TRXUSDT','AVAXUSDT','LINKUSDT'];
        }
        function currentHeatmapCoins() {
            var cfg = window.BTCT_CONFIG || {};
            var btc = cfg.btc || {};
            var list = Array.isArray(btc.heatmapCoins) ? btc.heatmapCoins.slice(0, 10) : [];
            while (list.length < 10) list.push(defaultHeatmapCoins()[list.length]);
            return list.slice(0, 10).map(normalizeHeatmapSymbol).filter(Boolean);
        }
        function ensureCryptoRows() {
            if (cryptoRowsReady || !el.settingsCryptoGrid) return;
            for (var i = 0; i < 10; i++) {
                var row = document.createElement('div');
                row.className = 'settings-crypto-row';
                var slot = document.createElement('div');
                slot.className = 'settings-crypto-slot';
                slot.textContent = String(i + 1);
                var input = document.createElement('input');
                input.type = 'text';
                input.className = 'settings-crypto-input';
                input.id = 'setCryptoSlot' + (i + 1);
                input.placeholder = 'BTC or BTCUSDT';
                input.setAttribute('list', 'cryptoSymbolOptions');
                input.addEventListener('blur', function(ev) {
                    var target = ev && ev.target;
                    if (!target) return;
                    var normalized = normalizeHeatmapSymbol(target.value);
                    if (normalized) target.value = normalized;
                });
                row.appendChild(slot);
                row.appendChild(input);
                el.settingsCryptoGrid.appendChild(row);
            }
            cryptoRowsReady = true;
        }
        function setCryptoSlots(list) {
            ensureCryptoRows();
            var coins = Array.isArray(list) ? list.slice(0, 10) : [];
            while (coins.length < 10) coins.push(defaultHeatmapCoins()[coins.length]);
            for (var i = 0; i < 10; i++) {
                var input = document.getElementById('setCryptoSlot' + (i + 1));
                if (!input) continue;
                input.value = normalizeHeatmapSymbol(coins[i]) || '';
            }
        }
        function getCryptoSlotsFromUi() {
            var out = [];
            for (var i = 0; i < 10; i++) {
                var input = document.getElementById('setCryptoSlot' + (i + 1));
                var normalized = normalizeHeatmapSymbol(input && input.value);
                if (!normalized) return { ok: false, message: 'Slot ' + (i + 1) + ' is invalid.' };
                out.push(normalized);
            }
            var uniq = {};
            for (var j = 0; j < out.length; j++) {
                if (uniq[out[j]]) return { ok: false, message: 'Duplicate symbol: ' + out[j] };
                uniq[out[j]] = true;
            }
            return { ok: true, coins: out };
        }
        function renderCryptoOptions(symbols) {
            if (!el.cryptoSymbolOptions) return;
            el.cryptoSymbolOptions.innerHTML = '';
            (symbols || []).forEach(function(sym) {
                var opt = document.createElement('option');
                opt.value = sym;
                el.cryptoSymbolOptions.appendChild(opt);
            });
        }
        function loadCryptoSymbols() {
            if (cryptoSymbolCache) return Promise.resolve(cryptoSymbolCache);
            if (cryptoLoadPromise) return cryptoLoadPromise;
            var cfg = (window.BTCT_CONFIG && window.BTCT_CONFIG.btc) || {};
            var base = cfg.apiBase || 'https://api.binance.com';
            cryptoLoadPromise = fetch(base + '/api/v3/exchangeInfo')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var symbols = [];
                if (data && Array.isArray(data.symbols)) {
                    data.symbols.forEach(function(it) {
                        if (!it || it.status !== 'TRADING') return;
                        if (it.quoteAsset !== 'USDT') return;
                        var s = normalizeHeatmapSymbol(it.symbol);
                        if (s) symbols.push(s);
                    });
                }
                if (!symbols.length) throw new Error('No symbols loaded');
                symbols.sort();
                cryptoSymbolCache = symbols;
                renderCryptoOptions(symbols);
                return symbols;
            })
            .catch(function() {
                var defs = ((window.BTCT_CONFIG && window.BTCT_CONFIG.btc && window.BTCT_CONFIG.btc.symbols) || {});
                var fallback = Object.keys(defs).map(normalizeHeatmapSymbol).filter(Boolean);
                if (!fallback.length) fallback = defaultHeatmapCoins();
                fallback = fallback.sort();
                cryptoSymbolCache = fallback;
                renderCryptoOptions(fallback);
                return fallback;
            })
            .finally(function() {
                cryptoLoadPromise = null;
            });
            return cryptoLoadPromise;
        }
        function applyCryptoSlots() {
            var parsed = getCryptoSlotsFromUi();
            if (!parsed.ok) {
                setSettingsInfo(parsed.message, 'err');
                return;
            }
            var overrides = loadRuntimeOverrides();
            if (!overrides.btc) overrides.btc = {};
            overrides.btc.heatmapCoins = parsed.coins.slice(0, 10);
            saveRuntimeOverrides(overrides);
            mergeRuntimeConfig({ btc: { heatmapCoins: parsed.coins.slice(0, 10) } });
            reloadCurrentDashboard();
            setSettingsInfo('Crypto slots updated.', 'ok');
            setCryptoMenuOpen(false);
        }
        function setCopyButtonCopied(on) {
            if (!el.setFinalUrlCopyBtn) return;
            el.setFinalUrlCopyBtn.classList.toggle('is-copied', !!on);
        }
        function renderDesktopAccessUi(state) {
            lastDesktopState = state || null;
            var browserUrl = (window.location && /^https?:/i.test(window.location.protocol || ''))
                ? window.location.origin
                : '';
            if (el.setFinalUrl) {
                el.setFinalUrl.value = getFinalAccessUrlFromState(state) || browserUrl || '-';
            }
            if (el.setRuntimeMode && state && state.config) {
                el.setRuntimeMode.value = state.config.runtimeMode || 'app_open';
            }
        }
        function loadDesktopAccessUi() {
            var hasDesktopApi = !!(window.DesktopApi && typeof window.DesktopApi.getState === 'function');
            if (el.setRuntimeMode) el.setRuntimeMode.disabled = !hasDesktopApi;
            if (!hasDesktopApi) {
                renderDesktopAccessUi(null);
                return;
            }
            window.DesktopApi.getState()
            .then(function(state) {
                renderDesktopAccessUi(state);
                loadHealthUi();
            })
            .catch(function() {
                renderDesktopAccessUi(null);
            });
        }
        function fmtTs(ts) {
            if (!ts) return 'n/a';
            var d = new Date(ts);
            if (isNaN(d.getTime())) return 'n/a';
            return d.toLocaleString();
        }
        function msToHuman(ms) {
            var total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
            var h = Math.floor(total / 3600);
            var m = Math.floor((total % 3600) / 60);
            var s = total % 60;
            if (h > 0) return h + 'h ' + m + 'm';
            if (m > 0) return m + 'm ' + s + 's';
            return s + 's';
        }
        function loadHealthUi() {
            if (!el.settingsHealth) return;
            fetch('/health', { cache: 'no-store' })
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(data) {
                if (!data || data.ok !== true) {
                    el.settingsHealth.textContent = 'Health: unavailable';
                    return;
                }
                var uptime = msToHuman((data.uptimeMs || 0));
                var req = (data.metrics && data.metrics.requests) || 0;
                var pcOk = (data.metrics && data.metrics.api && data.metrics.api.pc && data.metrics.api.pc.ok) || 0;
                var pcErr = (data.metrics && data.metrics.api && data.metrics.api.pc && data.metrics.api.pc.error) || 0;
                var version = (lastDesktopState && lastDesktopState.appVersion) ? ('v' + lastDesktopState.appVersion) : 'browser';
                var u = (lastDesktopState && lastDesktopState.updates) || {};
                var updateText = u.status ? (' · Updater ' + u.status) : '';
                var checkText = u.lastCheckAt ? (' · Last check ' + fmtTs(u.lastCheckAt)) : '';
                var errText = u.lastError ? (' · Last update error: ' + u.lastError) : '';
                el.settingsHealth.textContent = 'Health: ok · ' + version + ' · Uptime ' + uptime + ' · Requests ' + req + ' · PC ok/err ' + pcOk + '/' + pcErr + updateText + checkText + errText;
            })
            .catch(function() {
                el.settingsHealth.textContent = 'Health: unavailable';
            });
        }
        function enhanceNumberInputs() {
            var inputs = document.querySelectorAll('.settings-grid input[type="number"], .alert-controls input[type="number"]');
            inputs.forEach(function(input) {
                if (!input || input.dataset.enhancedStepper === '1') return;
                var wrap = document.createElement('div');
                wrap.className = 'num-wrap';
                input.parentNode.insertBefore(wrap, input);
                wrap.appendChild(input);

                var ctrl = document.createElement('div');
                ctrl.className = 'num-ctrl';
                var upBtn = document.createElement('button');
                upBtn.type = 'button';
                upBtn.className = 'num-btn';
                upBtn.textContent = '▲';
                var downBtn = document.createElement('button');
                downBtn.type = 'button';
                downBtn.className = 'num-btn';
                downBtn.textContent = '▼';
                ctrl.appendChild(upBtn);
                ctrl.appendChild(downBtn);
                wrap.appendChild(ctrl);

                function adjust(dir) {
                    var step = parseFloat(input.step || '1');
                    if (!isFinite(step) || step <= 0) step = 1;
                    var decimals = (String(step).split('.')[1] || '').length;
                    var value = parseFloat(input.value);
                    if (!isFinite(value)) value = 0;
                    value += dir * step;
                    var min = parseFloat(input.min);
                    var max = parseFloat(input.max);
                    if (isFinite(min)) value = Math.max(min, value);
                    if (isFinite(max)) value = Math.min(max, value);
                    input.value = decimals ? value.toFixed(decimals) : String(Math.round(value));
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }

                upBtn.addEventListener('click', function() { adjust(1); });
                downBtn.addEventListener('click', function() { adjust(-1); });
                input.dataset.enhancedStepper = '1';
            });
        }
        function setSettingsInfo(text, cls) {
            if (!el.settingsInfo) return;
            el.settingsInfo.textContent = text || '';
            el.settingsInfo.classList.remove('ok', 'err');
            if (cls) el.settingsInfo.classList.add(cls);
        }
        function clearMatches() {
            if (el.settingsMatches) el.settingsMatches.innerHTML = '';
        }
        function cityLabel(hit) {
            var addr = hit && hit.address ? hit.address : {};
            var city = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
            var country = addr.country || '';
            if (city && country) return city + ', ' + country;
            return hit.display_name || '';
        }
        function applyCityHit(hit, keepMatches) {
            if (!hit) return;
            var lat = parseFloat(hit.lat);
            var lon = parseFloat(hit.lon);
            if (el.setWeatherLat) el.setWeatherLat.value = isNaN(lat) ? '' : lat.toFixed(4);
            if (el.setWeatherLon) el.setWeatherLon.value = isNaN(lon) ? '' : lon.toFixed(4);
            if (el.setWeatherName) el.setWeatherName.value = cityLabel(hit) || (el.setWeatherName.value || '');
            if (!keepMatches) clearMatches();
        }
        function renderMatches(list) {
            clearMatches();
            if (!el.settingsMatches || !Array.isArray(list) || !list.length) return;
            list.forEach(function(hit) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'settings-match';
                btn.textContent = cityLabel(hit) || 'Unnamed place';
                btn.addEventListener('click', function() {
                    applyCityHit(hit);
                    setSettingsInfo('Location selected.', 'ok');
                });
                el.settingsMatches.appendChild(btn);
            });
        }
        function readNumber(node, fallback, min, max) {
            var v = node ? parseFloat(node.value) : NaN;
            if (!isFinite(v)) return fallback;
            if (isFinite(min)) v = Math.max(min, v);
            if (isFinite(max)) v = Math.min(max, v);
            return v;
        }
        function collectOverridesFromUi() {
            var cfg = window.BTCT_CONFIG || {};
            var overrides = loadRuntimeOverrides();
            if (!overrides.btc) overrides.btc = {};
            if (!overrides.weather) overrides.weather = {};
            if (!overrides.pc) overrides.pc = {};
            if (!overrides.theme) overrides.theme = {};
            if (!overrides.btc.alerts) overrides.btc.alerts = {};

            var fallbackWeather = cfg.weather || {};
            var fallbackPc = cfg.pc || {};
            var fallbackBtc = cfg.btc || {};
            var fallbackTheme = cfg.theme || {};
            var fallbackAlerts = fallbackBtc.alerts || {};

            if (el.setWeatherName) overrides.weather.name = (el.setWeatherName.value || fallbackWeather.name || '').trim();
            overrides.weather.lat = readNumber(el.setWeatherLat, fallbackWeather.lat, -90, 90);
            overrides.weather.lon = readNumber(el.setWeatherLon, fallbackWeather.lon, -180, 180);
            if (el.setBtcSymbol) overrides.btc.defaultSymbol = el.setBtcSymbol.value || fallbackBtc.defaultSymbol || 'BTCUSDT';
            overrides.weather.refreshMs = Math.round(readNumber(el.setWeatherRefresh, (fallbackWeather.refreshMs || 600000) / 1000, 30) * 1000);
            overrides.pc.pollMs = Math.round(readNumber(el.setPcPoll, fallbackPc.pollMs || 2000, 500));
            overrides.btc.alerts.audio = !!(el.setAlertAudioEnabled && el.setAlertAudioEnabled.checked);
            overrides.btc.alerts.volume = readNumber(el.setAlertAudioVolume, fallbackAlerts.volume || 0.06, 0, 1);
            overrides.theme.btcImageOpacity = readNumber(el.setBtcDim, fallbackTheme.btcImageOpacity, 0, 1);
            overrides.theme.weatherImageOpacity = readNumber(el.setWeatherDim, fallbackTheme.weatherImageOpacity, 0, 1);
            overrides.theme.pcOverlayTop = readNumber(el.setPcTopDim, fallbackTheme.pcOverlayTop, 0, 1);
            overrides.theme.pcOverlayBottom = readNumber(el.setPcBottomDim, fallbackTheme.pcOverlayBottom, 0, 1);
            return overrides;
        }
        function applyOverrides(reloadPage) {
            var overrides = collectOverridesFromUi();
            saveRuntimeOverrides(overrides);
            mergeRuntimeConfig(overrides);
            if (reloadPage) {
                location.reload();
                return;
            }
            reloadCurrentDashboard();
            setSettingsInfo('Applied.', 'ok');
        }
        function resolveCity() {
            var q = (el.setWeatherName && el.setWeatherName.value || '').trim();
            if (!q) { setSettingsInfo('Enter a city/town first.', 'err'); return; }
            var weatherCfg = (window.BTCT_CONFIG && window.BTCT_CONFIG.weather) || {};
            var base = weatherCfg.searchGeocodeBase || 'https://nominatim.openstreetmap.org/search';
            var url = base + '?q=' + encodeURIComponent(q) + '&format=json&addressdetails=1&limit=5';
            setSettingsInfo('Updating city...', null);
            clearMatches();
            fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(list) {
                if (!list || !list.length) {
                    setSettingsInfo('No match found for "' + q + '".', 'err');
                    return;
                }
                if (list.length === 1) {
                    applyCityHit(list[0], false);
                    setSettingsInfo('City updated.', 'ok');
                    return;
                }
                renderMatches(list);
                applyCityHit(list[0], true);
                setSettingsInfo('Multiple matches found (' + list.length + '). Pick one below.', null);
            })
            .catch(function() { setSettingsInfo('Resolve failed. Try again.', 'err'); });
        }
        function useCurrentLocation() {
            if (!navigator.geolocation) {
                setSettingsInfo('Geolocation is not supported here.', 'err');
                return;
            }
            setSettingsInfo('Reading current location...', null);
            clearMatches();
            navigator.geolocation.getCurrentPosition(function(pos) {
                var lat = pos.coords.latitude;
                var lon = pos.coords.longitude;
                if (el.setWeatherLat) el.setWeatherLat.value = lat.toFixed(4);
                if (el.setWeatherLon) el.setWeatherLon.value = lon.toFixed(4);
                var weatherCfg = (window.BTCT_CONFIG && window.BTCT_CONFIG.weather) || {};
                var base = weatherCfg.reverseGeocodeBase || 'https://nominatim.openstreetmap.org/reverse';
                var url = base + '?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon) + '&format=json&addressdetails=1';
                fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(hit) {
                    if (hit) applyCityHit(hit);
                    setSettingsInfo('Current location updated.', 'ok');
                })
                .catch(function() { setSettingsInfo('Location set, city lookup failed.', null); });
            }, function(err) {
                var msg = (err && err.message) ? err.message : 'Location permission denied.';
                setSettingsInfo(msg, 'err');
            }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
        }
        if (el.settingsBtn) el.settingsBtn.addEventListener('click', function() {
            if (el.settingsDrawer && el.settingsDrawer.classList.contains('open')) closeSettings();
            else {
                setCryptoMenuOpen(false);
                setCryptoSlots(currentHeatmapCoins());
                loadCryptoSymbols();
                loadHealthUi();
                openSettings();
            }
        });
        if (el.settingsCryptoBtn) {
            el.settingsCryptoBtn.addEventListener('click', function() {
                setCryptoSlots(currentHeatmapCoins());
                loadCryptoSymbols();
                setCryptoMenuOpen(true);
            });
        }
        if (el.settingsCryptoBackBtn) {
            el.settingsCryptoBackBtn.addEventListener('click', function() {
                setCryptoMenuOpen(false);
            });
        }
        if (el.settingsCryptoCancelBtn) {
            el.settingsCryptoCancelBtn.addEventListener('click', function() {
                setCryptoSlots(currentHeatmapCoins());
                setCryptoMenuOpen(false);
            });
        }
        if (el.settingsCryptoApplyBtn) {
            el.settingsCryptoApplyBtn.addEventListener('click', applyCryptoSlots);
        }
        if (el.setFinalUrlCopyBtn) {
            el.setFinalUrlCopyBtn.addEventListener('click', function() {
                var target = (el.setFinalUrl && el.setFinalUrl.value && el.setFinalUrl.value !== '-') ? el.setFinalUrl.value : '';
                if (!target) {
                    setSettingsInfo('Final URL is not available yet.', 'err');
                    return;
                }
                var copyPromise = (window.DesktopApi && typeof window.DesktopApi.copyText === 'function')
                    ? window.DesktopApi.copyText(target)
                    : (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(target) : Promise.reject(new Error('Copy not supported')));
                copyPromise.then(function() {
                    if (copyFlashTimer) clearTimeout(copyFlashTimer);
                    setCopyButtonCopied(true);
                    copyFlashTimer = setTimeout(function() { setCopyButtonCopied(false); }, 1400);
                    setSettingsInfo('Final URL copied.', 'ok');
                }).catch(function() {
                    setSettingsInfo('Failed to copy final URL.', 'err');
                });
            });
        }
        if (el.setRuntimeMode) {
            el.setRuntimeMode.addEventListener('change', function() {
                var mode = el.setRuntimeMode.value === 'background' ? 'background' : 'app_open';
                if (!(window.DesktopApi && typeof window.DesktopApi.updateRuntimeMode === 'function')) {
                    setSettingsInfo('Runtime mode can be changed only in desktop app.', 'err');
                    return;
                }
                window.DesktopApi.updateRuntimeMode(mode)
                .then(function(nextState) {
                    renderDesktopAccessUi(nextState);
                    setSettingsInfo(mode === 'background' ? 'Runtime mode set to background.' : 'Runtime mode set to run while app is open.', 'ok');
                })
                .catch(function(err) {
                    setSettingsInfo((err && err.message) ? err.message : 'Failed to update runtime mode.', 'err');
                    if (lastDesktopState && lastDesktopState.config && el.setRuntimeMode) {
                        el.setRuntimeMode.value = lastDesktopState.config.runtimeMode || 'app_open';
                    }
                });
            });
        }
        if (el.settingsWizardBtn) {
            var hasDesktopWizard = !!(window.DesktopApi && typeof window.DesktopApi.rerunWizard === 'function');
            el.settingsWizardBtn.style.display = hasDesktopWizard ? '' : 'none';
            if (hasDesktopWizard) {
                el.settingsWizardBtn.addEventListener('click', function() {
                    window.DesktopApi.rerunWizard();
                });
            }
        }
        if (el.setWeatherResolveBtn) el.setWeatherResolveBtn.addEventListener('click', resolveCity);
        if (el.setWeatherUseCurrentBtn) el.setWeatherUseCurrentBtn.addEventListener('click', useCurrentLocation);
        loadDesktopAccessUi();
        loadHealthUi();
        enhanceNumberInputs();
        if (el.settingsApplyBtn) el.settingsApplyBtn.addEventListener('click', function() { applyOverrides(false); });
        if (el.settingsResetBtn) el.settingsResetBtn.addEventListener('click', function() {
            try { localStorage.removeItem(runtimeConfigKey); } catch (e) {}
            location.reload();
        });
        if (el.settingsSaveBtn) el.settingsSaveBtn.addEventListener('click', function() {
            applyOverrides(true);
        });
        ['setBtcDim','setWeatherDim','setPcTopDim','setPcBottomDim'].forEach(function(id) {
            var node = el[id];
            if (!node) return;
            node.addEventListener('input', function() {
                applyThemeVars({
                    btcImageOpacity: parseFloat(el.setBtcDim.value),
                    weatherImageOpacity: parseFloat(el.setWeatherDim.value),
                    pcOverlayTop: parseFloat(el.setPcTopDim.value),
                    pcOverlayBottom: parseFloat(el.setPcBottomDim.value)
                });
            });
        });
    }

    // === START ===
    function start(defaultMode) {
        applyThemeVars((window.BTCT_CONFIG && window.BTCT_CONFIG.theme) || {});
        bindSettingsUi();
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
        incMsg: function() { msgCount++; },
        fmtP: fmtP,
        fmtI: fmtI,
        fmtV: fmtV
    };
})();
