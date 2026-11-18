import { fields, idInRange, title, website } from './protocol.js';
import { forgetSuspendedTab, mediaSuspended } from './suspend.js';

const pages = new Map();
const injections = new Map();
const activeTabs = new Map();
let selectedWindow;
let lastMediaTab;
let refresh = () => {};

export function isSelected(id) {
  return activeTabs.get(selectedWindow) === id;
}

export function selectTab({ id, windowId }) {
  activeTabs.set(windowId, id);
  selectedWindow = windowId;
  refresh();
}

export function pagePort(id) {
  return pages.get(id)?.port;
}

export async function activeTab(tabs) {
  const selected = tabs.find((tab) => tab.active && tab.windowId === selectedWindow);
  if (selected) {
    return selected;
  }
  const last = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  return (
    tabs.find((tab) => tab.active && tab.windowId === last?.id) ?? tabs.find((tab) => tab.active)
  );
}

export function scroll(frame) {
  const tab = activeTabs.get(selectedWindow);
  if (frame.tab != null && frame.tab !== tab) {
    return;
  }
  const page = pages.get(tab);
  if (page) {
    try {
      page.port.postMessage(frame);
    } catch {
      // The document may have navigated before onDisconnect is delivered.
    }
  }
}

export async function ensure(tab) {
  if (pages.has(tab.id) || tab.status !== 'complete' || !tab.url || !website(tab.url)) {
    return;
  }
  let attempt = injections.get(tab.id);
  if (!attempt) {
    // Tabs already open at install time do not get the declared content script.
    attempt = chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['hover.js', 'pointer.js', 'page.js'],
    });
    injections.set(tab.id, attempt);
  }
  await attempt;
}

chrome.runtime.onConnect.addListener((port) => {
  const sender = port.sender;
  const id = sender?.tab?.id;
  if (
    port.name !== 'webcompanion-page' ||
    sender?.id !== chrome.runtime.id ||
    sender.frameId !== 0 ||
    !idInRange(id, 0x7fffffff) ||
    !sender.url ||
    !website(sender.url)
  ) {
    port.disconnect();
    return;
  }
  const page = { port, media: null };
  pages.set(id, page);
  refresh();
  port.onMessage.addListener((message) => {
    if (pages.get(id) !== page) {
      return;
    }
    if (!fields(message, 'kind', 'media') || message.kind !== 'media_changed') {
      return;
    }
    const media = message.media;
    if (
      media !== null &&
      (!fields(media, 'paused', 'rate') ||
        typeof media.paused !== 'boolean' ||
        typeof media.rate !== 'number' ||
        !(media.rate === 0 || (media.rate >= 0.0625 && media.rate <= 16)))
    ) {
      return;
    }
    page.media = media;
    if (media?.paused === false) {
      lastMediaTab = id;
    }
    refresh();
  });
  port.onDisconnect.addListener(() => {
    if (pages.get(id) === page) {
      pages.delete(id);
      refresh();
    }
  });
});

export function mediaTab(tabs, active) {
  if (pages.get(active?.id)?.media) {
    return active;
  }
  return (
    tabs.find((tab) => tab.audible && pages.get(tab.id)?.media?.paused === false) ??
    tabs.find((tab) => pages.get(tab.id)?.media?.paused === false) ??
    tabs.find((tab) => tab.id === lastMediaTab && pages.get(tab.id)?.media) ??
    tabs.find((tab) => pages.get(tab.id)?.media)
  );
}

