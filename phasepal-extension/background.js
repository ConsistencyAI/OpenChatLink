import {WORKER_REVISION} from './worker-version.js';
import {createSourceController} from './sync-controller.js';

const controller = createSourceController(chrome);
chrome.runtime.onInstalled.addListener(() => {void controller.ready;});
chrome.runtime.onStartup.addListener(() => {void controller.ready;});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.alarms.onAlarm.addListener(alarm => {void controller.alarm(alarm.name);});
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === 'worker-info') {reply({ok: true, revision: WORKER_REVISION}); return;}
  let action;
  switch (message?.type) {
    case 'connect': action = controller.connect(message.code); break;
    case 'preferences': action = controller.save(message.source, message.preferences); break;
    case 'list': action = controller.list(message.source, message.cursor); break;
    case 'disconnect': action = controller.disconnect(); break;
    case 'sync': action = controller.sync(message.source, Boolean(message.full)); break;
    default: return;
  }
  action.then(result => reply({ok: true, ...result}), error => reply({ok: false, error: error.message}));
  return true;
});
