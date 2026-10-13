import test from 'node:test';
import assert from 'node:assert/strict';
import {syncChatGPT, listChatGPTConversations} from '../providers/chatgpt.js';
import {syncClaude} from '../providers/claude.js';
import {sleep} from '../lib/common.js';

test('personal collection checkpoints bounded runs and resumes without re-fetching accepted chats', async () => {
  const fetchBefore = globalThis.fetch;
  const ids = ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
  const fetched=[];
  globalThis.fetch=async url=>{
    let payload;
    if (url.endsWith('/api/auth/session')) payload={accessToken:'synthetic-browser-token'};
    else if (url.includes('/accounts/check')) payload={accounts:{personal:{account:{account_id:'personal-id',structure:'personal'}},
      team:{account:{account_id:'team-id',structure:'workspace'}}}};
    else if (url.includes('/conversations?')) payload={items:ids.slice(Number(new URL(url).searchParams.get('offset'))).map(id=>({id,update_time:1700000000})),total:2};
    else {
      const id=url.split('/').at(-1); fetched.push(id);
      payload={title:'Synthetic chat',create_time:1700000000,update_time:1700000000,current_node:'reply',
        mapping:{question:{id:'question',parent:null,message:{author:{role:'user'},create_time:1700000000,content:{content_type:'text',parts:['Hi']}}},
          hidden:{id:'hidden',parent:'question',message:{author:{role:'user'},metadata:{is_visually_hidden_from_conversation:true},content:{content_type:'text',parts:['hidden setup']}}},
          analysis:{id:'analysis',parent:'hidden',message:{author:{role:'assistant'},channel:'analysis',content:{content_type:'text',parts:['hidden analysis']}}},
          toolcall:{id:'toolcall',parent:'analysis',message:{author:{role:'assistant'},recipient:'python',content:{content_type:'code',text:'tool input'}}},
          reply:{id:'reply',parent:'toolcall',message:{author:{role:'assistant'},create_time:1700000001,content:{content_type:'text',parts:['Hello']}}}}};
    }
    return {ok:true,status:200,json:async()=>payload};
  };
  try {
    const pushed=[];
    const push=async(source,_adapter,rows)=>{assert.equal(source,'chatgpt-web');
      for (const row of rows) assert.deepEqual(row.messages.map(message=>message.content),['Hi','Hello']);
      pushed.push(...rows.map(row=>row.externalId));return rows.length;};
    let result=await syncChatGPT({state:{},push,log:()=>{},maxConversations:1,preferences:{chats:'all'}});
    assert.equal(result.hasMore,true);
    assert.equal(Object.values(result.state.accounts)[0].lastSyncMs,null);
    result=await syncChatGPT({state:result.state,push,log:()=>{},maxConversations:1,preferences:{chats:'all'}});
    assert.equal(result.hasMore,undefined);
    assert.deepEqual(fetched,ids);
    assert.deepEqual(pushed,ids);
  } finally {globalThis.fetch=fetchBefore;}
});

