'use strict';
// Render may retain an auto-detected `node desktop/main.cjs` command.
// Plain Node starts the web service; Electron alone initializes native APIs.
if (!process.versions.electron) {
  import('../server/index.js').then(({startServer})=>startServer()).catch(error=>{
    console.error('Mother web startup failed:',error.message);process.exitCode=1;
  });
} else {
const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } = require('electron');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { APP_ORIGIN, CSP, isAppUrl, isAllowedExternalUrl } = require('./security.cjs');
const { createRuntimeManager } = require('./runtime.cjs');
const { createPrivateBrowser } = require('./browser.cjs');
const { createUpdateManager } = require('./updater.cjs');

// A stable secure origin preserves localStorage across random server ports and
// app upgrades. Remote webpages never receive access to this protocol handler.
protocol.registerSchemesAsPrivileged([{
  scheme: 'mother',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, serviceWorkers: true },
}]);

if (process.env.MOTHER_DESKTOP_TEST === '1' && process.env.MOTHER_DESKTOP_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.MOTHER_DESKTOP_USER_DATA));
}
app.setName('Mother AI');
if (process.platform === 'win32') app.setAppUserModelId('ai.mother.desktop');
let mainWindow;
let localServer;
let backendConnection;
let backendApp;
let runtimeManager;
let privateBrowser;
let updateManager;
let updateTimer;
let protocolRegistered = false;
let quitting = false;

function log(message) {
  try {
    const directory = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, 'desktop.log');
    // A bounded log: sensitive request content and tokens are never logged.
    try { if (fs.statSync(target).size > 1024 * 1024) fs.renameSync(target, `${target}.previous`); } catch {}
    fs.appendFileSync(target, `${new Date().toISOString()} ${message}\n`);
  } catch {}
}

function ensureTrustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || !isAppUrl(event.senderFrame.url)) {
    throw new Error('This native operation is only available to the Mother application.');
  }
}

async function openOfficial(value) {
  if (!isAllowedExternalUrl(value)) return { ok: false, error: 'This external link is not an approved Mother resource.' };
  await shell.openExternal(value);
  return { ok: true, opened: value };
}

async function showHelp() {
  await dialog.showMessageBox(mainWindow, {
    type: 'info', title: 'Welcome to Mother', message: 'Your companion, on this computer.',
    detail: 'Use Connections → Open guided setup to choose a free local model. Mother includes the local AI engine and handles model downloads. No API key or terminal is required.\n\nUse Knowledge to review references, Coding studio to choose a project, and App permissions to connect compatible applications. These preview tools require your approval before accessing your projects or granting an app access.',
  });
  return { ok: true };
}

function registerNativeActions() {
  const browser = () => privateBrowser ||= createPrivateBrowser({ parent: mainWindow, userData: app.getPath('userData') });
  for (const [channel, action] of Object.entries({status:'status',check:'check',download:'download',install:'install',cancel:'cancel'})) {
    ipcMain.handle(`mother:update-${channel}`, event => {
      ensureTrustedSender(event);
      return updateManager[action]();
    });
  }
  ipcMain.handle('mother:system-info', event => {
    ensureTrustedSender(event);
    const memoryGiB = Math.round(os.totalmem() / (1024 ** 3));
    return { platform: process.platform, arch: process.arch, totalMemoryGiB: memoryGiB, memoryGB: memoryGiB, appVersion: app.getVersion(), desktop: true };
  });
  ipcMain.handle('mother:runtime-status', event => {
    ensureTrustedSender(event);
    return runtimeManager.status();
  });
  ipcMain.handle('mother:runtime-start', async event => {
    ensureTrustedSender(event);
    return runtimeManager.ensureStarted();
  });
  ipcMain.handle('mother:browser-open', async (event, url) => {
    ensureTrustedSender(event);
    if (typeof url !== 'string' || url.length > 4096) return { ok: false, error: 'Enter one public HTTPS web address.' };
    return browser().open(url);
  });
  ipcMain.handle('mother:browser-activity', event => {
    ensureTrustedSender(event);
    return browser().readActivity({ limit: 100 });
  });
  ipcMain.handle('mother:browser-clear-activity', event => {
    ensureTrustedSender(event);
    return browser().clearActivity();
  });
  ipcMain.handle('mother:help', async event => {
    ensureTrustedSender(event);
    return showHelp();
  });
  ipcMain.handle('mother:choose-project-directory', async event => {
    ensureTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a project for Mother',
      buttonLabel: 'Choose project',
      properties: ['openDirectory'],
      message: 'Choose only a project you want Mother to read. Connecting it is a separate step.',
    });
    return { canceled: result.canceled, path: result.canceled ? null : result.filePaths[0] || null };
  });
}

