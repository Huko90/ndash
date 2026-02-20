// Technical indicator calculations (pure functions, no DOM/state).
// Used by btc.js chart rendering. Each function takes an array of
// candle objects ({close, ...}) and returns an array of values.
(function() {
    function sma(data, period) {
        var result = [];
        for (var i = 0; i < data.length; i++) {
            if (i < period - 1) { result.push(null); continue; }
            var sum = 0;
            for (var j = 0; j < period; j++) sum += data[i-j].close;
            result.push(sum / period);
        }
        return result;
    }

    function ema(data, period) {
        var result = [], k = 2 / (period + 1);
        for (var i = 0; i < data.length; i++) {
            if (i === 0) { result.push(data[i].close); continue; }
            if (i < period - 1) { result.push(null); continue; }
            if (result[i-1] === null) {
                var sum = 0; for (var j = 0; j < period; j++) sum += data[i-j].close;
                result.push(sum / period);
            } else {
                result.push(data[i].close * k + result[i-1] * (1 - k));
            }
        }
        return result;
    }

    function bollinger(data, period, mult) {
        var mid = sma(data, period);
        var upper = [], lower = [];
        for (var i = 0; i < data.length; i++) {
            if (mid[i] === null) { upper.push(null); lower.push(null); continue; }
            var sum = 0;
            for (var j = 0; j < period; j++) sum += Math.pow(data[i-j].close - mid[i], 2);
            var std = Math.sqrt(sum / period);
            upper.push(mid[i] + mult * std);
            lower.push(mid[i] - mult * std);
        }
        return {middle: mid, upper: upper, lower: lower};
    }

    function rsi(data, period) {
        var result = [], gains = [], losses = [];
        for (var i = 0; i < data.length; i++) {
            if (i === 0) { result.push(null); continue; }
            var change = data[i].close - data[i-1].close;
            gains.push(change > 0 ? change : 0);
            losses.push(change < 0 ? -change : 0);
            if (i < period) { result.push(null); continue; }
            var avgGain = 0, avgLoss = 0;
            for (var j = gains.length - period; j < gains.length; j++) { avgGain += gains[j]; avgLoss += losses[j]; }
            avgGain /= period; avgLoss /= period;
            if (avgLoss === 0) { result.push(100); }
            else { var rs = avgGain / avgLoss; result.push(100 - (100 / (1 + rs))); }
        }
        return result;
    }

    window.Indicators = {
        sma: sma,
        ema: ema,
        bollinger: bollinger,
        rsi: rsi
    };
})();
