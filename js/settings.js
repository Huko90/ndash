// Settings UI — extracted from app.js
(function() {
    App._initSettings(function(ctx) {
    var el = ctx.el;
    var getSetting = ctx.getSetting;
    var setSetting = ctx.setSetting;
    var loadRuntimeOverrides = ctx.loadRuntimeOverrides;
    var saveRuntimeOverrides = ctx.saveRuntimeOverrides;
    var mergeRuntimeConfig = ctx.mergeRuntimeConfig;
    var applyThemeVars = ctx.applyThemeVars;
    var toast = ctx.toast;
    var reloadCurrentDashboard = ctx.reloadCurrentDashboard;
    var closeSettings = ctx.closeSettings;
    var setSettingsOpen = ctx.setSettingsOpen;
    var switchMode = ctx.switchMode;
    var getSettings = ctx.getSettings;
    var replaceSettings = ctx.replaceSettings;
    var runtimeConfigKey = ctx.runtimeConfigKey;

    var lastDesktopState = null;
    function getFinalAccessUrlFromState(state) {
        if (!state || !state.server || !state.config || !state.config.network) return '';
        var preferHttps = state.config.network.preferHttps !== false;
        return preferHttps ? (state.server.httpsUrl || '') : (state.server.httpUrl || '');
    }
    function setSettingsTab(tabName) {
        var tab = String(tabName || 'general');
        var buttons = document.querySelectorAll('[data-settings-tab]');
        var panels = document.querySelectorAll('[data-tab-panel]');
        var hasMatch = false;
        buttons.forEach(function(btn) {
            var isActive = btn.getAttribute('data-settings-tab') === tab;
            if (isActive) hasMatch = true;
            btn.classList.toggle('active', isActive);
        });
        if (!hasMatch) tab = 'general';
        panels.forEach(function(panel) {
            panel.classList.toggle('active', panel.getAttribute('data-tab-panel') === tab);
        });
    }
    function openSettings() {
        if (!el.settingsDrawer) return;
        el.settingsDrawer.classList.remove('crypto-open');
        setSettingsTab('general');
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
        pendingWallpapers = null;
        refreshWallpaperPreviews();
        if (el.settingsMatches) el.settingsMatches.innerHTML = '';
        if (window.DesktopApi && typeof window.DesktopApi.getState === 'function') {
            window.DesktopApi.getState().then(function(state) {
                var finalUrl = getFinalAccessUrlFromState(state) || '-';
                if (el.setFinalUrl) el.setFinalUrl.value = finalUrl;
                if (el.setRuntimeMode && state && state.config) el.setRuntimeMode.value = state.config.runtimeMode || 'app_open';
                lastDesktopState = state || null;
            }).catch(function() {});
        }
        setSettingsOpen(true);
        el.settingsDrawer.classList.add('open');
    }

    // === BIND SETTINGS UI ===
    var copyFlashTimer = null;
    var cryptoRowsReady = false;
    var cryptoSymbolCache = null;
    var cryptoLoadPromise = null;
    function setCryptoMenuOpen(open) {
        if (!el.settingsDrawer) return;
        el.settingsDrawer.classList.toggle('crypto-open', !!open);
    }
    function bindSettingsTabs() {
        var buttons = document.querySelectorAll('[data-settings-tab]');
        buttons.forEach(function(btn) {
            if (btn.dataset.tabBound === '1') return;
            btn.addEventListener('click', function() {
                setSettingsTab(btn.getAttribute('data-settings-tab'));
            });
            btn.dataset.tabBound = '1';
        });
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
    function exportConfigBackup() {
        var payload = {
            exportedAt: new Date().toISOString(),
            settings: getSettings() || {},
            runtimeOverrides: loadRuntimeOverrides() || {}
        };
        var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'btct-config-backup.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(function() {
            URL.revokeObjectURL(a.href);
            a.remove();
        }, 100);
        setSettingsInfo('Backup exported.', 'ok');
    }
    function importConfigBackup() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.addEventListener('change', function() {
            var f = input.files && input.files[0];
            if (!f) return;
            var reader = new FileReader();
            reader.onload = function() {
                try {
                    var parsed = JSON.parse(String(reader.result || '{}'));
                    if (parsed && parsed.settings && typeof parsed.settings === 'object') {
                        replaceSettings(parsed.settings);
                    }
                    if (parsed && parsed.runtimeOverrides && typeof parsed.runtimeOverrides === 'object') {
                        saveRuntimeOverrides(parsed.runtimeOverrides);
                        mergeRuntimeConfig(parsed.runtimeOverrides);
                    }
                    reloadCurrentDashboard();
                    setSettingsInfo('Backup imported.', 'ok');
                } catch (_err) {
                    setSettingsInfo('Invalid backup file.', 'err');
                }
            };
            reader.readAsText(f);
        });
        input.click();
    }
    function ensureOpsButtons() {
        var row = document.getElementById('settingsAdvancedActions');
        if (!row || row.querySelector('.settings-action-ops')) return;
        var mk = function(text, onClick) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'settings-action alt settings-action-ops';
            btn.textContent = text;
            btn.addEventListener('click', onClick);
            row.appendChild(btn);
        };
        mk('Export Backup', exportConfigBackup);
        mk('Import Backup', importConfigBackup);
        if (window.DesktopApi && typeof window.DesktopApi.openUpdateLog === 'function') {
            mk('Open Update Log', function() { window.DesktopApi.openUpdateLog(); });
        }
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
        if (pendingWallpapers) {
            ['btcWallpaper', 'weatherWallpaper', 'pcWallpaper'].forEach(function(key) {
                if (key in pendingWallpapers) overrides.theme[key] = pendingWallpapers[key];
            });
        }
        return overrides;
    }
    function applyOverrides(reloadPage) {
        var overrides = collectOverridesFromUi();
        saveRuntimeOverrides(overrides);
        mergeRuntimeConfig(overrides);
        pendingWallpapers = null;
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
        setSettingsTab('datasources');
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
        setSettingsTab('datasources');
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

    // === WALLPAPER UPLOADS ===
    var pendingWallpapers = null;
    var wpKeyToDash = { btcWallpaper: 'btc', weatherWallpaper: 'weather', pcWallpaper: 'pc' };
    var wpCards = [
        { key: 'btcWallpaper', preview: el.wpBtcPreview, upload: el.wpBtcUpload, reset: el.wpBtcReset, file: el.wpBtcFile },
        { key: 'weatherWallpaper', preview: el.wpWeatherPreview, upload: el.wpWeatherUpload, reset: el.wpWeatherReset, file: el.wpWeatherFile },
        { key: 'pcWallpaper', preview: el.wpPcPreview, upload: el.wpPcUpload, reset: el.wpPcReset, file: el.wpPcFile }
    ];
    function refreshWallpaperPreviews() {
        var overrides = loadRuntimeOverrides();
        var theme = (overrides && overrides.theme) || {};
        var cfgTheme = (window.BTCT_CONFIG && window.BTCT_CONFIG.theme) || {};
        wpCards.forEach(function(c) {
            if (!c.preview) return;
            var val = theme[c.key] || cfgTheme[c.key] || '';
            c.preview.style.backgroundImage = val ? 'url("' + val + '")' : '';
        });
    }
    function saveWallpaperToServer(dashName, dataUrl) {
        return fetch('/api/wallpapers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dashboard: dashName, dataUrl: dataUrl })
        }).then(function(r) { return r.json(); })
          .catch(function() { return null; });
    }
    function deleteWallpaperFromServer(dashName) {
        return fetch('/api/wallpapers', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dashboard: dashName })
        }).then(function(r) { return r.json(); })
          .catch(function() { return null; });
    }
    function setupWallpaperCard(c) {
        if (!c.preview || !c.upload || !c.reset || !c.file) return;
        var dashName = wpKeyToDash[c.key];
        c.upload.addEventListener('click', function() { c.file.click(); });
        c.file.addEventListener('change', function() {
            var file = c.file.files[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) {
                setSettingsInfo('Image too large (max 5 MB).', 'err');
                return;
            }
            var reader = new FileReader();
            reader.onload = function() {
                c.preview.style.backgroundImage = 'url("' + reader.result + '")';
                setSettingsInfo('Saving wallpaper...', null);
                saveWallpaperToServer(dashName, reader.result).then(function(result) {
                    if (result && result.ok) {
                        if (!pendingWallpapers) pendingWallpapers = {};
                        pendingWallpapers[c.key] = result.url;
                        setSettingsInfo('Wallpaper saved. Click Apply to use it.', 'ok');
                    } else {
                        // Server not available — fallback to localStorage data URL
                        if (!pendingWallpapers) pendingWallpapers = {};
                        pendingWallpapers[c.key] = reader.result;
                        setSettingsInfo('Wallpaper selected. Click Apply to use it.', 'ok');
                    }
                });
            };
            reader.readAsDataURL(file);
            c.file.value = '';
        });
        c.reset.addEventListener('click', function() {
            c.preview.style.backgroundImage = '';
            deleteWallpaperFromServer(dashName);
            if (!pendingWallpapers) pendingWallpapers = {};
            pendingWallpapers[c.key] = '';
            setSettingsInfo('Wallpaper reset to default. Click Apply.', 'ok');
        });
    }
    wpCards.forEach(setupWallpaperCard);

    // === EVENT LISTENERS ===
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
    bindSettingsTabs();
    loadDesktopAccessUi();
    loadHealthUi();
    enhanceNumberInputs();
    ensureOpsButtons();
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

    });
})();
