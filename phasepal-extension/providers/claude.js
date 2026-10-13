// Derived from hstry's MIT-licensed Claude web collector.
import {fetchJson, sleep, toMs, syncError} from '../lib/common.js';
import {canCollect, conversationKey, isConversationId, normalizePreferences} from '../preferences.js';
const BASE = 'https://claude.ai';

async function organizations(signal) {
  const data = await fetchJson(BASE + '/api/organizations', {signal});
  const rows = Array.isArray(data) ? data : data?.organizations ?? data?.data;
  if (!Array.isArray(rows)) throw new Error('Open Claude and sign in, then refresh the chat list.');
  return rows.map(row => ({id: row.uuid ?? row.id})).filter(row => isConversationId(row.id));
}

export async function listClaudeConversations({cursor = null, signal} = {}) {
  const orgs = await organizations(signal);
  const index = cursor?.orgIndex ?? 0, offset = cursor?.offset ?? 0;
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(offset) || offset < 0 || offset > 1000000 || !orgs[index])
    throw new Error('Refresh the Claude chat list.');
  const org = orgs[index];
  const data = await fetchJson(`${BASE}/api/organizations/${org.id}/chat_conversations?limit=50&offset=${offset}&consistency=eventual`, {signal});
  const rows = Array.isArray(data) ? data : data?.data;
  if (!Array.isArray(rows)) throw new Error('Claude returned an unreadable conversation list.');
  return {items: rows.filter(row => isConversationId(row.uuid ?? row.id)).map(row => ({accountId: org.id,
    id: (row.uuid ?? row.id).toLowerCase(), title: String(row.name ?? 'Untitled Claude chat').slice(0, 300), updatedAt: toMs(row.updated_at)})),
    nextCursor: rows.length === 50 ? {orgIndex: index, offset: offset + 50}
      : index + 1 < orgs.length ? {orgIndex: index + 1, offset: 0} : null};
}

function visibleBranch(detail) {
  const rows = detail.chat_messages ?? [];
  const byId = new Map(rows.filter(row => row.uuid).map(row => [row.uuid, row]));
  let leaf = detail.current_leaf_message_uuid ?? detail.current_leaf_message?.uuid;
  if (!leaf || !byId.has(leaf)) {
    if (!rows.some(row => row.parent_message_uuid && byId.has(row.parent_message_uuid))) return rows;
    const parents = new Set(rows.map(row => row.parent_message_uuid));
    leaf = rows.filter(row => !parents.has(row.uuid)).sort((a, b) => (toMs(b.created_at) ?? 0) - (toMs(a.created_at) ?? 0))[0]?.uuid;
  }
  const chain = [], seen = new Set();
  while (leaf && byId.has(leaf) && !seen.has(leaf)) {
    seen.add(leaf); const row = byId.get(leaf); chain.push(row); leaf = row.parent_message_uuid;
  }
  return chain.reverse();
}

function parse(detail, item) {
  const messages = visibleBranch(detail).map(row => ({
    role: row.sender === 'human' ? 'user' : row.sender === 'assistant' ? 'assistant' : null,
    content: Array.isArray(row.content) ? row.content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n') : row.text,
    createdAt: toMs(row.created_at)
  })).filter(row => row.role && typeof row.content === 'string' && row.content.trim());
  return {externalId: item.id, title: detail.name ?? item.title, createdAt: toMs(detail.created_at) ?? messages[0]?.createdAt ?? 0,
    updatedAt: toMs(detail.updated_at) ?? item.updatedAt ?? 0, messages, metadata: {accountId: item.accountId}};
}

export async function syncClaude({state = {}, push, preferences = {}, signal, report = async () => {}, maxConversations = 50}) {
  preferences = normalizePreferences(preferences);
  if (!canCollect(preferences)) return {state: {}, conversations: 0, hasMore: false};
  const selected = new Set(preferences.selected.map(row => conversationKey(row.accountId, row.id)));
  let cursor = state.cursor ?? null, count = 0, processed = 0, inspected = 0, failures = state.pendingFailures ?? 0, batchFailures = 0;
  const started = Date.now(), runStarted = state.runStartedMs ?? started, previous = state.lastSyncMs ?? 0, seen = new Set(state.seen ?? []);
  for (;;) {
    signal?.throwIfAborted();
    await report({phase: 'scanning', inspected, processed});
    const page = await listClaudeConversations({cursor, signal});
    for (let i = 0; i < page.items.length; i++) {
      const item = page.items[i], key = conversationKey(item.accountId, item.id);
      if (processed >= maxConversations || (inspected > 0 && Date.now() - started >= 20000))
        return {state: {cursor: {orgIndex: cursor?.orgIndex ?? 0, offset: (cursor?.offset ?? 0) + i}, seen: [...seen].slice(-5000), lastSyncMs: previous, runStartedMs: runStarted, pendingFailures: failures}, conversations: count, hasMore: true, failures: batchFailures, processed, inspected};
      inspected++;
      if (inspected === 1 || inspected % 25 === 0) await report({phase: 'scanning', inspected, processed});
      if ((preferences.chats !== 'all' && !selected.has(key)) || seen.has(key) || (previous && item.updatedAt && item.updatedAt <= previous - 300000)) continue;
      if (processed) await sleep(400, signal);
      await report({phase: 'importing', inspected, processed});
      let conversation;
      try {
        const detail = await fetchJson(`${BASE}/api/organizations/${item.accountId}/chat_conversations/${item.id}?tree=True&rendering_mode=messages&render_all_tools=true&consistency=eventual`, {signal});
        conversation = parse(detail, item);
      } catch (error) {signal?.throwIfAborted(); failures++; batchFailures++; await report({phase: 'error', message: syncError(error), inspected, processed});}
      if (conversation) count += await push('claude-web', 'claude-web', [conversation]);
      seen.add(key); processed++; await report({processed});
    }
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return {state: {lastSyncMs: failures ? previous : runStarted}, conversations: count, hasMore: false, failures: batchFailures, processed, inspected};
}
