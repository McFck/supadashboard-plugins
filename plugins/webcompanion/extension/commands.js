import { activeTab, ensure, isSelected, mediaTab, selectTab } from './browser.js';
import { isSelection } from './outline-worker.js';
import { fields, idInRange, website } from './protocol.js';

const GONE = Symbol('Tab closed');
const COVERED = Symbol('Element covered');

async function existingTab(id) {
  return chrome.tabs.get(id).catch(() => {
    throw GONE;
  });
}

async function page(tab, action) {
  if (!tab?.url || !website(tab.url)) {
    return false;
  }
  await ensure(tab);
  return (await chrome.tabs.sendMessage(tab.id, action, { frameId: 0 })) === true;
}

async function outline(action) {
  const { input } = action;
  if (!isSelection(input.selection) || !isSelected(input.selection.tab)) {
    return false;
  }
  const tab = input.selection.tab;
  if (input.kind !== 'press') {
    return (
      fields(input, 'kind', 'selection') &&
      (await chrome.tabs.sendMessage(tab, action, { frameId: 0 })) === true
    );
  }
  if (!fields(input, 'kind', 'selection', 'background') || typeof input.background !== 'boolean') {
    return false;
  }
  const active = await activeTab(await chrome.tabs.query({ windowType: 'normal', active: true }));
  if (active?.id !== tab || !isSelected(tab)) {
    return false;
  }
  const response = await chrome.tabs.sendMessage(tab, action, { frameId: 0 });
  if (fields(response, 'covered') && response.covered === true) {
    throw COVERED;
  }
  if (!input.background) {
    return response === true;
  }
  const url = fields(response, 'url') && website(response.url);
  if (!url || !isSelected(tab)) {
    return false;
  }
  await chrome.tabs.create({ windowId: active.windowId, url, active: false });
  return true;
}

async function tabCommand(action) {
  await existingTab(action.tab);
  try {
    if (action.kind === 'activate') {
      selectTab(await chrome.tabs.update(action.tab, { active: true }));
    } else {
      await chrome.tabs.remove(action.tab);
    }
  } catch (error) {
    await existingTab(action.tab);
    throw error;
  }
  return true;
}

async function run(action) {
  switch (action.kind) {
    case 'activate':
    case 'close':
      return tabCommand(action);
    case 'open': {
      const url = website(action.url);
      const tab = await activeTab(await chrome.tabs.query({ windowType: 'normal', active: true }));
      if (!url || !tab) {
        return false;
      }
      if (action.destination === 'current') {
        await chrome.tabs.update(tab.id, { url });
      } else if (action.destination === 'new') {
        await chrome.tabs.create({ windowId: tab.windowId, url, active: true });
      } else {
        return false;
      }
      return true;
    }
    case 'page':
      if (['preview', 'clear_preview', 'press'].includes(action.input?.kind)) {
        return outline(action);
      }
      return page(
        await activeTab(await chrome.tabs.query({ windowType: 'normal', active: true })),
        action,
      );
    case 'media': {
      const tabs = await chrome.tabs.query({ windowType: 'normal' });
      const player = mediaTab(tabs, await activeTab(tabs));
      if (!player) {
        return false;
      }
      const tab = await existingTab(player.id);
      if (action.input.kind === 'fullscreen') {
        const window = await chrome.windows.get(tab.windowId);
        await chrome.windows.update(tab.windowId, {
          state: window.state === 'fullscreen' ? 'normal' : 'fullscreen',
        });
        return true;
      }
      return page(tab, action);
    }
    default:
      return false;
  }
}

export function isCommand(message) {
  return (
    fields(message, 'kind', 'id', 'action') &&
    message.kind === 'command' &&
    idInRange(message.id, 0xffffffff)
  );
}

export async function reply({ id, action }) {
  try {
    return { kind: 'done', id, ok: await run(action) };
  } catch (error) {
    return { kind: 'done', id, ok: false, gone: error === GONE, covered: error === COVERED };
  }
}
