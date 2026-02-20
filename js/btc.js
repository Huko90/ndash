(function() {
var $ = App.$;
var btcConfig = {};
var refreshConfig = {};
var alertConfig = {};
var apiBase = 'https://api.binance.com';
var wsBase = 'wss://stream.binance.com:9443';
var fearGreedApi = 'https://api.alternative.me/fng/?limit=1';
var dominanceApi = 'https://api.coingecko.com/api/v3/global';
var getPref = (typeof App.getSetting === 'function') ? App.getSetting : function(_k, fallback) { return fallback; };
var setPref = (typeof App.setSetting === 'function') ? App.setSetting : function() {};

// === ELEMENT REFS ===
var digitsWrap = $('digitsWrap'), pDec = $('pDec'), priceFlash = $('priceFlash');
var changePill = $('changePill'), changeIcon = $('changeIcon'), changePct = $('changePct'), changeAbs = $('changeAbs');
var sHigh = $('sHigh'), sLow = $('sLow'), sTrades = $('sTrades'), sTps = $('sTps'), sSpread = $('sSpread'), sDom = $('sDom');
var sHighD = $('sHighD'), sLowD = $('sLowD');
var pressureFill = $('pressureFill'), pBuy = $('pBuy'), pSell = $('pSell');
var perf7d = $('perf7d'), perf30d = $('perf30d'), perfYtd = $('perfYtd');
var volFill = $('volFill'), volVal = $('volVal');
var fgiNeedle = $('fgiNeedle'), fgiText = $('fgiText');
var chartWrap = $('chartWrap'), canvas = $('chart'), ctx = canvas.getContext('2d');
var overlay = $('overlay'), crossV = $('crossV'), crossH = $('crossH'), tip = $('tip');
var fullscreenBtn = $('fullscreenBtn');
var pairTag = $('pairTag');
var heatmapEl = $('heatmap');
var alertHighInput = $('alertHighInput'), alertLowInput = $('alertLowInput');
var setAlertBtn = $('setAlertBtn'), clearAlertBtn = $('clearAlertBtn'), notifyPermBtn = $('notifyPermBtn');
var alertHistoryEl = $('alertHistory');

// === STATE ===
var active = false;
var currentSymbol = getPref('btcSymbol', btcConfig.defaultSymbol || 'BTCUSDT');
var lastPrice = 0, curPrice = 0, high24 = 0, low24 = 0;
var buyVol = 0, sellVol = 0, cvd = 0;
var prevDigits = '';
var alertHigh = parseFloat(getPref('alertHigh', 0)) || 0;
var alertLow = parseFloat(getPref('alertLow', 0)) || 0;
var highAlertLatched = false, lowAlertLatched = false;
var alertHistory = getPref('alertHistory', []);

// === CHART STATE ===
var chartMode = getPref('chartMode', 'candle');
var activeTF = getPref('btcTf', btcConfig.defaultTimeframe || '1m');
var indicators = getPref('indicators', {sma:false, ema:false, boll:false, rsi:false}) || {sma:false, ema:false, boll:false, rsi:false};
var klineData = {};
var MAX_CANDLES = 500;
var visibleCandles = 100;
var scrollOffset = 0;
var isDragging = false;
var dragStartX = 0, dragStartOffset = 0;
var tfMap = {'1m':'1m','5m':'5m','15m':'15m','1h':'1h','4h':'4h','1d':'1d'};
var needsRedraw = false;
var lastWSMessage = Date.now();
var apiRetries = {fgi:0, dom:0, perf:0, kline:0, heatmap:0};
var fetchController = null;
var lastBtcStampTs = 0;
var indicatorCache = {};
var pendingTradeUpdate = null;
var tradeRafId = 0;
var lastCacheSaveAt = 0;
var onOnlineCb = null;

// === INTERVALS & WEBSOCKETS ===
var intervals = [];
var mainMWS = null, klineMWS = null;

// === SYMBOL DATA ===
var symbolDefs = {};
var symbolNames = {};
var symbolLogos = {};
function syncBtcConfig() {
    btcConfig = (window.BTCT_CONFIG && window.BTCT_CONFIG.btc) || {};
    refreshConfig = btcConfig.refresh || {};
    alertConfig = btcConfig.alerts || {};
    apiBase = btcConfig.apiBase || 'https://api.binance.com';
    wsBase = btcConfig.wsBase || 'wss://stream.binance.com:9443';
    fearGreedApi = btcConfig.fearGreedApi || 'https://api.alternative.me/fng/?limit=1';
    dominanceApi = btcConfig.dominanceApi || 'https://api.coingecko.com/api/v3/global';
    symbolDefs = btcConfig.symbols || {};
    symbolNames = {};
    symbolLogos = {};
    Object.keys(symbolDefs).forEach(function(sym) {
        symbolNames[sym] = symbolDefs[sym].name;
        symbolLogos[sym] = symbolDefs[sym].logo;
    });
    if (!symbolNames.BTCUSDT) {
        symbolNames.BTCUSDT = 'Bitcoin';
        symbolLogos.BTCUSDT = '₿';
    }
    heatmapCoins = btcConfig.heatmapCoins || ['BTCUSDT','ETHUSDT','BNBUSDT','XRPUSDT','SOLUSDT','ADAUSDT','DOGEUSDT','TRXUSDT','AVAXUSDT','LINKUSDT'];
}
syncBtcConfig();

// === ROLLING DIGITS ===
function updateDigits(price) {
    var intStr = Math.floor(price).toLocaleString('en-US');
    if (intStr === prevDigits) return;
    var h = digitsWrap.offsetHeight || 72;
    var html = '';
    for (var i = 0; i < intStr.length; i++) {
        var ch = intStr[i];
        if (ch === ',') { html += '<div class="digit-col comma-col"><div class="digit-inner"><span>,</span></div></div>'; continue; }
        var d = parseInt(ch);
        var spans = ''; for (var n = 0; n <= 9; n++) spans += '<span>' + n + '</span>';
        html += '<div class="digit-col"><div class="digit-inner" style="transform:translateY(-' + (d*h) + 'px)" data-d="' + d + '">' + spans + '</div></div>';
    }
    digitsWrap.innerHTML = html;
    prevDigits = intStr;
}

// === PRICE FLASH ===
function flashPrice(up) {
    var c = up ? 'rgba(0,230,118,' : 'rgba(255,23,68,';
    priceFlash.style.background = 'radial-gradient(circle,' + c + '0.2),transparent)';
    priceFlash.classList.remove('go'); void priceFlash.offsetWidth; priceFlash.classList.add('go');
}

function apiUrl(path) {
    return apiBase + path;
}

function wsUrl(path) {
    return wsBase + path;
}

function saveAlertState() {
    setPref('alertHigh', alertHigh || 0);
    setPref('alertLow', alertLow || 0);
    setPref('alertHistory', alertHistory.slice(0, alertConfig.historyLimit || 20));
}

function renderAlertInputs() {
    if (alertHighInput) alertHighInput.value = alertHigh ? alertHigh.toFixed(2) : '';
    if (alertLowInput) alertLowInput.value = alertLow ? alertLow.toFixed(2) : '';
}

function renderAlertHistory() {
    if (!alertHistoryEl) return;
    if (!alertHistory.length) {
        alertHistoryEl.textContent = alertHigh || alertLow ? 'Alerts armed' : 'No active alerts';
        return;
    }
    var latest = alertHistory[0];
    alertHistoryEl.textContent = latest.time + ' · ' + latest.message;
}

function playAlertTone() {
    if (alertConfig.audio === false) return;
    try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        var ctx = new Ctx();
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        var vol = (typeof alertConfig.volume === 'number') ? alertConfig.volume : 0.06;
        gain.gain.value = Math.max(0, Math.min(1, vol));
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        setTimeout(function() {
            osc.stop();
            ctx.close();
        }, 140);
    } catch (e) {}
}

function notifyAlert(title, body) {
    if (alertConfig.desktop === false || typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
        try { new Notification(title, { body: body }); } catch (e) {}
    }
}

function addAlertHistory(message) {
    var now = new Date();
    var stamp = now.toUTCString().slice(17, 25) + ' UTC';
    alertHistory.unshift({ time: stamp, message: message });
    alertHistory = alertHistory.slice(0, alertConfig.historyLimit || 20);
    saveAlertState();
    renderAlertHistory();
}

function triggerAlert(kind, price) {
    var text = kind === 'high' ? 'High alert hit @ $' + App.fmtP(price) : 'Low alert hit @ $' + App.fmtP(price);
    addAlertHistory(text);
    playAlertTone();
    notifyAlert('BTC Price Alert', text);
}

// === DYNAMIC ORBS ===
function updateOrbs(trend) {
    if (trend > 0) {
        App.el.orb1.style.background = 'radial-gradient(circle,rgba(0,230,118,0.08),transparent 70%)';
        App.el.orb2.style.background = 'radial-gradient(circle,rgba(0,200,83,0.06),transparent 70%)';
    } else if (trend < 0) {
        App.el.orb1.style.background = 'radial-gradient(circle,rgba(255,23,68,0.08),transparent 70%)';
        App.el.orb2.style.background = 'radial-gradient(circle,rgba(213,0,0,0.06),transparent 70%)';
    } else {
        App.el.orb1.style.background = 'radial-gradient(circle,rgba(245,200,66,0.12),transparent 70%)';
        App.el.orb2.style.background = 'radial-gradient(circle,rgba(247,147,26,0.08),transparent 70%)';
    }
}

// === ALERT CHECK ===
function checkAlerts(p) {
    var af = App.el.alertFlash;
    if (alertHigh && p >= alertHigh) {
        af.style.background = 'rgba(0,230,118,0.15)';
        af.classList.remove('go'); void af.offsetWidth; af.classList.add('go');
        if (!highAlertLatched) {
            highAlertLatched = true;
            triggerAlert('high', p);
        }
    }
    if (alertLow && p <= alertLow) {
        af.style.background = 'rgba(255,23,68,0.15)';
        af.classList.remove('go'); void af.offsetWidth; af.classList.add('go');
        if (!lowAlertLatched) {
            lowAlertLatched = true;
            triggerAlert('low', p);
        }
    }
    if (!alertHigh || p < alertHigh * 0.998) highAlertLatched = false;
    if (!alertLow || p > alertLow * 1.002) lowAlertLatched = false;
}

// Technical indicators provided by js/lib/indicators.js (window.Indicators)

// === CHART RENDERING ===
function getVisibleData() {
    var data = klineData[activeTF] || [];
    if (data.length === 0) return [];
    var end = data.length - scrollOffset;
    var start = Math.max(0, end - visibleCandles);
    return data.slice(start, end);
}

function drawChart() {
    var data = getVisibleData();
    var dpr = devicePixelRatio || 1;
    var rect = canvas.parentElement.getBoundingClientRect();
    var newW = Math.round(rect.width * dpr);
    var newH = Math.round(rect.height * dpr);
    if (canvas.width !== newW || canvas.height !== newH) {
        canvas.width = newW;
        canvas.height = newH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    if (data.length < 2) return;

    var w = rect.width, ht = rect.height;
    var volHeight = 30;
    var rsiHeight = indicators.rsi ? 50 : 0;
    var mainHeight = ht - volHeight - rsiHeight - 8;
    var pad = 4;

    var minP = Infinity, maxP = -Infinity, maxVol = 0;
    for (var i = 0; i < data.length; i++) {
        if (data[i].low < minP) minP = data[i].low;
        if (data[i].high > maxP) maxP = data[i].high;
        if (data[i].volume > maxVol) maxVol = data[i].volume;
    }

    var range = maxP - minP || 1;
    minP -= range * 0.05; maxP += range * 0.05; range = maxP - minP;

    var candleW = Math.max(1, (w - pad*2) / data.length - 1);
    var step = (w - pad*2) / data.length;

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 0.5;
    for (var i = 0; i < 5; i++) {
        var yy = pad + (mainHeight - pad*2) * (i/4);
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke();
    }

    function priceToY(p) { return pad + (mainHeight - pad*2) * (1 - (p - minP) / range); }

    if (chartMode === 'candle') {
        for (var i = 0; i < data.length; i++) {
            var c = data[i];
            var x = pad + i * step + step/2;
            var isGreen = c.close >= c.open;
            var color = isGreen ? '#00e676' : '#ff1744';
            ctx.strokeStyle = color; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, priceToY(c.high)); ctx.lineTo(x, priceToY(c.low)); ctx.stroke();
            var bodyTop = priceToY(Math.max(c.open, c.close));
            var bodyBot = priceToY(Math.min(c.open, c.close));
            var bodyH = Math.max(1, bodyBot - bodyTop);
            ctx.fillStyle = color;
            ctx.fillRect(x - candleW/2, bodyTop, candleW, bodyH);
        }
    } else {
        var rising = data[data.length-1].close >= data[0].close;
        var clr = rising ? '0,230,118' : '255,23,68';
        ctx.beginPath();
        for (var i = 0; i < data.length; i++) {
            var x = pad + i * step + step/2;
            var y = priceToY(data[i].close);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(' + clr + ',0.8)'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
        var grd = ctx.createLinearGradient(0, 0, 0, mainHeight);
        grd.addColorStop(0, 'rgba(' + clr + ',0.12)'); grd.addColorStop(1, 'rgba(' + clr + ',0)');
        ctx.lineTo(pad + (data.length-1) * step + step/2, mainHeight);
        ctx.lineTo(pad + step/2, mainHeight);
        ctx.closePath(); ctx.fillStyle = grd; ctx.fill();
    }

    // Indicators (cached — only recalculated when candle data changes)
    var allData = klineData[activeTF] || [];
    var cacheKey = activeTF + ':' + allData.length + ':' + (allData.length ? allData[allData.length-1].time : 0);
    if (indicatorCache._key !== cacheKey) {
        indicatorCache._key = cacheKey;
        indicatorCache.sma = indicators.sma ? Indicators.sma(allData, 20) : null;
        indicatorCache.ema = indicators.ema ? Indicators.ema(allData, 12) : null;
        indicatorCache.boll = indicators.boll ? Indicators.bollinger(allData, 20, 2) : null;
        indicatorCache.rsi = indicators.rsi ? Indicators.rsi(allData, 14) : null;
    }
    if (indicators.sma && indicatorCache.sma) {
        var visibleSMA = indicatorCache.sma.slice(indicatorCache.sma.length - data.length - scrollOffset, indicatorCache.sma.length - scrollOffset);
        drawIndicatorLine(visibleSMA, '#3b82f6', priceToY, step, pad);
    }
    if (indicators.ema && indicatorCache.ema) {
        var visibleEMA = indicatorCache.ema.slice(indicatorCache.ema.length - data.length - scrollOffset, indicatorCache.ema.length - scrollOffset);
        drawIndicatorLine(visibleEMA, '#f97316', priceToY, step, pad);
    }
    if (indicators.boll && indicatorCache.boll) {
        var startIdx = allData.length - data.length - scrollOffset;
        var endIdx = startIdx + data.length;
        drawIndicatorLine(indicatorCache.boll.upper.slice(startIdx, endIdx), '#a855f7', priceToY, step, pad, 0.5);
        drawIndicatorLine(indicatorCache.boll.middle.slice(startIdx, endIdx), '#a855f7', priceToY, step, pad, 0.3);
        drawIndicatorLine(indicatorCache.boll.lower.slice(startIdx, endIdx), '#a855f7', priceToY, step, pad, 0.5);
    }

    // Volume bars
    var volTop = mainHeight + 4;
    for (var i = 0; i < data.length; i++) {
        var c = data[i];
        var x = pad + i * step + step/2;
        var isGreen = c.close >= c.open;
        var volH = (c.volume / maxVol) * volHeight * 0.9;
        ctx.fillStyle = isGreen ? 'rgba(0,230,118,0.3)' : 'rgba(255,23,68,0.3)';
        ctx.fillRect(x - candleW/2, volTop + volHeight - volH, candleW, volH);
    }

    // RSI (cached)
    if (indicators.rsi && indicatorCache.rsi) {
        var rsiTop = mainHeight + volHeight + 8;
        var visibleRSI = indicatorCache.rsi.slice(indicatorCache.rsi.length - data.length - scrollOffset, indicatorCache.rsi.length - scrollOffset);
        ctx.fillStyle = 'rgba(255,255,255,0.02)';
        ctx.fillRect(0, rsiTop, w, rsiHeight);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 0.5; ctx.setLineDash([4,4]);
        var y30 = rsiTop + rsiHeight * (1 - 30/100);
        var y70 = rsiTop + rsiHeight * (1 - 70/100);
        ctx.beginPath(); ctx.moveTo(0, y30); ctx.lineTo(w, y30); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, y70); ctx.lineTo(w, y70); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        var first = true;
        for (var i = 0; i < visibleRSI.length; i++) {
            if (visibleRSI[i] === null) continue;
            var x = pad + i * step + step/2;
            var y = rsiTop + rsiHeight * (1 - visibleRSI[i] / 100);
            if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
        }
        ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // Latest price dot
    if (data.length > 0) {
        var lastC = data[data.length-1];
        var ly = priceToY(lastC.close);
        var lx = pad + (data.length-1) * step + step/2;
        ctx.fillStyle = lastC.close >= lastC.open ? 'rgba(0,230,118,0.9)' : 'rgba(255,23,68,0.9)';
        ctx.beginPath(); ctx.arc(lx, ly, 3, 0, 6.28); ctx.fill();
    }
}

function drawIndicatorLine(values, color, priceToY, step, pad, alpha) {
    alpha = alpha || 1;
    ctx.beginPath();
    var first = true;
    for (var i = 0; i < values.length; i++) {
        if (values[i] === null) continue;
        var x = pad + i * step + step/2;
        var y = priceToY(values[i]);
        if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
    }
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 1; ctx.stroke();
    ctx.globalAlpha = 1;
}

function scheduleRedraw() {
    if (!active || document.hidden) return;
    if (!needsRedraw) {
        needsRedraw = true;
        requestAnimationFrame(function() { drawChart(); needsRedraw = false; });
    }
}

// === CHART CROSSHAIR & TOOLTIP ===
overlay.addEventListener('mousemove', function(e) {
    var rect = overlay.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    crossV.style.left = x + 'px'; crossV.style.opacity = '1';
    crossH.style.top = y + 'px'; crossH.style.opacity = '1';
    var data = getVisibleData();
    if (data.length === 0) return;
    var step = (rect.width - 8) / data.length;
    var idx = Math.floor((x - 4) / step);
    if (idx >= 0 && idx < data.length) {
        var c = data[idx];
        var html = '<div class="tt-ohlc">';
        html += '<span class="tt-label">O:</span><span>$' + App.fmtP(c.open) + '</span>';
        html += '<span class="tt-label">H:</span><span>$' + App.fmtP(c.high) + '</span>';
        html += '<span class="tt-label">L:</span><span>$' + App.fmtP(c.low) + '</span>';
        html += '<span class="tt-label">C:</span><span>$' + App.fmtP(c.close) + '</span>';
        html += '<span class="tt-label">V:</span><span>' + App.fmtV(c.volume * c.close) + '</span>';
        html += '</div>';
        tip.innerHTML = html;
        tip.style.left = Math.min(x + 10, rect.width - 120) + 'px';
        tip.style.top = Math.max(y - 70, 0) + 'px';
        tip.style.opacity = '1';
    }
});
overlay.addEventListener('mouseleave', function() {
    crossV.style.opacity = '0'; crossH.style.opacity = '0'; tip.style.opacity = '0';
});

// === ZOOM WITH MOUSE WHEEL ===
overlay.addEventListener('wheel', function(e) {
    e.preventDefault();
    var delta = e.deltaY > 0 ? 10 : -10;
    var data = klineData[activeTF] || [];
    visibleCandles = Math.max(20, Math.min(data.length, visibleCandles + delta));
    var maxOffset = Math.max(0, data.length - visibleCandles);
    scrollOffset = Math.min(scrollOffset, maxOffset);
    scheduleRedraw();
}, {passive:false});

// === PAN WITH DRAG ===
overlay.addEventListener('mousedown', function(e) {
    isDragging = true; dragStartX = e.clientX; dragStartOffset = scrollOffset;
    overlay.style.cursor = 'grabbing';
});
var onDocMouseMove = function(e) {
    if (!isDragging) return;
    var dx = e.clientX - dragStartX;
    var rect = overlay.getBoundingClientRect();
    var step = (rect.width - 8) / visibleCandles;
    var candlesMoved = Math.round(dx / step);
    var data = klineData[activeTF] || [];
    var maxOffset = Math.max(0, data.length - visibleCandles);
    scrollOffset = Math.max(0, Math.min(maxOffset, dragStartOffset + candlesMoved));
    scheduleRedraw();
};
var onDocMouseUp = function() {
    isDragging = false; overlay.style.cursor = 'crosshair';
};

// === TOUCH SUPPORT ===
var touchStartX = 0, lastTouchDist = 0;
overlay.addEventListener('touchstart', function(e) {
    if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX; dragStartOffset = scrollOffset;
    } else if (e.touches.length === 2) {
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist = Math.sqrt(dx*dx + dy*dy);
    }
}, {passive:true});
overlay.addEventListener('touchmove', function(e) {
    if (e.touches.length === 1) {
        var dx = e.touches[0].clientX - touchStartX;
        var rect = overlay.getBoundingClientRect();
        var step = (rect.width - 8) / visibleCandles;
        var candlesMoved = Math.round(dx / step);
        var data = klineData[activeTF] || [];
        var maxOffset = Math.max(0, data.length - visibleCandles);
        scrollOffset = Math.max(0, Math.min(maxOffset, dragStartOffset + candlesMoved));
        scheduleRedraw();
    } else if (e.touches.length === 2) {
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        var dist = Math.sqrt(dx*dx + dy*dy);
        var delta = (lastTouchDist - dist) / 5;
        var data = klineData[activeTF] || [];
        visibleCandles = Math.max(20, Math.min(data.length, visibleCandles + delta));
        var maxOffset = Math.max(0, data.length - visibleCandles);
        scrollOffset = Math.min(scrollOffset, maxOffset);
        lastTouchDist = dist;
        scheduleRedraw();
    }
}, {passive:true});

// === CHART TYPE TOGGLE ===
document.querySelectorAll('.chart-type-btn').forEach(function(btn) {
    function activate() {
        document.querySelectorAll('.chart-type-btn').forEach(function(b) { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        chartMode = btn.dataset.type;
        setPref('chartMode', chartMode);
        scheduleRedraw();
    }
    btn.addEventListener('click', activate);
    btn.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
});

// === TIMEFRAME TABS ===
document.querySelectorAll('.chart-tab').forEach(function(tab) {
    function activate() {
        document.querySelectorAll('.chart-tab').forEach(function(t) { t.classList.remove('active'); t.setAttribute('aria-pressed', 'false'); });
        tab.classList.add('active');
        tab.setAttribute('aria-pressed', 'true');
        var newTF = tab.dataset.tf;
        if (newTF !== activeTF) {
            activeTF = newTF;
            setPref('btcTf', activeTF);
            indicatorCache = {};
            scrollOffset = 0;
            visibleCandles = 100;
            if (!klineData[activeTF] || klineData[activeTF].length === 0) {
                fetchKlines(activeTF);
            }
            reconnectKlineWS();
            scheduleRedraw();
        }
    }
    tab.addEventListener('click', activate);
    tab.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
});

// === INDICATOR TOGGLES ===
document.querySelectorAll('.ind-btn').forEach(function(btn) {
    function activate() {
        var ind = btn.dataset.ind;
        indicators[ind] = !indicators[ind];
        btn.classList.toggle('active', indicators[ind]);
        btn.setAttribute('aria-pressed', indicators[ind] ? 'true' : 'false');
        setPref('indicators', indicators);
        indicatorCache = {};
        chartWrap.classList.toggle('with-rsi', indicators.rsi);
        scheduleRedraw();
    }
    btn.addEventListener('click', activate);
    btn.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
});

// === ALERT CONTROLS ===
if (setAlertBtn) {
    setAlertBtn.addEventListener('click', function() {
        var highVal = alertHighInput ? alertHighInput.value.trim() : '';
        var lowVal = alertLowInput ? alertLowInput.value.trim() : '';
        var nextHigh = highVal ? parseFloat(highVal) : 0;
        var nextLow = lowVal ? parseFloat(lowVal) : 0;
        if (highVal && (!isFinite(nextHigh) || nextHigh < 0)) { App.toast('Invalid high alert value', 'warn'); return; }
        if (lowVal && (!isFinite(nextLow) || nextLow < 0)) { App.toast('Invalid low alert value', 'warn'); return; }
        if (nextHigh > 0 && nextLow > 0 && nextHigh <= nextLow) { App.toast('High alert must be greater than low alert', 'warn'); return; }
        alertHigh = nextHigh;
        alertLow = nextLow;
        highAlertLatched = false;
        lowAlertLatched = false;
        saveAlertState();
        renderAlertInputs();
        renderAlertHistory();
    });
}
if (clearAlertBtn) {
    clearAlertBtn.addEventListener('click', function() {
        alertHigh = 0;
        alertLow = 0;
        highAlertLatched = false;
        lowAlertLatched = false;
        alertHistory = [];
        saveAlertState();
        renderAlertInputs();
        renderAlertHistory();
    });
}
if (notifyPermBtn) {
    notifyPermBtn.addEventListener('click', function() {
        var showToast = (typeof App.toast === 'function') ? App.toast : function() {};
        if (typeof Notification === 'undefined') {
            showToast('Notifications are not supported in this browser context.', 'err', 3600);
            return;
        }
        if (!window.isSecureContext) {
            showToast('Notifications require secure context. Use HTTPS or localhost.', 'err', 4200);
            return;
        }
        if (Notification.permission === 'granted') {
            showToast('Desktop notifications are enabled.', 'ok', 2600);
            return;
        }
        if (Notification.permission === 'denied') {
            showToast('Notifications are blocked. Enable them in Brave site settings.', 'err', 4200);
            return;
        }
        showToast('Requesting notification permission...', 'info', 2200);
        Notification.requestPermission().then(function(result) {
            if (result === 'granted') {
                showToast('Notifications enabled.', 'ok', 2600);
                try { new Notification('nDash', { body: 'Desktop notifications are now enabled.' }); } catch (e) {}
                return;
            }
            if (result === 'denied') {
                showToast('Notifications blocked. Enable in Brave site settings.', 'err', 4200);
                return;
            }
            showToast('Permission dismissed. Click Notify again any time.', 'info', 3600);
        }).catch(function() {
            showToast('Could not request notification permission.', 'err', 3600);
        });
    });
}

// === FULLSCREEN BUTTON (chart) ===
fullscreenBtn.addEventListener('click', App.toggleFullscreen);
var onDocFullscreenChange = function() {
    if (active) setTimeout(scheduleRedraw, 100);
};
var onDocVisibilityChange = function() {
    if (!active || document.hidden) return;
    fetchFGI();
    fetchDominance();
    fetchPerformance();
    fetchHeatmap();
    scheduleRedraw();
};
function abortPendingFetches() {
    if (fetchController) fetchController.abort();
    fetchController = new AbortController();
    return fetchController.signal;
}

// === FETCH HISTORICAL KLINES ===
function fetchKlines(tf) {
    var interval = tfMap[tf] || '1m';
    var sig = fetchController ? fetchController.signal : undefined;
    fetch(apiUrl('/api/v3/klines?symbol=' + currentSymbol + '&interval=' + interval + '&limit=' + MAX_CANDLES), {signal:sig})
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (!active) return;
        klineData[tf] = data.map(function(k) {
            return { time:k[0], open:parseFloat(k[1]), high:parseFloat(k[2]), low:parseFloat(k[3]), close:parseFloat(k[4]), volume:parseFloat(k[5]) };
        });
        App.setSourceStatus('binance', true);
        apiRetries.kline = 0;
        if (tf === activeTF) {
            visibleCandles = Math.min(100, klineData[tf].length);
            scrollOffset = 0;
        }
        scheduleRedraw();
    }).catch(function(e) {
        if (e && e.name === 'AbortError') return;
        App.setSourceStatus('binance', false);
        console.error('Kline fetch error:', e);
        apiRetries.kline++;
        if (apiRetries.kline < 5) setTimeout(function() { fetchKlines(tf); }, Math.min(60000 * apiRetries.kline, 300000));
    });
}

// === KLINE WEBSOCKET ===
function initKlineMWS() {
    klineMWS = new ManagedWebSocket({
        url: function() {
            var interval = tfMap[activeTF] || '1m';
            return wsUrl('/ws/' + currentSymbol.toLowerCase() + '@kline_' + interval);
        },
        onMessage: function(e) {
            var msg;
            try { msg = JSON.parse(e.data); } catch (_) { return; }
            if (!msg.k) return;
            var k = msg.k;
            var o = parseFloat(k.o), h = parseFloat(k.h), l = parseFloat(k.l), c = parseFloat(k.c), v = parseFloat(k.v);
            if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) return;
            var candle = { time:k.t, open:o, high:h, low:l, close:c, volume:isFinite(v)?v:0 };
            var data = klineData[activeTF];
            if (!data) return;
            if (data.length > 0 && data[data.length-1].time === candle.time) {
                data[data.length-1] = candle;
            } else if (k.x) {
                data.push(candle);
                if (data.length > MAX_CANDLES) data.shift();
            } else if (data.length > 0) {
                data[data.length-1] = candle;
            }
            scheduleRedraw();
        },
        reconnectDelay: 3000,
        backoff: false
    });
}

