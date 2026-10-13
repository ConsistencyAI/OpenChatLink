import {normalizeTransfer, previewSelection, transferMessages} from './preferences.js';

// Transcript bodies live only in this page and are discarded when the preview closes.
export function createHistoryPreview({request, apply, changed}) {
  const el = id => document.getElementById(id);
  let row, messages = [], keys = new Set(), capturedAt = 0, page = 0, revision = 0;
  const pageSize = 50;
  function close() {
    revision++; row = null; messages = []; keys.clear();
    el('preview-messages').replaceChildren(); el('history-preview').hidden = true;
    changed(false);
  }
  function draw() {
    el('preview-dates').hidden = el('preview-mode').value !== 'range';
    el('preview-count').textContent = `${messages.filter(message => keys.has(message.key)).length} of ${messages.length} messages selected.`;
    el('preview-messages').replaceChildren();
    for (const message of messages.slice(page * pageSize, (page + 1) * pageSize)) {
      const label = document.createElement('label'); label.className = 'message-choice';
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = keys.has(message.key);
      input.addEventListener('change', () => {
        if (input.checked) keys.add(message.key); else keys.delete(message.key);
        el('preview-mode').value = 'messages'; draw();
        const index = messages.slice(page * pageSize, (page + 1) * pageSize).indexOf(message);
        el('preview-messages').querySelectorAll('input')[index]?.focus({preventScroll: true});
      });
      const body = document.createElement('span'), heading = document.createElement('strong'), text = document.createElement('span');
      heading.textContent = `${message.role === 'user' ? 'You' : 'Assistant'} · ${message.createdAt ? new Date(message.createdAt).toLocaleString() : 'Unknown date'}`;
      text.textContent = message.text; body.append(heading, text); label.append(input, body); el('preview-messages').append(label);
    }
    el('preview-page').textContent = messages.length ? `${page * pageSize + 1}–${Math.min(messages.length, (page + 1) * pageSize)} of ${messages.length}` : 'No supported messages';
    el('preview-prev').disabled = page === 0; el('preview-next').disabled = (page + 1) * pageSize >= messages.length;
    el('preview-apply').disabled = !keys.size && !el('preview-future').checked;
    el('preview-reset').hidden = keys.size > 0 || messages.length === 0;
    el('preview-state').textContent = keys.size ? 'Review your selection, then use it below. No messages have been imported.'
      : messages.length ? 'Nothing selected. Change the dates, select messages, or choose all history.' : 'This chat has no supported messages.';
  }
  function choose() {
    if (el('preview-mode').value !== 'messages') keys = new Set(previewSelection(messages, el('preview-mode').value,
      el('preview-from').value, el('preview-until').value).map(message => message.key));
    draw();
  }
  for (const id of ['preview-mode', 'preview-from', 'preview-until']) el(id).addEventListener('change', choose);
  el('preview-future').addEventListener('change', draw);
  el('preview-close').addEventListener('click', close);
  el('preview-prev').addEventListener('click', () => {page--; draw();});
  el('preview-next').addEventListener('click', () => {page++; draw();});
  for (const id of ['preview-all', 'preview-reset']) el(id).addEventListener('click', () => {el('preview-mode').value = 'all'; choose();});
  el('preview-none').addEventListener('click', () => {el('preview-mode').value = 'messages'; keys.clear(); draw();});
  el('preview-apply').addEventListener('click', () => {
    try {
      const transfer = normalizeTransfer({history: el('preview-mode').value, sinceDate: el('preview-from').value,
        untilDate: el('preview-until').value, messageKeys: [...keys], capturedAt, includeFuture: el('preview-future').checked});
      apply({...row, transfer}); close();
    } catch (error) {el('preview-state').textContent = error.message;}
  });
  return {close, async open(selected, defaults) {
    const owner = ++revision; row = selected; messages = []; keys.clear(); page = 0;
    changed(true);
    el('preview-title').textContent = selected.title ?? 'Choose history';
    el('history-preview').hidden = false; el('preview-controls').hidden = true;
    el('preview-state').textContent = 'Reading messages for preview…';
    el('history-preview').scrollIntoView({block: 'start', behavior: 'smooth'});
    try {
      const result = await request({type: 'preview', row: {accountId: selected.accountId, id: selected.id}});
      if (owner !== revision) return;
      messages = result.messages; capturedAt = result.capturedAt;
      const saved = selected.transfer;
      el('preview-mode').value = saved?.history ?? (defaults.history === 'since' ? 'range' : defaults.history);
      el('preview-from').value = saved?.sinceDate ?? defaults.sinceDate;
      el('preview-until').value = saved?.untilDate ?? '';
      el('preview-future').checked = saved?.includeFuture ?? false;
      el('preview-controls').hidden = false;
      if (saved) {keys = new Set(transferMessages(messages, saved).map(message => message.key)); draw();}
      else choose();
      el('preview-mode').focus();
    } catch (error) {if (owner === revision) el('preview-state').textContent = error.message;}
  }};
}
