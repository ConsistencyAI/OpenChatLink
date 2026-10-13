import test from 'node:test';
import assert from 'node:assert/strict';
import {listClaudeConversations, syncClaude} from '../providers/claude.js';
import {toWireConversation} from '../protocol.js';
const org = 'aaaaaaaa-0000-4000-8000-000000000001';
const otherOrg = 'bbbbbbbb-0000-4000-8000-000000000001';
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
function mock(t, {failure = false} = {}) {
  const old = globalThis.fetch, calls = [];
  globalThis.fetch = async value => {
    const url = new URL(value); calls.push(url);
    let data;
    if (url.pathname === '/api/organizations') data = [{uuid: org}, {uuid: otherOrg}];
    else if (url.pathname.endsWith('/chat_conversations')) {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      data = ids.slice(offset).map(uuid => ({uuid, name: 'Claude chat', updated_at: '2026-10-12T10:00:00Z'}));
    } else {
      if (failure) return {ok: false, status: 500};
      data = {name: 'Reina', current_leaf_message_uuid: 'chosen', created_at: '2026-10-12T00:00:00Z', chat_messages: [
        {uuid: 'root', sender: 'human', content: [{type: 'text', text: 'Hello 🌸'}]},
        {uuid: 'chosen', parent_message_uuid: 'root', sender: 'assistant', content: [{type: 'thinking', thinking: 'hidden'}, {type: 'text', text: 'こんにちは'}, {type: 'tool_use', name: 'hidden tool'}]},
        {uuid: 'other', parent_message_uuid: 'root', sender: 'assistant', text: 'Other branch', created_at: '2026-10-12T11:00:00Z'},
      ]};
    }
    return {ok: true, status: 200, json: async () => data};
  };
  t.after(() => {globalThis.fetch = old;});
  return calls;
}
test('Claude picker loads organization-scoped titles without fetching bodies', async t => {
  const calls = mock(t);
  const result = await listClaudeConversations();
  assert.equal(result.items[0].accountId, org);
  assert.deepEqual(result.nextCursor, {orgIndex: 1, offset: 0});
  assert.equal(calls.length, 2);
});
test('Claude defaults import nothing and selected chats omit other bodies, thinking, tools and branches', async t => {
  const calls = mock(t), pushed = [];
  await syncClaude({push: async () => assert.fail('default import')});
  assert.equal(calls.length, 0);
  await syncClaude({preferences: {selected: [{accountId: org, id: ids[0]}]}, push: async (source, adapter, rows) => {
    assert.equal(source, 'claude-web'); pushed.push(...rows); return rows.length;
  }});
  assert.equal(calls.filter(url => url.search.includes('tree=True')).length, 1);
  const wire = toWireConversation(pushed[0], {}, 'claude');
  assert.equal(wire.source, 'claude'); assert.equal(wire.accountId, org);
  assert.deepEqual(wire.messages.map(row => row.text), ['Hello 🌸', 'こんにちは']);
});
test('Claude bounded passes resume chosen chats without duplicating accepted work', async t => {
  mock(t); const received = [];
  const options = {preferences: {selected: ids.map(id => ({accountId: org, id}))}, maxConversations: 1,
    push: async (_source, _adapter, rows) => {received.push(rows[0].externalId); return 1;}};
  const first = await syncClaude(options);
  assert.equal(first.hasMore, true);
  let result = await syncClaude({...options, state: first.state});
  for (let pass = 0; result.hasMore && pass < 3; pass++) result = await syncClaude({...options, state: result.state});
  assert.equal(result.hasMore, false); assert.deepEqual(received, ids);
});
test('failed selected Claude details do not retain a cursor that skips retries', async t => {
  mock(t, {failure: true});
  const result = await syncClaude({preferences: {selected: [{accountId: org, id: ids[0]}]},
    push: async () => assert.fail('failed detail was sent')});
  assert.equal(result.failures, 1); assert.deepEqual(result.state, {});
});

test('Claude continuation retains the first batch watermark so edits during a long import are retried', async t => {
  const beforeFetch = globalThis.fetch, beforeNow = Date.now;
  let clock = 1700000000000;
  Date.now = () => clock;
  t.after(() => {globalThis.fetch = beforeFetch; Date.now = beforeNow;});
  const rows = ids.map(uuid => ({uuid, name: 'chat', updated_at: new Date(clock - 1000).toISOString()}));
  globalThis.fetch = async value => {
    const url = new URL(value);
    const data = url.pathname === '/api/organizations' ? [{uuid: org}]
      : url.pathname.endsWith('/chat_conversations') ? rows.slice(Number(url.searchParams.get('offset') ?? 0))
      : {chat_messages: [{uuid: 'root', sender: 'human', text: 'message'}]};
    return {ok: true, status: 200, json: async () => data};
  };
  const pushed = [], options = {maxConversations: 1, preferences: {chats: 'all'},
    push: async (_source, _adapter, chats) => {pushed.push(chats[0].externalId); return 1;}};
  const started = clock, first = await syncClaude(options);
  clock += 10000; rows[0].updated_at = new Date(clock).toISOString(); clock += 600000;
  const second = await syncClaude({...options, state: first.state});
  assert.equal(second.state.lastSyncMs, started);
  const third = await syncClaude({...options, state: second.state});
  assert.equal(third.conversations, 1); assert.deepEqual(pushed, [ids[0], ids[1], ids[0]]);
});
