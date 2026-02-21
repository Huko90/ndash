const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, shell, clipboard, Tray, Menu, nativeImage, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { ConfigStore, deepMerge } = require('./config-store');
const { LocalServer } = require('./local-server');
const updater = require('./updater');
const winTrust = require('./win-trust');
const baseRuntimeConfig = require('../js/config-base.js');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let configStore = null;
let localServer = null;
let serverState = null;

function projectRoot() {
  return path.resolve(__dirname, '..');
}

function runtimeConfigFromDesktopConfig(cfg) {
  const runtimeConfigKey = 'btct_runtime_config_v1';
  const base = JSON.parse(JSON.stringify(baseRuntimeConfig || {}));
  if (!base.app) base.app = {};
  base.app.storageKey = base.app.storageKey || 'btct_settings_v1';
  base.app.runtimeConfigKey = runtimeConfigKey;

  const overrides = {
    weather: {
      name: cfg.weather.name,
      lat: Number(cfg.weather.lat),
      lon: Number(cfg.weather.lon),
      refreshMs: Number(cfg.weather.refreshMs)
    },
    btc: {
      defaultSymbol: cfg.btc.defaultSymbol,
      alerts: {
        audio: !!cfg.btc.alerts.audio,
        volume: Number(cfg.btc.alerts.volume)
      }
    },
    pc: {
      // Always fetch PC telemetry through local server proxy to avoid mixed-content/CORS issues.
      endpoint: '/api/pc',
      pollMs: Number(cfg.pc.pollMs)
    }
  };
  const wp = cfg.wallpapers || {};
  if (wp.btc || wp.weather || wp.pc) {
    if (!overrides.theme) overrides.theme = {};
    if (wp.btc) overrides.theme.btcWallpaper = '/wallpapers/' + wp.btc;
    if (wp.weather) overrides.theme.weatherWallpaper = '/wallpapers/' + wp.weather;
    if (wp.pc) overrides.theme.pcWallpaper = '/wallpapers/' + wp.pc;
  }
  return deepMerge(base, overrides);
}

async function startLocalServer() {
  const cfg = configStore.get();
  if (!localServer) {
    localServer = new LocalServer({
      rootDir: projectRoot(),
      userDataPath: app.getPath('userData'),
      getRuntimeConfig: () => runtimeConfigFromDesktopConfig(configStore.get()),
      getDesktopConfig: () => configStore.get()
    });
  }
  serverState = await localServer.start(cfg);
}

function shouldShowWizard() {
  if (process.env.BTCT_FORCE_WIZARD === '1') return true;
  return !configStore.get().wizardCompleted;
}

function normalizePort(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function validateNetworkConfig(network) {
  const httpPort = normalizePort(network && network.httpPort, 8888);
  const httpsPort = normalizePort(network && network.httpsPort, 8443);
  const valid = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;

  if (!valid(httpPort)) throw new Error(`Invalid HTTP port: ${network && network.httpPort}`);
  if (!valid(httpsPort)) throw new Error(`Invalid HTTPS port: ${network && network.httpsPort}`);
  if (httpPort === httpsPort) throw new Error('HTTP and HTTPS ports must be different.');
}

function currentDashboardUrl() {
  const cfg = configStore.get();
  return cfg.network.preferHttps ? serverState.httpsUrl : serverState.httpUrl;
}

function tinyIcon() {
  // Build a fully opaque 16x16 RGBA icon so Windows tray never renders it as transparent.
  const size = 16;
  const raw = Buffer.alloc(size * size * 4);
  const setPx = (x, y, r, g, b, a = 255) => {
    const i = (y * size + x) * 4;
    raw[i] = r;
    raw[i + 1] = g;
    raw[i + 2] = b;
    raw[i + 3] = a;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      setPx(x, y, 17, 20, 24, 255); // dark base
    }
  }
  for (let i = 0; i < size; i++) {
    setPx(i, 0, 245, 200, 66);
    setPx(i, size - 1, 245, 200, 66);
    setPx(0, i, 245, 200, 66);
    setPx(size - 1, i, 245, 200, 66);
  }
  // Simple bright "B" glyph block for visibility at tiny sizes.
  for (let y = 3; y <= 12; y++) setPx(6, y, 245, 200, 66);
  for (let x = 6; x <= 10; x++) setPx(x, 3, 245, 200, 66);
  for (let x = 6; x <= 10; x++) setPx(x, 7, 245, 200, 66);
  for (let x = 6; x <= 10; x++) setPx(x, 12, 245, 200, 66);
  for (let y = 4; y <= 6; y++) setPx(10, y, 245, 200, 66);
  for (let y = 8; y <= 11; y++) setPx(10, y, 245, 200, 66);

  return nativeImage.createFromBitmap(raw, { width: size, height: size, scaleFactor: 1 });
}

