const path = require('path');
const fs = require('fs');
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
let updateReadyInfo = null;
let lastUpdateError = '';
let lastUpdateCheckAt = 0;
let lastUpdateAvailableVersion = '';
let manualCheckPending = false;
let manualErrorShown = false;
let updateCounters = { checks: 0, ok: 0, errors: 0, downloads: 0, installedPrompts: 0 };

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

function trayIcon() {
  const trayPath = path.join(__dirname, 'tray-icon.png');
  const img = nativeImage.createFromPath(trayPath);
  if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
  return tinyIcon();
}

function createTray() {
  if (tray) return;
  tray = new Tray(trayIcon());
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
      label: 'Install Downloaded Update Now',
      enabled: !!updateReadyInfo,
      click: () => {
        if (!updateReadyInfo) return;
        isQuitting = true;
        autoUpdater.quitAndInstall();
      }
    },
    {
      label: 'Open Update Log',
      click: () => {
        shell.showItemInFolder(updateLogPath());
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

function updateLogPath() {
  return path.join(app.getPath('userData'), 'update.log');
}

function logUpdateEvent(event, detail) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    detail: detail || '',
    version: app.getVersion()
  };
  const line = `${JSON.stringify(entry)}\n`;
  try {
    fs.mkdirSync(path.dirname(updateLogPath()), { recursive: true });
    fs.appendFileSync(updateLogPath(), line, 'utf8');
  } catch (_) {}
}

function lastRunVersionPath() {
  return path.join(app.getPath('userData'), 'last-run-version.txt');
}

function maybeShowPostUpdateNotes() {
  const current = app.getVersion();
  let prev = '';
  try {
    prev = fs.existsSync(lastRunVersionPath()) ? fs.readFileSync(lastRunVersionPath(), 'utf8').trim() : '';
  } catch (_) {}
  if (prev && prev !== current) {
    dialog.showMessageBox(mainWindow || null, {
      type: 'info',
      title: 'App Updated',
      message: `BTC Tracker Desktop updated to ${current}.`,
      detail: `Previous version: ${prev}`
    }).catch(() => {});
  }
  try {
    fs.mkdirSync(path.dirname(lastRunVersionPath()), { recursive: true });
    fs.writeFileSync(lastRunVersionPath(), current, 'utf8');
  } catch (_) {}
}

