import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePairing, toWireConversation, createClient, collect, PROTOCOL} from '../protocol.js';
import {snapshotKey} from '../preferences.js';
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
  assert.deepEqual(toWireConversation(conversation),{source:'chatgpt',id:conversation.externalId,accountId:'personal',title:'Reina',
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
  assert.deepEqual(result,{connectionId:'new',filterKey:snapshotKey({}),targetName:'Reina',state:{fresh:true},count:1,hasMore:false});
});
test('same scope resumes; a failed import never returns an advanced watermark',async()=>{
  await collect({pairing,saved:{connectionId:'same',filterKey:snapshotKey({}),state:{marker:7}},fetcher:async()=>ok({connectionId:'same'}),
    collector:async options=>{assert.deepEqual(options.state,{marker:7});return {state:{marker:8},conversations:0};}});
  await assert.rejects(collect({pairing,fetcher:async()=>ok({connectionId:'same'}),collector:async()=>{throw new Error('offline');}}));
});

test('history filters apply to visible messages and keep receiver indices sequential', () => {
  const source={...conversation,messages:Array.from({length:120},(_,i)=>({role:i%2?'assistant':'user',content:'Message '+i,
    createdAt:Date.parse('2026-10-01T00:00:00Z')+i*86400000}))};
  const limited=toWireConversation(source,{history:'last100'}).messages;
  assert.equal(limited.length,100);assert.equal(limited[0].text,'Message 20');
  assert.deepEqual(limited.map(row=>row.index),Array.from({length:100},(_,i)=>i));
  const dated=toWireConversation(source,{history:'since',sinceDate:'2026-10-03'}).messages;
  assert.equal(dated[0].text,'Message 2');assert.equal(dated[0].index,0);
  assert.equal(dated.length,118);
});

test('changed chat or history filters reset a watermark; schedule changes preserve it',async()=>{
  const old={chats:'all',history:'all',schedule:'auto'};
  for (const [preferences,expected] of [[{...old,history:'last100'},{}],[{...old,schedule:'manual'},{marker:7}]]) {
    await collect({pairing,preferences,saved:{connectionId:'same',filterKey:snapshotKey(old),state:{marker:7}},
      fetcher:async()=>ok({connectionId:'same'}),collector:async options=>{
        assert.deepEqual(options.state,expected);return {state:{},conversations:0};
      }});
  }
});

test('a chat with no eligible text sends no import or deletion request',async()=>{
  let requests=0;
  const client=createClient(pairing,async()=>{requests++;return ok({accepted:true});},undefined,async()=>{},
    {history:'since',sinceDate:'2099-01-01'});
  assert.equal(await client.push('chatgpt-web','chatgpt-web',[conversation]),0);
  assert.equal(requests,0);
});
