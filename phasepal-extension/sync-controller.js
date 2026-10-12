import {syncChatGPT, listChatGPTConversations} from './providers/chatgpt.js';
import {collect, createClient, parsePairing} from './protocol.js';
import {canCollect, normalizePreferences, snapshotKey} from './preferences.js';

export const ALARM = 'openchatlink-sync';
export const CONTINUE = 'openchatlink-continue';

export function createSyncController(api, {collector = syncChatGPT, catalog = listChatGPTConversations, fetcher} = {}) {
  let operation = null, cancellation = null, generation = 0;
  const writeStatus = (message, running = false) => api.storage.local.set({status: {message, running}});
  async function schedule() {
    const {code, preferences, batchPending} = await api.storage.local.get(['code', 'preferences', 'batchPending']);
    const settings = normalizePreferences(preferences);
    if (code && canCollect(settings) && settings.schedule === 'auto')
      await api.alarms.create(ALARM, {periodInMinutes: 1});
    else await api.alarms.clear(ALARM);
    if (code && canCollect(settings) && batchPending)
      await api.alarms.create(CONTINUE, {delayInMinutes: 0.5});
    else await api.alarms.clear(CONTINUE);
  }
  const ready = (async () => {
    const {status} = await api.storage.local.get('status');
    if (status?.running) await writeStatus('Ready to resume sync.');
    await schedule();
  })();

  async function runOwned(full, trigger, owner) {
    try {
      await ready;
      const {code, saved, preferences, batchPending} = await api.storage.local.get(['code', 'saved', 'preferences', 'batchPending']);
      const settings = normalizePreferences(preferences);
      if (!code || owner !== generation) return;
      if ((trigger === 'auto' && settings.schedule !== 'auto') || (trigger === 'continue' && !batchPending)) return;
      if (!canCollect(settings)) {await writeStatus('Select chats and save your options before syncing.'); return;}
      cancellation = new AbortController();
      await writeStatus('Syncing your chosen ChatGPT history…', true);
      const result = await collect({pairing: parsePairing(code), preferences: settings, saved, full,
        collector, fetcher, signal: cancellation.signal,
        report: async progress => owner === generation && writeStatus(
          `Syncing: ${progress.processed ?? 0} conversations checked…`, true),
      });
      if (owner !== generation) return;
      await api.storage.local.set({saved: result, batchPending: result.hasMore, status: {running: false,
        message: result.failures > 0 ? `Some chats could not be read. ${settings.schedule === 'auto' ? 'Automatic sync will retry.' : 'Select Sync now to retry.'}`
          : result.hasMore ? 'Sync is continuing with the next batch…'
          : `Synced ${result.count} conversations in this batch to ${result.targetName || 'Phase Pal'}.`,
        ...(result.failures > 0 ? {} : {lastSuccess: Date.now()})}});
      await api.action.setBadgeText({text: result.failures > 0 ? '!' : ''});
      if (result.hasMore) await api.alarms.create(CONTINUE, {delayInMinutes: 0.5});
      else await api.alarms.clear(CONTINUE);
    } catch (error) {
      if (owner !== generation) return;
      await writeStatus(error.message);
      await api.action.setBadgeText({text: '!'});
    } finally { cancellation = null; }
  }

  async function sync(full = false, trigger = 'manual') {
    await commands;
    if (operation) return operation;
    operation = runOwned(full, trigger, generation).finally(() => {operation = null;});
    return operation;
  }
  async function stop() {
    generation++;
    cancellation?.abort();
    if (operation) await operation;
  }
  // User commands are serialized so reconnect, disconnect, and saved filters cannot race.
  let commands = ready;
  function command(work) {
    const result = commands.then(work);
    commands = result.catch(() => {});
    return result;
  }

  return {
    ready, sync,
    list: cursor => catalog({cursor}),
    alarm: name => name === ALARM ? sync(false, 'auto') : name === CONTINUE ? sync(false, 'continue') : Promise.resolve(),
    connect: code => command(async () => {
      const pairing = parsePairing(code);
      const health = await createClient(pairing, fetcher).health();
      await stop();
      const {preferences} = await api.storage.local.get('preferences');
      const settings = normalizePreferences(preferences);
      await api.storage.local.set({code: code.trim(), saved: {}, batchPending: false});
      await writeStatus(`Connected to ${health.targetName || 'Phase Pal'}. Choose chats and save your sync options.`);
      await schedule();
      if (settings.schedule === 'auto' && canCollect(settings)) void sync(true, 'auto');
    }),
    save: preferences => command(async () => {
      const settings = normalizePreferences(preferences);
      await stop();
      const {preferences: previous} = await api.storage.local.get('preferences');
      if (snapshotKey(previous) !== snapshotKey(settings)) await api.storage.local.remove('saved');
      await api.storage.local.set({preferences: settings, batchPending: false});
      await schedule();
      await writeStatus(!canCollect(settings) ? 'Select one or more chats, or choose Sync all chats.'
        : settings.schedule === 'manual' ? 'Options saved. Select Sync now when ready.' : 'Options saved. Automatic sync is enabled.');
      if (settings.schedule === 'auto' && canCollect(settings)) void sync(false, 'auto');
    }),
    disconnect: () => command(async () => {
      await stop();
      await api.alarms.clear(ALARM); await api.alarms.clear(CONTINUE);
      await api.storage.local.remove(['code', 'saved', 'batchPending']);
      await writeStatus('Disconnected.');
    }),
  };
}
