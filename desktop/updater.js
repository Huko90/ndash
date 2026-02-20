const path = require('path');
const fs = require('fs');
const { dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');

// === STATE ===
let mainWindowGetter = null;
let userDataPath = '';
let appVersion = '';
let onTrayUpdate = null;
let isQuittingSetter = null;
let configStoreGetter = null;

let updateStatus = 'Updates: idle';
let updateCheckTimer = null;
let updateReadyInfo = null;
let lastUpdateError = '';
let lastUpdateCheckAt = 0;
let lastUpdateAvailableVersion = '';
let manualCheckPending = false;
let manualErrorShown = false;
let updateCounters = { checks: 0, ok: 0, errors: 0, downloads: 0, installedPrompts: 0 };

// === INIT ===
function init(opts) {
  mainWindowGetter = opts.getMainWindow;
  userDataPath = opts.userDataPath;
  appVersion = opts.appVersion;
  onTrayUpdate = opts.onTrayUpdate || function() {};
  isQuittingSetter = opts.setIsQuitting;
  configStoreGetter = opts.getConfigStore;
}

function win() { return mainWindowGetter ? mainWindowGetter() : null; }

// === HELPERS ===
function setUpdateStatus(text) {
  updateStatus = text;
  onTrayUpdate();
}

function updateLogPath() {
  return path.join(userDataPath, 'update.log');
}

function logUpdateEvent(event, detail) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    detail: detail || '',
    version: appVersion
  };
  const line = `${JSON.stringify(entry)}\n`;
  try {
    fs.mkdirSync(path.dirname(updateLogPath()), { recursive: true });
    fs.appendFileSync(updateLogPath(), line, 'utf8');
  } catch (_) {}
}

function lastRunVersionPath() {
  return path.join(userDataPath, 'last-run-version.txt');
}

function maybeShowPostUpdateNotes() {
  let prev = '';
  try {
    prev = fs.existsSync(lastRunVersionPath()) ? fs.readFileSync(lastRunVersionPath(), 'utf8').trim() : '';
  } catch (_) {}
  if (prev && prev !== appVersion) {
    dialog.showMessageBox(win(), {
      type: 'info',
      title: 'App Updated',
      message: `nDash updated to ${appVersion}.`,
      detail: `Previous version: ${prev}`
    }).catch(() => {});
  }
  try {
    fs.mkdirSync(path.dirname(lastRunVersionPath()), { recursive: true });
    fs.writeFileSync(lastRunVersionPath(), appVersion, 'utf8');
  } catch (_) {}
}

function runStartupSelfCheck() {
  const cfg = configStoreGetter();
  const warnings = [];
  if (!cfg.pc || !/^https?:\/\//i.test(String(cfg.pc.endpoint || ''))) warnings.push('pc_endpoint_not_set');
  if (!cfg.network || cfg.network.httpPort === cfg.network.httpsPort) warnings.push('invalid_ports');
  if (warnings.length) {
    logUpdateEvent('startup-warning', warnings.join(','));
  }
}

function hasPackagedUpdateConfig() {
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
  if (process.env.BTCT_DISABLE_AUTO_UPDATE === '1') return false;
  if (String(process.env.BTCT_UPDATE_URL || '').trim()) return true;
  if (githubFeedFromEnv()) return true;
  return hasPackagedUpdateConfig();
}

async function runUpdateCheck(manual) {
  if (!isAutoUpdateEnabled()) {
    if (manual) {
      await dialog.showMessageBox(win(), {
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
      await dialog.showMessageBox(win(), {
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
      dialog.showMessageBox(win(), {
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
      dialog.showMessageBox(win(), {
        type: 'info',
        title: 'Updates',
        message: 'You are up to date.',
        detail: `Current version: ${appVersion}`
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
      dialog.showMessageBox(win(), {
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
    onTrayUpdate();
    const res = await dialog.showMessageBox(win(), {
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
      if (isQuittingSetter) isQuittingSetter(true);
      autoUpdater.quitAndInstall();
    }
    manualCheckPending = false;
  });

  runUpdateCheck(false);
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  updateCheckTimer = setInterval(() => runUpdateCheck(false), 6 * 60 * 60 * 1000);
}

module.exports = {
  init,
  setupAutoUpdates,
  runUpdateCheck,
  setUpdateStatus,
  updateLogPath,
  logUpdateEvent,
  maybeShowPostUpdateNotes,
  runStartupSelfCheck,
  isAutoUpdateEnabled,
  getUpdateReadyInfo() { return updateReadyInfo; },
  getState() {
    return {
      status: updateStatus,
      readyVersion: updateReadyInfo && updateReadyInfo.version ? updateReadyInfo.version : '',
      availableVersion: lastUpdateAvailableVersion,
      lastError: lastUpdateError,
      lastCheckAt: lastUpdateCheckAt,
      logPath: updateLogPath(),
      counters: updateCounters
    };
  },
  clearCheckTimer() {
    if (updateCheckTimer) { clearInterval(updateCheckTimer); updateCheckTimer = null; }
  }
};
