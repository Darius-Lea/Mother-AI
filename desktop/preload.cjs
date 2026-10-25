'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// No Node, generic IPC, filesystem access, process invocation, or session tokens
// are exposed to the renderer. Native actions have narrow, validated handlers.
contextBridge.exposeInMainWorld('motherDesktop', Object.freeze({
  isDesktop: true,
  getSystemInfo: () => ipcRenderer.invoke('mother:system-info'),
  openOllamaDownload: () => ipcRenderer.invoke('mother:ollama-download'),
  openHelp: () => ipcRenderer.invoke('mother:help'),
  chooseProjectDirectory: () => ipcRenderer.invoke('mother:choose-project-directory'),
}));
