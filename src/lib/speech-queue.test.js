import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechQueue} from './speech-queue.js';
test('a complete streamed sentence is spoken without waiting for another token',async()=>{
  const queue=createSpeechQueue();
  queue.push('I can hear you clearly. ');
  const first=await queue.next();
  assert.equal(first.value,'I can hear you clearly.');queue.end();
});
test('first sentence is available before full answer and fenced code is never narrated',async()=>{
  const queue=createSpeechQueue();const next=queue.next();
  queue.push('Hello, I am Mother. More words are coming');
  assert.equal((await next).value,'Hello, I am Mother.');
  for(const delta of ['. ``','`js\nsecret();\n`','`` Next sentence.'])queue.push(delta);
  queue.end();let rest='';for await(const part of queue)rest+=part;
  assert.doesNotMatch(rest,/secret|```/);assert.match(rest,/Next sentence/);
});
test('aborting releases the waiting speech consumer and discards pending words',async()=>{
  const controller=new AbortController();const queue=createSpeechQueue({signal:controller.signal});
  const waiting=queue.next();controller.abort();await assert.rejects(waiting,{name:'AbortError'});
});
test('long replies keep spoken output bounded',async()=>{
  const queue=createSpeechQueue({maxCharacters:200});queue.push('A long response. '.repeat(200));queue.end();
  const parts=[];for await(const part of queue)parts.push(part);
  assert.ok(parts.join('').length<=200);assert.ok(parts.every(part=>part.length<=150));
});
