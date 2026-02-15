const path = require('path');
const { app, BrowserWindow, ipcMain, shell, clipboard, Tray, Menu, nativeImage, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { ConfigStore, deepMerge } = require('./config-store');
const { LocalServer } = require('./local-server');
const baseRuntimeConfig = require('../js/config-base.js');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let configStore = null;
let localServer = null;
let serverState = null;
let updateStatus = 'Updates: idle';
let updateCheckTimer = null;

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

function createTray() {
  if (tray) return;
  tray = new Tray(tinyIcon());
  tray.setToolTip('BTC Tracker Desktop');
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
        runUpdateCheck(true);
      }
    },
    {
      label: updateStatus,
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

function setUpdateStatus(text) {
  updateStatus = text;
  if (tray) updateTrayMenu();
}

function isAutoUpdateEnabled() {
  if (!app.isPackaged) return false;
  if (process.env.BTCT_DISABLE_AUTO_UPDATE === '1') return false;
  return !!process.env.BTCT_UPDATE_URL;
}

async function runUpdateCheck(manual) {
  if (!isAutoUpdateEnabled()) {
    if (manual) {
      await dialog.showMessageBox(mainWindow || null, {
        type: 'info',
        title: 'Updates',
        message: 'Auto-update is not configured for this build.',
        detail: 'Set BTCT_UPDATE_URL on the machine to enable update checks.'
      });
    }
    return;
  }
  try {
    setUpdateStatus('Updates: checking...');
    await autoUpdater.checkForUpdates();
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    setUpdateStatus('Updates: error');
    if (manual) {
      await dialog.showMessageBox(mainWindow || null, {
        type: 'error',
        title: 'Update Check Failed',
        message: 'Could not check for updates.',
        detail: msg
      });
    }
  }
}

function setupAutoUpdates() {
  if (!isAutoUpdateEnabled()) {
    setUpdateStatus('Updates: not configured');
    return;
  }

  const updateBaseUrl = String(process.env.BTCT_UPDATE_URL || '').trim();
  const channel = String(process.env.BTCT_UPDATE_CHANNEL || 'latest').trim();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.setFeedURL({ provider: 'generic', url: updateBaseUrl, channel });

  autoUpdater.on('checking-for-update', () => {
    setUpdateStatus('Updates: checking...');
  });
  autoUpdater.on('update-available', (info) => {
    const nextVersion = info && info.version ? info.version : 'new version';
    setUpdateStatus(`Updates: downloading ${nextVersion}`);
  });
  autoUpdater.on('update-not-available', () => {
    setUpdateStatus('Updates: up to date');
  });
  autoUpdater.on('download-progress', (p) => {
    const pct = p && typeof p.percent === 'number' ? p.percent.toFixed(0) : '?';
    setUpdateStatus(`Updates: downloading ${pct}%`);
  });
  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err && err.message ? err.message : err);
    setUpdateStatus('Updates: error');
  });
  autoUpdater.on('update-downloaded', async (info) => {
    const nextVersion = info && info.version ? info.version : 'new version';
    setUpdateStatus(`Updates: ready (${nextVersion})`);
    const res = await dialog.showMessageBox(mainWindow || null, {
      type: 'question',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update Ready',
      message: `Version ${nextVersion} has been downloaded.`,
      detail: 'Restart now to apply the update.'
    });
    if (res.response === 0) {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    }
  });

  runUpdateCheck(false);
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  updateCheckTimer = setInterval(() => runUpdateCheck(false), 6 * 60 * 60 * 1000);
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
    title: 'BTC Tracker Desktop',
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
  setupAutoUpdates();

  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', async () => {
  const mode = configStore ? configStore.get().runtimeMode : 'app_open';
  if (mode !== 'background' && localServer) {
    await localServer.stop();
  }
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
  if (process.platform !== 'darwin' && mode !== 'background') app.quit();
});

ipcMain.handle('app:get-state', async () => ({
  config: configStore.get(),
  server: serverState,
  configPath: configStore.getFilePath()
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
    return {
      ok: true,
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
