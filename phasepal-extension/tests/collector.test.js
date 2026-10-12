import test from 'node:test';
import assert from 'node:assert/strict';
import {syncChatGPT} from '../providers/chatgpt.js';
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
    else if (url.includes('/conversations?')) payload={items:ids.map(id=>({id,update_time:1700000000})),total:2};
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
    let result=await syncChatGPT({state:{},push,log:()=>{},maxConversations:1});
    assert.equal(result.hasMore,true);
    assert.equal(Object.values(result.state.accounts)[0].lastSyncMs,null);
    result=await syncChatGPT({state:result.state,push,log:()=>{},maxConversations:1});
    assert.equal(result.hasMore,true);
    result=await syncChatGPT({state:result.state,push,log:()=>{},maxConversations:1});
    assert.equal(result.hasMore,undefined);
    assert.deepEqual(fetched,ids);
    assert.deepEqual(pushed,ids);
  } finally {globalThis.fetch=fetchBefore;}
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
    signal:controller.signal,log:()=>{}}));}
  finally {globalThis.fetch=before;}
});
