const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const isConversationId = value => typeof value === 'string' && ID.test(value);
export const conversationKey = (accountId, id) => JSON.stringify([accountId, id.toLowerCase()]);

export function normalizePreferences(value = {}) {
  const chats = value.chats ?? 'selected';
  const history = value.history ?? 'all';
  const schedule = value.schedule ?? 'auto';
  if (!['selected', 'all'].includes(chats) || !['all', 'last100', 'since'].includes(history) ||
      !['auto', 'manual'].includes(schedule)) throw new Error('Choose valid sync options.');
  const sinceDate = history === 'since' ? value.sinceDate : '';
  if (history === 'since' && (typeof sinceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(sinceDate) ||
      !Number.isFinite(Date.parse(sinceDate + 'T00:00:00Z')) ||
      new Date(sinceDate + 'T00:00:00Z').toISOString().slice(0, 10) !== sinceDate)) {
    throw new Error('Choose a valid start date.');
  }
  const selected = value.selected ?? [];
  if (!Array.isArray(selected) || selected.length > 5000) throw new Error('Too many selected chats.');
  const unique = new Map();
  for (const row of selected) {
    if (!row || !isConversationId(row.id) || typeof row.accountId !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(row.accountId)) throw new Error('Choose chats from the source list.');
    const entry = {accountId: row.accountId, id: row.id.toLowerCase()};
    if (row.title !== undefined) {
      if (typeof row.title !== 'string' || row.title.length > 300) throw new Error('Invalid selected chat title. Reload the chat list.');
      entry.title = row.title;
    }
    unique.set(conversationKey(entry.accountId, entry.id), entry);
  }
  return {chats, selected: [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row),
          history, sinceDate, schedule};
}

// Scheduling does not change a snapshot; switching auto/manual must retain its checkpoint.
export function snapshotKey(preferences) {
  const {schedule, ...snapshot} = normalizePreferences(preferences);
  snapshot.selected = snapshot.selected.map(({accountId, id}) => ({accountId, id}));
  return JSON.stringify(snapshot);
}

export function canCollect(preferences) {
  return preferences.chats === 'all' || preferences.selected.length > 0;
}

export function limitMessages(messages, preferences) {
  if (preferences.history === 'last100') return messages.slice(-100);
  if (preferences.history === 'since') {
    const cutoff = Date.parse(preferences.sinceDate + 'T00:00:00Z');
    return messages.filter(message => message.createdAt >= cutoff);
  }
  return messages;
}
