const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('DesktopApi', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  testEndpoint: (url) => ipcRenderer.invoke('wizard:test-endpoint', url),
  saveWizard: (payload) => ipcRenderer.invoke('wizard:save', payload),
  updateRuntimeMode: (mode) => ipcRenderer.invoke('app:update-runtime-mode', mode),
  openDashboard: () => ipcRenderer.invoke('app:open-dashboard'),
  copyText: (text) => ipcRenderer.invoke('app:copy-text', text),
  openFileInFolder: (path) => ipcRenderer.invoke('app:open-file', path),
  openUpdateLog: () => ipcRenderer.invoke('app:open-update-log'),
  rerunWizard: () => ipcRenderer.invoke('wizard:rerun'),
  getTrustStatus: () => ipcRenderer.invoke('trust:status'),
  installTrust: () => ipcRenderer.invoke('trust:install')
});
