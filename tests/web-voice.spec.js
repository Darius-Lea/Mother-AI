import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.route('**/api/models',route=>route.fulfill({json:{available:false,models:[]}}));
  await page.route('**/api/web/status',route=>route.fulfill({json:{available:true,verifiedUrl:'https://example.com/',checkedAt:new Date().toISOString()}}));
});

test('web references require review and become a draft rather than hidden instructions',async({page})=>{
  await page.route('**/api/web/read',route=>route.fulfill({json:{title:'Example source',url:'https://example.com/source',text:'A reviewed source fact. <script>window.__unsafeWebScript=true</script>'}}));
  await page.goto('/');await page.getByRole('button',{name:'Web & browser',exact:true}).click();
  await expect(page.getByText('Public internet request verified',{exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'Public website address',exact:true}).fill('https://example.com/source');
  await page.getByRole('button',{name:'Read',exact:true}).click();
  await expect(page.getByRole('button',{name:'Attach to conversation',exact:true})).toBeDisabled();
  await page.getByRole('checkbox',{name:'I reviewed this excerpt and want Mother to discuss it.',exact:true}).check();
  await page.getByRole('button',{name:'Attach to conversation',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Message Mother',exact:true})).toHaveValue(/untrusted reference material/);
  expect(await page.evaluate(()=>window.__unsafeWebScript)).not.toBe(true);
  expect(await page.locator('.message.user').count()).toBe(0);
});

test('conversation research supplies actual excerpts without owner activity records',async({page})=>{
  await page.route('**/api/web/search',route=>route.fulfill({json:{results:[{title:'Public fact',url:'https://example.com/fact'}]}}));
  await page.route('**/api/web/read',route=>route.fulfill({json:{title:'Public fact',url:'https://example.com/fact',text:'The documented answer is forty-two.'}}));
  let auditRequests=0;await page.route('**/api/web/activity',route=>{auditRequests++;return route.fulfill({json:{records:[{query:'PRIVATE_AUDIT_CANARY'}]}});});
  await page.goto('/');await page.getByRole('checkbox',{name:'Search the web for this conversation',exact:false}).check();
  await page.getByRole('textbox',{name:'Message Mother',exact:true}).fill('Find the documented answer');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.locator('.message.assistant').last()).toContainText('forty-two');
  await expect(page.locator('.message-engine').last()).toHaveText('Web source excerpts');
  expect(auditRequests).toBe(0);await expect(page.locator('.messages')).not.toContainText('PRIVATE_AUDIT_CANARY');
});

test('failed voice preparation stays unavailable and never silently substitutes a robot voice',async({page})=>{
  await page.addInitScript(()=>{window.__deviceSpeechCalls=0;window.speechSynthesis.speak=()=>window.__deviceSpeechCalls++;});
  await page.route('**/api/voice/status',route=>route.fulfill({json:{state:'idle',nativeSynthesis:true}}));
  await page.route('**/api/voice/prepare',route=>route.fulfill({status:503,json:{error:'The local voice could not load. Please retry.'}}));
  await page.goto('/');await page.getByRole('button',{name:'Mother’s voice',exact:true}).click();
  await expect(page.locator('audio[aria-label="Mother Heart voice sample"]')).toHaveAttribute('src','/voices/mother-preview.wav');
  const prepare=page.getByRole('button',{name:'Download or load human voice',exact:true});await expect(prepare).toBeDisabled();
  await page.getByRole('checkbox',{name:'I approve downloading the free voice pack and using storage on this device.',exact:true}).check();await prepare.click();
  await expect(page.locator('.voice-settings [role="alert"]')).toContainText('Please retry');
  await expect(page.getByRole('button',{name:'Hear Mother’s voice',exact:true})).toBeDisabled();expect(await page.evaluate(()=>window.__deviceSpeechCalls)).toBe(0);
});

test('owner browser activity uses its narrow native bridge and can be cleared',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('mother-ai-memory-v1',JSON.stringify({version:1,profile:{},settings:{setupVisited:true,voice:false},conversations:[],knowledge:[],feedback:[]}));
    let records=[{timestamp:new Date().toISOString(),type:'navigation',url:'https://example.com/browser-visit'}];
    window.motherDesktop={isDesktop:true,openBrowser:async()=>({ok:true}),readBrowserActivity:async()=>({records}),clearBrowserActivity:async()=>{records=[];return {ok:true};}};
  });
  await page.route('**/api/web/activity',route=>route.fulfill({json:route.request().method()==='DELETE'?{ok:true}:{records:[]}}));
  await page.goto('/');await page.getByRole('button',{name:'Web & browser',exact:true}).click();await page.getByRole('tab',{name:'Your activity log',exact:true}).click();
  await expect(page.getByText('https://example.com/browser-visit',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Clear local activity',exact:true}).click();
  await expect(page.getByText('No retained activity.',{exact:true})).toBeVisible();
});
