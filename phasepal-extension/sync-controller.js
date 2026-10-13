import {syncChatGPT, listChatGPTConversations} from './providers/chatgpt.js';
import {syncClaude, listClaudeConversations} from './providers/claude.js';
import {collect, createClient, parsePairing} from './protocol.js';
import {NotLoggedInError, RateLimitedError, syncError} from './lib/common.js';
import {canCollect, normalizePreferences, snapshotKey} from './preferences.js';

export const ALARM = 'openchatlink-sync';
export const CONTINUE = 'openchatlink-continue';

// Serialize each source's activity writes and bound storage; never include chat content.
function statusWriter(api) {
  let pending = Promise.resolve();
  return (message, running = false, level = 'info', extra = {}) => {
    const write = pending.then(async () => {
      const {activity = []} = await api.storage.local.get('activity');
      if (activity.at(-1)?.message !== message) activity.push({time: Date.now(), message, level});
      await api.storage.local.set({status: {message, running, level, ...extra}, activity: activity.slice(-100)});
    });
    pending = write.catch(() => {});
    return write;
  };
}

export function createSyncController(api, {collector = syncChatGPT, catalog = listChatGPTConversations, fetcher, source = 'chatgpt'} = {}) {
  let operation = null, cancellation = null, generation = 0;
  const writeStatus = statusWriter(api);
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
    const {status, batchPending} = await api.storage.local.get(['status', 'batchPending']);
    if (status?.running) await writeStatus(batchPending ? 'Waiting for the next batch; Chrome must stay open.' : 'The previous sync was interrupted. Select Sync now to retry.', Boolean(batchPending));
    await schedule();
  })();

  async function runOwned(full, trigger, owner) {
    let feedbackClient, run;
    try {
      await ready;
      const {code, saved, preferences, batchPending, syncRun} = await api.storage.local.get(['code', 'saved', 'preferences', 'batchPending', 'syncRun']);
      const settings = normalizePreferences(preferences);
      if (!code || owner !== generation) return;
      if ((trigger === 'auto' && settings.schedule !== 'auto') || (trigger === 'continue' && !batchPending)) return;
      if (!canCollect(settings)) {await writeStatus('Select chats and save your options before syncing.'); return;}
      cancellation = new AbortController();
      feedbackClient = createClient(parsePairing(code), fetcher);
      if (trigger === 'manual' && syncRun) await feedbackClient.syncFeedback(source, 'cancel', {...syncRun, failures: 0});
      run = trigger !== 'manual' && batchPending && syncRun ? syncRun : {id: crypto.randomUUID(), manual: trigger === 'manual', failures: 0, checked: 0, scanned: 0, delivered: 0};
      await api.storage.local.set({syncRun: run});
      await feedbackClient.syncFeedback(source, 'start', {...run, failures: 0});
      let heartbeat = Date.now();
      const totals = {processed: 0, inspected: 0, delivered: 0};
      await writeStatus(batchPending && trigger !== 'manual' ? 'Resuming the next batch…' : 'Starting sync…', true);
      const result = await collect({pairing: parsePairing(code), preferences: settings, saved, full,
        collector, fetcher, signal: cancellation.signal,
        report: async progress => {
          if (owner !== generation) return;
          for (const key of Object.keys(totals)) if (Number.isFinite(progress[key])) totals[key] = Math.max(totals[key], progress[key]);
          const checked = (run.checked ?? 0) + totals.processed, scanned = (run.scanned ?? 0) + totals.inspected;
          const delivered = (run.delivered ?? 0) + totals.delivered;
          const stage = progress.phase === 'connecting' ? 'Checking the Phase Pal connection…'
            : progress.phase === 'discovering' ? 'Checking your browser sign-in and accounts…'
            : progress.phase === 'scanning' ? `Scanning chat list: ${scanned} entries scanned, ${checked} chats checked…`
            : progress.phase === 'saving' ? `Phase Pal received ${delivered} chats; ${checked} checked…`
            : progress.phase === 'error' ? progress.message
            : `Reading conversations: ${checked} checked, ${delivered} sent to Phase Pal…`;
          await writeStatus(stage, true, progress.phase === 'error' ? 'error' : 'info');
          if (Date.now() - heartbeat >= 5000) {
            await feedbackClient.syncFeedback(source, 'progress', {...run, failures: 0}); heartbeat = Date.now();
          }
        },
      });
      if (owner !== generation) return;
      if (result.hasMore && JSON.stringify(result.state) === JSON.stringify(saved?.state ?? {}))
        throw new Error('Sync stopped because the source returned the same batch. Refresh the chat list, then retry.');
      run.checked = (run.checked ?? 0) + Math.max(result.processed, totals.processed);
      run.scanned = (run.scanned ?? 0) + Math.max(result.inspected, totals.inspected);
      run.delivered = (run.delivered ?? 0) + result.delivered;
      run.failures = Math.min(10000, run.failures + (result.failures ?? 0));
      if (result.hasMore) {
        await feedbackClient.syncFeedback(source, 'progress', {...run, failures: 0});
        await api.storage.local.set({syncRun: run});
      } else {
        await feedbackClient.syncFeedback(source, 'finish', run);
        await api.storage.local.remove('syncRun');
      }
      await api.storage.local.set({saved: result, batchPending: result.hasMore});
      const summary = `${run.scanned} list entries scanned, ${run.checked} chats checked, ${run.delivered} sent to Phase Pal.`;
      await writeStatus(result.hasMore ? `${summary} Next batch in about 30 seconds; Chrome must stay open.`
        : run.failures > 0 ? `${summary} ${run.failures} reads failed. ${settings.schedule === 'auto' ? 'Automatic sync will retry.' : 'Select Sync now to retry.'}`
        : `Sync complete. ${summary}${run.delivered === 0 ? ' No new matching messages to import. Check your chat and history choices if this is unexpected.' : ''}`,
        result.hasMore, run.failures > 0 ? 'error' : 'info',
        !result.hasMore && run.failures === 0 ? {lastSuccess: Date.now()} : {});
      await api.action.setBadgeText({text: run.failures > 0 ? '!' : ''});
      if (result.hasMore) await api.alarms.create(CONTINUE, {delayInMinutes: 0.5});
      else await api.alarms.clear(CONTINUE);
    } catch (error) {
      if (owner !== generation) return;
      if (feedbackClient && run) {
        try {await feedbackClient.syncFeedback(source, 'finish', {...run, failures: Math.min(10000, run.failures + 1)});} catch {}
        await api.storage.local.remove('syncRun');
      }
      await api.storage.local.set({batchPending: false});
      await api.alarms.clear(CONTINUE);
      await writeStatus(error instanceof NotLoggedInError || error instanceof RateLimitedError || /https?:\/\//.test(error.message) ? syncError(error) : error.message, false, 'error');
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
    const {code, syncRun} = await api.storage.local.get(['code', 'syncRun']);
    if (code && syncRun) {
      try {await createClient(parsePairing(code), fetcher).syncFeedback(source, 'cancel', {...syncRun, failures: 0});} catch {}
    }
    await api.storage.local.remove('syncRun');
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
    fetcher, source, collector: collectors[source] ?? (source === 'chatgpt' ? syncChatGPT : syncClaude),
    catalog: catalogs[source] ?? (source === 'chatgpt' ? listChatGPTConversations : listClaudeConversations)
  })]));
  const sourceApi = source => {
    if (!SOURCES.includes(source)) throw new Error('Choose a supported source.');
    return scopedApi(api, source);
  };
  const localStatus = Object.fromEntries(['codex', 'claude-code'].map(source => [source, statusWriter(sourceApi(source))]));
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
      await scoped.storage.local.set({preferences: settings});
      await localStatus[source](settings.schedule === 'auto' ? 'Saved. Phase Pal checks selected local chats every five seconds while sync is enabled.' : 'Saved. Select Sync now when ready.');
    },
    async sync(source, full = false) {
      const scoped = sourceApi(source);
      if (!isLocal(source)) return browsers[source].sync(full);
      await localStatus[source]('Sending the local sync request to Phase Pal…', true);
      try {
        await (await client()).localSync(source);
        await localStatus[source]('Local sync queued. Check Phase Pal for completion and any issues.');
      } catch (error) {await localStatus[source](error.message, false, 'error'); throw error;}
    },
    alarm(name) {const source = name.split(':')[1]; return browsers[source]?.alarm(name.split(':')[0]) ?? Promise.resolve();},
    async disconnect() {
      // Capture the app client before clearing shared pairing. Stop browser work
      // even when the app is closed or its connection code has been revoked.
      const pairing = (await api.storage.local.get('code')).code;
      const app = pairing ? createClient(parsePairing(pairing), fetcher) : null;
      await Promise.all(Object.values(browsers).map(controller => controller.disconnect()));
      let pauseFailed = false;
      if (app) {try {await app.pauseLocal();} catch {pauseFailed = true;}}
      for (const source of ['codex', 'claude-code']) await sourceApi(source).storage.local.set({status: {
        message: pauseFailed ? 'Browser disconnected. Local sync could not be paused. Disable External Conversations in Phase Pal to stop local sync.' : 'Disconnected.', running: false}});
      if (pauseFailed) throw new Error('Browser disconnected. Local sync could not be paused. Disable External Conversations in Phase Pal to stop local sync.');
    },
  };
}
