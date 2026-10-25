import {test,expect} from '@playwright/test';
// Exercise the missing-model branch deterministically, even on a host with Ollama.
test.beforeEach(async({page})=>{await page.route('**/api/models',route=>route.fulfill({json:{available:false,models:[],error:'Unavailable runtime test branch'}}));});
import {createHash} from 'node:crypto';

test('Mother renders, assembles, gestures, rests, and awakens in actual WebGL',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Meet Mother.'})).toBeVisible();
  await expect(page.locator('.presence-top')).toContainText('MOTHER IS HERE',{timeout:30000});
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button',{name:'Wave hand',exact:true}).click();
  await page.screenshot({path:'test-results/mother-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Rest Mother',exact:true}).click();
  await expect(page.locator('.presence-top')).toContainText('AT REST');
  await page.getByRole('button',{name:'Awaken Mother',exact:true}).click();
  await expect(page.locator('.presence-top')).toContainText('MOTHER IS HERE',{timeout:30000});
  expect(errors).toEqual([]);
});

test('offline conversation, feedback correction and memory persist',async({page})=>{
  await page.goto('/');
  await page.getByRole('textbox',{name:'Message Mother'}).fill('How can I take you to another device?');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.locator('.messages')).toContainText('USB drive');
  await expect(page.locator('.message-engine').last()).toHaveText('Offline guide');
  await page.getByRole('button',{name:'Helpful response',exact:true}).click();
  await page.getByRole('button',{name:'Knowledge',exact:true}).click();
  await page.getByRole('button',{name:'Add a correction',exact:true}).click();
  await page.getByRole('textbox',{name:'What should Mother have said?'}).fill('Keep a private backup before transferring your memory.');
  await page.getByRole('button',{name:'Save correction',exact:true}).click();
  await expect(page.locator('.feedback-correction')).toContainText('private backup');
  const trainingDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export teaching examples',exact:false}).click();
  expect((await trainingDownload).suggestedFilename()).toMatch(/\.jsonl$/);
  await page.reload();
  await page.getByRole('button',{name:'Knowledge',exact:true}).click();
  await expect(page.locator('.feedback-correction')).toContainText('private backup');
});

test('datasets require review and approved text is retrieved, export stays portable',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Knowledge',exact:true}).click();
  await page.getByLabel('Upload dataset file').setInputFiles({name:'observatory.txt',mimeType:'text/plain',buffer:Buffer.from('The observatory telescope is named Meridian. Its aperture is 80 millimeters.')});
  await expect(page.getByRole('button',{name:'Add to knowledge',exact:true})).toBeDisabled();
  await page.getByRole('checkbox',{name:'I reviewed the source and approve using it as reference material.'}).check();
  await page.getByRole('button',{name:'Add to knowledge',exact:true}).click();
  await expect(page.getByText('1 sources',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sanctuary',exact:true}).click();
  await page.getByRole('textbox',{name:'Message Mother'}).fill('What is the observatory telescope named?');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.locator('.messages')).toContainText('Meridian');
  await page.getByRole('button',{name:'Connections',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export memory',exact:false}).click();
  const downloaded=await downloadPromise;
  expect(downloaded.suggestedFilename()).toMatch(/^mother-memory-.*\.json$/);
  const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('mother-ai-memory-v1')));
  expect(data.knowledge[0].approved).toBe(true);
  expect(data.conversations.at(-1).engine).toBe('Offline guide');
  await page.getByLabel('Import Mother memory file').setInputFiles({name:'memory.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...data,profile:{name:'Traveler',notes:''}}))});
  await expect(page.getByRole('button',{name:'Replace memory',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Replace memory',exact:true}).click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mother-ai-memory-v1')).profile.name)).toBe('Traveler');
});

test('security tools calculate actual hash and find unsafe code without execution',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Security lab',exact:true}).click();
  const contents='Mother test file';const digest=createHash('sha256').update(contents).digest('hex');
  await page.getByLabel('Select a file · up to 32 MB').setInputFiles({name:'test.txt',mimeType:'text/plain',buffer:Buffer.from(contents)});
  await expect(page.locator('code')).toHaveText(digest);
  await page.getByRole('textbox',{name:'Expected SHA-256 (optional)'}).fill(digest);
  await expect(page.getByText('Fingerprints match.',{exact:false})).toBeVisible();
  await page.getByRole('tab',{name:'Code review',exact:true}).click();
  await page.getByRole('textbox',{name:'Source code',exact:true}).fill('eval(userInput);');
  await page.getByRole('button',{name:'Review patterns',exact:true}).click();
  await expect(page.getByText('Dynamic code evaluation',{exact:false})).toBeVisible();
});

test('phone layout remains usable and missing model is explained',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await expect(page.getByRole('heading',{name:'Meet Mother.'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Connections',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Local intelligence',exact:true})).toBeVisible();
  await expect(page.getByText('Not connected',{exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/mother-mobile.png',fullPage:true});
});

test('production app shell can reopen offline after a visit',async({page,context})=>{
  await page.goto('/');
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByRole('heading',{name:'Meet Mother.'})).toBeVisible();
  await page.waitForFunction(async()=>{const cache=await caches.open('mother-shell-v1');const requests=await cache.keys();return requests.some(r=>r.url.endsWith('/index.html')) && requests.filter(r=>r.url.includes('/assets/')).length>=3;});
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading',{name:'Meet Mother.'})).toBeVisible();
  await page.getByRole('textbox',{name:'Message Mother'}).fill('Hello Mother');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.locator('.messages')).toContainText('offline guide mode');
});