function trayIcon() {
  const trayPath = path.join(__dirname, 'tray-icon.png');
  const img = nativeImage.createFromPath(trayPath);
  if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
  return tinyIcon();
}

function createTray() {
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.setToolTip('nDash');
  tray.on('double-click', () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
  });
  updateTrayMenu();
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

function updateTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => {
        if (!mainWindow) return;
        mainWindow.loadURL(currentDashboardUrl());
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: 'Open Setup Wizard',
      click: async () => {
        if (!mainWindow) return;
        await mainWindow.loadFile(path.join(__dirname, 'wizard.html'));
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: 'Check for Updates',
      click: () => {
        updater.runUpdateCheck(true);
      }
    },
    {
      label: 'Install Downloaded Update Now',
      enabled: !!updater.getUpdateReadyInfo(),
      click: () => {
        if (!updater.getUpdateReadyInfo()) return;
        isQuitting = true;
        autoUpdater.quitAndInstall();
      }
    },
    {
      label: 'Open Update Log',
      click: () => {
        shell.showItemInFolder(updater.updateLogPath());
      }
    },
    {
      label: updater.getState().status,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
}

function applyRunModeSideEffects() {
  const mode = configStore.get().runtimeMode;
  if (mode === 'background') {
    createTray();
  } else {
    destroyTray();
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: 'nDash',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.on('close', (event) => {
    const mode = configStore ? configStore.get().runtimeMode : 'app_open';
    if (mode === 'background' && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  const mode = shouldShowWizard() ? 'wizard' : 'dashboard';
  if (mode === 'wizard') {
    mainWindow.loadFile(path.join(__dirname, 'wizard.html'));
  } else {
    mainWindow.loadURL(currentDashboardUrl());
  }
}

function looksLikeLocalServer(url) {
  if (!serverState) return false;
  return url.startsWith(serverState.httpUrl) || url.startsWith(serverState.httpsUrl);
}

function extractSensors(node, out) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.Text === 'string' && typeof node.Type === 'string') {
    const key = `${node.Type}: ${node.Text}`;
    out.add(key);
  }
  if (Array.isArray(node.Children)) node.Children.forEach((c) => extractSensors(c, out));
}

async function testEndpoint(endpoint) {
  const target = String(endpoint || '').trim();
  if (!/^https?:\/\//i.test(target)) {
    return { ok: false, message: 'Endpoint must start with http:// or https://.' };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(target, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status} from endpoint.` };
    const data = await res.json();
    const set = new Set();
    extractSensors(data, set);
    const sensors = Array.from(set).slice(0, 15);
    const hasCpu = sensors.some((s) => s.toLowerCase().includes('cpu'));
    const hasGpu = sensors.some((s) => s.toLowerCase().includes('gpu'));
    return {
      ok: true,
      message: hasCpu || hasGpu
        ? 'Endpoint reachable and sensor payload detected.'
        : 'Endpoint reachable, but CPU/GPU sensors were not clearly detected.',
      sensors
    };
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? 'Request timed out.' : (err.message || 'Request failed.');
    return { ok: false, message: msg };
  } finally {
    clearTimeout(t);
  }
}

// Self-signed cert acceptance is intentional here — only applies to our own
// local server URLs (localhost/LAN) to support HTTPS without a CA-signed cert.
app.on('certificate-error', (event, webContents, url, _error, _cert, callback) => {
  if (looksLikeLocalServer(url)) {
    event.preventDefault();
    callback(true);
    return;
  }
  callback(false);
});

app.whenReady().then(async () => {
  configStore = new ConfigStore(app.getPath('userData'));
  await startLocalServer();
  applyRunModeSideEffects();
  createMainWindow();

  updater.init({
    getMainWindow: () => mainWindow,
    userDataPath: app.getPath('userData'),
    appVersion: app.getVersion(),
    onTrayUpdate: updateTrayMenu,
    setIsQuitting: (v) => { isQuitting = v; },
    getConfigStore: () => configStore.get()
  });
  updater.runStartupSelfCheck();
  updater.maybeShowPostUpdateNotes();
  if (app.isPackaged) updater.setupAutoUpdates();

  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

process.on('uncaughtException', (err) => {
  const msg = err && err.stack ? err.stack : String(err);
  updater.logUpdateEvent('uncaught-exception', msg);
  dialog.showMessageBox(mainWindow || null, {
    type: 'error',
    title: 'Unexpected Error',
    message: 'The app hit an unexpected error.',
    detail: msg
  }).catch(() => {});
});

process.on('unhandledRejection', (reason) => {
  const msg = reason && reason.stack ? reason.stack : String(reason);
  updater.logUpdateEvent('unhandled-rejection', msg);
  dialog.showMessageBox(mainWindow || null, {
    type: 'error',
    title: 'Unhandled Rejection',
    message: 'A background task failed.',
    detail: msg
  }).catch(() => {});
});

app.on('window-all-closed', async () => {
  const mode = configStore ? configStore.get().runtimeMode : 'app_open';
  if (mode !== 'background' && localServer) {
    await localServer.stop();
  }
  updater.clearCheckTimer();
  if (process.platform !== 'darwin' && mode !== 'background') app.quit();
});

ipcMain.handle('app:get-state', async () => ({
  config: configStore.get(),
  server: serverState,
  configPath: configStore.getFilePath(),
  appVersion: app.getVersion(),
  updates: updater.getState()
}));

ipcMain.handle('wizard:test-endpoint', async (_evt, endpoint) => testEndpoint(endpoint));

ipcMain.handle('wizard:save', async (_evt, payload) => {
  try {
    const current = configStore.get();
    const next = deepMerge(current, payload || {});
    next.wizardCompleted = true;
    validateNetworkConfig(next.network || {});
    configStore.update(next);
    await startLocalServer();
    applyRunModeSideEffects();
    updateTrayMenu();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(currentDashboardUrl());
    }
    // Check if trust state is stale (cert or ports changed)
    let trustStale = false;
    if (serverState && serverState.certPath && process.platform === 'win32') {
      try {
        const trustState = next.trust || {};
        const currentThumbprint = winTrust.computeThumbprint(serverState.certPath);
        if (!trustState.thumbprint || trustState.thumbprint !== currentThumbprint) trustStale = true;
        const expectedRules = ['nDash HTTP ' + next.network.httpPort, 'nDash HTTPS ' + next.network.httpsPort];
        const storedRules = (trustState.firewallRuleNames || []).slice().sort();
        if (expectedRules.slice().sort().join(',') !== storedRules.join(',')) trustStale = true;
      } catch (_) {
        trustStale = true;
      }
    }

    return {
      ok: true,
      trustStale: trustStale,
      config: configStore.get(),
      server: serverState,
      configPath: configStore.getFilePath()
    };
  } catch (err) {
    const message = (err && err.message) ? err.message : String(err);
    const full = `Failed to save wizard settings: ${message}. Config path: ${configStore.getFilePath()}`;
    console.error(full);
    throw new Error(full);
  }
});

ipcMain.handle('wizard:rerun', async () => {
  configStore.update({ wizardCompleted: false });
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadFile(path.join(__dirname, 'wizard.html'));
    mainWindow.show();
  }
  return { ok: true };
});

ipcMain.handle('app:open-dashboard', async () => {
  const chosenUrl = currentDashboardUrl();
  await shell.openExternal(chosenUrl);
  return { ok: true, url: chosenUrl };
});

ipcMain.handle('app:copy-text', async (_evt, text) => {
  clipboard.writeText(String(text || ''));
  return { ok: true };
});

ipcMain.handle('app:update-runtime-mode', async (_evt, mode) => {
  const nextMode = mode === 'background' ? 'background' : 'app_open';
  configStore.update({ runtimeMode: nextMode });
  applyRunModeSideEffects();
  updateTrayMenu();
  return {
    ok: true,
    config: configStore.get(),
    server: serverState,
    configPath: configStore.getFilePath()
  };
});

ipcMain.handle('app:open-file', async (_evt, p) => {
  if (!p) return { ok: false };
  await shell.showItemInFolder(p);
  return { ok: true };
});

ipcMain.handle('app:open-update-log', async () => {
  await shell.showItemInFolder(updater.updateLogPath());
  return { ok: true, path: updater.updateLogPath() };
});

// --- Trust automation (Windows cert + firewall) ---

function isLocalSender(evt) {
  try {
    const url = evt.senderFrame && evt.senderFrame.url;
    if (!url) return false;
    if (url.startsWith('file://')) return true;
    if (serverState && (url.startsWith(serverState.httpUrl) || url.startsWith(serverState.httpsUrl))) return true;
    return false;
  } catch (_) {
    return false;
  }
}

ipcMain.handle('trust:status', async (evt) => {
  if (!isLocalSender(evt)) return { supported: false, error: 'unauthorized' };
  if (process.platform !== 'win32') return { supported: false };
  if (!serverState || !serverState.certPath) return { supported: true, certExists: false };

  const thumbprint = winTrust.computeThumbprint(serverState.certPath);
  const trusted = await winTrust.isCertTrusted(thumbprint);
  const cfg = configStore.get();
  const desiredRules = [
    { name: 'nDash HTTP ' + cfg.network.httpPort, port: cfg.network.httpPort, protocol: 'TCP' },
    { name: 'nDash HTTPS ' + cfg.network.httpsPort, port: cfg.network.httpsPort, protocol: 'TCP' }
  ];
  const rules = await winTrust.checkFirewallRules(desiredRules);
  const allValid = desiredRules.every(function(r) { var e = rules[r.name]; return e && e.valid; });

  return {
    supported: true,
    certExists: true,
    thumbprint: thumbprint,
    certTrusted: trusted,
    firewallRules: rules,
    allRulesOk: allValid,
    storedTrust: cfg.trust || {}
  };
});

ipcMain.handle('trust:install', async (evt) => {
  if (!isLocalSender(evt)) return { ok: false, error: 'unauthorized' };
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  if (!serverState || !serverState.certPath) return { ok: false, error: 'Server not started' };

  const cfg = configStore.get();
  try {
    const result = await winTrust.installTrust({
      certPath: serverState.certPath,
      httpPort: cfg.network.httpPort,
      httpsPort: cfg.network.httpsPort,
      userDataPath: app.getPath('userData'),
      currentTrustState: cfg.trust || {}
    });

    if (result.ok || result.certInstalled) {
      configStore.update({
        trust: {
          thumbprint: result.thumbprint,
          firewallRuleNames: result.firewallRules || [],
          installedAt: Date.now()
        }
      });
    }

    return result;
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Trust installation failed' };
  }
});

// --- Wallpaper storage ---

ipcMain.handle('wallpaper:save', async (_evt, payload) => {
  const dashboard = String(payload && payload.dashboard);
  if (!['btc', 'weather', 'pc'].includes(dashboard)) {
    return { ok: false, error: 'Invalid dashboard' };
  }
  const match = String(payload.dataUrl || '').match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
  if (!match) return { ok: false, error: 'Invalid image data' };

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 5 * 1024 * 1024) return { ok: false, error: 'Image too large (max 5 MB)' };

  const wpDir = path.join(app.getPath('userData'), 'wallpapers');
  fs.mkdirSync(wpDir, { recursive: true });

  const cfg = configStore.get();
  const oldFile = cfg.wallpapers && cfg.wallpapers[dashboard];
  if (oldFile) try { fs.unlinkSync(path.join(wpDir, oldFile)); } catch (_) {}

  const filename = dashboard + '.' + ext;
  fs.writeFileSync(path.join(wpDir, filename), buffer);

  const wallpapers = Object.assign({}, cfg.wallpapers || {});
  wallpapers[dashboard] = filename;
  configStore.update({ wallpapers });

  return { ok: true, url: '/wallpapers/' + filename };
});

ipcMain.handle('wallpaper:delete', async (_evt, payload) => {
  const dashboard = String(payload && payload.dashboard);
  if (!['btc', 'weather', 'pc'].includes(dashboard)) {
    return { ok: false, error: 'Invalid dashboard' };
  }
  const cfg = configStore.get();
  const filename = cfg.wallpapers && cfg.wallpapers[dashboard];
  if (filename) {
    try { fs.unlinkSync(path.join(app.getPath('userData'), 'wallpapers', filename)); } catch (_) {}
  }
  const wallpapers = Object.assign({}, cfg.wallpapers || {});
  delete wallpapers[dashboard];
  configStore.update({ wallpapers });
  return { ok: true };
});
