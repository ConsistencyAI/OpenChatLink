// ChatGPT provider: syncs personal conversations via the
// chatgpt.com backend API, authenticated with the browser session cookies.

import {
  NotLoggedInError,
  RateLimitedError,
  fetchJson,
  sleep,
  syncError,
  textPart,
  thinkingPart,
  toMs,
} from '../lib/common.js';
import {canCollect, conversationKey, isConversationId, normalizePreferences} from '../preferences.js';

const BASE = 'https://chatgpt.com';
const PAGE_SIZE = 50;
// Refetch a little history on every run so near-simultaneous edits are not
// missed between polls.
const OVERLAP_MS = 5 * 60 * 1000;
// Pace detail requests to stay under ChatGPT's rate limit. Backoff in
// fetchJson handles bursts, but pacing avoids tripping 429 in the first place.
const THROTTLE_MS = 400;

async function getAccessToken(signal) {
  const data = await fetchJson(`${BASE}/api/auth/session`, {signal});
  if (!data?.accessToken) throw new NotLoggedInError('chatgpt.com');
  return data.accessToken;
}

function authHeaders(token, accountId) {
  const headers = { Authorization: `Bearer ${token}` };
  if (accountId) headers['chatgpt-account-id'] = accountId;
  return headers;
}

/** Identify accounts before selecting the personal scope. */
async function listAccounts(token, signal) {
  try {
    const data = await fetchJson(`${BASE}/backend-api/accounts/check/v4-2023-04-27`, {
      headers: authHeaders(token),
      signal,
    });
    const accounts = [];
    for (const entry of Object.values(data?.accounts ?? {})) {
      const account = entry?.account ?? entry;
      const id = account?.account_id ?? account?.id;
      if (!id || account?.is_deactivated) continue;
      if (accounts.some(a => a.id === id)) continue;
      accounts.push({
        id,
        name: account?.organization_name || account?.name || account?.plan_type || 'personal',
        isWorkspace: (account?.structure ?? account?.plan_type) === 'workspace',
        isPersonal: account?.structure === 'personal',
      });
    }
    if (accounts.length > 0) return accounts;
  } catch {
    signal?.throwIfAborted();
    // Do not import from an unknown default account when discovery fails.
  }
  throw new Error('Could not identify a personal ChatGPT account. Open ChatGPT and switch to your personal account, then try again.');
}

async function* listUpdatedConversations(token, accountId, sinceMs, signal, startOffset = 0) {
  for (let offset = startOffset; ; offset += PAGE_SIZE) {
    const data = await fetchJson(
      `${BASE}/backend-api/conversations?offset=${offset}&limit=${PAGE_SIZE}&order=updated`,
      { headers: authHeaders(token, accountId), signal }
    );
    const items = data?.items ?? [];
    for (const [index, item] of items.entries()) {
      const updatedMs = toMs(item.update_time);
      if (sinceMs && updatedMs && updatedMs <= sinceMs) return;
      yield {item, offset: offset + index};
    }
    if (items.length < PAGE_SIZE || (typeof data?.total === 'number' && offset + PAGE_SIZE >= data.total)) return;
  }
}

/** Returns one bounded page of personal chat titles without fetching transcript bodies. */
export async function listChatGPTConversations({cursor = null, signal} = {}) {
  const index = cursor?.accountIndex ?? 0;
  const offset = cursor?.offset ?? 0;
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(offset) || offset < 0 || offset > 1000000)
    throw new Error('Refresh the ChatGPT list.');
  const token = await getAccessToken(signal);
  const accounts = (await listAccounts(token, signal)).filter(account => account.isPersonal);
  if (!accounts.length) throw new Error('No personal ChatGPT account was found.');
  if (index >= accounts.length) throw new Error('Your ChatGPT accounts changed. Refresh the list.');
  const account = accounts[index];
  const data = await fetchJson(`${BASE}/backend-api/conversations?offset=${offset}&limit=${PAGE_SIZE}&order=updated`,
    {headers: authHeaders(token, account.id), signal});
  const rows = data?.items ?? [];
  const items = rows.filter(row => isConversationId(row.id)).map(row => ({
    accountId: account.id, id: row.id.toLowerCase(), title: String(row.title ?? 'Untitled ChatGPT chat').slice(0, 300),
    updatedAt: toMs(row.update_time),
  }));
  const more = rows.length === PAGE_SIZE && (typeof data.total !== 'number' || offset + PAGE_SIZE < data.total);
  const nextCursor = more ? {accountIndex: index, offset: offset + PAGE_SIZE}
    : index + 1 < accounts.length ? {accountIndex: index + 1, offset: 0} : null;
  return {items, nextCursor};
}

/** Linearize the active branch of the mapping tree (current_node -> root).
 * If ChatGPT returns a broken parent chain, preserve all message-bearing nodes
 * in deterministic chronological order rather than silently losing the prefix. */