// === FEAR & GREED INDEX ===
function fetchFGI() {
    fetch(fearGreedApi, {signal: fetchController ? fetchController.signal : undefined})
    .then(function(r) { return r.json(); })
    .then(function(d) {
        if (!active) return;
        if (d && d.data && d.data[0]) {
            var val = parseInt(d.data[0].value), cls = d.data[0].value_classification;
            fgiNeedle.style.left = val + '%';
            fgiText.textContent = val + ' · ' + cls;
            fgiText.style.color = val < 25 ? 'var(--red)' : val < 45 ? '#ff9100' : val < 55 ? '#ffea00' : val < 75 ? '#76ff03' : 'var(--green)';
            apiRetries.fgi = 0;
        }
    }).catch(function(e) {
        if (e && e.name === 'AbortError') return;
        console.error('FGI error:', e);
        apiRetries.fgi++;
        if (apiRetries.fgi < 5) setTimeout(fetchFGI, Math.min(60000 * apiRetries.fgi, 300000));
        else { fgiText.textContent = '--'; fgiText.style.color = ''; }
    });
}

// === BTC DOMINANCE ===
function fetchDominance() {
    fetch(dominanceApi, {signal: fetchController ? fetchController.signal : undefined})
    .then(function(r) { return r.json(); })
    .then(function(d) {
        if (!active) return;
        if (d && d.data && d.data.market_cap_percentage) {
            var dom = d.data.market_cap_percentage.btc;
            sDom.textContent = dom.toFixed(1) + '%';
            apiRetries.dom = 0;
        }
    }).catch(function(e) {
        if (e && e.name === 'AbortError') return;
        console.error('Dominance error:', e);
        apiRetries.dom++;
        if (apiRetries.dom < 5) setTimeout(fetchDominance, Math.min(60000 * apiRetries.dom, 300000));
        else sDom.textContent = '--';
    });
}

