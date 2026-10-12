export const PROTOCOL = 'openchatlink/1';

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

export function toWireConversation(conversation) {
  if (typeof conversation.externalId !== 'string' || !/^[a-f0-9-]{32,36}$/i.test(conversation.externalId)) {
    throw new Error('ChatGPT returned an unsupported conversation ID.');
  }
  const messages = (conversation.messages ?? []).filter(message =>
    ['user', 'assistant'].includes(message.role) && typeof message.content === 'string' && message.content.trim()
  ).map((message, index) => ({
    index,
    role: message.role,
    text: message.content,
    createdAt: Number.isSafeInteger(message.createdAt) ? message.createdAt : conversation.createdAt,
  }));
  if (messages.length > 20000) throw new Error('This conversation is too large to sync.');
  return {
    id: conversation.externalId,
    accountId: conversation.metadata?.accountId ?? 'personal',
    title: (conversation.title ?? 'ChatGPT conversation').slice(0, 300),
    updatedAt: conversation.updatedAt ?? conversation.createdAt,
    messages,
  };
}

export function createClient(pairing, fetcher = fetch, signal, progress = async () => {}) {
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
    async push(source, _adapter, conversations) {
      if (source !== 'chatgpt-web') throw new Error('Only personal ChatGPT conversations are enabled.');
      let accepted = 0;
      for (const conversation of conversations) {
        const payload = {conversation: toWireConversation(conversation)};
        if (new TextEncoder().encode(JSON.stringify(payload)).length > 8 * 1024 * 1024) {
          throw new Error('This conversation is too large to sync.');
        }
        const result = await request('/ingest', payload);
        if (result.conflict) throw new Error('This chat has local changes. Open it in Phase Pal and choose Continue in Phase Pal.');
        accepted += result.accepted ? 1 : 0;
        await progress();
      }
      return accepted;
    },
  };
}

export async function collect({pairing, saved = {}, full = false, collector, fetcher, signal, report = async () => {}}) {
  const client = createClient(pairing, fetcher, signal, () => report({phase: 'saving'}));
  const health = await client.health();
  const state = !full && saved.connectionId === health.connectionId ? saved.state ?? {} : {};
  const result = await collector({state, push: client.push, register: async () => {},
                                  log: () => {}, report, personalOnly: true, signal, maxConversations: 50});
  return {connectionId: health.connectionId, state: result.state, count: result.conversations,
          targetName: health.targetName, hasMore: Boolean(result.hasMore)};
}
