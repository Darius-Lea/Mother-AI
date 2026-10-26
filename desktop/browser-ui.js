'use strict';
const browser=window.motherBrowser;
const address=document.getElementById('address');
const status=document.getElementById('status');
const back=document.getElementById('back');
const forward=document.getElementById('forward');
const go=document.getElementById('go');
let currentUrl='';

function render(value) {
  if (!value || typeof value!=='object') return;
  currentUrl=typeof value.url==='string'?value.url:'';
  if(document.activeElement!==address)address.value=currentUrl;
  back.disabled=!value.canGoBack;forward.disabled=!value.canGoForward;
  status.textContent=value.auditAvailable===false?'Local activity recording is unavailable on this device.':value.error || (value.loading?'Loading…':'Private session · public HTTPS websites');
}
async function invoke(action) {
  try { const result=await action();if(result?.ok===false)status.textContent=result.error || 'The action could not be completed.'; }
  catch {status.textContent='The browser controls are unavailable. Close this window and reopen it from Mother.';}
}
function openAddress(){
  let value=address.value.trim();
  if(value && !/^[a-z][a-z0-9+.-]*:/i.test(value))value=`https://${value}`;
  go.disabled=true;
  void invoke(()=>browser.navigate(value)).finally(()=>{go.disabled=false;});
}
if(browser){
  go.addEventListener('click',openAddress);
  address.addEventListener('keydown',event=>{if(event.key==='Enter')openAddress();if(event.key==='Escape'){address.value=currentUrl;address.blur();}});
  back.addEventListener('click',()=>void invoke(()=>browser.back()));
  forward.addEventListener('click',()=>void invoke(()=>browser.forward()));
  document.getElementById('reload').addEventListener('click',()=>void invoke(()=>browser.reload()));
  document.getElementById('close').addEventListener('click',()=>void invoke(()=>browser.close()));
  browser.onStatus(render);
  browser.getStatus().then(render).catch(()=>{status.textContent='Private browser controls could not connect.';});
}else{
  for(const control of document.querySelectorAll('button,input'))control.disabled=true;
  status.textContent='Open this private browser from the Mother desktop app.';
}
