export const PROTOCOL = 'openchatlink/1';
import {limitMessages, normalizePreferences, snapshotKey, identifyMessages, transferMessages} from './preferences.js';

export function visibleMessages(conversation) {
  return (conversation.messages ?? []).filter(message => ['user', 'assistant'].includes(message.role) &&
    typeof message.content === 'string' && message.content.trim()).map(message => ({
      role: message.role, text: message.content,
      createdAt: Number.isSafeInteger(message.createdAt) ? message.createdAt : conversation.createdAt,
      ...(message.key ? {key: message.key} : {}),
    }));
}

export function parsePairing(code) {
  if (typeof code !== 'string' || !code.startsWith('ocl1.') || code.length > 1024) {
    throw new Error('Copy a connection code from Phase Pal > Settings > External Conversations.');
  }
  let pairing;
  try {
    const bytes = Uint8Array.from(atob(code.slice(5).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    pairing = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The connection code is invalid. Copy it again from Phase Pal.');
  }
  if (pairing.v !== 1 || !Number.isInteger(pairing.port) || pairing.port < 1024 || pairing.port > 65535 ||
      typeof pairing.token !== 'string' || !/^[a-f0-9]{64}$/.test(pairing.token) ||
      Object.keys(pairing).some(key => !['v', 'port', 'token'].includes(key))) {
    throw new Error('The connection code is invalid. Copy it again from Phase Pal.');
  }
  return pairing;
}

export function toWireConversation(conversation, preferences = {}, source = 'chatgpt') {
  if (typeof conversation.externalId !== 'string' || !/^[a-f0-9-]{32,36}$/i.test(conversation.externalId)) {
    throw new Error('ChatGPT returned an unsupported conversation ID.');
  }
  const visible = visibleMessages(conversation), settings = normalizePreferences(preferences);
  const transfer = settings.chats === 'selected' && settings.selected.find(row => row.id === conversation.externalId.toLowerCase() &&
    row.accountId === (conversation.metadata?.accountId ?? 'personal'))?.transfer;
  const messages = (transfer ? transferMessages(visible, transfer) : limitMessages(visible, settings))
    .map(({key, ...message}, index) => ({index, ...message}));
  if (messages.length > 20000) throw new Error('This conversation is too large to sync.');
  return {
    source,
    id: conversation.externalId,
    accountId: conversation.metadata?.accountId ?? 'personal',
    title: (conversation.title ?? 'ChatGPT conversation').slice(0, 300),
    updatedAt: conversation.updatedAt ?? conversation.createdAt,
    messages,
  };
}

export function createClient(pairing, fetcher = fetch, signal, progress = async () => {}, preferences = {}) {
  const base = `http://127.0.0.1:${pairing.port}/openchatlink/v1`;
  async function request(path, body) {
    let response;
    try {
      response = await fetcher(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {Authorization: `Bearer ${pairing.token}`, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        credentials: 'omit',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
      });
    } catch {
      throw new Error('Open Phase Pal and enable External Conversations, then try again.');
    }
    if (response.status === 401) throw new Error('Connection revoked. Copy a new code from Phase Pal.');
    if (response.status === 413) throw new Error('This conversation is too large to sync.');
    if (!response.ok) throw new Error('Phase Pal could not import this chat. Check External Conversations in Settings.');
    const result = await response.json();
    if (result.protocol !== PROTOCOL) throw new Error('Update Phase Pal to use this extension.');
    return result;
  }
  return {
    health: () => request('/health'),
    syncFeedback: (source, phase, run) => request(`/sync/${source}/${phase}`, {id: run.id, manual: run.manual, failures: run.failures ?? 0}),
    localCatalog: (source, cursor) => request(`/local/${source}/catalog?offset=${cursor ?? 0}`),
    localPreview: (source, row) => request(`/local/${source}/preview`, {accountId: row.accountId, id: row.id}),
    localPreferences: (source, preferences) => request(`/local/${source}/preferences`, {preferences}),
    localSync: source => request(`/local/${source}/sync`, {}),
    pauseLocal: () => request('/local/codex/pause', {}),
    async push(source, _adapter, conversations) {
      const provider = source === 'chatgpt-web' ? 'chatgpt' : source === 'claude-web' ? 'claude' : null;
      if (!provider) throw new Error('Unsupported browser source.');
      let accepted = 0;
      for (const conversation of conversations) {
        const visible = await identifyMessages(visibleMessages(conversation));
        const prepared = {...conversation, messages: visible.map(({text, ...message}) => ({...message, content: text}))};
        const payload = {conversation: toWireConversation(prepared, preferences, provider)};
        if (!payload.conversation.messages.length) {await progress({filtered: visible.length > 0 ? 1 : 0, empty: visible.length ? 0 : 1}); continue;}
        if (new TextEncoder().encode(JSON.stringify(payload)).length > 8 * 1024 * 1024) {
          throw new Error('This conversation is too large to sync.');
        }
        const result = await request('/ingest', payload);
        if (result.conflict) throw new Error('This chat has local changes. Open it in Phase Pal and choose Continue in Phase Pal.');
        accepted += result.accepted ? 1 : 0;
        if (!result.accepted) throw new Error('Phase Pal did not accept this chat. It may have been deleted there.');
        await progress({delivered: 1, updated: result.changed === true ? 1 : 0, unchanged: result.changed === false ? 1 : 0});
      }
      return accepted;
    },
  };
}

export async function collect({pairing, preferences = {}, saved = {}, full = false, collector, fetcher, signal, report = async () => {}}) {
  preferences = normalizePreferences(preferences);
  const filterKey = snapshotKey(preferences);
  const totals = {delivered: 0, updated: 0, unchanged: 0, filtered: 0, empty: 0};
  await report({phase: 'connecting'});
  const client = createClient(pairing, fetcher, signal, change => {
    for (const key of Object.keys(totals)) totals[key] += change[key] ?? 0;
    return report({phase: change.delivered ? 'saving' : 'filtered', ...totals});
  }, preferences);
  const health = await client.health();
  const state = !full && saved.connectionId === health.connectionId && saved.filterKey === filterKey ? saved.state ?? {} : {};
  const result = await collector({state, push: client.push, register: async () => {},
                                  log: () => {}, report, personalOnly: true, signal, maxConversations: 50, preferences});
  return {connectionId: health.connectionId, filterKey, state: result.state, count: result.conversations,
          processed: result.processed ?? 0, inspected: result.inspected ?? 0, ...totals,
          targetName: health.targetName, hasMore: Boolean(result.hasMore),
          ...(result.failures > 0 ? {failures: result.failures} : {})};
}
