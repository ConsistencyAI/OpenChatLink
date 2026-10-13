import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncController, createSourceController, ALARM, CONTINUE} from '../sync-controller.js';
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
function setup(initial,collector,feedback=[]) {
  const api=fakeApi(initial);
  const controller=createSyncController({...api,alarms:api.alarmsApi},{collector,
    fetcher:async(url,init)=>{
      if(url.includes('/sync/')) feedback.push({phase:url.split('/').at(-1),...JSON.parse(init.body)});
      return {ok:true,status:200,json:async()=>({protocol:PROTOCOL,connectionId:'scope',targetName:'Reina'})};
    }});
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
  let calls=0; const feedback=[];
  const collector=async()=>({state:{checkpoint:++calls},conversations:1,hasMore:calls===1});
  const first=setup({code,preferences:{chats:'all',schedule:'manual'}},collector,feedback);
  await first.controller.sync();
  assert.equal(first.api.alarms.has(ALARM),false);assert.equal(first.api.alarms.has(CONTINUE),true);
  assert.deepEqual(feedback.map(event=>event.phase),['start','progress']);
  const restarted=setup(first.api.state,collector,feedback);
  await restarted.controller.ready;await restarted.controller.alarm(CONTINUE);
  assert.equal(calls,2);assert.equal(restarted.api.alarms.size,0);
  assert.deepEqual(feedback.map(event=>event.phase),['start','progress','start','finish']);
  assert.equal(new Set(feedback.map(event=>event.id)).size,1);
  assert.ok(feedback.every(event=>event.manual));
  assert.equal(restarted.api.state.syncRun,undefined);
  await restarted.controller.alarm(CONTINUE);assert.equal(calls,2);
});

