import {syncChatGPT} from './providers/chatgpt.js';
import {collect, createClient, parsePairing} from './protocol.js';

const ALARM = 'openchatlink-sync';
const CONTINUE = 'openchatlink-continue';
let operation = null;
let cancellation = null;
let generation = 0;
const startup = chrome.storage.local.get('status').then(({status}) => {
  if (status?.running) return chrome.storage.local.set({status: {running: false, message: 'Ready to resume sync.'}});
});

async function runOwned(full, owner) {
  try {
    await startup;
    const {code, saved} = await chrome.storage.local.get(['code', 'saved']);
    if (!code || owner !== generation) return;
    cancellation = new AbortController();
    const pairing = parsePairing(code);
    await chrome.storage.local.set({status: {running: true, message: 'Syncing ChatGPT conversations…'}});
    const result = await collect({pairing, saved, full, collector: syncChatGPT, signal: cancellation.signal,
      report: async progress => owner === generation && chrome.storage.local.set({status: {
        running: true, message: `Syncing: ${progress.processed ?? 0} conversations checked…`,
      }}),
    });
    if (owner !== generation) return;
    await chrome.storage.local.set({saved: result, status: {running: false,
      message: `Synced ${result.count} conversations to ${result.targetName || 'Phase Pal'}.`, lastSuccess: Date.now()}});
    await chrome.action.setBadgeText({text: ''});
    if (result.hasMore) await chrome.alarms.create(CONTINUE, {delayInMinutes: 0.5});
  } catch (error) {
    if (owner !== generation) return;
    await chrome.storage.local.set({status: {running: false, message: error.message}});
    await chrome.action.setBadgeText({text: '!'});
  } finally {
    cancellation = null;
  }
}

function run(full = false) {
  if (operation) return operation;
  operation = runOwned(full, generation).finally(() => {operation = null;});
  return operation;
}

async function stop() {
  generation++;
  cancellation?.abort();
  if (operation) await operation;
}

async function schedule() {
  await chrome.alarms.create(ALARM, {periodInMinutes: 1});
}
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener(alarm => {if ([ALARM, CONTINUE].includes(alarm.name)) void run();});
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === 'connect') {
    (async () => {
      const pairing = parsePairing(message.code);
      const health = await createClient(pairing).health();
      await stop();
      await chrome.storage.local.set({code: message.code.trim(), saved: {}, status: {
        running: false, message: `Connected to ${health.targetName || 'Phase Pal'}. Syncing will start now.`,
      }});
      await schedule();
      void run(true);
      return {ok: true};
    })().then(reply, error => reply({ok: false, error: error.message}));
    return true;
  }
  if (message?.type === 'sync') {void run(Boolean(message.full)); reply({ok: true});}
  if (message?.type === 'disconnect') {
    stop().then(async () => {
      await chrome.alarms.clear(ALARM);
      await chrome.alarms.clear(CONTINUE);
      await chrome.storage.local.remove(['code', 'saved']);
      await chrome.storage.local.set({status: {running: false, message: 'Disconnected.'}});
      reply({ok: true});
    });
    return true;
  }
});
