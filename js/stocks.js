(function() {
var $ = App.$;

var active = false;
var intervals = [];
var stocksConfig = {};
var refreshConfig = {};
var apiBase = '/api/stocks';
var currentTicker = (typeof App.getSetting === 'function') ? (App.getSetting('stocksTicker', 'AAPL') || 'AAPL') : 'AAPL';
var chartMode = (typeof App.getSetting === 'function') ? (App.getSetting('stocksChartMode', 'candle') || 'candle') : 'candle';
var activeTF = (typeof App.getSetting === 'function') ? (App.getSetting('stocksTf', '1m') || '1m') : '1m';
var barsByTf = {};
var MAX_BARS = 500;
var visibleBars = 120;
var scrollOffset = 0;
var isDragging = false;
var dragStartX = 0;
var dragStartOffset = 0;
var needsRedraw = false;

var pairTag = $('stocksPairTag');
var apiChip = $('stocksApiChip');
var marketStatus = $('stocksMarketStatus');
var priceEl = $('stocksPrice');
var changePill = $('stocksChangePill');
var changeIcon = $('stocksChangeIcon');
var changePct = $('stocksChangePct');
var changeAbs = $('stocksChangeAbs');
var highEl = $('stocksHigh');
var lowEl = $('stocksLow');
var openEl = $('stocksOpen');
var prevCloseEl = $('stocksPrevClose');
var volumeEl = $('stocksVolume');
var heatmapEl = $('stocksHeatmap');
var chartWrap = $('stocksChartWrap');
var canvas = $('stocksChart');
var ctx = canvas.getContext('2d');
var overlay = $('stocksOverlay');
var crossV = $('stocksCrossV');
var crossH = $('stocksCrossH');
var tip = $('stocksTip');
var fullscreenBtn = $('stocksFullscreenBtn');

var tfMap = {
    '1m': { mult: 1, span: 'minute' },
    '5m': { mult: 5, span: 'minute' },
    '15m': { mult: 15, span: 'minute' },
    '1h': { mult: 1, span: 'hour' },
    '4h': { mult: 4, span: 'hour' },
    '1d': { mult: 1, span: 'day' }
};

function setPref(key, value) {
    if (typeof App.setSetting === 'function') App.setSetting(key, value);
}

function syncStocksConfig() {
    stocksConfig = (window.BTCT_CONFIG && window.BTCT_CONFIG.stocks) || {};
    refreshConfig = stocksConfig.refresh || {};
    apiBase = stocksConfig.apiBase || '/api/stocks';
    if (!currentTicker) currentTicker = stocksConfig.defaultTicker || 'AAPL';
}

function fmtPrice(n) {
    var v = parseFloat(n);
    if (!isFinite(v)) return '--';
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtVol(n) {
    var v = parseFloat(n);
    if (!isFinite(v)) return '--';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
}

function pathWithQuery(path, params) {
    var allowClientKey = !!(stocksConfig && stocksConfig.allowClientApiKey === true);
    var cfgKey = allowClientKey ? String((stocksConfig && stocksConfig.apiKey) || '').trim() : '';
    if (cfgKey) params = Object.assign({}, params || {}, { apiKey: cfgKey });
    var q = [];
    Object.keys(params || {}).forEach(function(k) {
        if (params[k] === undefined || params[k] === null || params[k] === '') return;
        q.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    });
    return apiBase + path + (q.length ? ('?' + q.join('&')) : '');
}

function fetchJson(path, params) {
    return fetch(pathWithQuery(path, params), { cache: 'no-store' }).then(function(r) { return r.json(); });
}

function currentHeatmapTickers() {
    var list = Array.isArray(stocksConfig.heatmapTickers) ? stocksConfig.heatmapTickers : [];
    if (!list.length) list = ['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','AMD','NFLX','PLTR'];
    return list.slice(0, 10).map(function(t) { return String(t || '').trim().toUpperCase(); }).filter(Boolean);
}

function updateTopTag() {
    pairTag.innerHTML = '<span class="dot"></span>' + currentTicker + ' · US Equity';
}

function setApiChip(state, text) {
    if (!apiChip) return;
    apiChip.classList.remove('ok', 'missing', 'warn');
    apiChip.classList.add(state || 'missing');
    apiChip.textContent = text || 'API Key Missing';
}

function fetchMarketStatus() {
    if (document.hidden) return;
    fetchJson('/marketstatus', {})
    .then(function(d) {
        if (d && d.ok === false) {
            if (d.error === 'stocks_api_key_missing') setApiChip('missing', 'API Key Missing');
            else if (d.error === 'stocks_rate_limited') setApiChip('warn', 'Rate Limited');
            else setApiChip('warn', 'API Issue');
            return;
        }
        setApiChip('ok', 'API Key Detected');
        var open = !!(d && d.market === 'open');
        marketStatus.textContent = open ? 'Market Open' : 'Market Closed';
        marketStatus.classList.toggle('open', open);
        marketStatus.classList.toggle('closed', !open);
    }).catch(function() {
        setApiChip('warn', 'API Offline');
    });
}

function fetchSnapshot() {
    if (document.hidden) return;
    fetchJson('/snapshot', { ticker: currentTicker })
    .then(function(d) {
        if (!d || d.ok === false) {
            if (d && d.error === 'stocks_api_key_missing') setApiChip('missing', 'API Key Missing');
            else if (d && d.error === 'stocks_rate_limited') setApiChip('warn', 'Rate Limited');
            else setApiChip('warn', 'Invalid Key');
            throw new Error('snapshot failed');
        }
        setApiChip('ok', 'API Key Detected');
        var snap = d.snapshot || d;
        var day = snap.day || {};
        var prev = snap.prevDay || {};
        var last = parseFloat(day.c);
        var prevClose = parseFloat(prev.c);
        var diff = isFinite(last) && isFinite(prevClose) ? (last - prevClose) : NaN;
        var pct = isFinite(diff) && isFinite(prevClose) && prevClose !== 0 ? (diff / prevClose * 100) : NaN;
        priceEl.textContent = fmtPrice(last);
        highEl.textContent = '$' + fmtPrice(day.h);
        lowEl.textContent = '$' + fmtPrice(day.l);
        openEl.textContent = '$' + fmtPrice(day.o);
        prevCloseEl.textContent = '$' + fmtPrice(prevClose);
        volumeEl.textContent = fmtVol(day.v);
        var pos = isFinite(diff) ? diff >= 0 : true;
        changePill.className = 'stocks-change-pill ' + (pos ? 'pos' : 'neg');
        changeIcon.textContent = pos ? '▲' : '▼';
        changePct.textContent = (isFinite(pct) ? (pos ? '+' : '') + pct.toFixed(2) + '%' : '--');
        changeAbs.textContent = isFinite(diff) ? ((pos ? '+' : '') + '$' + fmtPrice(diff)) : '$--';
        App.setLive(true, 'Stocks');
    }).catch(function() {
        App.setLive(false, 'Stocks Offline');
    });
}

function fetchBars(tf) {
    if (document.hidden) return Promise.resolve();
    var spec = tfMap[tf] || tfMap['1m'];
    return fetchJson('/aggs', {
        ticker: currentTicker,
        mult: spec.mult,
        span: spec.span,
        limit: MAX_BARS
    }).then(function(d) {
        var out = (d && Array.isArray(d.results)) ? d.results : [];
        barsByTf[tf] = out.map(function(b) {
            return {
                time: b.t,
                open: parseFloat(b.o),
                high: parseFloat(b.h),
                low: parseFloat(b.l),
                close: parseFloat(b.c),
                volume: parseFloat(b.v)
            };
        }).filter(function(b) {
            return isFinite(b.open) && isFinite(b.high) && isFinite(b.low) && isFinite(b.close);
        });
        visibleBars = Math.min(120, barsByTf[tf].length || 120);
        scrollOffset = 0;
        scheduleRedraw();
    }).catch(function() {});
}

function fetchHeatmap() {
    if (document.hidden) return;
    var tickers = currentHeatmapTickers();
    fetchJson('/heatmap', { tickers: tickers.join(',') })
    .then(function(d) {
        var list = (d && Array.isArray(d.items)) ? d.items : [];
        var html = '';
        list.forEach(function(it) {
            var pct = parseFloat(it.changePct);
            var pos = isFinite(pct) ? pct >= 0 : true;
            var intensity = Math.min(Math.abs(pct || 0) / 8, 1);
            var bg = pos ? 'rgba(0,230,118,' + (0.2 + intensity * 0.6) + ')' : 'rgba(255,23,68,' + (0.2 + intensity * 0.6) + ')';
            var activeCls = it.ticker === currentTicker ? ' active' : '';
            html += '<div class="stocks-hm-item' + activeCls + '" data-ticker="' + it.ticker + '" style="background:' + bg + '">';
            html += '<div class="stocks-hm-symbol">' + it.ticker + '</div>';
            html += '<div class="stocks-hm-change">' + (pos ? '+' : '') + (isFinite(pct) ? pct.toFixed(2) : '--') + '%</div>';
            html += '</div>';
        });
        heatmapEl.innerHTML = html;
        heatmapEl.querySelectorAll('.stocks-hm-item').forEach(function(node) {
            node.addEventListener('click', function() {
                switchTicker(node.getAttribute('data-ticker'));
            });
        });
    }).catch(function() {});
}

function switchTicker(next) {
    next = String(next || '').trim().toUpperCase();
    if (!next || next === currentTicker) return;
    currentTicker = next;
    setPref('stocksTicker', currentTicker);
    barsByTf = {};
    updateTopTag();
    fetchSnapshot();
    fetchBars(activeTF);
    fetchHeatmap();
}

function getVisibleBars() {
    var bars = barsByTf[activeTF] || [];
    if (!bars.length) return [];
    var end = bars.length - scrollOffset;
    var start = Math.max(0, end - visibleBars);
    return bars.slice(start, end);
}

function drawChart() {
    var data = getVisibleBars();
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.parentElement.getBoundingClientRect();
    var cw = Math.round(rect.width * dpr);
    var ch = Math.round(rect.height * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (data.length < 2) return;

    var w = rect.width;
    var h = rect.height;
    var volH = 30;
    var pad = 4;
    var mainH = h - volH - 8;
    var minP = Infinity, maxP = -Infinity, maxVol = 0;
    data.forEach(function(c) {
        if (c.low < minP) minP = c.low;
        if (c.high > maxP) maxP = c.high;
        if (c.volume > maxVol) maxVol = c.volume;
    });
    var range = maxP - minP || 1;
    minP -= range * 0.05;
    maxP += range * 0.05;
    range = maxP - minP;
    function p2y(p) { return pad + (mainH - pad * 2) * (1 - (p - minP) / range); }

    var step = (w - pad * 2) / data.length;
    var bodyW = Math.max(1, step - 1);

    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 0.5;
    for (var g = 0; g < 5; g++) {
        var yy = pad + (mainH - pad * 2) * (g / 4);
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(w, yy);
        ctx.stroke();
    }

    if (chartMode === 'candle') {
        data.forEach(function(c, i) {
            var x = pad + i * step + step / 2;
            var up = c.close >= c.open;
            var color = up ? '#00e676' : '#ff1744';
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, p2y(c.high));
            ctx.lineTo(x, p2y(c.low));
            ctx.stroke();
            var top = p2y(Math.max(c.open, c.close));
            var bot = p2y(Math.min(c.open, c.close));
            var hh = Math.max(1, bot - top);
            ctx.fillStyle = color;
            ctx.fillRect(x - bodyW / 2, top, bodyW, hh);
        });
    } else {
        var rising = data[data.length - 1].close >= data[0].close;
        var clr = rising ? '0,230,118' : '255,23,68';
        ctx.beginPath();
        data.forEach(function(c, i) {
            var x = pad + i * step + step / 2;
            var y = p2y(c.close);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = 'rgba(' + clr + ',0.85)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    var volTop = mainH + 4;
    data.forEach(function(c, i) {
        var x = pad + i * step + step / 2;
        var up = c.close >= c.open;
        var vh = maxVol ? (c.volume / maxVol) * volH * 0.9 : 0;
        ctx.fillStyle = up ? 'rgba(0,230,118,0.28)' : 'rgba(255,23,68,0.28)';
        ctx.fillRect(x - bodyW / 2, volTop + volH - vh, bodyW, vh);
    });
}

function scheduleRedraw() {
    if (needsRedraw) return;
    needsRedraw = true;
    requestAnimationFrame(function() {
        needsRedraw = false;
        drawChart();
    });
}

function bindChartUi() {
    overlay.addEventListener('mousemove', function(e) {
        var rect = overlay.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        crossV.style.left = x + 'px';
        crossH.style.top = y + 'px';
        crossV.style.opacity = '1';
        crossH.style.opacity = '1';
        var data = getVisibleBars();
        if (!data.length) return;
        var step = (rect.width - 8) / data.length;
        var idx = Math.floor((x - 4) / step);
        if (idx >= 0 && idx < data.length) {
            var c = data[idx];
            tip.innerHTML = 'O: $' + fmtPrice(c.open) + ' · H: $' + fmtPrice(c.high) + ' · L: $' + fmtPrice(c.low) + ' · C: $' + fmtPrice(c.close) + ' · V: ' + fmtVol(c.volume);
            tip.style.left = Math.min(x + 10, rect.width - 220) + 'px';
            tip.style.top = Math.max(y - 30, 0) + 'px';
            tip.style.opacity = '1';
        }
    });
    overlay.addEventListener('mouseleave', function() {
        crossV.style.opacity = '0';
        crossH.style.opacity = '0';
        tip.style.opacity = '0';
    });
    overlay.addEventListener('wheel', function(e) {
        e.preventDefault();
        var delta = e.deltaY > 0 ? 10 : -10;
        var bars = barsByTf[activeTF] || [];
        visibleBars = Math.max(20, Math.min(bars.length || 20, visibleBars + delta));
        var maxOffset = Math.max(0, bars.length - visibleBars);
        scrollOffset = Math.min(scrollOffset, maxOffset);
        scheduleRedraw();
    }, { passive: false });
    overlay.addEventListener('mousedown', function(e) {
        isDragging = true;
        dragStartX = e.clientX;
        dragStartOffset = scrollOffset;
    });
    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        var rect = overlay.getBoundingClientRect();
        var step = (rect.width - 8) / Math.max(1, visibleBars);
        var moved = Math.round((e.clientX - dragStartX) / step);
        var bars = barsByTf[activeTF] || [];
        var maxOffset = Math.max(0, bars.length - visibleBars);
        scrollOffset = Math.max(0, Math.min(maxOffset, dragStartOffset + moved));
        scheduleRedraw();
    });
    document.addEventListener('mouseup', function() {
        isDragging = false;
    });
    document.querySelectorAll('.stocks-chart-type-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.stocks-chart-type-btn').forEach(function(n) { n.classList.remove('active'); });
            btn.classList.add('active');
            chartMode = btn.getAttribute('data-type');
            setPref('stocksChartMode', chartMode);
            scheduleRedraw();
        });
    });
    document.querySelectorAll('.stocks-chart-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.stocks-chart-tab').forEach(function(n) { n.classList.remove('active'); });
            tab.classList.add('active');
            var tf = tab.getAttribute('data-tf');
            if (tf === activeTF) return;
            activeTF = tf;
            setPref('stocksTf', activeTF);
            if (!barsByTf[activeTF] || !barsByTf[activeTF].length) fetchBars(activeTF);
            scheduleRedraw();
        });
    });
    if (fullscreenBtn) fullscreenBtn.addEventListener('click', App.toggleFullscreen);
}

