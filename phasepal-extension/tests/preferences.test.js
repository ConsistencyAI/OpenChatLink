import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePreferences, snapshotKey, identifyMessages, previewSelection, transferMessages} from '../preferences.js';

test('preferences default to no selected chats and reject invalid modes, dates, or IDs',()=>{
  assert.deepEqual(normalizePreferences(),{chats:'selected',selected:[],history:'all',sinceDate:'',schedule:'auto'});
  for(const invalid of [{chats:'unknown'},{schedule:'often'},{history:'since',sinceDate:'2026-02-30'},
    {history:'since',sinceDate:''},{selected:[{accountId:'personal',id:'../../other'}]}])assert.throws(()=>normalizePreferences(invalid));
});

test('preview windows and specific selections remain fixed unless future messages are enabled', async () => {
  const messages = await identifyMessages(Array.from({length: 120}, (_, i) => ({role: 'user', text: `Message ${i}`,
    createdAt: Date.parse('2026-01-01T00:00:00Z') + i * 86400000})));
  assert.equal(previewSelection(messages, 'last100')[0].text, 'Message 20');
  assert.deepEqual(previewSelection(messages, 'range', '2026-01-02', '2026-01-03').map(m => m.text), ['Message 1', 'Message 2']);
  const transfer = {history: 'messages', messageKeys: [messages[1].key], capturedAt: messages.at(-1).createdAt,
    includeFuture: false};
  const future = (await identifyMessages([{role: 'assistant', text: 'Future', createdAt: transfer.capturedAt + 1}]))[0];
  const edited = (await identifyMessages([{...messages[1], text: 'Edited'}]))[0];
  assert.deepEqual(transferMessages([...messages, future], transfer), [messages[1]]);
  assert.deepEqual(transferMessages([edited, future], transfer), []);
  assert.deepEqual(transferMessages([...messages, future], {...transfer, includeFuture: true}), [messages[1], future]);
  const row = {accountId: 'personal', id: '00000000-0000-4000-8000-000000000001', transfer};
  assert.ok(!JSON.stringify(normalizePreferences({selected: [row]})).includes('Message 1'));
  assert.notEqual(snapshotKey({selected: [row]}), snapshotKey({selected: [{...row, transfer: {...transfer, includeFuture: true}}]}));
  assert.throws(() => normalizePreferences({selected: [{...row, transfer: {...transfer, messageKeys: ['invalid']}}]}));
});

test('selection keys are account-scoped and independent of selection order',()=>{
  const a={accountId:'account-a',id:'ABCDEFAB-0000-4000-8000-000000000001',title:'Reina'};
  const b={accountId:'account-b',id:a.id};
  const value=normalizePreferences({selected:[a,b,a]});
  assert.equal(value.selected.length,2);
  assert.equal(value.selected[0].id,a.id.toLowerCase());
  assert.equal(snapshotKey(value),snapshotKey({selected:[b,a]}));
  assert.equal(snapshotKey(value),snapshotKey({selected:[b,{...a,title:'Renamed chat'}]}));
});
