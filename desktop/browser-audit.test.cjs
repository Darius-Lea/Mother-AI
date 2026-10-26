'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createBrowserAudit,sanitizeRecord}=require('./browser-audit.cjs');
const {trustedChrome}=require('./browser.cjs');

test('owner browser activity omits credentials, query tokens, form data and website content',()=>{
  const record=sanitizeRecord({type:'request',url:'https://user:password@example.com/path?token=secret#private',method:'GET',headers:{Authorization:'secret'},body:'private form',text:'page contents',reason:'not a fixed code'});
  assert.equal(record.url,'https://example.com/path');assert.equal(record.method,'GET');
  assert.doesNotMatch(JSON.stringify(record),/password|token|secret|private form|page contents|Authorization/);
});

test('owner activity rotates within its bound and can be cleared independently of browser storage',async t=>{
  const userData=await fs.mkdtemp(path.join(os.tmpdir(),'mother-browser-audit-'));t.after(()=>fs.rm(userData,{recursive:true,force:true}));
  const audit=createBrowserAudit({userData,maxBytes:2048,maxQueue:1000});
  for(let i=0;i<200;i++)audit.record({type:'navigation',url:`https://example.com/path/${i}`});
  await audit.flush();
  for(const name of await fs.readdir(path.join(userData,'audit')))assert.ok((await fs.stat(path.join(userData,'audit',name))).size<=2048);
  const activity=await audit.read();assert.ok(activity.records.length>0);assert.match(activity.records[0].url,/199$/);
  assert.equal((await audit.clear()).ok,true);assert.deepEqual((await audit.read()).records,[]);await audit.close();
});

test('browser chrome IPC rejects remote pages, subframes and unrelated contents',()=>{
  const {CHROME_URL}=require('./browser.cjs');
  const frame={url:CHROME_URL};const contents={mainFrame:frame};const state={closing:false,window:{webContents:contents}};
  assert.equal(trustedChrome({sender:contents,senderFrame:frame},state),true);
  assert.equal(trustedChrome({sender:contents,senderFrame:{url:'https://example.com'}},state),false);
  assert.equal(trustedChrome({sender:{mainFrame:frame},senderFrame:frame},state),false);
  state.closing=true;assert.equal(trustedChrome({sender:contents,senderFrame:frame},state),false);
});
