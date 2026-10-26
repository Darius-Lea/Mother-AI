'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { createBrowserAudit } = require('./browser-audit.cjs');
const { createBrowserProxy, validateBrowserUrl } = require('./browser-network.cjs');

const CHROME_HTML = path.join(__dirname,'browser-ui.html');
const CHROME_URL = pathToFileURL(CHROME_HTML).href;
const CHROME_FILES = new Set(['browser-ui.html','browser-ui.js','browser-ui.css'].map(name=>pathToFileURL(path.join(__dirname,name)).href));
const TOOLBAR_HEIGHT = 158;

function trustedChrome(event, state) {
  return Boolean(state && !state.closing && event.sender === state.window.webContents && event.senderFrame === state.window.webContents.mainFrame && event.senderFrame.url === CHROME_URL);
}

/** Remote sites run in a separate, memory-only Chromium session. They never get
 * a preload bridge, Mother's protocol handler, local service token or model. */
function createPrivateBrowser({ parent, userData, electron, createProxy = createBrowserProxy, auditStore } = {}) {
  const { app, BrowserWindow, WebContentsView, ipcMain, session } = electron || require('electron');
  const audit = auditStore || createBrowserAudit({userData});
  let active = null;
  let creating = null;

  function statusFor(state = active) {
    const contents = state?.view?.webContents;
    const alive = contents && !contents.isDestroyed() && !state.closing;
    const history = alive ? contents.navigationHistory : null;
    return {
      open:Boolean(state && !state.closing && !state.window.isDestroyed()),
      url:alive ? contents.getURL() : '',
      loading:Boolean(alive && contents.isLoading()),
      canGoBack:Boolean(history?.canGoBack()), canGoForward:Boolean(history?.canGoForward()),
      error:state?.error || '', auditAvailable:audit.available(),
    };
  }

  function publish(state) {
    if (!state.window.isDestroyed() && !state.closing) state.window.webContents.send(state.channels.status,statusFor(state));
  }

  function blockNavigation(state, value, reason='url-policy') {
    audit.record({type:'navigation-block',url:value,reason});
    state.error = 'Only public HTTPS websites can open here. Local networks and other link types are blocked.';
    publish(state);
  }

  async function navigate(state, value) {
    if (state.closing) return {ok:false,error:'The private browser is closing.'};
    let url;
    try { url=validateBrowserUrl(value).href; }
    catch { blockNavigation(state,value);return {ok:false,error:state.error}; }
    state.error='';
    publish(state);
    let timeout;
    try {
      await Promise.race([
        state.view.webContents.loadURL(url),
        new Promise((_resolve,reject)=>{timeout=setTimeout(()=>{if(!state.view.webContents.isDestroyed())state.view.webContents.stop();reject(Error('Navigation timed out.'));},30000);}),
      ]);
      return {ok:true,opened:true};
    } catch {
      if (!state.closing) {
        state.error = 'This page could not be loaded. The site may be unavailable or blocked by the public-network policy.';
        publish(state);
      }
      return {ok:false,error:state.error || 'The private browser closed.'};
    } finally {clearTimeout(timeout);}
  }

  async function terminate(state) {
    if (!state) return;
    if (state.cleanup) return state.cleanup;
    state.closing=true;
    state.cleanup=(async()=>{
      audit.record({type:'session-close'});
      for (const channel of Object.values(state.channels).filter(channel=>channel!==state.channels.status)) ipcMain.removeHandler(channel);
      app.removeListener('login',state.loginHandler);
      try {
        const contents=state.view.webContents;
        if (!contents.isDestroyed()) { contents.stop();contents.close({waitForBeforeUnload:false}); }
      } catch {}
      await state.proxy.close().catch(()=>{});
      await Promise.allSettled([state.remoteSession,state.chromeSession].flatMap(selected=>[
        selected.clearStorageData(), selected.clearCache(), selected.clearAuthCache(), selected.closeAllConnections(),
      ]));
      if (!state.window.isDestroyed()) state.window.destroy();
      if (active === state) active=null;
      await audit.flush();
    })();
    return state.cleanup;
  }

  async function createWindow() {
    const id=randomUUID();
    const remoteSession=session.fromPartition(`mother-private-web-${id}`,{cache:false});
    const chromeSession=session.fromPartition(`mother-private-chrome-${id}`,{cache:false});
    const proxy=await createProxy({audit:record=>audit.record(record)});
    try {
      await remoteSession.setProxy({mode:'fixed_servers',proxyRules:`http=${proxy.host}:${proxy.port};https=${proxy.host}:${proxy.port}`,proxyBypassRules:'<-loopback>'});
      const owner=typeof parent === 'function' ? parent() : parent;
      const window=new BrowserWindow({
        width:1280,height:900,minWidth:720,minHeight:500,show:false,
        title:'Mother Private Browser',backgroundColor:'#08131e',autoHideMenuBar:true,
        ...(owner && !owner.isDestroyed() ? {parent:owner} : {}),
        webPreferences:{
          session:chromeSession,preload:path.join(__dirname,'browser-preload.cjs'),
          additionalArguments:[`--mother-browser-id=${id}`],
          nodeIntegration:false,nodeIntegrationInSubFrames:false,contextIsolation:true,sandbox:true,
          webSecurity:true,allowRunningInsecureContent:false,devTools:false,spellcheck:false,
        },
      });
      const view=new WebContentsView({webPreferences:{
        session:remoteSession,nodeIntegration:false,nodeIntegrationInSubFrames:false,
        contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,
        devTools:false,spellcheck:false,webviewTag:false,plugins:false,
      }});
      const channels=Object.fromEntries(['navigate','back','forward','reload','close','get-status','status'].map(name=>[name.replace(/-([a-z])/g,(_m,c)=>c.toUpperCase()),`mother-browser:${id}:${name}`]));
      const state={window,view,remoteSession,chromeSession,proxy,channels,error:'',closing:false};
      active=state;
      state.loginHandler=(event,contents,_details,authInfo,callback)=>{
        if (contents !== view.webContents) return;
        event.preventDefault();
        if (authInfo.isProxy && authInfo.host === proxy.host && authInfo.port === proxy.port) callback(proxy.username,proxy.password);
        else callback();
      };
      app.on('login',state.loginHandler);
      window.contentView.addChildView(view);
      const layout=()=>{
        if (window.isDestroyed()) return;
        const [width,height]=window.getContentSize();
        view.setBounds({x:0,y:TOOLBAR_HEIGHT,width,height:Math.max(0,height-TOOLBAR_HEIGHT)});
      };
      layout();window.on('resize',layout);
      const guard=(event,value)=>{try {validateBrowserUrl(value);}catch {event.preventDefault();blockNavigation(state,value);}};
      view.webContents.on('will-navigate',guard);
      view.webContents.on('will-redirect',guard);
      view.webContents.on('will-frame-navigate',(event,details)=>guard(event,typeof details==='string'?details:details.url));
      view.webContents.on('will-attach-webview',event=>event.preventDefault());
      view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      view.webContents.setWindowOpenHandler(({url})=>{
        audit.record({type:'navigation-block',url,reason:'popup'});
        state.error='Pop-up windows are blocked. Enter the website address above to open it.';publish(state);
        return {action:'deny'};
      });
      for (const name of ['did-start-loading','did-stop-loading','did-navigate-in-page']) view.webContents.on(name,()=>publish(state));
      view.webContents.on('did-navigate',(_event,url)=>{audit.record({type:'navigation',url});state.error='';publish(state);});
      view.webContents.on('did-fail-load',(_event,code,_description,url,isMainFrame)=>{
        if (!isMainFrame || code===-3 || state.closing) return;
        audit.record({type:'request-error',url,reason:'page-load'});
        state.error='This page could not be loaded. Check the address or try another public HTTPS site.';publish(state);
      });
      view.webContents.on('render-process-gone',()=>{state.error='This page stopped responding. Reload it to continue.';publish(state);});

      remoteSession.setPermissionRequestHandler((_contents,permission,callback)=>{audit.record({type:'permission-block',reason:'website-permission',resourceType:permission});callback(false);});
      remoteSession.setPermissionCheckHandler(()=>false);
      remoteSession.setDevicePermissionHandler(()=>false);
      remoteSession.on('will-download',(event,item)=>{
        event.preventDefault();audit.record({type:'download-block',url:item.getURL(),reason:'download'});
        state.error='File downloads are blocked in this private browser.';publish(state);
      });
      remoteSession.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{
        try {
          validateBrowserUrl(details.url,{allowWebSocket:true});
          audit.record({type:'request',url:details.url,method:details.method,resourceType:details.resourceType});
          callback({cancel:false});
        } catch {
          audit.record({type:'network-block',url:details.url,reason:'url-policy',resourceType:details.resourceType});
          callback({cancel:true});
        }
      });
      remoteSession.webRequest.onBeforeSendHeaders({urls:['<all_urls>']},(details,callback)=>{
        const headers={...details.requestHeaders};
        for (const key of Object.keys(headers)) if (key.toLowerCase()==='referer' || key.toLowerCase()==='x-mother-desktop-token') delete headers[key];
        headers.DNT='1';headers['Sec-GPC']='1';
        callback({requestHeaders:headers});
      });
      remoteSession.webRequest.onCompleted({urls:['<all_urls>']},details=>audit.record({type:'response',url:details.url,method:details.method,status:details.statusCode,resourceType:details.resourceType}));
      remoteSession.webRequest.onErrorOccurred({urls:['<all_urls>']},details=>audit.record({type:'request-error',url:details.url,resourceType:details.resourceType,reason:'network'}));
      chromeSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
      chromeSession.setPermissionCheckHandler(()=>false);
      chromeSession.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>callback({cancel:!CHROME_FILES.has(details.url)}));
      window.webContents.on('will-navigate',(event,url)=>{if(url!==CHROME_URL)event.preventDefault();});
      window.webContents.on('will-attach-webview',event=>event.preventDefault());
      window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      window.webContents.once('did-finish-load',()=>publish(state));
      function handle(name,action) {
        ipcMain.handle(channels[name],(event,...args)=>{
          if (!trustedChrome(event,state)) throw Error('This action is only available to the private browser controls.');
          return action(...args);
        });
      }
      handle('navigate',value=>navigate(state,value));
      handle('getStatus',()=>statusFor(state));
      handle('back',()=>{if(view.webContents.navigationHistory.canGoBack())view.webContents.navigationHistory.goBack();return {ok:true};});
      handle('forward',()=>{if(view.webContents.navigationHistory.canGoForward())view.webContents.navigationHistory.goForward();return {ok:true};});
      handle('reload',()=>{view.webContents.reload();return {ok:true};});
      handle('close',()=>{void terminate(state);return {ok:true};});
      window.on('close',event=>{if(!state.closing){event.preventDefault();void terminate(state);}});
      window.on('closed',()=>{void terminate(state);});
      await window.loadFile(CHROME_HTML);
      audit.record({type:'session-open'});
      window.show();
      return state;
    } catch (error) { await proxy.close().catch(()=>{});throw error; }
  }

  return {
    async open(value) {
      try {validateBrowserUrl(value);}catch{return {ok:false,error:'Enter a complete public HTTPS website address.'};}
      try {
        if (active?.closing) await terminate(active);
        if (!active || active.window.isDestroyed()) {
          creating ||= createWindow().finally(()=>{creating=null;});
          await creating;
        }
        active.window.show();active.window.focus();
        return await navigate(active,value);
      } catch { if(active)await terminate(active);return {ok:false,error:'The private browser could not open. Please try again.'}; }
    },
    async close() { if(creating)await creating.catch(()=>{});await terminate(active);await audit.flush(); },
    status:()=>statusFor(),
    readActivity:options=>audit.read(options),
    clearActivity:()=>audit.clear(),
  };
}
module.exports={createPrivateBrowser,trustedChrome,CHROME_URL,TOOLBAR_HEIGHT};
