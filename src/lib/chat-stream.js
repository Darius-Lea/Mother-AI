/** Read only the local, same-origin chat stream. A partial answer is never a completed turn. */
export async function streamReply({payload,signal,onChunk=()=>{},fetchImpl=globalThis.fetch}={}) {
  signal?.throwIfAborted();
  const response=await fetchImpl('/api/chat/stream',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/x-ndjson'},body:JSON.stringify(payload),signal});
  if(!response.ok){let body;try{body=await response.json();}catch{}throw Error(body?.error||'The local model could not respond. Check Connections and try again.');}
  if(!response.body?.getReader)throw Error('This browser cannot read Mother’s live response. Try the desktop app or an updated browser.');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer='',content='',result,total=0;
  async function frame(line) {
    if(!line.trim())return;
    if(line.length>1024*1024)throw Error('The response stream message was too large.');
    let data;
    try{data=JSON.parse(line);}catch{throw Error('Mother received an invalid response stream. Please retry.');}
    if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Mother received an invalid response stream. Please retry.');
    if(data.type==='error')throw Error(typeof data.error==='string'?data.error.slice(0,1000):'The model could not finish its response.');
    if(data.type==='delta') {
      if(typeof data.text!=='string'||content.length+data.text.length>64000)throw Error('The response text was invalid or too long.');
      content+=data.text;await onChunk(data.text,content);
    } else if(data.type==='done') {
      if(typeof data.result?.message?.content!=='string'||data.result.message.content!==content||!content.trim())throw Error('The response ended with incomplete text. Please retry.');
      result=data.result;
    } else throw Error('Mother received an unknown response stream message. Please retry.');
  }
  try {
    while(!result) {
      signal?.throwIfAborted();
      const next=await reader.read();
      if(next.done){buffer+=decoder.decode();if(buffer.trim())await frame(buffer);break;}
      total+=next.value.byteLength;
      if(total>16*1024*1024)throw Error('The response stream was too large.');
      buffer+=decoder.decode(next.value,{stream:true});
      let end;
      while(!result&&(end=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);await frame(line);}
      if(buffer.length>1024*1024)throw Error('The response stream message was too large.');
    }
    signal?.throwIfAborted();
    if(!result)throw Error('Mother’s response was interrupted before it finished. Please retry.');
    return result;
  } finally {try{await reader.cancel();}catch{}reader.releaseLock();}
}
