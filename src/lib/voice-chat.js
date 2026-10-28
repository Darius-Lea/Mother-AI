/** A hands-free turn owns the microphone until a final transcript arrives.
 * submitTurn must resolve after playback, so Mother's voice is never recorded.
 * A recognizerFactory receives {onResult(text), onPartial(text), onEnd(),
 * onError(error)} and returns {start(), stop(), dispose?()} (possibly async).
 */
export function createVoiceConversation({recognizerFactory, submitTurn, onTranscript=()=>{}, onState=()=>{}, onError=()=>{}}={}) {
  if(typeof recognizerFactory!=='function'||typeof submitTurn!=='function')throw Error('Voice conversation needs a recognizer and reply handler.');
  let status={enabled:false,state:'off',transcript:'',error:null};
  let epoch=0,recognizer,turn,activeReply,disposed=false;
  const publish=next=>{status={...status,...next};if(!disposed)onState({...status});};
  const release=async value=>{if(!value)return;try{await value.stop();}catch{}try{await value.dispose?.();}catch{}};
  async function fail(error,token) {
    if(token!==epoch||disposed)return;
    epoch++;const previous=recognizer;recognizer=null;turn?.abort();turn=null;
    const message=error?.message||'The microphone could not start. Check microphone permission and try again.';
    publish({enabled:false,state:'error',error:message});onError(Error(message));await release(previous);
  }
  async function listen() {
    if(!status.enabled||disposed)return;
    const token=++epoch;let completed=false;
    publish({state:'starting',transcript:'',error:null});
    try {
      const next=await recognizerFactory({
        onPartial:text=>{if(token!==epoch||completed||disposed)return;publish({transcript:String(text||'')});onTranscript(String(text||''),false);},
        onResult:text=>{
          if(token!==epoch||completed||disposed||!String(text||'').trim())return;
          completed=true;const work=reply(String(text).trim(),token);activeReply=work;
          void work.finally(()=>{if(activeReply===work)activeReply=null;});
        },
        onEnd:()=>{if(token===epoch&&!completed&&!disposed)void fail(Error('The microphone stopped. Click Start voice chat to reconnect.'),token);},
        onError:error=>{if(token===epoch&&!completed)void fail(error,token);},
      });
      if(token!==epoch||!status.enabled||disposed){await release(next);return;}
      recognizer=next;await next.start();
      if(token===epoch&&status.enabled&&!completed&&!disposed)publish({state:'listening'});
    } catch(error){await fail(error,token);}
  }
  async function reply(text,token) {
    if(token!==epoch)return;
    const nextToken=++epoch;const previous=recognizer;recognizer=null;
    const operation=new AbortController();turn=operation;
    publish({state:'thinking',transcript:text});onTranscript(text,true);
    await release(previous);
    if(nextToken!==epoch||operation.signal.aborted||disposed)return;
    try {await submitTurn({text,signal:operation.signal});}
    catch(error){if(!operation.signal.aborted){await fail(error,nextToken);return;}}
    finally{if(turn===operation)turn=null;}
    if(nextToken===epoch&&status.enabled&&!disposed)await listen();
  }
  async function stop() {
    epoch++;const previous=recognizer;recognizer=null;turn?.abort();turn=null;
    publish({enabled:false,state:'off',transcript:'',error:null});await release(previous);
  }
  return {
    getStatus:()=>({...status}),
    async start(){if(disposed)throw Error('This voice conversation is closed.');if(status.enabled)return;const token=++epoch;publish({enabled:true,state:'starting',error:null});await activeReply;if(token===epoch&&status.enabled&&!disposed)await listen();},
    stop,
    async interrupt(){if(disposed)return;epoch++;const token=epoch;const previousReply=activeReply;turn?.abort();turn=null;const previous=recognizer;recognizer=null;publish({enabled:true,state:'starting',transcript:'',error:null});await release(previous);await previousReply;if(token===epoch&&status.enabled&&!disposed)await listen();},
    async dispose(){await stop();disposed=true;},
  };
}