// === MAIN BINANCE WEBSOCKET ===
function initMainMWS() {
    mainMWS = new ManagedWebSocket({
        url: function() {
            var sym = currentSymbol.toLowerCase();
            return wsUrl('/stream?streams=' + sym + '@trade/' + sym + '@ticker/' + sym + '@depth5@100ms');
        },
        onConnect: function() {
            App.setLive(true, 'Live');
            App.setSourceStatus('binance', true);
            App.el.logo.classList.remove('pulse'); void App.el.logo.offsetWidth; App.el.logo.classList.add('pulse');
        },
        onDisconnect: function() {
            App.setLive(false, 'Offline');
            App.setSourceStatus('binance', false);
        },
        onMessage: function(e) {
            App.incMsg();
            lastWSMessage = Date.now();
            var msg;
            try { msg = JSON.parse(e.data); } catch (_) { return; }
            var stream = msg.stream, d = msg.data;
            if (!d) return;
            var sym = currentSymbol.toLowerCase();

            // TRADE — buffer state, apply DOM changes once per frame
            if (stream === sym + '@trade') {
                var p = parseFloat(d.p), q = parseFloat(d.q);
                if (!isFinite(p) || !isFinite(q)) return;
                var val = p * q;
                lastPrice = curPrice; curPrice = p;
                if (d.m === false) { buyVol += val; cvd += val; } else { sellVol += val; cvd -= val; }
                checkAlerts(p);
                pendingTradeUpdate = { price: p, up: lastPrice ? p > lastPrice : null, changed: p !== lastPrice };
                if (!tradeRafId) {
                    tradeRafId = requestAnimationFrame(function() {
                        tradeRafId = 0;
                        var t = pendingTradeUpdate;
                        if (!t) return;
                        pendingTradeUpdate = null;
                        updateDigits(t.price);
                        App.setTitle('\u20bf $' + App.fmtP(t.price));
                        pDec.textContent = '.' + t.price.toFixed(2).split('.')[1];
                        if (t.up !== null) {
                            if (t.changed) flashPrice(t.up);
                            pDec.style.color = t.up ? 'rgba(0,230,118,0.6)' : 'rgba(255,23,68,0.6)';
                            setTimeout(function() { pDec.style.color = ''; }, 300);
                            updateOrbs(t.up ? 1 : -1);
                            App.updateFavicon(t.up ? 1 : -1);
                        }
                        var totalVol = buyVol + sellVol;
                        if (totalVol > 0) {
                            var buyPct = (buyVol / totalVol * 100);
                            pressureFill.style.width = buyPct.toFixed(1) + '%';
                            pBuy.textContent = buyPct.toFixed(0) + '%';
                            pSell.textContent = (100 - buyPct).toFixed(0) + '%';
                        }
                        // Throttled cache save (every 10s)
                        if (Date.now() - lastCacheSaveAt > 10000 && curPrice) {
                            lastCacheSaveAt = Date.now();
                            setPref('btcCache', {price:curPrice, high24:high24, low24:low24, symbol:currentSymbol, ts:Date.now()});
                        }
                    });
                }
            }

            // 24h TICKER
            if (stream === sym + '@ticker') {
                high24 = parseFloat(d.h); low24 = parseFloat(d.l);
                if (!isFinite(high24) || !isFinite(low24)) return;
                sHigh.textContent = '$' + App.fmtI(high24);
                sLow.textContent = '$' + App.fmtI(low24);
                if (curPrice) {
                    var dH = ((curPrice - high24) / high24 * 100).toFixed(2);
                    var dL = ((curPrice - low24) / low24 * 100).toFixed(2);
                    sHighD.textContent = dH + '%'; sHighD.style.color = dH >= 0 ? 'var(--green)' : 'var(--red)';
                    sLowD.textContent = '+' + dL + '%'; sLowD.style.color = 'var(--green)';
                }
                var pctChange = parseFloat(d.P), absChange = parseFloat(d.p);
                var pos = pctChange >= 0;
                changePill.className = 'change-pill ' + (pos ? 'pos' : 'neg');
                changeIcon.textContent = pos ? '▲' : '▼';
                changePct.textContent = (pos ? '+' : '') + pctChange.toFixed(2) + '%';
                changeAbs.textContent = (pos ? '+' : '') + App.fmtP(absChange);
                var vol = parseFloat(d.q) * ((high24 + low24) / 2);
                volVal.textContent = App.fmtV(vol);
                var volPct = Math.min(100, vol / 5e10 * 100);
                volFill.style.width = volPct.toFixed(1) + '%';
                var trades = parseInt(d.n);
                sTrades.textContent = trades >= 1e6 ? (trades/1e6).toFixed(1) + 'M' : trades >= 1e3 ? (trades/1e3).toFixed(0) + 'K' : trades;
                sTps.textContent = Math.round(trades / 86400) + ' tps';
            }

            // ORDER BOOK DEPTH
            if (stream === sym + '@depth5@100ms') {
                if (d.bids && d.bids.length && d.asks && d.asks.length) {
                    var bestBid = parseFloat(d.bids[0][0]), bestAsk = parseFloat(d.asks[0][0]);
                    var spread = (bestAsk - bestBid).toFixed(2);
                    sSpread.textContent = '$' + spread;
                }
            }
            if (Date.now() - lastBtcStampTs > 5000) {
                App.touchSection('btc');
                lastBtcStampTs = Date.now();
            }
        },
        reconnectDelay: 1000,
        maxReconnectDelay: 30000,
        backoff: true
    });
}

