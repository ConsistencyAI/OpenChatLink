import {conversationKey, normalizePreferences} from './preferences.js';

const el = id => document.getElementById(id);
let selected = new Map(), rows = new Map(), cursor = null, loaded = false, listing = false, dirty = false, busy = false;
function visibility() {
  el('picker').hidden = el('chats').value !== 'selected';
  el('date-row').hidden = el('history').value !== 'since';
  el('since-date').required = el('history').value === 'since';
  el('selection-count').textContent = `${selected.size} ${selected.size === 1 ? 'chat' : 'chats'} selected. Choices on other pages are kept.`;
}
function loadPreferences(value) {
  const preferences = normalizePreferences(value);
  selected = new Map(preferences.selected.map(row => [conversationKey(row.accountId, row.id), row]));
  for (const key of ['chats', 'history', 'schedule']) el(key).value = preferences[key];
  el('since-date').value = preferences.sinceDate;
  visibility(); drawList();
}
function drawList() {
  const search = el('search').value.trim().toLocaleLowerCase();
  el('chat-list').replaceChildren();
  const available = new Map(rows);
  for (const [key, row] of selected) if (!available.has(key)) available.set(key, {...row, title: row.title ?? `Saved selection: ${row.id}`});
  for (const [key, row] of available) {
    if (search && !row.title.toLocaleLowerCase().includes(search)) continue;
    const label = document.createElement('label'); label.className = 'chat-choice';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected.has(key);
    input.addEventListener('change', () => {
      if (input.checked) selected.set(key, {accountId: row.accountId, id: row.id, title: row.title}); else selected.delete(key);
      dirty = true; visibility(); void renderStatus();
    });
    const title = document.createElement('span'); title.textContent = row.title;
    label.append(input, title); el('chat-list').append(label);
  }
  el('more').hidden = !cursor;
}
async function renderStatus() {
  const {status, code} = await chrome.storage.local.get(['status', 'code']);
  el('status').textContent = dirty ? 'You have unsaved sync options. Select Save sync options.' : status?.message ?? 'Not connected.';
  el('sync').disabled = !code || Boolean(status?.running) || dirty || busy;
  el('full').disabled = el('sync').disabled;
  el('connect').disabled = busy;
  el('save').disabled = busy;
}
async function request(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error ?? 'Could not complete this action.');
  return result;
}
async function act(work) {
  busy = true; await renderStatus();
  let failure;
  try {await work();}
  catch (error) {failure = error.message;}
  finally {busy = false; await renderStatus(); if (failure) el('status').textContent = failure;}
}
el('connect').addEventListener('click', () => act(async () => {
  await request({type: 'connect', code: el('code').value.trim()}); el('code').value = '';
}));
el('preferences').addEventListener('change', event => {
  if (['chats', 'history', 'schedule', 'since-date'].includes(event.target.id)) {
    dirty = true; visibility(); void renderStatus();
  }
});
el('preferences').addEventListener('submit', event => {
  event.preventDefault();
  void act(async () => {
    const preferences = normalizePreferences({chats: el('chats').value, selected: [...selected.values()],
      history: el('history').value, sinceDate: el('since-date').value, schedule: el('schedule').value});
    await request({type: 'preferences', preferences}); dirty = false;
  });
});
async function list(refresh) {
  if (listing) return;
  listing = true; el('load').disabled = el('more').disabled = true;
  el('list-status').textContent = 'Loading chat titles…';
  try {
    const result = await request({type: 'list', cursor: refresh ? null : cursor});
    if (refresh) rows.clear();
    for (const row of result.items) rows.set(conversationKey(row.accountId, row.id), row);
    cursor = result.nextCursor; loaded = true; drawList();
    el('list-status').textContent = `${rows.size} chat ${rows.size === 1 ? 'title' : 'titles'} loaded.${cursor ? ' Load more to see older chats.' : ''}`;
  } catch (error) {el('list-status').textContent = error.message;}
  finally {listing = false; el('load').disabled = el('more').disabled = false;}
}
el('load').addEventListener('click', () => list(true));
el('more').addEventListener('click', () => list(!loaded));
el('search').addEventListener('input', drawList);
el('sync').addEventListener('click', () => act(() => request({type: 'sync'})));
el('full').addEventListener('click', () => act(() => request({type: 'sync', full: true})));
el('disconnect').addEventListener('click', () => act(() => request({type: 'disconnect'})));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.preferences && !dirty) loadPreferences(changes.preferences.newValue);
  void renderStatus();
});
loadPreferences((await chrome.storage.local.get('preferences')).preferences);
await renderStatus();
