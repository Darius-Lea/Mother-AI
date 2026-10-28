'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// No Node, generic IPC, filesystem access, process invocation, or session tokens
// are exposed to the renderer. Native actions have narrow, validated handlers.
contextBridge.exposeInMainWorld('motherDesktop', Object.freeze({
  isDesktop: true,
  getSystemInfo: () => ipcRenderer.invoke('mother:system-info'),
  getRuntimeStatus: () => ipcRenderer.invoke('mother:runtime-status'),
  startRuntime: () => ipcRenderer.invoke('mother:runtime-start'),
  getUpdateStatus: () => ipcRenderer.invoke('mother:update-status'),
  checkForUpdates: () => ipcRenderer.invoke('mother:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('mother:update-download'),
  installUpdate: () => ipcRenderer.invoke('mother:update-install'),
  cancelUpdate: () => ipcRenderer.invoke('mother:update-cancel'),
  onUpdateStatus: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('mother:update-status', listener);
    return () => ipcRenderer.removeListener('mother:update-status', listener);
  },
  openBrowser: url => ipcRenderer.invoke('mother:browser-open', url),
  readBrowserActivity: () => ipcRenderer.invoke('mother:browser-activity'),
  clearBrowserActivity: () => ipcRenderer.invoke('mother:browser-clear-activity'),
  openHelp: () => ipcRenderer.invoke('mother:help'),
  chooseProjectDirectory: () => ipcRenderer.invoke('mother:choose-project-directory'),
}));
