import https from 'node:https';
import {Readable} from 'node:stream';

const agent=new https.Agent({keepAlive:false,proxyEnv:process.env});
const HOSTS=new Set(['github.com','release-assets.githubusercontent.com']);

/** Fixed official download hosts only. Callers validate paths, redirects and
 * content digests; this transport honors managed HTTPS proxies and normal TLS. */
export function fetchOfficialAsset(value,{signal}={}){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!HOSTS.has(url.hostname))throw Error('Unapproved official asset host.');
  return new Promise((resolve,reject)=>{
    const request=https.get(url,{signal,agent,headers:{Accept:'application/octet-stream'}},response=>{
      const headers=new Headers();
      for(const [name,value]of Object.entries(response.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value);
      const status=response.statusCode;
      resolve(new Response([204,205,304].includes(status)?null:Readable.toWeb(response),{status,headers}));
    });
    request.on('error',reject);
  });
}