// === PERFORMANCE (7D, 30D, YTD) ===
function fetchPerformance() {
    var now = Date.now();
    var day7 = now - 7*24*60*60*1000;
    var day30 = now - 30*24*60*60*1000;
    var ytdStart = new Date(new Date().getFullYear(), 0, 1).getTime();
    var sig = fetchController ? fetchController.signal : undefined;

    Promise.all([
        fetch(apiUrl('/api/v3/klines?symbol=' + currentSymbol + '&interval=1d&startTime=' + day7 + '&limit=1'), {signal:sig}).then(function(r) { return r.json(); }),
        fetch(apiUrl('/api/v3/klines?symbol=' + currentSymbol + '&interval=1d&startTime=' + day30 + '&limit=1'), {signal:sig}).then(function(r) { return r.json(); }),
        fetch(apiUrl('/api/v3/klines?symbol=' + currentSymbol + '&interval=1d&startTime=' + ytdStart + '&limit=1'), {signal:sig}).then(function(r) { return r.json(); }),
        fetch(apiUrl('/api/v3/ticker/price?symbol=' + currentSymbol), {signal:sig}).then(function(r) { return r.json(); })
    ]).then(function(results) {
        if (!active) return;
        var price7d = parseFloat(results[0][0][1]);
        var price30d = parseFloat(results[1][0][1]);
        var priceYtd = parseFloat(results[2][0][1]);
        var priceNow = parseFloat(results[3].price);

        var pct7 = ((priceNow - price7d) / price7d * 100);
        var pct30 = ((priceNow - price30d) / price30d * 100);
        var pctYtd = ((priceNow - priceYtd) / priceYtd * 100);

        perf7d.textContent = (pct7 >= 0 ? '+' : '') + pct7.toFixed(1) + '%';
        perf7d.className = 'perf-val ' + (pct7 >= 0 ? 'pos' : 'neg');
        perf30d.textContent = (pct30 >= 0 ? '+' : '') + pct30.toFixed(1) + '%';
        perf30d.className = 'perf-val ' + (pct30 >= 0 ? 'pos' : 'neg');
        perfYtd.textContent = (pctYtd >= 0 ? '+' : '') + pctYtd.toFixed(1) + '%';
        perfYtd.className = 'perf-val ' + (pctYtd >= 0 ? 'pos' : 'neg');
        apiRetries.perf = 0;
    }).catch(function(e) {
        if (e && e.name === 'AbortError') return;
        console.error('Performance error:', e);
        apiRetries.perf++;
        if (apiRetries.perf < 5) setTimeout(fetchPerformance, Math.min(60000 * apiRetries.perf, 300000));
        else { perf7d.textContent = '--'; perf30d.textContent = '--'; perfYtd.textContent = '--'; }
    });
}