function linearize(detail) {
  const mapping = detail?.mapping ?? {};
  const chain = [];
  const visited = new Set();
  let nodeId = detail?.current_node;
  let incomplete = !nodeId;

  while (nodeId) {
    if (!mapping[nodeId] || visited.has(nodeId)) {
      incomplete = true;
      break;
    }
    visited.add(nodeId);
    chain.push(mapping[nodeId]);
    nodeId = mapping[nodeId].parent;
  }

  if (!incomplete) {
    chain.reverse();
    return chain;
  }

  const compareEntries = (left, right) =>
    left.createdAt - right.createdAt ||
    left.id.localeCompare(right.id) ||
    left.key.localeCompare(right.key);
  const seenIds = new Set();
  const entries = Object.entries(mapping)
    .map(([key, node]) => ({
      key,
      node,
      id: String(node?.id ?? key),
      createdAt: toMs(node?.message?.create_time ?? node?.create_time) ?? 0,
    }))
    .sort(compareEntries)
    .filter(entry => {
      if (seenIds.has(entry.id)) return false;
      seenIds.add(entry.id);
      return true;
    });

  // A topological sort keeps parents before children when ChatGPT assigns the
  // same timestamp to several nodes. The chronological/id ordering of the
  // ready queue makes the result deterministic across repeated syncs.
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const children = new Map();
  const indegree = new Map(entries.map(entry => [entry.id, 0]));
  for (const entry of entries) {
    const parentKey = entry.node?.parent;
    const parentId = parentKey ? String(mapping[parentKey]?.id ?? parentKey) : null;
    if (!parentId || parentId === entry.id || !byId.has(parentId)) continue;
    indegree.set(entry.id, 1);
    const siblings = children.get(parentId) ?? [];
    siblings.push(entry.id);
    children.set(parentId, siblings);
  }

  const ready = entries.filter(entry => indegree.get(entry.id) === 0).sort(compareEntries);
  const ordered = [];
  while (ready.length > 0) {
    const entry = ready.shift();
    ordered.push(entry);
    for (const childId of children.get(entry.id) ?? []) {
      indegree.set(childId, indegree.get(childId) - 1);
      if (indegree.get(childId) === 0) {
        ready.push(byId.get(childId));
        ready.sort(compareEntries);
      }
    }
  }

  if (ordered.length < entries.length) {
    const orderedIds = new Set(ordered.map(entry => entry.id));
    ordered.push(...entries.filter(entry => !orderedIds.has(entry.id)).sort(compareEntries));
  }

  return ordered.filter(entry => entry.node?.message).map(entry => entry.node);
}

const NON_TEXT_METADATA_KEYS = new Set([
  'content_type',
  'language',
  'message_type',
  'model',
  'model_slug',
  'request_id',
  'status',
]);

function recoverStrings(value, output) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text) output.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) recoverStrings(item, output);
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [childKey, childValue] of Object.entries(value)) {
    if (
      NON_TEXT_METADATA_KEYS.has(childKey) ||
      childKey === 'asset_pointer' ||
      childKey.endsWith('_id') ||
      childKey.endsWith('_slug')
    ) {
      continue;
    }
    recoverStrings(childValue, output);
  }
}

function extractMessage(node) {
  const msg = node?.message;
  if (!msg) return null;
  const role = msg.author?.role;
  if (role !== 'user' && role !== 'assistant') return null;
  if (msg.metadata?.is_visually_hidden_from_conversation || msg.channel === 'analysis' ||
      (msg.recipient && msg.recipient !== 'all')) return null;
  const parts = [];
  const texts = [];
  const content = msg.content ?? {};
  const addText = text => {
    const trimmed = text?.trim();
    if (!trimmed) return;
    texts.push(trimmed);
    parts.push(textPart(trimmed));
  };

  if (content.content_type === 'text' || content.content_type === 'multimodal_text') {
    for (const part of content.parts ?? []) {
      if (typeof part === 'string') {
        addText(part);
      } else if (part?.content_type === 'image_asset_pointer') {
        addText('[image]');
      } else {
        const recovered = [];
        recoverStrings(part, recovered);
        for (const text of recovered) addText(text);
      }
    }
  } else if (content.content_type === 'code' && content.text) {
    addText(`\`\`\`${content.language ?? ''}\n${content.text}\n\`\`\``);
  } else if (content.content_type === 'thoughts') {
    for (const thought of content.thoughts ?? []) {
      const text = thought?.content ?? thought?.summary;
      if (text) parts.push(thinkingPart(text));
    }
  } else if (content.content_type === 'image_asset_pointer') {
    addText('[image]');
  } else {
    const recovered = [];
    recoverStrings(content, recovered);
    for (const text of recovered) addText(text);
  }

  if (texts.length === 0 && parts.length === 0) {
    const recovered = [];
    recoverStrings(msg.metadata, recovered);
    for (const text of recovered) addText(text);
  }

  const contentStr = texts.join('\n').trim();
  if (!contentStr && parts.length === 0) return null;

  return {
    role,
    content: contentStr,
    createdAt: toMs(msg.create_time),
    model: msg.metadata?.model_slug ?? null,
    parts,
  };
}

