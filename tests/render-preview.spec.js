import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {createApp} from '../server/index.js';

let app,server,base;
test.beforeAll(async()=>{
  app=createApp({mode:'hosted-preview'});server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async()=>{app.locals.shutdown();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});});

test('hosted preview works on phones while keeping server controls private',async({page})=>{
  const privateRequests=[];
  page.on('request',request=>{const route=new URL(request.url()).pathname;if(route.startsWith('/api/')&&!['/api/health','/api/models','/api/distribution'].includes(route))privateRequests.push(route);});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await expect(page.getByRole('region',{name:'Hosted preview',exact:true})).toBeVisible();
  await expect(page.locator('.mode-chip')).toContainText('HOSTED PREVIEW');
  await page.getByRole('button',{name:'Coding studio',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Bring Mother to your project.',exact:true})).toBeVisible();
  await expect(page.getByLabel('Folder on the computer running Mother',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Connections',exact:true}).click();
  await expect(page.getByRole('button',{name:'Open guided setup',exact:true})).toHaveCount(0);
  await expect(page.getByRole('tab',{name:'App permissions',exact:true})).not.toBeVisible();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export memory',exact:false}).click();
  expect((await download).suggestedFilename()).toMatch(/mother-memory-.*\.json$/);
  await page.getByRole('button',{name:'Knowledge',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Dataset link',exact:true})).toHaveCount(0);
  await page.getByLabel('Upload dataset file').setInputFiles({name:'preview.txt',mimeType:'text/plain',buffer:Buffer.from('The demonstration telescope is called Meridian.')});
  await page.getByRole('checkbox',{name:'I reviewed the source and approve using it as reference material.',exact:true}).check();
  await page.getByRole('button',{name:'Add to knowledge',exact:true}).click();
  await expect(page.getByText('1 sources',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Security lab',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Security tool bridge',exact:true})).not.toBeVisible();
  const contents='A local preview file';
  await page.getByLabel('Select a file · up to 32 MB').setInputFiles({name:'test.txt',mimeType:'text/plain',buffer:Buffer.from(contents)});
  await expect(page.locator('code')).toHaveText(createHash('sha256').update(contents).digest('hex'));
  await page.getByRole('tab',{name:'Code review',exact:true}).click();await page.getByRole('textbox',{name:'Source code',exact:true}).fill('eval(userInput);');
  await page.getByRole('button',{name:'Review patterns',exact:true}).click();await expect(page.getByText('Dynamic code evaluation',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Get Mother',exact:true}).click();
  await expect(page.getByRole('link',{name:'Desktop test downloads',exact:true})).toHaveAttribute('href','https://github.com/Darius-Lea/Mother-AI/actions/workflows/desktop-installers.yml');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/render-phone-preview.png',fullPage:true});
  expect(privateRequests).toEqual([]);expect(errors).toEqual([]);
});
