import {test,expect} from '@playwright/test';

test('clicking microphone opens voice chat setup without downloading before consent',async({page})=>{
  let downloads=0;
  await page.route('**/api/recognition/model.tar.gz',route=>{downloads++;return route.abort();});
  await page.goto('/');
  await page.getByRole('button',{name:'Start voice chat',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'A conversation, without typing.'});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Start voice chat',exact:true})).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await expect(dialog.getByRole('button',{name:'Start voice chat',exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:'Continue typing',exact:true}).click();
  await expect(dialog).toHaveCount(0);expect(downloads).toBe(0);
});

test('voice preparation can be stopped and a late download cannot turn the microphone back on',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('mother-neural-voice-consent-v1','approved');
    localStorage.setItem('mother-local-speech-input-v1','approved');
  });
  await page.route('**/api/voice/status',route=>route.fulfill({json:{nativeSynthesis:true,state:'ready'}}));
  let finish;const waiting=new Promise(resolve=>finish=resolve);
  await page.route('**/api/voice/prepare',async route=>{await waiting;await route.fulfill({json:{ready:true}});});
  let recognitionRequests=0;
  await page.route('**/api/recognition/model.tar.gz',route=>{recognitionRequests++;return route.abort();});
  await page.goto('/');await page.getByRole('button',{name:'Start voice chat',exact:true}).click();
  await expect(page.locator('.voice-chat-status')).toContainText('Preparing voice chat');
  await page.locator('.voice-chat-status').getByRole('button',{name:'Stop voice chat',exact:true}).click();
  const completed=page.waitForResponse('**/api/voice/prepare');finish();await completed;
  await page.getByRole('button',{name:'Mother’s voice',exact:true}).click();
  await expect(page.getByText('Human voice ready',{exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(recognitionRequests).toBe(0);
});

test('desktop update can download in background then explicitly open installation',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('mother-ai-memory-v1',JSON.stringify({version:1,profile:{},settings:{setupVisited:true,voice:false},conversations:[],knowledge:[],feedback:[]}));
    let status={source:'desktop',state:'idle',installedVersion:'1.0.0-preview.1'},listener;
    const publish=change=>{status={...status,...change};listener?.(status);return status;};
    window.__updateProgress=publish;window.__installerOpened=0;
    window.motherDesktop={isDesktop:true,
      getUpdateStatus:async()=>status,onUpdateStatus:callback=>{listener=callback;return()=>{if(listener===callback)listener=null;};},
      checkForUpdates:async()=>publish({state:'available',availableVersion:'1.0.0-preview.2',availableCommit:'a'.repeat(40),signing:'unsigned'}),
      downloadUpdate:async()=>publish({state:'downloading',progress:.25,total:100000000,downloaded:25000000}),
      cancelUpdate:async()=>publish({state:'cancelled'}),
      installUpdate:async()=>{window.__installerOpened++;return publish({state:'installing'});},
    };
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Mother updates',exact:true}).click();
  await expect(page.getByRole('heading',{name:'A new Mother update is available',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Download update',exact:true}).click();
  await expect(page.getByRole('progressbar',{name:'Mother update download'})).toHaveAttribute('value','0.25');
  await page.getByRole('button',{name:'Keep working',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('textbox',{name:'Message Mother',exact:true}).fill('I am still working');
  await page.evaluate(()=>window.__updateProgress({state:'ready',progress:1,downloaded:100000000}));
  await expect(page.getByRole('button',{name:'Mother updates',exact:true})).toContainText('Update available');
  expect(await page.evaluate(()=>window.__installerOpened)).toBe(0);
  await page.getByRole('button',{name:'Mother updates',exact:true}).click();
  await page.getByRole('button',{name:'Install update',exact:true}).click();
  expect(await page.evaluate(()=>window.__installerOpened)).toBe(1);
});