function toParsedConversation(detail, conversationId, accountId) {
  const messages = linearize(detail)
    .map(extractMessage)
    .filter(Boolean);
  if (messages.length === 0) return null;

  const model = [...messages].reverse().find(m => m.model)?.model ?? null;

  return {
    externalId: conversationId,
    title: detail?.title ?? null,
    createdAt: toMs(detail?.create_time) ?? messages[0].createdAt ?? Date.now(),
    updatedAt: toMs(detail?.update_time),
    model,
    provider: 'openai',
    messages,
    metadata: {
      url: `${BASE}/c/${conversationId}`,
      ...(accountId ? { accountId } : {}),
    },
  };
}

export async function syncChatGPT({ state, push, register = async () => {}, log, report = async () => {}, personalOnly = true, signal, maxConversations = 50, preferences = {} }) {
  preferences = normalizePreferences(preferences);
  if (!canCollect(preferences)) return {state, conversations: 0};
  const selected = new Set(preferences.selected.map(row => conversationKey(row.accountId, row.id)));
  const deadline = Date.now() + 20000;
  await report({ phase: 'discovering' });
  const token = await getAccessToken(signal);
  await report({ phase: 'discovering' });
  const accounts = (await listAccounts(token, signal)).filter(account => !personalOnly || account.isPersonal);
  if (!accounts.length) throw new Error('No personal ChatGPT account was found. Switch to your personal account and try again.');
  const newState = { ...state, accounts: {...state.accounts} };
  let total = 0;
  let detected = 0;
  let processed = 0;
  let inspected = 0;
  let failed = 0;

  const resumeIndex = Math.max(0, accounts.findIndex(account => account.id === state?.resumeAccount));
  for (const account of accounts.slice(resumeIndex)) {
    const key = account.id ?? 'default';
    const sourceId = account.id && account.isWorkspace ? `chatgpt-web-${key}` : 'chatgpt-web';
    await register(sourceId, 'chatgpt-web');
    const lastSyncMs = state?.accounts?.[key]?.lastSyncMs ?? null;
    const since = lastSyncMs ? lastSyncMs - OVERLAP_MS : null;
    const runStartedMs = state?.accounts?.[key]?.runStartedMs ?? Date.now();
    const seen = {...state?.accounts?.[key]?.seen};
    let failures = state?.accounts?.[key]?.pendingFailures ?? 0;

    let batch = [];
    let first = true;
    for await (const {item, offset} of listUpdatedConversations(token, account.id, since, signal, state?.accounts?.[key]?.offset ?? 0)) {
      signal?.throwIfAborted();
      if (processed >= maxConversations || (inspected > 0 && Date.now() >= deadline)) {
        if (batch.length) total += await push(sourceId, 'chatgpt-web', batch);
        newState.resumeAccount = key;
        newState.accounts[key] = {lastSyncMs, runStartedMs, seen, offset, pendingFailures: failures, name: account.name};
        return {state: newState, conversations: total, hasMore: true, failures: failed, processed, inspected};
      }
      inspected++;
      if (inspected === 1 || inspected % 25 === 0) await report({phase: 'scanning', inspected, processed});
      if (!isConversationId(item.id) || (preferences.chats === 'selected' && !selected.has(conversationKey(account.id, item.id)))) continue;
      const version = toMs(item.update_time) ?? 0;
      if (seen[item.id] === version) continue;
      detected++;
      await report({ phase: 'importing', detected, processed });
      if (!first) await sleep(THROTTLE_MS, signal);
      first = false;
      try {
        const detail = await fetchJson(`${BASE}/backend-api/conversation/${item.id}`, {
          headers: authHeaders(token, account.id),
          signal,
        });
        const conv = toParsedConversation(detail, item.id, account.id);
        if (conv) batch.push(conv);
        seen[item.id] = version;
      } catch (err) {
        signal?.throwIfAborted();
        failures++;
        failed++;
        await report({phase: 'error', message: syncError(err), inspected, processed});
        if (err instanceof RateLimitedError) break;
      }
      processed++;
      await report({ detected, processed });
      if (batch.length >= 1) {
        total += await push(sourceId, 'chatgpt-web', batch);
        batch = [];
      }
    }
    if (batch.length > 0) {
      total += await push(sourceId, 'chatgpt-web', batch);
    }

    // Only advance the watermark on a clean run. If any conversation failed
    // (e.g. persistent 429), keep the old watermark so the next sync retries
    // them rather than skipping past them forever. Re-pushes dedupe server-side.
    if (failures > 0) {
      log(`chatgpt: ${failures} conversation(s) failed; keeping watermark to retry next run`);
    }
    newState.accounts[key] = {
      lastSyncMs: failures > 0 ? lastSyncMs : runStartedMs,
      ...(failures > 0 ? {runStartedMs, seen} : {}),
      name: account.name,
    };
    delete newState.resumeAccount;
  }

  await report({ phase: 'complete', detected, processed });

  return { state: newState, conversations: total, failures: failed, processed, inspected };
}
