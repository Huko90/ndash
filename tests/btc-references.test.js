const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Read source files
var btcSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'btc.js'), 'utf8');
var appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

// Extract function/var definitions from btc.js
function extractDefined(src) {
    var defs = new Set();
    // Match: function name(
    var fnRe = /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    var m;
    while ((m = fnRe.exec(src)) !== null) defs.add(m[1]);
    // Match: var declarations (including comma-separated: var a = 0, b = 1, c;)
    var varRe = /var\s+([^;]+)/g;
    while ((m = varRe.exec(src)) !== null) {
        // Extract all identifier names from the declaration
        var decl = m[1];
        var idRe = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[=,;]/g;
        var im;
        while ((im = idRe.exec(decl)) !== null) defs.add(im[1]);
    }
    return defs;
}

var btcDefs = extractDefined(btcSrc);

describe('btc.js function references', function() {
    // Functions called in switchSymbol()
    it('switchSymbol references exist', function() {
        var block = btcSrc.match(/function switchSymbol[\s\S]*?^}/m);
        assert.ok(block, 'switchSymbol function not found');
        var refs = ['abortPendingFetches', 'fetchKlines', 'fetchPerformance', 'fetchHeatmap'];
        refs.forEach(function(fn) {
            assert.ok(btcDefs.has(fn), 'switchSymbol calls ' + fn + ' but it is not defined in btc.js');
        });
    });

    // Functions called in init()
    it('init() references exist', function() {
        var refs = [
            'syncBtcConfig', 'initMainMWS', 'initKlineMWS',
            'fetchKlines', 'fetchFGI', 'fetchDominance', 'fetchPerformance', 'fetchHeatmap',
            'renderAlertInputs', 'renderAlertHistory', 'scheduleRedraw',
            'updateDigits', 'onDocMouseMove', 'onDocMouseUp', 'onDocFullscreenChange', 'onDocVisibilityChange'
        ];
        refs.forEach(function(fn) {
            assert.ok(btcDefs.has(fn), 'init() uses ' + fn + ' but it is not defined in btc.js');
        });
    });

    // Functions called in destroy()
    it('destroy() references exist', function() {
        var refs = ['onDocMouseMove', 'onDocMouseUp', 'onDocFullscreenChange', 'onDocVisibilityChange'];
        refs.forEach(function(fn) {
            assert.ok(btcDefs.has(fn), 'destroy() removes ' + fn + ' but it is not defined in btc.js');
        });
    });

    // Chart tab activate calls reconnectKlineWS
    it('chart tab activate references exist', function() {
        assert.ok(btcSrc.includes('reconnectKlineWS'), 'chart tabs reference reconnectKlineWS');
        // reconnectKlineWS is klineMWS.reconnect() — verify klineMWS is defined
        assert.ok(btcDefs.has('klineMWS'), 'klineMWS should be defined');
    });

    // Functions that use App.* methods exist on App
    it('App methods used in btc.js exist in app.js exports', function() {
        var appMethods = ['setLive', 'setSourceStatus', 'touchSection', 'setTitle', 'updateFavicon',
                          'fmtP', 'fmtI', 'fmtV', 'escapeHTML', 'onOnline', 'offOnline', 'toast',
                          'getSetting', 'setSetting', 'toggleFullscreen'];
        appMethods.forEach(function(method) {
            // Check the method is exported as a key in App's return object (pattern: "name:" or "name :")
            var re = new RegExp('\\b' + method + '\\s*:');
            assert.ok(re.test(appSrc),
                'btc.js uses App.' + method + ' but it is not exported from app.js');
        });
    });

    // State variables used across functions
    it('shared state variables are defined', function() {
        var stateVars = ['active', 'currentSymbol', 'curPrice', 'lastPrice', 'high24', 'low24',
                         'klineData', 'activeTF', 'chartMode', 'indicators', 'apiRetries',
                         'fetchController', 'mainMWS', 'klineMWS', 'intervals', 'onOnlineCb'];
        stateVars.forEach(function(v) {
            assert.ok(btcDefs.has(v), 'state variable ' + v + ' should be defined in btc.js');
        });
    });
});

describe('btc.js init/destroy symmetry', function() {
    it('every document.addEventListener in init has matching removeEventListener in destroy', function() {
        var initBlock = btcSrc.match(/function init\(\)[\s\S]*?^}/m);
        var destroyBlock = btcSrc.match(/function destroy\(\)[\s\S]*?^}/m);
        assert.ok(initBlock, 'init function not found');
        assert.ok(destroyBlock, 'destroy function not found');

        var addRe = /document\.addEventListener\('([^']+)',\s*([^)]+)\)/g;
        var m;
        while ((m = addRe.exec(initBlock[0])) !== null) {
            var event = m[1], handler = m[2].trim();
            assert.ok(
                destroyBlock[0].includes("document.removeEventListener('" + event + "', " + handler + ")"),
                'init adds document listener for "' + event + '" (' + handler + ') but destroy does not remove it'
            );
        }
    });

    it('onOnline registered in init is unsubscribed in destroy', function() {
        var initBlock = btcSrc.match(/function init\(\)[\s\S]*?^}/m);
        var destroyBlock = btcSrc.match(/function destroy\(\)[\s\S]*?^}/m);
        assert.ok(initBlock[0].includes('App.onOnline'), 'init should register onOnline callback');
        assert.ok(destroyBlock[0].includes('App.offOnline'), 'destroy should unregister onOnline callback');
    });
});