function init() {
    active = true;
    syncStocksConfig();
    setApiChip((stocksConfig && stocksConfig.apiKey) ? 'warn' : 'missing', (stocksConfig && stocksConfig.apiKey) ? 'Checking API...' : 'API Key Missing');
    if (!currentTicker) currentTicker = stocksConfig.defaultTicker || 'AAPL';
    updateTopTag();
    document.querySelectorAll('.stocks-chart-tab').forEach(function(n) { n.classList.toggle('active', n.getAttribute('data-tf') === activeTF); });
    document.querySelectorAll('.stocks-chart-type-btn').forEach(function(n) { n.classList.toggle('active', n.getAttribute('data-type') === chartMode); });
    fetchMarketStatus();
    fetchSnapshot();
    fetchBars(activeTF);
    fetchHeatmap();
    intervals.push(setInterval(function() { if (!document.hidden) fetchSnapshot(); }, refreshConfig.snapshotMs || 10000));
    intervals.push(setInterval(function() { if (!document.hidden) fetchMarketStatus(); }, refreshConfig.marketStatusMs || 30000));
    intervals.push(setInterval(function() { if (!document.hidden) fetchHeatmap(); }, refreshConfig.heatmapMs || 30000));
    intervals.push(setInterval(function() { if (!document.hidden) fetchBars(activeTF); }, refreshConfig.barsMs || 20000));
    scheduleRedraw();
}

function destroy() {
    active = false;
    intervals.forEach(clearInterval);
    intervals = [];
}

window.addEventListener('btct:config-updated', function() {
    syncStocksConfig();
});
document.addEventListener('visibilitychange', function() {
    if (!active || document.hidden) return;
    fetchMarketStatus();
    fetchSnapshot();
    fetchBars(activeTF);
    fetchHeatmap();
    scheduleRedraw();
});

bindChartUi();

App.registerDashboard('stocks', {
    name: 'Stocks Dashboard',
    icon: '$',
    brandHTML: '<span>Stocks</span> Tracker',
    brandSub: 'US Equities',
    orbColors: ['rgba(56,189,248,0.12)', 'rgba(16,185,129,0.08)'],
    logoGradient: 'linear-gradient(135deg,#38bdf8,#10b981)',
    containerId: 'stocksDash',
    init: init,
    destroy: destroy
});

})();
