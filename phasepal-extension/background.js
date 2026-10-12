import {createSyncController} from './sync-controller.js';

const controller = createSyncController(chrome);
chrome.runtime.onInstalled.addListener(() => {void controller.ready;});
chrome.runtime.onStartup.addListener(() => {void controller.ready;});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.alarms.onAlarm.addListener(alarm => {void controller.alarm(alarm.name);});
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  let action;
  switch (message?.type) {
    case 'connect': action = controller.connect(message.code); break;
    case 'preferences': action = controller.save(message.preferences); break;
    case 'list': action = controller.list(message.cursor); break;
    case 'disconnect': action = controller.disconnect(); break;
    case 'sync': void controller.sync(Boolean(message.full)); reply({ok: true}); return;
    default: return;
  }
  action.then(result => reply({ok: true, ...result}), error => reply({ok: false, error: error.message}));
  return true;
});