test('automatic sync reports its origin and failures without becoming manual',async()=>{
  const feedback=[];
  const {controller}=setup({code,preferences:{chats:'all',schedule:'auto'}},
    async()=>({state:{},conversations:0,failures:1}),feedback);
  await controller.alarm(ALARM);
  assert.deepEqual(feedback.map(({phase,manual,failures})=>({phase,manual,failures})),[
    {phase:'start',manual:false,failures:0},{phase:'finish',manual:false,failures:1}]);
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
  const feedback=[];
  let started;
  const entering=new Promise(resolve=>{started=resolve;});
  const {api,controller}=setup({code,preferences:{chats:'all',schedule:'manual'}},async({signal})=>{
    started();
    await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
    return {state:{stale:true},conversations:1,hasMore:true};
  },feedback);
  const syncing=controller.sync();await entering;
  await controller.save({chats:'selected',schedule:'manual'});await syncing;
  assert.equal(api.state.saved,undefined);assert.equal(api.state.batchPending,false);assert.equal(api.alarms.size,0);
  assert.deepEqual(feedback.map(event=>event.phase),['start','cancel']);
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

test('browser sources keep independent choices, alarms and checkpoints', async () => {
  const api = fakeApi({code, 'preferences:chatgpt': {chats: 'all', schedule: 'manual'}, 'preferences:claude': {chats: 'all', schedule: 'auto'}});
  const calls = [];
  const controller = createSourceController({...api, alarms: api.alarmsApi}, {
    collectors: Object.fromEntries(['chatgpt', 'claude'].map(source => [source, async () => {calls.push(source); return {state: {source}, conversations: 1};}])),
    fetcher: async () => ({ok: true, status: 200, json: async () => ({protocol: PROTOCOL, connectionId: 'scope'})})
  });
  await controller.ready;
  assert.equal(api.alarms.has(ALARM + ':chatgpt'), false); assert.equal(api.alarms.has(ALARM + ':claude'), true);
  await controller.alarm(ALARM + ':claude'); await controller.sync('chatgpt');
  assert.deepEqual(calls, ['claude', 'chatgpt']);
  assert.equal(api.state['saved:claude'].state.source, 'claude');
  assert.equal(api.state['saved:chatgpt'].state.source, 'chatgpt');
});

test('local source controls use the authenticated app and disconnect pauses local work', async () => {
  const api = fakeApi({code}), calls = [];
  const controller = createSourceController({...api, alarms: api.alarmsApi}, {fetcher: async (url, init) => {
    calls.push({url, init}); return {ok: true, status: 200, json: async () => ({protocol: PROTOCOL, items: [], nextCursor: null})};
  }});
  await controller.ready;
  await controller.save('codex', {chats: 'all', schedule: 'auto'});
  await controller.list('codex', 50); await controller.sync('codex'); await controller.disconnect();
  assert.deepEqual(calls.map(row => new URL(row.url).pathname), ['/openchatlink/v1/local/codex/preferences',
    '/openchatlink/v1/local/codex/catalog', '/openchatlink/v1/local/codex/sync', '/openchatlink/v1/local/codex/pause']);
  assert.equal(calls[0].init.credentials, 'omit'); assert.equal(calls[0].init.headers.Authorization, 'Bearer ' + pairing.token);
  assert.equal(api.state.code, undefined); assert.equal(api.state['preferences:codex'].chats, 'all');
});

for (const failure of ['offline', 'revoked']) test(`disconnect clears browser pairing and alarms when the app is ${failure}`, async () => {
  const api = fakeApi({code, 'preferences:chatgpt': {chats: 'all', schedule: 'auto'},
    'preferences:claude': {chats: 'all', schedule: 'auto'}});
  const controller = createSourceController({...api, alarms: api.alarmsApi}, {fetcher: async () => {
    if (failure === 'offline') throw new Error('offline');
    return {ok: false, status: 401};
  }, collectors: {chatgpt: async () => assert.fail('sync after disconnect'), claude: async () => assert.fail('sync after disconnect')}});
  await controller.ready;
  assert.equal(api.alarms.size, 2);
  await assert.rejects(controller.disconnect(), /Browser disconnected.*Local sync could not be paused/);
  assert.equal(api.state.code, undefined); assert.equal(api.alarms.size, 0);
  await controller.alarm(ALARM + ':chatgpt'); await controller.alarm(ALARM + ':claude');
  assert.match(api.state['status:codex'].message, /Disable External Conversations/);
});


test('saving preserves read counts and activity survives a continuation restart', async () => {
  let calls = 0;
  const collector = async ({report, push}) => {
    await report({phase: 'scanning', inspected: 25, processed: 0});
    await report({processed: 2});
    await push('chatgpt-web', 'chatgpt-web', [{externalId: '00000000-0000-4000-8000-000000000001',
      createdAt: 1700000000000, messages: [{role: 'user', content: 'Synthetic fixture'}]}]);
    return {state: {checkpoint: ++calls}, conversations: 1, hasMore: calls === 1, processed: 2, inspected: 25};
  };
  const first = setup({code, preferences: {chats: 'all', schedule: 'manual'}}, collector);
  await first.controller.sync();
  assert.equal(first.api.state.status.running, true);
  assert.match(first.api.state.status.message, /30 seconds/);
  assert.ok(first.api.state.activity.some(entry => /received 1 chats; 2 checked/.test(entry.message)));
  const second = setup(first.api.state, collector);
  await second.controller.alarm(CONTINUE);
  assert.match(second.api.state.status.message, /50 list entries scanned, 4 chats checked, 2 sent/);
  assert.equal(second.api.state.status.running, false);
  assert.ok(second.api.state.activity.some(entry => /received 1 chats; 2 checked/.test(entry.message)));
  assert.ok(!JSON.stringify(second.api.state.activity).includes('Synthetic fixture'));
});

test('unchanged continuation stops with an actionable failure and no pending alarm', async () => {
  let calls = 0;
  const feedback = [];
  const {api, controller} = setup({code, preferences: {chats: 'all', schedule: 'manual'}}, async () => {
    calls++; return {state: {checkpoint: 1}, conversations: 0, hasMore: true};
  }, feedback);
  await controller.sync(); await controller.alarm(CONTINUE);
  assert.equal(calls, 2);
  assert.equal(api.state.batchPending, false);
  assert.equal(api.state.syncRun, undefined);
  assert.equal(api.alarms.has(CONTINUE), false);
  assert.match(api.state.status.message, /same batch/);
  assert.equal(feedback.at(-1).phase, 'finish');
  assert.equal(feedback.at(-1).failures, 1);
});

test('activity is bounded and provider URLs are excluded from failures', async () => {
  const {api, controller} = setup({code, preferences: {chats: 'all', schedule: 'manual'}}, async ({report}) => {
    for (let processed = 1; processed <= 120; processed++) await report({processed});
    throw new Error('GET https://chatgpt.com/backend-api/conversation/private-id -> 500');
  });
  await controller.sync();
  assert.equal(api.state.activity.length, 100);
  assert.equal(api.state.activity.at(-1).level, 'error');
  assert.match(api.state.status.message, /could not be read/);
  assert.ok(!JSON.stringify(api.state.activity).includes('private-id'));
});


test('updating from a worker with no activity log reports the pending continuation', async () => {
  const {api, controller} = setup({code, preferences: {chats: 'all', schedule: 'manual'}, batchPending: true,
    status: {running: false, message: 'Sync is continuing with the next batch…'}}, async () => assert.fail('must wait for the alarm'));
  await controller.ready;
  assert.equal(api.state.status.running, true);
  assert.match(api.state.activity[0].message, /Updated worker loaded/);
  assert.equal(api.alarms.has(CONTINUE), true);
});
