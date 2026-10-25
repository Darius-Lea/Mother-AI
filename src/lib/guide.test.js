import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localReply,referenceDocuments} from './guide.js';
import {createMemory} from './memory.js';

test('approved corrections are reference memory, uncorrected ratings do not become facts',()=>{
  const memory=createMemory();memory.feedback=[{prompt:'What is my telescope?',response:'wrong',rating:'positive'},{prompt:'What is my telescope?',correction:'My telescope is Meridian, an 80mm refractor.'}];
  assert.equal(referenceDocuments(memory).length,1);
  const reply=localReply('Tell me about my telescope',memory);
  assert.match(reply,/Meridian/);assert.match(reply,/source excerpts, not verified facts/);
});
test('offline guide identifies its limitations and does not pretend to invoke tools',()=>{
  const memory=createMemory();assert.match(localReply('Who are you?',memory),/not a running neural model/);
  assert.match(localReply('Please secure my computer',memory),/does not run network attacks or execute pasted code/);
});
