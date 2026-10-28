import {test} from 'node:test';
import assert from 'node:assert/strict';
import {streamReply} from './chat-stream.js';
const encoder=new TextEncoder();
const payload={model:'qwen3:4b',messages:[{role:'user',content:'Hi'}]};
function stream(frames,{split=3,cancel=()=>{}}={}) {
  const bytes=encoder.encode(frames.map(frame=>typeof frame==='string'?frame:JSON.stringify(frame)).join('\n'));
  return new Response(new ReadableStream({start(controller){for(let at=0;at<bytes.length;at+=split)controller.enqueue(bytes.slice(at,at+split));controller.close();},cancel}));
}
test('chat stream emits deltas incrementally and accepts only an exact completed answer',async()=>{
  const seen=[];let request;
  const expected={message:{role:'assistant',content:'Café, hello.'},engine:'ollama',neural:true};
  const result=await streamReply({payload,onChunk:(delta,text)=>seen.push([delta,text]),fetchImpl:async(url,options)=>{request={url,options};return stream([{type:'delta',text:'Café, '},{type:'delta',text:'hello.'},{type:'done',result:expected}],{split:1});}});
  assert.deepEqual(seen,[['Café, ','Café, '],['hello.','Café, hello.']]);assert.deepEqual(result,expected);
  assert.equal(request.url,'/api/chat/stream');assert.deepEqual(JSON.parse(request.options.body),payload);
});
test('chat stream rejects truncated, malformed, mismatched and server-error responses',async()=>{
  for(const frames of [
    [{type:'delta',text:'Only part'}],
    ['{bad'],
    [{type:'error',error:'The model stopped.'}],
    [{type:'delta',text:'Partial'},{type:'done',result:{message:{content:'Something else'}}}],
    [{type:'other'}],
    [{type:'delta',text:'x'.repeat(64001)}],
  ])await assert.rejects(streamReply({payload,fetchImpl:async()=>stream(frames)}));
});
test('HTTP model setup errors are surfaced before reading a stream',async()=>{
  await assert.rejects(streamReply({payload,fetchImpl:async()=>Response.json({error:'Select a model.'},{status:503})}),/Select a model/);
});
test('cancelling a streamed turn closes its reader and never returns a partial success',async()=>{
  const controller=new AbortController();let cancelled=false;
  const fetchImpl=async()=>new Response(new ReadableStream({start(stream){stream.enqueue(encoder.encode(JSON.stringify({type:'delta',text:'Hello.'})+'\n'));},cancel(){cancelled=true;}}));
  await assert.rejects(streamReply({payload,signal:controller.signal,fetchImpl,onChunk:()=>controller.abort()}),{name:'AbortError'});
  assert.equal(cancelled,true);
});
