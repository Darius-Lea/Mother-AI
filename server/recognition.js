import express from 'express';
import https from 'node:https';
import {Readable} from 'node:stream';
import path from 'node:path';
import {createVoiceAssetStore} from './voice.js';

// Official Vosk-Browser demo model, pinned to an immutable upstream commit.
export const RECOGNITION_MODEL=Object.freeze({
  filename:'vosk-model-small-en-us-0.15.tar.gz',
  url:'https://raw.githubusercontent.com/ccoreilly/vosk-browser/a4b0d0fe60359e5ea9800f810f6b6f6c1d2b03c6/models/vosk-model-small-en-us-0.15.tar.gz',
  bytes:41184862,
  sha256:'f0b24bb92a48ca575b6a96500d6b543f0f079c573dfe85bbe16001fc0404e1d8',
  license:'Apache-2.0',
});
const agent=new https.Agent({keepAlive:false,proxyEnv:process.env});
function fetchModel(value,{signal}={}) {
  if(value!==RECOGNITION_MODEL.url)throw Error('Unknown speech-input asset.');
  return new Promise((resolve,reject)=>{
    const request=https.get(value,{signal,agent,headers:{Accept:'application/octet-stream'}},response=>{
      const headers=new Headers();for(const [name,value]of Object.entries(response.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value);
      resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers}));
    });request.on('error',reject);
  });
}
export function createRecognitionRouter({directory,fetchImpl=fetchModel}={}) {
  const store=createVoiceAssetStore({directory,fetchImpl,asset:RECOGNITION_MODEL});
  const router=express.Router();
  router.get('/status',(_req,res)=>{res.set('Cache-Control','no-store');res.json({...store.status(),model:'Vosk small English',version:'0.15',assetUrl:'/api/recognition/model.tar.gz'});});
  router.get('/model.tar.gz',async(_req,res)=>{
    try {const filename=await store.ensure();res.set('Content-Type','application/gzip');res.set('Cache-Control','private, max-age=86400');res.set('ETag',`"${RECOGNITION_MODEL.sha256}"`);res.sendFile(path.basename(filename),{root:path.dirname(filename),dotfiles:'deny'});}
    catch{res.status(503).json({error:'Mother could not download her free speech-input model. Check your connection and try again.'});}
  });
  router.all('/{*path}',(_req,res)=>res.status(404).json({error:'Unknown speech-input resource.'}));
  router.shutdown=()=>store.shutdown();return router;
}
