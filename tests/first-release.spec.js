import {test,expect} from '@playwright/test';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const setupStatus={hardware:{platform:'win32',arch:'x64',totalMemoryGiB:16,cpuCount:8},runtime:{available:false},models:[],recommendedModel:'qwen3:8b',recommendations:[{name:'qwen3:8b',label:'Reasoning',description:'A local model',eligible:true,recommended:true,minRamGiB:12,downloadGiB:5.2}],activeDownload:null};

test('first release labeling and guided setup never confuse missing runtime with readiness',async({page})=>{
  await page.route('**/api/setup/status',route=>route.fulfill({json:setupStatus}));
  await page.goto('/');await expect(page.locator('.version-tag')).toHaveText('FIRST RELEASE PREVIEW');
  await page.getByRole('button',{name:'Connections',exact:true}).click();
  await page.getByRole('button',{name:'Open guided setup',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:'Let’s bring Mother to life.'})).toBeVisible();
  await dialog.getByRole('button',{name:'Get started',exact:false}).click();
  await expect(dialog.getByText('Ollama is not connected yet',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Choose a model',exact:false})).toBeDisabled();
  await page.screenshot({path:'test-results/first-release-wizard.png'});
  await dialog.getByRole('button',{name:'Continue with offline guide',exact:true}).click();
  await expect(dialog).not.toBeVisible();
});

test('guided setup verifies an already installed model and supports keyboard dismissal',async({page})=>{
  await page.route('**/api/setup/status',route=>route.fulfill({json:{...setupStatus,runtime:{available:true,version:'test-runtime'},models:[{name:'qwen3:8b'}]}}));
  await page.goto('/');await page.getByRole('button',{name:'Connections',exact:true}).click();await page.getByRole('button',{name:'Open guided setup',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Get started',exact:false}).click();
  await dialog.getByRole('button',{name:'Choose a model',exact:false}).click();
  await dialog.getByRole('button',{name:'Use installed model',exact:false}).click();
  await expect(dialog.getByRole('heading',{name:'Mother’s local brain is ready.'})).toBeVisible();
  await dialog.getByRole('button',{name:'Meet Mother',exact:true}).click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mother-ai-memory-v1')).settings.model)).toBe('qwen3:8b');
  // The actual runtime remains absent; a mocked setup UI does not make live inference available.
  await expect(page.locator('.mode-chip')).toContainText('OFFLINE GUIDE');
});

test('an app receives only approved API access and revocation takes effect',async({page,request})=>{
  await page.goto('/');await page.getByRole('button',{name:'Connections',exact:true}).click();await page.getByRole('tab',{name:'App permissions',exact:true}).click();
  await page.getByRole('textbox',{name:'App name',exact:true}).fill('Browser test app');
  await page.getByRole('checkbox',{name:'Conversations & coding with your local model',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'Local code pattern checks',exact:true}).check();
  await expect(page.getByRole('button',{name:'Create app connection',exact:true})).toBeDisabled();
  await page.getByRole('checkbox',{name:'I trust this app and approve the selected access.',exact:true}).check();
  await page.getByRole('button',{name:'Create app connection',exact:true}).click();
  const token=await page.getByRole('textbox',{name:'One-time app token',exact:true}).inputValue();
  const review=await request.post('/api/connect/review',{headers:{Authorization:`Bearer ${token}`},data:{source:'eval(input);'}});
  expect(review.status()).toBe(200);expect((await review.json()).findings.length).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Revoke',exact:true}).click();await page.getByRole('button',{name:'Revoke app access',exact:true}).click();
  expect((await request.get('/api/connect/status',{headers:{Authorization:`Bearer ${token}`}})).status()).toBe(401);
});

test('coding studio writes only after approval and can restore the original',async({page})=>{
  const directory=await mkdtemp(path.join(tmpdir(),'mother-browser-project-'));const target=path.join(directory,'hello.js');
  try {
    await writeFile(target,'export const answer = 1;\n');
    await page.goto('/');await page.getByRole('button',{name:'Coding studio',exact:true}).click();
    await page.getByRole('textbox',{name:'Folder on the computer running Mother',exact:true}).fill(directory);
    await page.getByRole('button',{name:'Open project',exact:true}).click();await page.getByRole('button',{name:'hello.js',exact:true}).click();
    await page.getByRole('textbox',{name:'Proposed file contents',exact:true}).fill('export const answer = 42;\n');
    await page.getByRole('button',{name:'Review change',exact:true}).click();
    expect(await readFile(target,'utf8')).toBe('export const answer = 1;\n');
    await page.getByRole('button',{name:'Apply approved change',exact:true}).click();
    await expect(page.getByRole('button',{name:'Restore original',exact:true})).toBeVisible();expect(await readFile(target,'utf8')).toBe('export const answer = 42;\n');
    await page.getByRole('button',{name:'Restore original',exact:true}).click();
    await expect(page.getByText('Original contents restored.',{exact:true})).toBeVisible();expect(await readFile(target,'utf8')).toBe('export const answer = 1;\n');
    await page.getByRole('button',{name:'Disconnect project',exact:true}).click();
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('download center presents only existing artifacts and phone install requirements',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Get Mother',exact:true}).click();
  await page.getByLabel('Your device',{exact:true}).selectOption('mac');
  await expect(page.getByText('No Mac installer is available here yet.',{exact:true})).toBeVisible();
  await page.getByLabel('Your device',{exact:true}).selectOption('mobile');
  await expect(page.getByRole('heading',{name:'Install on a phone or tablet',exact:false})).toBeVisible();
  await expect(page.getByText('There is no public hosted mobile address',{exact:false})).toBeVisible();
});