// === HEATMAP ===
function fetchHeatmap() {
    if (!heatmapEl || heatmapCoins.length === 0) return;
    var sig = fetchController ? fetchController.signal : undefined;
    var promises = heatmapCoins.map(function(sym) {
        return fetch(apiUrl('/api/v3/ticker/24hr?symbol=' + sym), {signal:sig})
            .then(function(r) { return r.json(); })
            .catch(function() { return null; });
    });

    Promise.all(promises).then(function(results) {
        if (!active) return;
        var data = results.filter(function(r) { return r !== null; });
        if (data.length === 0) return;

        var html = '';
        heatmapCoins.forEach(function(symbol) {
            var t = data.find(function(d) { return d.symbol === symbol; });
            if (!t) return;
            var sym = t.symbol.replace('USDT', '');
            var pct = parseFloat(t.priceChangePercent);
            var intensity = Math.min(Math.abs(pct) / 10, 1);
            var bg = pct >= 0 ?
                'rgba(0,230,118,' + (0.2 + intensity * 0.6) + ')' :
                'rgba(255,23,68,' + (0.2 + intensity * 0.6) + ')';
            var isActive = t.symbol === currentSymbol ? ' active' : '';
            var pctLabel = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
            html += '<div class="hm-item' + isActive + '" data-symbol="' + App.escapeHTML(t.symbol) + '" style="background:' + bg + '" role="button" tabindex="0" aria-label="' + App.escapeHTML(sym) + ' ' + pctLabel + '">';
            html += '<div class="hm-symbol">' + App.escapeHTML(sym) + '</div>';
            html += '<div class="hm-change">' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%</div>';
            html += '</div>';
        });
        heatmapEl.innerHTML = html;
        heatmapEl.querySelectorAll('.hm-item').forEach(function(item) {
            function activate() { switchSymbol(item.dataset.symbol); }
            item.addEventListener('click', activate);
            item.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
        });
    }).catch(function(e) {
        if (e && e.name === 'AbortError') return;
        console.error('Heatmap error:', e);
        apiRetries.heatmap++;
        if (apiRetries.heatmap < 5) setTimeout(fetchHeatmap, Math.min(60000 * apiRetries.heatmap, 300000));
        else heatmapEl.innerHTML = '<span class="loading-text">Unavailable</span>';
    });
}

