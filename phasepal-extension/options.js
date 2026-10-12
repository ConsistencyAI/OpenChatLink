const el = id => document.getElementById(id);
async function render() {
  const {status, code} = await chrome.storage.local.get(['status', 'code']);
  el('status').textContent = status?.message ?? 'Not connected.';
  el('sync').disabled = !code || Boolean(status?.running);
  el('full').disabled = !code || Boolean(status?.running);
  el('connect').disabled = Boolean(status?.running);
}
el('connect').addEventListener('click', async () => {
  el('status').textContent = 'Connecting…';
  const result = await chrome.runtime.sendMessage({type: 'connect', code: el('code').value.trim()});
  if (!result?.ok) el('status').textContent = result?.error ?? 'Connection failed.';
  else {el('code').value = ''; await render();}
});
el('sync').addEventListener('click', () => chrome.runtime.sendMessage({type: 'sync'}));
el('full').addEventListener('click', () => chrome.runtime.sendMessage({type: 'sync', full: true}));
el('disconnect').addEventListener('click', () => chrome.runtime.sendMessage({type: 'disconnect'}));
chrome.storage.onChanged.addListener(() => void render());
await render();
