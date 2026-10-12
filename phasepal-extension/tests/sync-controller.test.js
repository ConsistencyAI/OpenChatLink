import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncController, ALARM, CONTINUE} from '../sync-controller.js';
import {PROTOCOL} from '../protocol.js';

const pairing={v:1,port:41771,token:'a'.repeat(64)};
const code='ocl1.'+Buffer.from(JSON.stringify(pairing)).toString('base64url');
function fakeApi(initial={}) {
  const state=structuredClone(initial), alarms=new Map();
  return {state,alarms,action:{setBadgeText:async()=>{}},
    storage:{local:{
      get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(state[key])])),
      set:async values=>Object.assign(state,structuredClone(values)),
      remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete state[key];},
    }},
    alarmsApi:{create:async(name,options)=>alarms.set(name,options),clear:async name=>alarms.delete(name)},
  };
}
function setup(initial,collector) {
  const api=fakeApi(initial);
  const controller=createSyncController({...api,alarms:api.alarmsApi},{collector,
    fetcher:async()=>({ok:true,status:200,json:async()=>({protocol:PROTOCOL,connectionId:'scope',targetName:'Reina'})})});
  return {api,controller};
}

test('manual mode survives restart and ignores automatic and stale continuation alarms',async()=>{
  let calls=0;
  const {api,controller}=setup({code,preferences:{chats:'all',schedule:'manual'}},async()=>{calls++;return {state:{},conversations:1};});
  await controller.ready;
  await controller.alarm(ALARM);await controller.alarm(CONTINUE);
  assert.equal(calls,0);assert.equal(api.alarms.size,0);
  await controller.sync();assert.equal(calls,1);assert.equal(api.state.batchPending,false);
  await controller.alarm(ALARM);assert.equal(calls,1);
});

test('a manual multi-batch import resumes after worker restart and stops when complete',async()=>{
  let calls=0;
  const collector=async()=>({state:{checkpoint:++calls},conversations:1,hasMore:calls===1});
  const first=setup({code,preferences:{chats:'all',schedule:'manual'}},collector);
  await first.controller.sync();
  assert.equal(first.api.alarms.has(ALARM),false);assert.equal(first.api.alarms.has(CONTINUE),true);
  const restarted=setup(first.api.state,collector);
  await restarted.controller.ready;await restarted.controller.alarm(CONTINUE);
  assert.equal(calls,2);assert.equal(restarted.api.alarms.size,0);
  await restarted.controller.alarm(CONTINUE);assert.equal(calls,2);
});

test('connecting with selected-only defaults imports nothing until choices are saved',async()=>{
  let calls=0;
  const {api,controller}=setup({},async()=>{calls++;return {state:{},conversations:0};});
  await controller.connect(code);await controller.alarm(ALARM);
  assert.equal(calls,0);assert.equal(api.alarms.size,0);
  await controller.save({chats:'all',schedule:'auto'});await controller.sync();
  assert.equal(calls,1);assert.equal(api.alarms.has(ALARM),true);
  await controller.save({chats:'all',schedule:'manual'});
  assert.equal(api.alarms.has(ALARM),false);
});

test('changing filters aborts a pending import without publishing its stale checkpoint',async()=>{
  let started;
  const entering=new Promise(resolve=>{started=resolve;});
  const {api,controller}=setup({code,preferences:{chats:'all',schedule:'manual'}},async({signal})=>{
    started();
    await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
    return {state:{stale:true},conversations:1,hasMore:true};
  });
  const syncing=controller.sync();await entering;
  await controller.save({chats:'selected',schedule:'manual'});await syncing;
  assert.equal(api.state.saved,undefined);assert.equal(api.state.batchPending,false);assert.equal(api.alarms.size,0);
});

test('disconnect retains user choices but clears pairing, checkpoints, and alarms',async()=>{
  const preferences={chats:'all',schedule:'manual'};
  const {api,controller}=setup({code,preferences,saved:{marker:1},batchPending:true},async()=>assert.fail('sync after disconnect'));
  await controller.disconnect();await controller.alarm(CONTINUE);
  assert.equal(api.state.code,undefined);assert.equal(api.state.saved,undefined);
  assert.deepEqual(api.state.preferences,preferences);assert.equal(api.alarms.size,0);
});

test('a partial manual import reports failure and requires an explicit retry',async()=>{
  let calls=0;
  const {api,controller}=setup({code,preferences:{chats:'all',schedule:'manual'}},async()=>{
    calls++;return {state:{retry:1},conversations:0,failures:1};
  });
  await controller.sync();
  assert.match(api.state.status.message,/Select Sync now to retry/);
  assert.equal(api.state.status.lastSuccess,undefined);assert.equal(api.alarms.size,0);
  await controller.alarm(ALARM);assert.equal(calls,1);
});
