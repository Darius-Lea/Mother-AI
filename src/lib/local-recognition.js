export const RECOGNITION_BYTES=41184862;
export const RECOGNITION_SHA256='f0b24bb92a48ca575b6a96500d6b543f0f079c573dfe85bbe16001fc0404e1d8';
const CONSENT_KEY='mother-local-speech-input-v1';
export function hasRecognitionConsent(){try{return globalThis.localStorage?.getItem(CONSENT_KEY)==='approved';}catch{return false;}}

function microphoneError(error) {
  if(['NotAllowedError','PermissionDeniedError','SecurityError'].includes(error?.name))return Error('Microphone permission was not granted. Allow microphone access in your device or browser settings, then click Start voice chat.');
  if(['NotFoundError','DevicesNotFoundError'].includes(error?.name))return Error('No microphone was found. Connect a microphone and try again.');
  if(['NotReadableError','TrackStartError'].includes(error?.name))return Error('The microphone is busy or unavailable. Close other apps using it and try again.');
  return Error(error?.message||'The microphone could not start. Check microphone access and try again.');
}

/** English recognition runs in a bundled WASM worker. Audio never leaves this
 * device. Only the fixed 41 MB model is downloaded after explicit consent.
 */
export function createLocalRecognizer({onState=()=>{},fetchImpl=globalThis.fetch,
  loadVosk=()=>import('virtual:mother-vosk'),mediaDevices=globalThis.navigator?.mediaDevices,
  audioContextFactory=()=>new (globalThis.AudioContext||globalThis.webkitAudioContext)(),
  cryptoImpl=globalThis.crypto,cacheStorage=globalThis.caches,
}={}) {
  let model,loadingModel,preparation,controller,disposed=false;
  const sessions=new Set();
  let status={state:'idle',progress:0,downloaded:0,total:RECOGNITION_BYTES,error:null};
  const update=next=>{status={...status,...next};if(!disposed)onState({...status});};
  async function verifiedBytes(response) {
    if(!response?.ok||!response.body)throw Error('The free speech-input download is unavailable. Check your connection and try again.');
    const reader=response.body.getReader(),chunks=[];let length=0;
    try {
      while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>RECOGNITION_BYTES)throw Error('Speech-input download exceeded its expected size.');chunks.push(value);update({state:'downloading',downloaded:length,progress:Math.min(.99,length/RECOGNITION_BYTES)});}
    }catch(error){await reader.cancel().catch(()=>{});throw error;}
    if(length!==RECOGNITION_BYTES)throw Error('Speech-input download was incomplete. Please retry.');
    update({state:'verifying',progress:1});
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const digest=[...new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
    if(digest!==RECOGNITION_SHA256)throw Error('Speech-input integrity check failed. Please retry the download.');
    return bytes;
  }
  return {
    getStatus:()=>({...status}),
    async prepare({consent=false}={}) {
      if(disposed)throw Error('This microphone session is closed.');
      if(!consent)throw Error('Approve the free 41 MB English speech-input download before starting voice chat.');
      try{globalThis.localStorage?.setItem(CONSENT_KEY,'approved');}catch{}
      if(model?.ready)return {...status};
      if(!preparation)preparation=(async()=>{
        controller=new AbortController();
        try {
          update({state:'loading',error:null});
          let cache,cached,bytes;try{cache=await cacheStorage?.open('mother-recognition-model-v1');cached=await cache?.match('/api/recognition/model.tar.gz');}catch{}
          if(cached){try{bytes=await verifiedBytes(cached);}catch{await cache?.delete('/api/recognition/model.tar.gz');}}
          if(!bytes){const response=await fetchImpl('/api/recognition/model.tar.gz',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(240000)])});bytes=await verifiedBytes(response);try{await cache?.put('/api/recognition/model.tar.gz',new Response(bytes,{headers:{'Content-Type':'application/gzip'}}));}catch{}}
          if(disposed)throw new DOMException('Microphone session closed.','AbortError');
          update({state:'loading',progress:1});
          const Vosk=await loadVosk();
          if(disposed)throw new DOMException('Microphone session closed.','AbortError');
          controller.signal.throwIfAborted();
          // Vosk fetches this fixed same-origin URL itself. The server verifies
          // every cached file before serving; HTTP cache reuses the bytes just
          // checked above. A blob URL would need a broader connect-src policy.
          const modelUrl=new URL('/api/recognition/model.tar.gz',globalThis.location.href).href;
          const next=await new Promise((resolve,reject)=>{
            const candidate=new Vosk.Model(modelUrl,-2);loadingModel=candidate;
            let settled=false;
            const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);controller?.signal.removeEventListener('abort',aborted);if(error){try{candidate.terminate();}catch{}reject(error);}else resolve(candidate);};
            const timer=setTimeout(()=>finish(Error('Loading speech input took too long. Retry voice setup or use a device with more free memory.')),90000);
            const aborted=()=>finish(new DOMException('Speech-input setup cancelled.','AbortError'));
            controller.signal.addEventListener('abort',aborted,{once:true});
            candidate.on('load',message=>finish(message.result?null:Error('The speech-input model could not load. Retry voice setup.')));
            candidate.on('error',()=>finish(Error('The speech-input engine could not start. Retry voice setup.')));
          });loadingModel=null;
          if(disposed){next.terminate();throw new DOMException('Microphone session closed.','AbortError');}
          model=next;update({state:'ready',progress:1,error:null});return {...status};
        }catch(error){update({state:'error',error:error.message});throw error;}
        finally{controller=null;preparation=null;}
      })();
      return preparation;
    },
    async create({onResult=()=>{},onPartial=()=>{},onEnd=()=>{},onError=()=>{}}={}) {
      if(disposed||!model?.ready)throw Error('Download and load the free speech-input model before starting voice chat.');
      let active=false,stream,context,processor,source,mute,recognizer,audioPort;
      const session={
        async start(){
          if(active)return;active=true;
          try {
            if(!mediaDevices?.getUserMedia)throw Error('Microphone access needs a secure HTTPS website or the desktop app.');
            stream=await mediaDevices.getUserMedia({video:false,audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});
            if(!active){stream.getTracks().forEach(track=>track.stop());return;}
            context=audioContextFactory();await context.resume();
            if(!active){await session.stop();return;}
            if(context.state!=='running')throw Error('Audio is paused. Click Start voice chat again to enable the microphone.');
            recognizer=new model.KaldiRecognizer(context.sampleRate);
            recognizer.on('result',message=>{if(active&&message?.result?.text?.trim())onResult(message.result.text.trim());});
            recognizer.on('partialresult',message=>{if(active)onPartial(message?.result?.partial||'');});
            source=context.createMediaStreamSource(stream);mute=context.createGain();mute.gain.value=0;
            if(context.audioWorklet&&globalThis.AudioWorkletNode){
              await context.audioWorklet.addModule(new URL('./recognition-worklet.js?no-inline',import.meta.url));
              if(!active){await session.stop();return;}
              processor=new AudioWorkletNode(context,'mother-speech-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
              const channel=new MessageChannel();audioPort=channel.port1;model.registerPort(audioPort);
              processor.port.postMessage({port:channel.port2,recognizerId:recognizer.id},[channel.port2]);
              processor.onprocessorerror=()=>{if(active)onError(Error('Microphone processing stopped. Restart voice chat.'));};
            }else{
              processor=context.createScriptProcessor(4096,1,1);
              processor.onaudioprocess=event=>{if(active)try{recognizer.acceptWaveform(event.inputBuffer);}catch(error){active=false;onError(error);}};
            }
            source.connect(processor);processor.connect(mute);mute.connect(context.destination);
            for(const track of stream.getAudioTracks())track.onended=()=>{if(active){active=false;onEnd();}};
          }catch(error){await session.stop();throw microphoneError(error);}
        },
        async stop(){active=false;if(processor){processor.onaudioprocess=null;processor.onprocessorerror=null;try{processor.port?.close();}catch{}}try{audioPort?.close();}catch{}audioPort=null;try{source?.disconnect();processor?.disconnect();mute?.disconnect();}catch{}stream?.getTracks().forEach(track=>{track.onended=null;track.stop();});try{recognizer?.remove();}catch{}recognizer=null;try{await context?.close();}catch{}context=null;sessions.delete(session);},
        async dispose(){await session.stop();},
      };
      sessions.add(session);return session;
    },
    async dispose(){disposed=true;controller?.abort();try{loadingModel?.terminate();}catch{}await Promise.all([...sessions].map(session=>session.stop()));model?.terminate();model=null;},
  };
}
