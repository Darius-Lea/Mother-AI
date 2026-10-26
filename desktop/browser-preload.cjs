'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const id=process.argv.find(value=>value.startsWith('--mother-browser-id='))?.slice('--mother-browser-id='.length);
if (/^[a-f0-9-]{36}$/.test(id || '')) {
  const channel=name=>`mother-browser:${id}:${name}`;
  contextBridge.exposeInMainWorld('motherBrowser',Object.freeze({
    navigate:url=>ipcRenderer.invoke(channel('navigate'),url),
    back:()=>ipcRenderer.invoke(channel('back')),
    forward:()=>ipcRenderer.invoke(channel('forward')),
    reload:()=>ipcRenderer.invoke(channel('reload')),
    close:()=>ipcRenderer.invoke(channel('close')),
    getStatus:()=>ipcRenderer.invoke(channel('get-status')),
    onStatus:callback=>{
      if(typeof callback!=='function')return ()=>{};
      const listener=(_event,status)=>callback(status);
      ipcRenderer.on(channel('status'),listener);
      return ()=>ipcRenderer.removeListener(channel('status'),listener);
    },
  }));
}
