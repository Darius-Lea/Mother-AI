import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const temporary=await mkdtemp(path.join(os.tmpdir(),'mother-browser-smoke-'));
let app;
try{
  app=await electron.launch({executablePath:process.env.MOTHER_DESKTOP_EXECUTABLE||path.resolve('node_modules/electron/dist/electron'),args:[...(process.env.MOTHER_DESKTOP_EXECUTABLE?[]:[path.resolve('.')]),'--no-sandbox','--enable-unsafe-swiftshader',...(process.env.DISPLAY?[]:['--ozone-platform=headless'])],env:{...process.env,MOTHER_DESKTOP_TEST:'1',MOTHER_DESKTOP_USER_DATA:temporary,XDG_CACHE_HOME:path.join(temporary,'cache')},timeout:60000});
  const owner=await app.firstWindow();await owner.waitForLoadState('domcontentloaded');
  const denied=await owner.evaluate(()=>window.motherDesktop.openBrowser('http://127.0.0.1/'));
  assert.equal(denied.ok,false);assert.equal(app.windows().length,1);
  const opening=app.waitForEvent('window');
  await owner.evaluate(()=>{window.__browserOpening=window.motherDesktop.openBrowser('https://github.com/Darius-Lea/Mother-AI');});
  const chrome=await opening;await chrome.waitForLoadState('domcontentloaded');
  await expect(chrome.getByLabel('Website address',{exact:true})).toBeVisible();
  await owner.evaluate(()=>window.__browserOpening);
  const chromeChecks=await chrome.evaluate(()=>({bridge:Object.keys(window.motherBrowser||{}),mother:typeof window.motherDesktop,node:typeof require}));
  assert.equal(chromeChecks.mother,'undefined');assert.equal(chromeChecks.node,'undefined');assert.ok(!chromeChecks.bridge.some(key=>/audit|activity|token|exec|shell/.test(key)));
  const isolation=await app.evaluate(({BrowserWindow})=>{
    const browser=BrowserWindow.getAllWindows().find(window=>window.getTitle()==='Mother Private Browser');
    const contents=browser.contentView.children[0].webContents;
    const preferences=contents.getLastWebPreferences();
    globalThis.__motherBrowserTestSession=contents.session;
    return {sandbox:preferences.sandbox,nodeIntegration:preferences.nodeIntegration,contextIsolation:preferences.contextIsolation,preload:preferences.preload||null,storagePath:contents.session.storagePath};
  });
  assert.equal(isolation.sandbox,true);assert.equal(isolation.nodeIntegration,false);assert.equal(isolation.contextIsolation,true);assert.equal(isolation.preload,null);assert.equal(isolation.storagePath,null);
  await app.evaluate(async()=>globalThis.__motherBrowserTestSession.cookies.set({url:'https://example.com/',name:'mother-session-smoke',value:'temporary',expirationDate:Date.now()/1000+3600}));
  const blocked=await chrome.evaluate(()=>window.motherBrowser.navigate('mother://app/api/models'));
  assert.equal(blocked.ok,false);assert.match(blocked.error,/HTTPS/);
  await chrome.getByRole('button',{name:'Close session',exact:true}).click();
  await expect.poll(()=>app.windows().length).toBe(1);
  assert.deepEqual(await app.evaluate(()=>globalThis.__motherBrowserTestSession.cookies.get({})),[]);
  const activity=await owner.evaluate(()=>window.motherDesktop.readBrowserActivity());
  assert.ok(activity.records.some(record=>record.type==='session-open'));
  assert.ok(activity.records.some(record=>record.type==='session-close'));
  assert.equal((await owner.evaluate(()=>window.motherDesktop.clearBrowserActivity())).ok,true);
  assert.deepEqual((await owner.evaluate(()=>window.motherDesktop.readBrowserActivity())).records,[]);
  console.log('Private browser smoke passed: actual native controls, isolated remote session, restricted IPC, private-link rejection, session cleanup and owner-only activity.');
}finally{await app?.close();await rm(temporary,{recursive:true,force:true});}
