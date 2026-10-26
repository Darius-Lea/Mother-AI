import {test,expect} from '@playwright/test';
// Exercise the missing-model branch deterministically, even on a host with Ollama.
test.beforeEach(async({page})=>{await page.route('**/api/models',route=>route.fulfill({json:{available:false,models:[],error:'Unavailable runtime test branch'}}));});
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
  await expect(dialog.getByText('Local engine is not connected yet',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Choose a model',exact:false})).toBeDisabled();
  await page.screenshot({path:'test-results/first-release-wizard.png'});
  await dialog.getByRole('button',{name:'Continue with offline guide',exact:true}).click();
  await expect(dialog).not.toBeVisible();
});

test('guided setup verifies an installed model before saving the selection',async({page})=>{
  await page.route('**/api/setup/status',route=>route.fulfill({json:{...setupStatus,runtime:{available:true,version:'test-runtime'},models:[{name:'qwen3:8b'}]}}));
  await page.goto('/');await page.getByRole('button',{name:'Connections',exact:true}).click();await page.getByRole('button',{name:'Open guided setup',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Get started',exact:false}).click();
  await dialog.getByRole('button',{name:'Choose a model',exact:false}).click();
  await dialog.getByRole('button',{name:'Use installed model',exact:false}).click();
  await expect(dialog.getByRole('heading',{name:'Mother’s local brain is ready.'})).toBeVisible();
  await dialog.getByRole('button',{name:'Meet Mother',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mother-ai-memory-v1')).settings.model)).toBe('qwen3:8b');
  // Setup and runtime discovery are distinct; the simulated unavailable branch stays explicit.
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

test('download center keeps unfinished builds pending and explains phone installation',async({page})=>{
  await page.route('**/api/distribution',route=>route.fulfill({json:{version:'1.0.0-preview.1',status:'pending',artifacts:[]}}));
  await page.goto('/');await page.getByRole('button',{name:'Get Mother',exact:true}).click();
  await page.getByLabel('Your device',{exact:true}).selectOption('mac');
  await expect(page.getByRole('heading',{name:'Your installer is being prepared.',exact:true})).toBeVisible();
  await expect(page.locator('a[href*="/actions/"]')).toHaveCount(0);
  await page.getByLabel('Your device',{exact:true}).selectOption('mobile');
  await expect(page.getByRole('heading',{name:'Install on a phone or tablet',exact:false})).toBeVisible();
  await expect(page.getByText('This web address can be added to your home screen when served over HTTPS.',{exact:false})).toBeVisible();
});

test('desktop download opens the installer directly without a ZIP or build-page detour',async({page})=>{
  const version='1.0.0-preview.1';
  const entry=(platform,architecture,format)=>{
    const filename=`Mother-AI-${version}-${platform==='windows'?'win':platform}-${architecture}.${format}`;
    return {filename,version,platform,architecture,format,kind:'installer',size:1024*1024,sha256:'a'.repeat(64),signing:'unsigned',nativeInstallTested:false,downloadUrl:`https://github.com/Darius-Lea/Mother-AI/releases/download/mother-preview/${filename}`};
  };
  await page.route('**/api/distribution',route=>route.fulfill({json:{version,status:'available',artifacts:[entry('windows','x64','exe'),entry('mac','arm64','pkg'),{...entry('windows','arm64','exe'),downloadUrl:'https://evil.example/mother.exe'}]}}));
  await page.goto('/');await page.getByRole('button',{name:'Get Mother',exact:true}).click();
  await page.getByLabel('Your device',{exact:true}).selectOption('windows');
  await page.getByLabel('Computer type',{exact:true}).selectOption('x64');
  await expect(page.getByRole('link',{name:'Download Mother for Windows',exact:true})).toHaveAttribute('href',entry('windows','x64','exe').downloadUrl);
  await expect(page.locator('.download-panel')).not.toContainText(/unzip|terminal|Sign in to GitHub/i);
  await expect(page.locator('a[href*="/actions/"]')).toHaveCount(0);
  await page.getByLabel('Computer type',{exact:true}).selectOption('arm64');
  await expect(page.getByRole('heading',{name:'Your installer is being prepared.',exact:true})).toBeVisible();
  await expect(page.locator('a[href*="evil.example"]')).toHaveCount(0);
  await page.getByLabel('Your device',{exact:true}).selectOption('mac');
  await expect(page.getByRole('link',{name:'Download Mother for Mac',exact:true})).toHaveAttribute('href',entry('mac','arm64','pkg').downloadUrl);
});

test('security bridge reports actual tool inventory and never invents a Kali installation',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Security lab',exact:true}).click();
  await page.getByRole('tab',{name:'Security tool bridge',exact:true}).click();
  await expect(page.getByRole('heading',{name:'A bridge to your security tools.',exact:true})).toBeVisible();
  await expect(page.getByText('A limited bridge, not the full Kali suite.',{exact:false})).toBeVisible();
  await expect(page.locator('.kali-panel .knowledge-entry')).toHaveCount(3);
  await expect(page.getByRole('button',{name:'Review check plan',exact:true})).toBeDisabled();
});