for (const source of ['chatgpt', 'claude']) test(`${source} selected sync bypasses catalogs and completes the final bounded batch`, async t => {
  const old = globalThis.fetch, requests = [], accountId = 'aaaaaaaa-0000-4000-8000-000000000001';
  t.after(() => {globalThis.fetch = old;});
  const selected = [1, 2].map(n => ({accountId, id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0')}));
  globalThis.fetch = async value => {
    const url = new URL(value); let data;
    if (url.pathname.endsWith('/api/auth/session')) data = {accessToken: 'synthetic'};
    else if (url.pathname.includes('/accounts/check')) data = {accounts: {p: {account: {account_id: accountId, structure: 'personal'}}}};
    else if (url.pathname === '/api/organizations') data = [{uuid: accountId}];
    else {
      assert.ok(selected.some(row => url.pathname.endsWith('/' + row.id)), 'must request a selected detail, never the catalog');
      requests.push(url.pathname);
      data = source === 'chatgpt' ? {current_node: 'n', mapping: {n: {message: {author: {role: 'user'}, content: {content_type: 'text', parts: ['fixture']}}}}}
        : {chat_messages: [{sender: 'human', text: 'fixture'}]};
    }
    return {ok: true, status: 200, json: async () => data};
  };
  const collector = source === 'chatgpt' ? syncChatGPT : syncClaude;
  const options = {preferences: {selected}, maxConversations: 1, push: async (_s, _a, rows) => rows.length};
  const first = await collector(options);
  assert.equal(first.hasMore, true); assert.equal(first.conversations, 1);
  const second = await collector({...options, state: first.state});
  assert.equal(second.hasMore, false); assert.equal(second.conversations, 1);
  assert.equal(first.inspected + second.inspected, 0); assert.equal(new Set(requests).size, 2);
  await collector({...options, state: second.state});
  assert.equal(requests[0], requests[2], 'next run refetches source changes');
});

test('revocation cancels pacing without waiting for the timer',async()=>{
  const controller=new AbortController();
  const waiting=sleep(60000,controller.signal);
  controller.abort();
  await assert.rejects(waiting,{name:'AbortError'});
});

test('revocation aborts a collector before it dispatches another conversation',async()=>{
  const before=globalThis.fetch;
  globalThis.fetch=async(_url,init)=>{init.signal.throwIfAborted();return {ok:true,status:200,json:async()=>({})};};
  const controller=new AbortController();controller.abort();
  try {await assert.rejects(syncChatGPT({state:{},push:async()=>assert.fail('dispatch after revoke'),
    signal:controller.signal,log:()=>{},preferences:{chats:'all'}}));}
  finally {globalThis.fetch=before;}
});

test('selected mode never fetches bodies for other chats or another account',async()=>{
  const before=globalThis.fetch;
  const selectedId='00000000-0000-4000-8000-000000000002';
  const otherId='00000000-0000-4000-8000-000000000001';
  const details=[];
  globalThis.fetch=async(url,init)=>{
    let data;
    if(url.endsWith('/api/auth/session'))data={accessToken:'synthetic'};
    else if(url.includes('/accounts/check'))data={accounts:{p:{account:{account_id:'personal-id',structure:'personal'}},
      w:{account:{account_id:'workspace-id',structure:'workspace'}},unknown:{account:{account_id:'unknown-id'}}}};
    else if(url.includes('/conversations?'))data={items:[{id:otherId,update_time:1700000000},{id:selectedId,update_time:1700000000}],total:2};
    else {details.push(url.split('/').at(-1));data={current_node:'n',create_time:1700000000,mapping:{n:{message:{author:{role:'user'},content:{content_type:'text',parts:['chosen']}}}}};}
    return {ok:true,status:200,json:async()=>data};
  };
  try {
    let result=await syncChatGPT({state:{},preferences:{selected:[{accountId:'another-account',id:otherId},{accountId:'personal-id',id:selectedId}]},
      push:async(_source,_adapter,rows)=>rows.length,log:()=>{}});
    assert.equal(result.conversations,1);assert.equal(result.failures,1);assert.deepEqual(details,[selectedId]);
    const page=await listChatGPTConversations();
    assert.deepEqual(page.items.map(row=>row.id),[otherId,selectedId]);
    assert.deepEqual(details,[selectedId]);assert.equal(page.nextCursor,null);
  } finally {globalThis.fetch=before;}
});

test('fresh selected-only defaults perform no ChatGPT requests',async()=>{
  const before=globalThis.fetch;
  globalThis.fetch=async()=>assert.fail('request without selected chats');
  try {assert.deepEqual(await syncChatGPT({state:{},push:async()=>assert.fail('import'),log:()=>{}}),{state:{},conversations:0});}
  finally {globalThis.fetch=before;}
});


test('ChatGPT all-chat sync scans past a full page without a total', async t => {
  const before = globalThis.fetch, offsets = [];
  t.after(() => {globalThis.fetch = before;});
  const accountId = 'personal-id', id = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
  globalThis.fetch = async value => {
    const url = new URL(value); let data;
    if (url.pathname.endsWith('/api/auth/session')) data = {accessToken: 'synthetic'};
    else if (url.pathname.includes('/accounts/check')) data = {accounts: {p: {account: {account_id: accountId, structure: 'personal'}}}};
    else if (url.pathname.endsWith('/conversations')) {
      const offset = Number(url.searchParams.get('offset')); offsets.push(offset);
      data = {items: Array.from({length: offset === 0 ? 50 : 1}, (_, i) => ({id: offset === 0 ? 'invalid' : id(offset + i + 1), update_time: 1700000000}))};
    } else {
      assert.ok(url.pathname.endsWith(id(51)));
      data = {current_node: 'n', mapping: {n: {message: {author: {role: 'user'}, content: {content_type: 'text', parts: ['fixture']}}}}};
    }
    return {ok: true, status: 200, json: async () => data};
  };
  const result = await syncChatGPT({state: {}, preferences: {chats: 'all'},
    push: async (_source, _adapter, chats) => chats.length, log: () => {}});
  assert.deepEqual(offsets, [0, 50]);
  assert.equal(result.conversations, 1);
  assert.equal(result.inspected, 51);
});
