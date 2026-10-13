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
    if (row.transfer !== undefined) entry.transfer = normalizeTransfer(row.transfer);
    unique.set(conversationKey(entry.accountId, entry.id), entry);
  }
  if ([...unique.values()].reduce((total, row) => total + (row.transfer?.messageKeys.length ?? 0), 0) > 50000)
    throw new Error('Select fewer messages. A saved source selection can contain up to 50,000 messages.');
  return {chats, selected: [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row),
          history, sinceDate, schedule};
}

// Scheduling does not change a snapshot; switching auto/manual must retain its checkpoint.
export function snapshotKey(preferences) {
  const {schedule, ...snapshot} = normalizePreferences(preferences);
  snapshot.selected = snapshot.selected.map(({title, ...row}) => row);
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

export function normalizeTransfer(value) {
  if (!value || !['all', 'last100', 'range', 'messages'].includes(value.history) ||
      typeof value.includeFuture !== 'boolean' || !Number.isSafeInteger(value.capturedAt) || value.capturedAt <= 0 ||
      !Array.isArray(value.messageKeys) || value.messageKeys.length > 20000 ||
      value.messageKeys.some(key => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)))
    throw new Error('Preview this chat again before saving.');
  const sinceDate = value.sinceDate ?? '', untilDate = value.untilDate ?? '';
  if (value.history === 'range') {
    for (const date of [sinceDate, untilDate]) if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date))
      throw new Error('Choose valid dates.');
    if (!sinceDate && !untilDate || sinceDate && untilDate && sinceDate > untilDate) throw new Error('Choose a valid date range.');
  }
  return {history: value.history, sinceDate, untilDate, capturedAt: value.capturedAt,
    includeFuture: value.includeFuture, messageKeys: [...new Set(value.messageKeys)].sort()};
}

// Save fingerprints, never transcript text. A changed message must be selected again.
export async function identifyMessages(messages) {
  return Promise.all(messages.map(async message => ({...message, key: Array.from(new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${message.role}\n${message.createdAt}\n${message.text}`))
  ), byte => byte.toString(16).padStart(2, '0')).join('')})));
}

export function transferMessages(messages, transfer) {
  const keys = new Set(transfer.messageKeys);
  return messages.filter(message => keys.has(message.key) || transfer.includeFuture && message.createdAt > transfer.capturedAt);
}

export function previewSelection(messages, history, sinceDate = '', untilDate = '') {
  if (history === 'last100') return messages.slice(-100);
  if (history === 'range') {
    const start = sinceDate ? Date.parse(sinceDate + 'T00:00:00Z') : -Infinity;
    const end = untilDate ? Date.parse(untilDate + 'T00:00:00Z') + 86400000 : Infinity;
    return messages.filter(message => message.createdAt >= start && message.createdAt < end);
  }
  return messages;
}
