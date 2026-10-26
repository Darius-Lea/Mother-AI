'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// No Node, generic IPC, filesystem access, process invocation, or session tokens
// are exposed to the renderer. Native actions have narrow, validated handlers.
contextBridge.exposeInMainWorld('motherDesktop', Object.freeze({
  isDesktop: true,
  getSystemInfo: () => ipcRenderer.invoke('mother:system-info'),
  getRuntimeStatus: () => ipcRenderer.invoke('mother:runtime-status'),
  startRuntime: () => ipcRenderer.invoke('mother:runtime-start'),
  openBrowser: url => ipcRenderer.invoke('mother:browser-open', url),
  readBrowserActivity: () => ipcRenderer.invoke('mother:browser-activity'),
  clearBrowserActivity: () => ipcRenderer.invoke('mother:browser-clear-activity'),
  openHelp: () => ipcRenderer.invoke('mother:help'),
  chooseProjectDirectory: () => ipcRenderer.invoke('mother:choose-project-directory'),
}));