function runStartupSelfCheck() {
  const cfg = configStore.get();
  const warnings = [];
  if (!cfg.pc || !/^https?:\/\//i.test(String(cfg.pc.endpoint || ''))) warnings.push('pc_endpoint_not_set');
  if (!cfg.network || cfg.network.httpPort === cfg.network.httpsPort) warnings.push('invalid_ports');
  if (warnings.length) {
    logUpdateEvent('startup-warning', warnings.join(','));
  }
}

function hasPackagedUpdateConfig() {
  if (!app.isPackaged) return false;
  try {
    return fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  } catch (_) {
    return false;
  }
}

function githubFeedFromEnv() {
  const owner = String(process.env.BTCT_GH_OWNER || '').trim();
  const repo = String(process.env.BTCT_GH_REPO || '').trim();
  if (!owner || !repo) return null;

  const host = String(process.env.BTCT_GH_HOST || '').trim();
  const isPrivate = String(process.env.BTCT_GH_PRIVATE || '').trim() === '1';
  const cfg = { provider: 'github', owner, repo, private: isPrivate };
  if (host) cfg.host = host;
  return cfg;
}

function isAutoUpdateEnabled() {
  if (!app.isPackaged) return false;
  if (process.env.BTCT_DISABLE_AUTO_UPDATE === '1') return false;
  if (String(process.env.BTCT_UPDATE_URL || '').trim()) return true;
  if (githubFeedFromEnv()) return true;
  return hasPackagedUpdateConfig();
}

async function runUpdateCheck(manual) {
  if (!isAutoUpdateEnabled()) {
    if (manual) {
      await dialog.showMessageBox(mainWindow || null, {
        type: 'info',
        title: 'Updates',
        message: 'Auto-update is not configured for this build.',
        detail: 'Set BTCT_UPDATE_URL or BTCT_GH_OWNER/BTCT_GH_REPO, or ship with app-update.yml metadata.'
      });
    }
    return;
  }
  try {
    manualCheckPending = !!manual;
    manualErrorShown = false;
    lastUpdateCheckAt = Date.now();
    updateCounters.checks += 1;
    logUpdateEvent('check-start', manual ? 'manual' : 'auto');
    setUpdateStatus('Updates: checking...');
    await autoUpdater.checkForUpdates();
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    lastUpdateError = msg;
    updateCounters.errors += 1;
    logUpdateEvent('check-error', msg);
    setUpdateStatus('Updates: error');
    if (manual) {
      manualErrorShown = true;
      await dialog.showMessageBox(mainWindow || null, {
        type: 'error',
        title: 'Update Check Failed',
        message: 'Could not check for updates.',
        detail: msg
      });
    }
    manualCheckPending = false;
  }
}

function setupAutoUpdates() {
  if (!isAutoUpdateEnabled()) {
    setUpdateStatus('Updates: not configured');
    return;
  }

  const updateBaseUrl = String(process.env.BTCT_UPDATE_URL || '').trim();
  const githubFeed = githubFeedFromEnv();
  const channel = String(process.env.BTCT_UPDATE_CHANNEL || 'latest').trim();
  const prereleaseEnabled = process.env.BTCT_UPDATE_ALLOW_PRERELEASE === '1' || channel !== 'latest';
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.allowPrerelease = prereleaseEnabled;
  if (updateBaseUrl) {
    autoUpdater.setFeedURL({ provider: 'generic', url: updateBaseUrl, channel });
    setUpdateStatus('Updates: configured (generic)');
    logUpdateEvent('feed', `generic ${updateBaseUrl} channel=${channel}`);
  } else if (githubFeed) {
    autoUpdater.setFeedURL(githubFeed);
    setUpdateStatus('Updates: configured (github)');
    logUpdateEvent('feed', `github ${githubFeed.owner}/${githubFeed.repo} prerelease=${prereleaseEnabled ? '1' : '0'}`);
  } else if (hasPackagedUpdateConfig()) {
    setUpdateStatus('Updates: configured (packaged)');
    logUpdateEvent('feed', `packaged channel=${channel} prerelease=${prereleaseEnabled ? '1' : '0'}`);
  } else {
    setUpdateStatus('Updates: not configured');
    return;
  }

  autoUpdater.on('checking-for-update', () => {
    lastUpdateCheckAt = Date.now();
    logUpdateEvent('checking');
    setUpdateStatus('Updates: checking...');
  });
  autoUpdater.on('update-available', (info) => {
    const nextVersion = info && info.version ? info.version : 'new version';
    lastUpdateAvailableVersion = nextVersion;
    updateCounters.ok += 1;
    logUpdateEvent('update-available', nextVersion);
    setUpdateStatus(`Updates: downloading ${nextVersion}`);
    if (manualCheckPending) {
      dialog.showMessageBox(mainWindow || null, {
        type: 'info',
        title: 'Update Found',
        message: `Version ${nextVersion} found.`,
        detail: 'Download started in background.'
      }).catch(() => {});
      manualCheckPending = false;
    }
  });
  autoUpdater.on('update-not-available', () => {
    logUpdateEvent('update-not-available');
    updateCounters.ok += 1;
    setUpdateStatus('Updates: up to date');
    if (manualCheckPending) {
      dialog.showMessageBox(mainWindow || null, {
        type: 'info',
        title: 'Updates',
        message: 'You are up to date.',
        detail: `Current version: ${app.getVersion()}`
      }).catch(() => {});
      manualCheckPending = false;
    }
  });
  autoUpdater.on('download-progress', (p) => {
    const pct = p && typeof p.percent === 'number' ? p.percent.toFixed(0) : '?';
    setUpdateStatus(`Updates: downloading ${pct}%`);
    logUpdateEvent('download-progress', `${pct}%`);
  });
  autoUpdater.on('error', (err) => {
    const msg = err && err.message ? err.message : String(err);
    lastUpdateError = msg;
    logUpdateEvent('error', msg);
    console.error('Auto-update error:', msg);
    setUpdateStatus('Updates: error');
    if (manualCheckPending && !manualErrorShown) {
      manualErrorShown = true;
      dialog.showMessageBox(mainWindow || null, {
        type: 'error',
        title: 'Update Error',
        message: 'Update failed.',
        detail: msg
      }).catch(() => {});
    }
    manualCheckPending = false;
  });
  autoUpdater.on('update-downloaded', async (info) => {
    const nextVersion = info && info.version ? info.version : 'new version';
    updateReadyInfo = info || { version: nextVersion };
    updateCounters.downloads += 1;
    logUpdateEvent('update-downloaded', nextVersion);
    setUpdateStatus(`Updates: ready (${nextVersion})`);
    updateTrayMenu();
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
      updateCounters.installedPrompts += 1;
      isQuitting = true;
      autoUpdater.quitAndInstall();
    }
    manualCheckPending = false;
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
  runStartupSelfCheck();
  maybeShowPostUpdateNotes();
  setupAutoUpdates();

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
  logUpdateEvent('uncaught-exception', msg);
  dialog.showMessageBox(mainWindow || null, {
    type: 'error',
    title: 'Unexpected Error',
    message: 'The app hit an unexpected error.',
    detail: msg
  }).catch(() => {});
});

process.on('unhandledRejection', (reason) => {
  const msg = reason && reason.stack ? reason.stack : String(reason);
  logUpdateEvent('unhandled-rejection', msg);
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
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
  if (process.platform !== 'darwin' && mode !== 'background') app.quit();
});

ipcMain.handle('app:get-state', async () => ({
  config: configStore.get(),
  server: serverState,
  configPath: configStore.getFilePath(),
  appVersion: app.getVersion(),
  updates: {
    status: updateStatus,
    readyVersion: updateReadyInfo && updateReadyInfo.version ? updateReadyInfo.version : '',
    availableVersion: lastUpdateAvailableVersion,
    lastError: lastUpdateError,
    lastCheckAt: lastUpdateCheckAt,
    logPath: updateLogPath(),
    counters: updateCounters
  }
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

ipcMain.handle('app:open-update-log', async () => {
  await shell.showItemInFolder(updateLogPath());
  return { ok: true, path: updateLogPath() };
});