// === SWITCH SYMBOL ===
function switchSymbol(newSymbol) {
    if (newSymbol === currentSymbol) return;
    currentSymbol = newSymbol;
    setPref('btcSymbol', currentSymbol);

    // Abort in-flight fetches from previous symbol
    abortPendingFetches();
    apiRetries = {fgi:0, dom:0, perf:0, kline:0, heatmap:0};

    // Reset state
    lastPrice = 0; curPrice = 0; buyVol = 0; sellVol = 0; cvd = 0;
    klineData = {};
    prevDigits = '';

    // Update UI
    var sym = currentSymbol.replace('USDT', '');
    var name = symbolNames[currentSymbol] || sym;
    pairTag.innerHTML = '<span class="dot"></span>' + App.escapeHTML(sym) + ' / USDT · Binance';
    App.el.brandName.innerHTML = '<span>' + App.escapeHTML(name) + '</span> Ticker';
    App.el.logo.textContent = symbolLogos[currentSymbol] || sym[0];
    digitsWrap.innerHTML = '';
    pDec.textContent = '.--';

    // Reconnect WebSockets
    mainMWS.reconnect();
    klineMWS.reconnect();

    // Refetch data
    fetchKlines(activeTF);
    fetchPerformance();
    fetchHeatmap();
}

