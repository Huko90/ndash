const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../js/config-base.js');

describe('config-base', function() {
    it('exports an object with all required top-level keys', function() {
        assert.ok(config && typeof config === 'object');
        ['app', 'btc', 'weather', 'pc', 'theme', 'stocks'].forEach(function(key) {
            assert.ok(config[key], 'missing key: ' + key);
        });
    });

    it('app has storageKey and runtimeConfigKey', function() {
        assert.equal(typeof config.app.storageKey, 'string');
        assert.equal(typeof config.app.runtimeConfigKey, 'string');
    });

    it('btc has valid defaults', function() {
        assert.equal(config.btc.defaultSymbol, 'BTCUSDT');
        assert.ok(config.btc.apiBase.startsWith('https://'));
        assert.ok(config.btc.wsBase.startsWith('wss://'));
        assert.ok(config.btc.fearGreedApi.startsWith('https://'));
        assert.ok(config.btc.dominanceApi.startsWith('https://'));
        assert.ok(Array.isArray(config.btc.heatmapCoins));
        assert.ok(config.btc.heatmapCoins.length >= 5);
    });

    it('btc.symbols has BTCUSDT with name and logo', function() {
        var btc = config.btc.symbols.BTCUSDT;
        assert.ok(btc, 'BTCUSDT not in symbols');
        assert.equal(btc.name, 'Bitcoin');
        assert.equal(typeof btc.logo, 'string');
        assert.ok(btc.logo.length > 0);
    });

    it('btc.refresh timings are positive numbers', function() {
        var r = config.btc.refresh;
        ['wsHealthMs', 'liveBadgeMs', 'pressureDecayMs', 'fgiMs', 'dominanceMs', 'performanceMs', 'heatmapMs'].forEach(function(key) {
            assert.equal(typeof r[key], 'number', key + ' should be a number');
            assert.ok(r[key] > 0, key + ' should be positive');
        });
    });

    it('weather has valid defaults', function() {
        assert.equal(typeof config.weather.name, 'string');
        assert.equal(typeof config.weather.lat, 'number');
        assert.equal(typeof config.weather.lon, 'number');
        assert.ok(config.weather.apiBase.startsWith('https://'));
        assert.ok(config.weather.refreshMs >= 60000);
    });

    it('pc has valid defaults', function() {
        assert.equal(typeof config.pc.endpoint, 'string');
        assert.ok(config.pc.pollMs >= 500);
    });

    it('theme has opacity values between 0 and 1', function() {
        ['btcImageOpacity', 'weatherImageOpacity', 'pcOverlayTop', 'pcOverlayBottom'].forEach(function(key) {
            var val = config.theme[key];
            assert.equal(typeof val, 'number', key + ' should be a number');
            assert.ok(val >= 0 && val <= 1, key + ' should be 0-1, got ' + val);
        });
    });
});
