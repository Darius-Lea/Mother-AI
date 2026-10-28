/** A bounded sentence stream: lets speech start while the model is still
 * writing. Fenced code is omitted even when fence markers cross token chunks. */
export function createSpeechQueue({signal,maxCharacters=4000}={}) {
  let raw='',text='',inCode=false,ended=false,failure=null,spoken=0,first=true;
  const parts=[],waiters=[];
  const deliver=()=>{while(waiters.length && (parts.length||ended||failure)){
    const {resolve,reject}=waiters.shift();
    if(failure)reject(failure);else resolve(parts.length?{value:parts.shift(),done:false}:{done:true});
  }};
  function emit(final=false){
    while(text.trim() && spoken<maxCharacters){
      const limit=first?90:150;
      const sentence=text.match(/^([\s\S]{10,}?[.!?]["')]*(?:\s|$))/);
      let cut=sentence && sentence[1].length<=limit?sentence[1].length:0;
      if(!cut && text.length>=limit)cut=Math.max(text.lastIndexOf(' ',limit),text.lastIndexOf('\n',limit),0)||limit;
      if(!cut && final)cut=text.length;
      if(!cut)break;
      const part=text.slice(0,cut).trim().slice(0,maxCharacters-spoken);
      text=text.slice(cut);if(part){parts.push(part);spoken+=part.length;first=false;deliver();}
    }
    if(spoken>=maxCharacters)text='';
  }
  function consume(final=false){
    while(raw.length){
      // Keep only a possible partial code fence. Holding ordinary punctuation
      // here would delay a complete first sentence until another model token.
      if(!final && (raw==='`'||raw==='``'))break;
      if(raw.startsWith('```')){inCode=!inCode;raw=raw.slice(3);if(!inCode)text+=' Code example omitted. ';continue;}
      if(!inCode)text+=raw[0];raw=raw.slice(1);
    }
    emit(final);
  }
  function close(error){ended=true;failure=error||null;if(error){parts.length=0;text='';raw='';}signal?.removeEventListener('abort',abort);deliver();}
  const abort=()=>close(signal.reason||new DOMException('Stopped','AbortError'));
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  return {
    push(delta){if(!ended){raw+=delta;consume();}},
    end(){if(!ended){consume(true);close();}},
    fail(error){close(error);},
    [Symbol.asyncIterator](){return this;},
    next(){if(failure)return Promise.reject(failure);if(parts.length)return Promise.resolve({value:parts.shift(),done:false});if(ended)return Promise.resolve({done:true});return new Promise((resolve,reject)=>waiters.push({resolve,reject}));},
    return(){close();parts.length=0;return Promise.resolve({done:true});},
  };
}
