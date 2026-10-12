import {syncChatGPT, listChatGPTConversations} from './providers/chatgpt.js';
import {syncClaude, listClaudeConversations} from './providers/claude.js';
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
      await writeStatus('Syncing your chosen history…', true);
      const result = await collect({pairing: parsePairing(code), preferences: settings, saved, full,
        collector, fetcher, signal: cancellation.signal,
        report: async progress => owner === generation && writeStatus(
          `Syncing: ${progress.processed ?? 0} conversations checked…`, true),
      });
      if (owner !== generation) return;
      await api.storage.local.set({saved: result, batchPending: result.hasMore, status: {running: false,
        message: result.failures > 0 ? `Some chats could not be read. ${settings.schedule === 'auto' ? 'Automatic sync will retry.' : 'Select Sync now to retry.'}`
          : result.hasMore ? 'Sync is continuing with the next batch…'
          : `Synced ${result.count} conversations in this batch. New chats go to ${result.targetName || 'Phase Pal'}.`,
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

export const SOURCES = ['chatgpt', 'claude', 'codex', 'claude-code'];
export const isLocal = source => source === 'codex' || source === 'claude-code';

function scopedApi(api, source) {
  const key = name => name === 'code' ? name : `${name}:${source}`;
  return {...api, storage: {local: {
    async get(names) {const list = Array.isArray(names) ? names : [names]; const data = await api.storage.local.get(list.map(key)); return Object.fromEntries(list.map(name => [name, data[key(name)]]));},
    set: data => api.storage.local.set(Object.fromEntries(Object.entries(data).map(([name, value]) => [key(name), value]))),
    remove: names => api.storage.local.remove((Array.isArray(names) ? names : [names]).map(key)),
  }}, alarms: {
    create: (name, options) => api.alarms.create(`${name}:${source}`, options),
    clear: name => api.alarms.clear(`${name}:${source}`),
  }};
}

export function createSourceController(api, {fetcher, collectors = {}, catalogs = {}} = {}) {
  const browsers = Object.fromEntries(['chatgpt', 'claude'].map(source => [source, createSyncController(scopedApi(api, source), {
    fetcher, collector: collectors[source] ?? (source === 'chatgpt' ? syncChatGPT : syncClaude),
    catalog: catalogs[source] ?? (source === 'chatgpt' ? listChatGPTConversations : listClaudeConversations)
  })]));
  const sourceApi = source => {
    if (!SOURCES.includes(source)) throw new Error('Choose a supported source.');
    return scopedApi(api, source);
  };
  const client = async () => createClient(parsePairing((await api.storage.local.get('code')).code), fetcher);
  return {
    ready: Promise.all(Object.values(browsers).map(controller => controller.ready)),
    async connect(code) {
      for (const controller of Object.values(browsers)) await controller.connect(code);
      for (const source of ['codex', 'claude-code']) {
        const {preferences} = await sourceApi(source).storage.local.get('preferences');
        if (preferences) await (await client()).localPreferences(source, normalizePreferences(preferences));
      }
    },
    async list(source, cursor) {sourceApi(source); return isLocal(source) ? (await client()).localCatalog(source, cursor) : browsers[source].list(cursor);},
    async save(source, preferences) {
      const scoped = sourceApi(source), settings = normalizePreferences(preferences);
      if (!isLocal(source)) return browsers[source].save(settings);
      await (await client()).localPreferences(source, settings);
      await scoped.storage.local.set({preferences: settings, status: {running: false,
        message: settings.schedule === 'auto' ? 'Saved. Phase Pal checks selected local chats every five seconds while sync is enabled.' : 'Saved. Select Sync now when ready.'}});
    },
    async sync(source, full = false) {
      const scoped = sourceApi(source);
      if (!isLocal(source)) return browsers[source].sync(full);
      await (await client()).localSync(source);
      await scoped.storage.local.set({status: {running: false, message: 'Local sync queued. Selected chats will appear in Phase Pal history.'}});
    },
    alarm(name) {const source = name.split(':')[1]; return browsers[source]?.alarm(name.split(':')[0]) ?? Promise.resolve();},
    async disconnect() {
      if ((await api.storage.local.get('code')).code) await (await client()).pauseLocal();
      for (const controller of Object.values(browsers)) await controller.disconnect();
      for (const source of ['codex', 'claude-code']) await sourceApi(source).storage.local.set({status: {message: 'Disconnected.', running: false}});
    },
  };
}