async function snapshot() {
  const [open, tabGroups] = await Promise.all([
    chrome.tabs.query({ windowType: 'normal' }),
    chrome.tabGroups.query({}),
  ]);
  const all = open
    .filter((tab) => idInRange(tab.id, 0x7fffffff))
    .sort((a, b) => a.windowId - b.windowId || a.index - b.index);
  for (const tab of all) {
    if (tab.active && !activeTabs.has(tab.windowId)) {
      activeTabs.set(tab.windowId, tab.id);
    }
  }
  const active = await activeTab(all);
  if (!activeTabs.has(selectedWindow)) {
    selectedWindow = active?.windowId;
  }
  const tabs = all.slice(0, 256);
  if (active && !tabs.includes(active)) {
    tabs[255] = active;
  }
  for (const tab of tabs) {
    if (tab.id === active?.id || tab.audible) {
      void ensure(tab).catch(() => {
        // Some browser pages cannot be scripted even with host permission.
      });
    }
  }
  const player = mediaTab(tabs, active);
  const status = pages.get(player?.id)?.media;
  const window =
    player && status ? await chrome.windows.get(player.windowId).catch(() => null) : null;
  const used = new Set(tabs.map((tab) => tab.groupId));
  const groups = tabGroups.filter((group) => used.has(group.id));
  const groupWindows = new Map(groups.map((group) => [group.id, group.windowId]));
  return {
    kind: 'state',
    state: {
      tabs: tabs.map((tab) => {
        const icon = tab.favIconUrl && website(tab.favIconUrl);
        return {
          id: tab.id,
          title: title(tab.title),
          active: tab.active,
          favicon: icon && icon.length <= 512 && !icon.includes('\\') ? icon : null,
          window: tab.windowId,
          group: !tab.pinned && groupWindows.get(tab.groupId) === tab.windowId ? tab.groupId : null,
          pinned: tab.pinned,
        };
      }),
      activeTab: active?.id ?? null,
      groups: groups.map(({ id, windowId, title: name, color, collapsed }) => ({
        id,
        window: windowId,
        title: title(name),
        color,
        collapsed,
      })),
      media: window
        ? { tab: player.id, ...status, fullscreen: window.state === 'fullscreen' }
        : null,
      suspended: await mediaSuspended(),
    },
  };
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  activeTabs.set(windowId, tabId);
  refresh();
});
chrome.windows.onFocusChanged.addListener((id) => {
  if (id !== chrome.windows.WINDOW_ID_NONE) {
    selectedWindow = id;
    refresh();
  }
});
chrome.windows.onRemoved.addListener((id) => {
  activeTabs.delete(id);
  if (selectedWindow === id) {
    selectedWindow = undefined;
  }
  refresh();
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.status === 'loading') {
    injections.delete(id);
    void forgetSuspendedTab(id, true).then(refresh, console.error);
  }
  refresh();
});
chrome.tabs.onDetached.addListener((id, { oldWindowId }) => {
  if (activeTabs.get(oldWindowId) === id) {
    activeTabs.delete(oldWindowId);
  }
  refresh();
});
function removeTab(id) {
  pages.delete(id);
  injections.delete(id);
  for (const [window, active] of activeTabs) {
    if (active === id) {
      activeTabs.delete(window);
    }
  }
  refresh();
}
function removeClosedTab(id) {
  removeTab(id);
  void forgetSuspendedTab(id).then(refresh, console.error);
}
chrome.tabs.onRemoved.addListener(removeClosedTab);
chrome.tabs.onReplaced.addListener((_added, removed) => removeClosedTab(removed));

export function observe(send, onError) {
  const events = [
    chrome.tabs.onCreated,
    chrome.tabs.onMoved,
    chrome.tabs.onAttached,
    chrome.windows.onBoundsChanged,
    chrome.tabGroups.onCreated,
    chrome.tabGroups.onUpdated,
    chrome.tabGroups.onMoved,
    chrome.tabGroups.onRemoved,
  ];
  let timer;
  let running = false;
  let pending = false;
  let stopped = false;
  let heartbeatDue = false;
  let lastState;
  function schedule() {
    pending = true;
    if (!running && timer === undefined && !stopped) {
      timer = setTimeout(publish, 35);
    }
  }
  async function publish() {
    timer = undefined;
    running = true;
    pending = false;
    const heartbeat = heartbeatDue;
    heartbeatDue = false;
    try {
      const update = await snapshot();
      const state = JSON.stringify(update);
      if (!stopped && (heartbeat || state !== lastState)) {
        send(state);
        lastState = state;
      }
    } catch (error) {
      if (!stopped) {
        onError(error);
      }
    } finally {
      running = false;
      if (pending) {
        schedule();
      }
    }
  }
  for (const event of events) {
    event.addListener(schedule);
  }
  refresh = schedule;
  // Idle traffic keeps the MV3 worker connected.
  const heartbeat = setInterval(() => {
    heartbeatDue = true;
    schedule();
  }, 15_000);
  schedule();
  return {
    refresh: schedule,
    stop() {
      stopped = true;
      if (refresh === schedule) {
        refresh = () => {};
      }
      clearTimeout(timer);
      clearInterval(heartbeat);
      for (const event of events) {
        event.removeListener(schedule);
      }
    },
  };
}
