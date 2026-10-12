import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePairing, toWireConversation, createClient, collect, PROTOCOL} from '../protocol.js';
const pairing = {v:1,port:41771,token:'a'.repeat(64)};
const code = value => 'ocl1.' + Buffer.from(JSON.stringify(value)).toString('base64url');
const conversation = {externalId:'00000000-0000-4000-8000-000000000001',title:'Reina',createdAt:1700000000000,
  messages:[{role:'system',content:'setup'},{role:'user',content:'こんにちは',createdAt:1700000000123},
            {role:'assistant',content:'Hello'},{role:'tool',content:'tool'}]};
const ok = body => ({ok:true,status:200,json:async()=>({protocol:PROTOCOL,...body})});
test('pairing permits only bounded loopback credentials', () => {
  assert.deepEqual(parsePairing(code(pairing)),pairing);
  for (const invalid of ['',code({...pairing,url:'https://elsewhere'}),code({...pairing,port:80}),code({...pairing,token:'bad'})]) {
    assert.throws(()=>parsePairing(invalid));
  }
});
test('wire keeps text and time but omits system, tools, attachments, and browser credentials', () => {
  assert.deepEqual(toWireConversation(conversation),{id:conversation.externalId,accountId:'personal',title:'Reina',
    updatedAt:1700000000000,messages:[{index:0,role:'user',text:'こんにちは',createdAt:1700000000123},
                                  {index:1,role:'assistant',text:'Hello',createdAt:1700000000000}]});
});
test('push uses only the paired loopback endpoint and fails conflicts',async()=>{
  const calls=[];
  const client=createClient(pairing,async(url,init)=>{calls.push({url,init});return ok({accepted:true});});
  assert.equal(await client.push('chatgpt-web','chatgpt-web',[conversation]),1);
  assert.equal(calls[0].url,'http://127.0.0.1:41771/openchatlink/v1/ingest');
  assert.equal(calls[0].init.credentials,'omit');
  assert.equal(calls[0].init.headers.Authorization,'Bearer '+pairing.token);
  await assert.rejects(createClient(pairing,async()=>ok({conflict:true})).push('chatgpt-web','chatgpt-web',[conversation]));
});
test('a new app scope or avatar resets collection watermark',async()=>{
  let received;
  const collector=async options=>{received=options;return {state:{fresh:true},conversations:1};};
  const result=await collect({pairing,saved:{connectionId:'old',state:{old:true}},collector,
                            fetcher:async()=>ok({connectionId:'new',targetName:'Reina'})});
  assert.deepEqual(received.state,{});
  assert.equal(received.personalOnly,true);
  assert.deepEqual(result,{connectionId:'new',targetName:'Reina',state:{fresh:true},count:1,hasMore:false});
});
test('same scope resumes; a failed import never returns an advanced watermark',async()=>{
  await collect({pairing,saved:{connectionId:'same',state:{marker:7}},fetcher:async()=>ok({connectionId:'same'}),
    collector:async options=>{assert.deepEqual(options.state,{marker:7});return {state:{marker:8},conversations:0};}});
  await assert.rejects(collect({pairing,fetcher:async()=>ok({connectionId:'same'}),collector:async()=>{throw new Error('offline');}}));
});