async function startLocalBackend() {
  if (localServer?.listening && backendConnection) return backendConnection;
  const { createApp } = await import(pathToFileURL(path.join(app.getAppPath(), 'server', 'index.js')).href);
  const desktopToken = randomBytes(32).toString('hex');
  const backend = createApp({ desktopToken, dataDirectory: path.join(app.getPath('userData'), 'service') });
  backendApp = backend;
  const server = await new Promise((resolve, reject) => {
    const instance = backend.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  localServer = server;
  const address = server.address();
  backendConnection = { origin: `http://127.0.0.1:${address.port}`, desktopToken };
  return backendConnection;
}

async function createWindow() {
  const backend = await startLocalBackend();
  const localSession = session.fromPartition('persist:mother-desktop');
  localSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    // Browser speech features can request microphone access. Chromium still
    // shows the OS permission prompt where applicable. No camera, location,
    // Bluetooth, USB, notifications, or clipboard permission is granted here.
    const trusted = contents === mainWindow?.webContents && isAppUrl(details.requestingUrl || contents.getURL());
    callback(Boolean(trusted && permission === 'media' && details.mediaTypes?.every(type => type === 'audio')));
  });
  localSession.setPermissionCheckHandler((contents, permission, origin, details) => {
    return Boolean(contents === mainWindow?.webContents && isAppUrl(origin || details.embeddingOrigin || '') && permission === 'media' && details.mediaType === 'audio');
  });
  if (!protocolRegistered) {
    await localSession.protocol.handle('mother', async request => {
    if (!isAppUrl(request.url)) return new Response('Unknown Mother resource.', { status: 403 });
    const source = new URL(request.url);
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method)) return new Response('Unsupported request method.', { status: 405 });
    const headers = new Headers();
    for (const name of ['accept', 'content-type', 'if-none-match', 'if-modified-since']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set('X-Mother-Desktop-Token', backend.desktopToken);
    if (!['GET', 'HEAD'].includes(request.method)) headers.set('Origin', backend.origin);
    try {
      const response = await net.fetch(`${backend.origin}${source.pathname}${source.search}`, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
        redirect: 'error',
      });
      const secured = new Headers(response.headers);
      secured.set('Content-Security-Policy', CSP);
      secured.set('X-Content-Type-Options', 'nosniff');
      secured.set('Referrer-Policy', 'no-referrer');
      if (source.pathname.startsWith('/api/')) secured.set('Cache-Control', 'no-store');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: secured });
    } catch (error) {
      log(`Local protocol request failed: ${error.name || 'Error'}`);
      return new Response('Mother could not reach her local service. Please restart the application.', { status: 503 });
    }
  });

    protocolRegistered = true;
  }

  mainWindow = new BrowserWindow({
    width: 1440, height: 1000, minWidth: 900, minHeight: 650,
    title: 'Mother AI', backgroundColor: '#080d13', show: false,
    autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), 'public', 'icons', 'mother-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      session: localSession,
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
      spellcheck: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openOfficial(url).catch(() => log('Could not open an official external link.'));
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      void openOfficial(url).catch(() => log('Could not open an official external link.'));
    }
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.on('render-process-gone', (_event, details) => log(`Renderer stopped: ${details.reason}`));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { void privateBrowser?.close(); privateBrowser = null; mainWindow = null; });
  await mainWindow.loadURL(`${APP_ORIGIN}/`);
  log(`Application started (${process.platform}/${process.arch}, version ${app.getVersion()}).`);
  if (process.env.MOTHER_DESKTOP_TEST === '1' && process.env.MOTHER_DESKTOP_AUTO_EXIT === '1') {
    setTimeout(() => app.quit(), 1500);
  }
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(async () => {
    const {fetchOfficialAsset}=await import(pathToFileURL(path.join(app.getAppPath(),'server','https-assets.js')).href);
    let build={};
    try { build=JSON.parse(fs.readFileSync(path.join(app.getAppPath(),'server','build-info.json'),'utf8')); } catch {}
    updateManager=createUpdateManager({
      userData:app.getPath('userData'),currentVersion:app.getVersion(),currentCommit:build.buildCommit,currentBuiltAt:build.buildTime,
      fetchImpl:fetchOfficialAsset,
      onStatus:status=>{if(mainWindow && !mainWindow.isDestroyed())mainWindow.webContents.send('mother:update-status',status);},
      openInstaller:async file=>{
        const error=await shell.openPath(file);
        if(error)throw Error('The operating system could not open the installer.');
      },
      onInstallStarted:()=>{setTimeout(()=>app.quit(),750);},
    });
    runtimeManager = createRuntimeManager({
      resourcesPath: process.resourcesPath,
      userData: app.getPath('userData'),
      ...(!app.isPackaged ? { bundleDirectory: path.join(app.getAppPath(), '.runtime', 'ollama') } : {}),
    });
    // The trusted desktop session can retry through a narrow IPC action.
    // Starting the bundled engine never blocks the visual companion from opening.
    void runtimeManager.ensureStarted().catch(() => log('Local AI engine could not start. Guided setup can retry.'));
    const template = [
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      { label: 'Help', submenu: [{ label: 'Mother help', click: () => { void showHelp(); } }] },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    registerNativeActions();
    await createWindow();
    // Checks are read-only. Downloading and OS installation need a button click.
    updateTimer=setInterval(()=>void updateManager.check(),30*60*1000);
  }).catch(async error => {
    log(`Application startup failed: ${error.stack || error.message}`);
    await dialog.showMessageBox({ type: 'error', title: 'Mother could not start', message: 'Mother could not start her local service.', detail: 'Please restart Mother. Your saved memory stays on this device. If the problem continues, contact the application maintainer.' });
    app.quit();
  });
  app.on('activate', () => {
    if (!mainWindow && !quitting) void createWindow().catch(error => log(`Could not reopen Mother: ${error.message}`));
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => {
    quitting = true;
    clearInterval(updateTimer);
    updateManager?.stop();
    backendApp?.locals.shutdown?.();
    runtimeManager?.stop();
    void privateBrowser?.close();
    localServer?.close();
    localServer?.closeAllConnections?.();
  });
}

}
