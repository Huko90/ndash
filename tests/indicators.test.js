const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Shim window object for the IIFE
var Indicators;
before(function() {
    var window = {};
    var code = fs.readFileSync(path.join(__dirname, '..', 'js', 'lib', 'indicators.js'), 'utf8');
    var fn = new Function('window', code);
    fn(window);
    Indicators = window.Indicators;
});

function makeCandles(closes) {
    return closes.map(function(c) { return { open: c, high: c + 1, low: c - 1, close: c, volume: 100 }; });
}

describe('Indicators.sma', function() {
    it('returns correct simple moving average', function() {
        var data = makeCandles([10, 20, 30, 40, 50]);
        var result = Indicators.sma(data, 3);
        assert.equal(result.length, 5);
        assert.equal(result[0], null);
        assert.equal(result[1], null);
        assert.equal(result[2], 20); // (10+20+30)/3
        assert.equal(result[3], 30); // (20+30+40)/3
        assert.equal(result[4], 40); // (30+40+50)/3
    });

    it('returns all nulls for data shorter than period', function() {
        var data = makeCandles([10, 20]);
        var result = Indicators.sma(data, 5);
        assert.ok(result.every(function(v) { return v === null; }));
    });

    it('handles single element with period 1', function() {
        var data = makeCandles([42]);
        var result = Indicators.sma(data, 1);
        assert.equal(result[0], 42);
    });
});

describe('Indicators.ema', function() {
    it('returns array same length as input', function() {
        var data = makeCandles([10, 20, 30, 40, 50]);
        var result = Indicators.ema(data, 3);
        assert.equal(result.length, 5);
    });

    it('first value equals first close', function() {
        var data = makeCandles([10, 20, 30]);
        var result = Indicators.ema(data, 2);
        assert.equal(result[0], 10);
    });

    it('converges toward recent prices', function() {
        var data = makeCandles([10, 10, 10, 10, 50, 50, 50, 50, 50]);
        var result = Indicators.ema(data, 3);
        // EMA should move toward 50 at the end
        var last = result[result.length - 1];
        assert.ok(last > 40, 'EMA should converge toward 50, got ' + last);
    });
});

describe('Indicators.bollinger', function() {
    it('returns upper, middle, lower bands', function() {
        var data = makeCandles([10, 20, 30, 40, 50, 60, 70]);
        var result = Indicators.bollinger(data, 3, 2);
        assert.ok(result.upper);
        assert.ok(result.middle);
        assert.ok(result.lower);
        assert.equal(result.upper.length, 7);
    });

    it('upper > middle > lower when non-null', function() {
        var data = makeCandles([10, 20, 30, 40, 50, 60, 70]);
        var result = Indicators.bollinger(data, 3, 2);
        for (var i = 0; i < result.upper.length; i++) {
            if (result.upper[i] !== null) {
                assert.ok(result.upper[i] > result.middle[i], 'upper should be > middle at index ' + i);
                assert.ok(result.middle[i] > result.lower[i], 'middle should be > lower at index ' + i);
            }
        }
    });

    it('bands are equal for constant prices', function() {
        var data = makeCandles([50, 50, 50, 50, 50]);
        var result = Indicators.bollinger(data, 3, 2);
        // With zero std dev, all bands should equal the SMA
        for (var i = 2; i < 5; i++) {
            assert.equal(result.upper[i], result.middle[i]);
            assert.equal(result.lower[i], result.middle[i]);
        }
    });
});

describe('Indicators.rsi', function() {
    it('returns array same length as input', function() {
        var data = makeCandles([10, 20, 30, 40, 50]);
        var result = Indicators.rsi(data, 3);
        assert.equal(result.length, 5);
    });

    it('first value is null', function() {
        var data = makeCandles([10, 20, 30, 40, 50]);
        var result = Indicators.rsi(data, 3);
        assert.equal(result[0], null);
    });

    it('RSI is 100 when all gains', function() {
        var data = makeCandles([10, 20, 30, 40, 50, 60]);
        var result = Indicators.rsi(data, 3);
        var lastNonNull = result.filter(function(v) { return v !== null; });
        var last = lastNonNull[lastNonNull.length - 1];
        assert.equal(last, 100);
    });

    it('RSI values are between 0 and 100', function() {
        var data = makeCandles([10, 15, 12, 18, 14, 20, 16, 22, 19, 25]);
        var result = Indicators.rsi(data, 5);
        result.forEach(function(v, i) {
            if (v !== null) {
                assert.ok(v >= 0 && v <= 100, 'RSI at index ' + i + ' is ' + v);
            }
        });
    });
});
