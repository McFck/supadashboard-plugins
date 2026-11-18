import { activeTab, ensure, mediaTab, selectTab } from './browser.js';
import { fields, idInRange, website } from './protocol.js';
import { suspendMedia } from './suspend.js';

const GONE = Symbol('Tab closed');
let tabCommands = Promise.resolve();

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

async function fullscreen(windowId) {
  const window = await chrome.windows.get(windowId);
  await chrome.windows.update(windowId, {
    state: window.state === 'fullscreen' ? 'normal' : 'fullscreen',
  });
  return true;
}

const currentTab = async () =>
  activeTab(await chrome.tabs.query({ windowType: 'normal', active: true }));

async function select(id, pointer) {
  await existingTab(id);
  const tab = await chrome.tabs.update(id, { active: true });
  selectTab(tab);
  if (website(tab.url)) {
    await pointer.dispatch({ kind: 'pointer', tab: id, input: { kind: 'begin' } }).catch(() => {
      // A restricted or still-loading page can be selected even if it cannot show the pointer.
    });
  }
  return true;
}

async function cycle(tab, direction, pointer) {
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId: tab.windowId }),
    chrome.tabGroups.query({ windowId: tab.windowId, collapsed: true }),
  ]);
  const collapsed = new Set(groups.map((group) => group.id));
  const visible = tabs
    .filter((entry) => entry.id === tab.id || !collapsed.has(entry.groupId))
    .sort((a, b) => a.index - b.index);
  const index = visible.findIndex((entry) => entry.id === tab.id);
  if (index === -1) {
    throw GONE;
  }
  const target = visible[(index + direction + visible.length) % visible.length];
  if (target.id !== tab.id) {
    return select(target.id, pointer);
  }
  return true;
}

async function tabCommand(input, pointer) {
  const tab = await currentTab();
  switch (input) {
    case 'new':
      selectTab(await chrome.tabs.create({ windowId: tab?.windowId, active: true }));
      return true;
    case 'reopen': {
      const [closed] = await chrome.sessions.getRecentlyClosed({ maxResults: 1 });
      if (!closed?.tab?.sessionId || !tab) {
        return false;
      }
      const { tab: restored } = await chrome.sessions.restore(closed.tab.sessionId);
      if (restored && restored.windowId === tab.windowId) {
        selectTab(restored);
      }
      return Boolean(restored);
    }
    case 'close':
      if (!tab) {
        return false;
      }
      await chrome.tabs.remove(tab.id);
      return true;
    case 'next':
    case 'previous':
      return tab ? cycle(tab, input === 'next' ? 1 : -1, pointer) : false;
    default:
      return false;
  }
}

async function pageCommand(action) {
  const tab = await currentTab();
  if (!tab) {
    return false;
  }
  switch (action.input.kind) {
    case 'back':
      await chrome.tabs.goBack(tab.id);
      break;
    case 'forward':
      await chrome.tabs.goForward(tab.id);
      break;
    case 'reload':
      await chrome.tabs.reload(tab.id);
      break;
    default:
      return page(tab, action);
  }
  return true;
}

async function run(action, pointer) {
  switch (action.kind) {
    case 'pointer':
      return pointer.dispatch(action);
    case 'tab':
    case 'select_tab':
    case 'close_tab':
    case 'group': {
      const command = tabCommands.then(async () => {
        switch (action.kind) {
          case 'select_tab':
            return select(action.tab, pointer);
          case 'close_tab':
            await existingTab(action.tab);
            await chrome.tabs.remove(action.tab);
            return true;
          case 'group':
            await chrome.tabGroups.update(action.group, { collapsed: action.collapsed });
            return true;
          default:
            return tabCommand(action.input, pointer);
        }
      });
      tabCommands = command.catch(() => {});
      return command;
    }
    case 'open': {
      const url = website(action.url);
      const tab = await currentTab();
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
      return pageCommand(action);
    case 'window_fullscreen': {
      const tab = await currentTab();
      return tab ? fullscreen(tab.windowId) : false;
    }
    case 'suspend':
      return suspendMedia(action.mode);
    case 'media': {
      const tabs = await chrome.tabs.query({ windowType: 'normal' });
      const player = mediaTab(tabs, await activeTab(tabs));
      if (!player) {
        return false;
      }
      const tab = await existingTab(player.id);
      if (action.input.kind === 'fullscreen') {
        return fullscreen(tab.windowId);
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

export async function reply({ id, action }, pointer) {
  try {
    return { kind: 'done', id, ok: await run(action, pointer) };
  } catch (error) {
    return { kind: 'done', id, ok: false, gone: error === GONE };
  }
}