// === INIT / DESTROY ===
function init() {
    active = true;
    syncBtcConfig();
    lastWSMessage = Date.now();
    apiRetries = {fgi:0, dom:0, perf:0, kline:0, heatmap:0};
    fetchController = new AbortController();

    // Attach document-level listeners (removed in destroy)
    document.addEventListener('mousemove', onDocMouseMove);
    document.addEventListener('mouseup', onDocMouseUp);
    document.addEventListener('fullscreenchange', onDocFullscreenChange);
    document.addEventListener('visibilitychange', onDocVisibilityChange);

    initMainMWS();
    initKlineMWS();
    if (!symbolNames[currentSymbol]) currentSymbol = btcConfig.defaultSymbol || 'BTCUSDT';

    // Update branding for current symbol
    var sym = currentSymbol.replace('USDT', '');
    var name = symbolNames[currentSymbol] || sym;
    App.el.logo.textContent = symbolLogos[currentSymbol] || sym[0];
    App.el.brandName.innerHTML = '<span>' + App.escapeHTML(name) + '</span> Ticker';
    pairTag.innerHTML = '<span class="dot"></span>' + App.escapeHTML(sym) + ' / USDT · Binance';

    document.querySelectorAll('.chart-tab').forEach(function(t) {
        var isActive = t.dataset.tf === activeTF;
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('.chart-type-btn').forEach(function(b) {
        var isActive = b.dataset.type === chartMode;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('.ind-btn').forEach(function(b) {
        var ind = b.dataset.ind;
        var isActive = !!indicators[ind];
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    chartWrap.classList.toggle('with-rsi', !!indicators.rsi);
    renderAlertInputs();
    renderAlertHistory();

    // Loading placeholders
    App.setLive(true, 'Connecting\u2026');
    sHigh.textContent = '--'; sLow.textContent = '--';
    sTrades.textContent = '--'; sTps.textContent = '--';
    sSpread.textContent = '--'; sDom.textContent = '--';
    fgiText.textContent = '--';
    perf7d.textContent = '--'; perf30d.textContent = '--'; perfYtd.textContent = '--';

    // Restore cached data for instant display
    var cached = getPref('btcCache', null);
    if (cached && cached.symbol === currentSymbol && cached.price && Date.now() - (cached.ts || 0) < 3600000) {
        updateDigits(cached.price);
        pDec.textContent = '.' + cached.price.toFixed(2).split('.')[1];
        if (cached.high24) sHigh.textContent = '$' + App.fmtI(cached.high24);
        if (cached.low24) sLow.textContent = '$' + App.fmtI(cached.low24);
    }

    // Fetch initial data
    fetchKlines(activeTF);

    // Connect websockets
    mainMWS.connect();
    klineMWS.connect();

    // Fetch API data
    fetchFGI();
    fetchDominance();
    fetchPerformance();
    fetchHeatmap();

    // Start intervals
    // WS health check
    intervals.push(setInterval(function() {
        var now = Date.now();
        if (now - lastWSMessage > 30000) {
            console.warn('WebSocket appears stale, reconnecting...');
            App.setLive(false, 'Reconnecting');
            mainMWS.reconnect();
            klineMWS.reconnect();
        }
    }, refreshConfig.wsHealthMs || 15000));

    // Live badge update
    intervals.push(setInterval(function() {
        if (Date.now() - lastWSMessage < 5000) {
            if (App.el.liveBadge.classList.contains('off')) {
                App.setLive(true, 'Live');
            }
        }
    }, refreshConfig.liveBadgeMs || 2000));

    // Decay buy/sell pressure & CVD
    intervals.push(setInterval(function() { buyVol *= 0.95; sellVol *= 0.95; cvd *= 0.98; }, refreshConfig.pressureDecayMs || 5000));

    // API refresh intervals
    intervals.push(setInterval(function() { if (!document.hidden) fetchFGI(); }, refreshConfig.fgiMs || 300000));
    intervals.push(setInterval(function() { if (!document.hidden) fetchDominance(); }, refreshConfig.dominanceMs || 300000));
    intervals.push(setInterval(function() { if (!document.hidden) fetchPerformance(); }, refreshConfig.performanceMs || 300000));
    intervals.push(setInterval(function() { if (!document.hidden) fetchHeatmap(); }, refreshConfig.heatmapMs || 30000));

    // Canvas memory cleanup (every 6 hours)
    intervals.push(setInterval(function() {
        var oldCanvas = canvas;
        var newCanvas = document.createElement('canvas');
        newCanvas.id = 'chart';
        oldCanvas.parentNode.replaceChild(newCanvas, oldCanvas);
        canvas = newCanvas;
        ctx = canvas.getContext('2d');
        scheduleRedraw();
        console.log('Canvas context refreshed');
    }, refreshConfig.canvasRefreshMs || 21600000));

    // Initial chart draw
    scheduleRedraw();

    // Reconnect on network recovery
    onOnlineCb = function() {
        if (!active) return;
        mainMWS.reconnect();
        klineMWS.reconnect();
        fetchKlines(activeTF);
        fetchFGI();
        fetchDominance();
        fetchPerformance();
        fetchHeatmap();
    };
    App.onOnline(onOnlineCb);

    // Set live badge
    App.setLive(false, 'Connecting');
}


function destroy() {
    active = false;

    // Abort in-flight fetches
    if (fetchController) { fetchController.abort(); fetchController = null; }

    // Close websockets
    if (mainMWS) mainMWS.disconnect();
    if (klineMWS) klineMWS.disconnect();

    // Clear intervals
    intervals.forEach(clearInterval);
    intervals = [];

    // Remove document-level listeners
    document.removeEventListener('mousemove', onDocMouseMove);
    document.removeEventListener('mouseup', onDocMouseUp);
    document.removeEventListener('fullscreenchange', onDocFullscreenChange);
    document.removeEventListener('visibilitychange', onDocVisibilityChange);

    // Unsubscribe online recovery callback
    if (onOnlineCb) { App.offOnline(onOnlineCb); onOnlineCb = null; }

    // Update live badge
    App.setLive(false, 'Offline');
}

// === REGISTER ===
App.registerDashboard('btc', {
    name: 'Crypto Dashboard',
    icon: '₿',
    brandHTML: '<span>Bitcoin</span> Ticker',
    brandSub: 'Real-Time Market Data',
    orbColors: ['rgba(245,200,66,0.12)', 'rgba(247,147,26,0.08)'],
    logoGradient: 'linear-gradient(135deg,#f7931a,#f5c842)',
    containerId: 'btcDash',
    init: init,
    destroy: destroy,
    syncConfig: syncBtcConfig
});

})();
