(function() {
var $ = App.$;

// === STATE ===
var active = false;
var intervals = [];
var defaultPcEndpoint = 'http://192.168.0.118:8085/data.json';
var pcConfig = {};
var pcEndpoint = defaultPcEndpoint;
var pcPollMs = 2000;
var pcDebug = false;
var lastSensorWarnAt = 0;

// === ELEMENT REFS ===
var pcCpuTemp = $('pcCpuTemp'), pcGpuTemp = $('pcGpuTemp'), pcGpuHotspot = $('pcGpuHotspot');
var pcLoads = $('pcLoads'), pcMode = $('pcMode'), pcStatus = $('pcStatus');
var pcCpuMarker = $('pcCpuMarker'), pcGpuMarker = $('pcGpuMarker');

// === HELPERS ===
function syncPcConfig() {
    pcConfig = (window.BTCT_CONFIG && window.BTCT_CONFIG.pc) || {};
    pcEndpoint = pcConfig.endpoint || defaultPcEndpoint;
    pcPollMs = pcConfig.pollMs || 2000;
    pcDebug = !!pcConfig.debug;
}

function findSensor(node, typeName, sensorName) {
    if (node.Text === sensorName && node.Type && node.Type === typeName) return node;
    if (node.Children) {
        for (var i = 0; i < node.Children.length; i++) {
            var r = findSensor(node.Children[i], typeName, sensorName);
            if (r) return r;
        }
    }
    return null;
}

function collectSensors(node, out) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.Type === 'string' && typeof node.Text === 'string') {
        out.push(node.Type + ':' + node.Text);
    }
    if (Array.isArray(node.Children)) {
        for (var i = 0; i < node.Children.length; i++) collectSensors(node.Children[i], out);
    }
}

function parseSensorNumber(value) {
    var raw = String(value == null ? '' : value).trim().replace(',', '.');
    if (!raw) return null;
    var match = raw.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    var num = parseFloat(match[0]);
    return isNaN(num) ? null : num;
}

function applyTempText(node, temp) {
    if (!node) return;
    var isNum = typeof temp === 'number' && !isNaN(temp);
    node.textContent = (isNum ? temp : '--') + '°';
    node.classList.toggle('triple', isNum && Math.abs(temp) >= 100);
}

// Keep in sync with .pc-vert-scale gradient in pc.css
function pcTempColor(t) {
    if (typeof t !== 'number') return 'gray';
    if (t <= 30) return 'dodgerblue';
    if (t <= 45) return 'cyan';
    if (t <= 55) return 'yellow';
    if (t <= 65) return 'orange';
    if (t <= 75) return 'darkorange';
    if (t <= 82) return 'orangered';
    return 'red';
}

function updateTempScale(markerEl, temp) {
    if (!markerEl) return;
    if (typeof temp !== 'number' || isNaN(temp)) {
        markerEl.style.bottom = '0%';
        markerEl.setAttribute('data-temp', '--°');
        return;
    }
    var minTemp = 20, maxTemp = 100;
    var pct = ((temp - minTemp) / (maxTemp - minTemp)) * 100;
    pct = Math.max(0, Math.min(100, pct));
    markerEl.style.bottom = pct + '%';
    markerEl.setAttribute('data-temp', temp + '°');
}

function parsePCData(data) {
    var root = data;
    var cpuTempNode = findSensor(root, 'Temperature', 'CPU Package') || findSensor(root, 'Temperature', 'Core (Tctl/Tdie)') || findSensor(root, 'Temperature', 'Core Average');
    var gpuTempNode = findSensor(root, 'Temperature', 'GPU Core');
    var gpuHotNode = findSensor(root, 'Temperature', 'GPU Hot Spot');
    var cpuLoadNode = findSensor(root, 'Load', 'CPU Total');
    var gpuLoadNode = findSensor(root, 'Load', 'GPU Core');

    var cpuTParsed = cpuTempNode ? parseSensorNumber(cpuTempNode.Value) : null;
    var gpuTParsed = gpuTempNode ? parseSensorNumber(gpuTempNode.Value) : null;
    var cpuT = (cpuTParsed === null) ? '--' : Math.round(cpuTParsed);
    var gpuT = (gpuTParsed === null) ? '--' : Math.round(gpuTParsed);
    if (typeof cpuT === 'number' && isNaN(cpuT)) cpuT = '--';
    if (typeof gpuT === 'number' && isNaN(gpuT)) gpuT = '--';
    var gpuHotParsed = gpuHotNode ? parseSensorNumber(gpuHotNode.Value) : null;
    var cpuLParsed = cpuLoadNode ? parseSensorNumber(cpuLoadNode.Value) : null;
    var gpuLParsed = gpuLoadNode ? parseSensorNumber(gpuLoadNode.Value) : null;
    var gpuHot = (gpuHotParsed === null) ? null : Math.round(gpuHotParsed);
    var cpuL = (cpuLParsed === null) ? '--' : Math.round(cpuLParsed);
    var gpuL = (gpuLParsed === null) ? '--' : Math.round(gpuLParsed);

    applyTempText(pcCpuTemp, cpuT);
    applyTempText(pcGpuTemp, gpuT);
    var cpuColor = pcTempColor(cpuT), gpuColor = pcTempColor(gpuT);
    pcCpuTemp.style.color = cpuColor;
    pcGpuTemp.style.color = gpuColor;
    pcCpuTemp.style.textShadow = '0 0 20px ' + cpuColor + ', 0 0 50px ' + cpuColor;
    pcGpuTemp.style.textShadow = '0 0 20px ' + gpuColor + ', 0 0 50px ' + gpuColor;
    if (gpuHot !== null) {
        pcGpuHotspot.innerHTML = '<span style="color:#f5e6a3">Hotspot </span><span style="color:' + pcTempColor(gpuHot) + '">' + gpuHot + '°</span>';
    } else {
        pcGpuHotspot.textContent = '';
    }
    pcLoads.innerHTML = '<span style="color:#f5e6a3">CPU </span><span style="color:' + pcTempColor(cpuL) + '">' + cpuL + '%</span>  ·  <span style="color:#f5e6a3">GPU </span><span style="color:' + pcTempColor(gpuL) + '">' + gpuL + '%</span>';

    var gaming = (typeof gpuT === 'number' && gpuT >= 60) || (typeof cpuT === 'number' && cpuT >= 70);
    pcMode.textContent = gaming ? 'GAMING' : 'IDLE';
    pcMode.className = 'pc-mode-pill ' + (gaming ? 'gaming' : 'idle');

    var sensorMismatch = (cpuT === '--' && gpuT === '--');
    if (sensorMismatch) {
        pcStatus.textContent = 'PC ONLINE (CHECK SENSOR NAMES)';
        pcStatus.className = 'pc-status warn';
        if (pcDebug && Date.now() - lastSensorWarnAt > 60000) {
            var sensors = [];
            collectSensors(root, sensors);
            console.warn('[PC] Sensor mismatch. Expected CPU/GPU labels not found. Sample:', sensors.slice(0, 25));
            lastSensorWarnAt = Date.now();
        }
    } else {
        pcStatus.textContent = 'PC ONLINE';
        pcStatus.className = 'pc-status online';
    }
    updateTempScale(pcCpuMarker, cpuT);
    updateTempScale(pcGpuMarker, gpuT);
    App.setSourceStatus('pc', true);
    App.touchSection('pc');
    if (active) App.setTitle('\ud83d\udda5 CPU ' + cpuT + '\u00b0 GPU ' + gpuT + '\u00b0');

    // Cache PC data for instant display on next load
    App.setSetting('pcCache', {cpuT: cpuT, gpuT: gpuT, cpuL: cpuL, gpuL: gpuL, ts: Date.now()});
}

function fetchPCData() {
    if (document.hidden) return Promise.resolve();
    return fetch(pcEndpoint, {cache:'no-store'})
    .then(function(r) { return r.json(); })
    .then(function(d) { parsePCData(d); })
    .catch(function() {
        pcStatus.textContent = 'PC OFFLINE';
        pcStatus.className = 'pc-status offline';
        updateTempScale(pcCpuMarker, null);
        updateTempScale(pcGpuMarker, null);
        App.setSourceStatus('pc', false);
    });
}

// === INIT / DESTROY ===
var pollTimer = null;
function schedulePoll() {
    if (!active) return;
    pollTimer = setTimeout(function() {
        pollTimer = null;
        fetchPCData().then(schedulePoll).catch(schedulePoll);
    }, pcPollMs);
}

function init() {
    active = true;
    syncPcConfig();

    // Restore cached PC data for instant display (< 5 min old)
    var cached = App.getSetting('pcCache', null);
    if (cached && cached.ts && Date.now() - cached.ts < 300000) {
        applyTempText(pcCpuTemp, cached.cpuT);
        applyTempText(pcGpuTemp, cached.gpuT);
        if (typeof cached.cpuT === 'number') {
            var cc = pcTempColor(cached.cpuT);
            pcCpuTemp.style.color = cc;
            pcCpuTemp.style.textShadow = '0 0 20px ' + cc + ', 0 0 50px ' + cc;
            updateTempScale(pcCpuMarker, cached.cpuT);
        }
        if (typeof cached.gpuT === 'number') {
            var gc = pcTempColor(cached.gpuT);
            pcGpuTemp.style.color = gc;
            pcGpuTemp.style.textShadow = '0 0 20px ' + gc + ', 0 0 50px ' + gc;
            updateTempScale(pcGpuMarker, cached.gpuT);
        }
        pcStatus.textContent = 'PC CONNECTING\u2026';
        pcStatus.className = 'pc-status';
    }

    fetchPCData().then(schedulePoll).catch(schedulePoll);

    document.addEventListener('visibilitychange', onDocVisibilityChange);
    App.setLive(true, 'Polling');
}

var onDocVisibilityChange = function() {
    if (!active || document.hidden) return;
    fetchPCData();
};

function destroy() {
    active = false;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    intervals.forEach(clearInterval);
    intervals = [];
    document.removeEventListener('visibilitychange', onDocVisibilityChange);
}

// === REGISTER ===
App.registerDashboard('pc', {
    name: 'PC Monitor',
    icon: '🖥',
    brandHTML: '<span>PC</span> Monitor',
    brandSub: 'Gaming Rig',
    orbColors: ['rgba(16,185,129,0.12)', 'rgba(6,182,212,0.08)'],
    logoGradient: 'linear-gradient(135deg,#10b981,#06b6d4)',
    containerId: 'pcDash',
    init: init,
    destroy: destroy,
    syncConfig: syncPcConfig
});

})();
