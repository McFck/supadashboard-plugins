import { idInRange, MAX_TAB_ID, title, website } from './protocol.js';
import {
  ensure,
  forgetInjection,
  forgetPage,
  mediaTab,
  onPagesChanged,
  pageMedia,
  pagePort,
  preparePointer,
} from './pages.js';
import { forgetSuspendedTab, mediaSuspended } from './suspend.js';

const activeTabs = new Map();
let selectedWindow;
let refresh = () => {};
onPagesChanged(() => refresh());

export function isSelected(id) {
  return activeTabs.get(selectedWindow) === id;
}

export function selectTab({ id, windowId }) {
  activeTabs.set(windowId, id);
  selectedWindow = windowId;
  refresh();
}

export const tabOrder = (a, b) => a.windowId - b.windowId || a.index - b.index;

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
  if (frame.tab !== activeTabs.get(selectedWindow)) {
    return;
  }
  try {
    pagePort(frame.tab)?.postMessage(frame);
  } catch {
    // The document may have navigated before onDisconnect is delivered.
  }
}

function describeTab(tab, groupWindows) {
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
}

async function snapshot() {
  const [open, tabGroups] = await Promise.all([
    chrome.tabs.query({ windowType: 'normal' }),
    chrome.tabGroups.query({}),
  ]);
  const all = open.filter((tab) => idInRange(tab.id, MAX_TAB_ID)).sort(tabOrder);
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
  preparePointer(active?.id);
  for (const tab of tabs) {
    if (tab.id === active?.id || tab.audible) {
      void ensure(tab).catch(() => {
        // Some browser pages cannot be scripted even with host permission.
      });
    }
  }
  const player = mediaTab(tabs, active);
  const status = pageMedia(player?.id);
  const window =
    player && status ? await chrome.windows.get(player.windowId).catch(() => null) : null;
  const used = new Set(tabs.map((tab) => tab.groupId));
  const groups = tabGroups.filter((group) => used.has(group.id));
  const groupWindows = new Map(groups.map((group) => [group.id, group.windowId]));
  return {
    kind: 'state',
    state: {
      tabs: tabs.map((tab) => describeTab(tab, groupWindows)),
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
    forgetInjection(id);
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
function removeClosedTab(id) {
  forgetPage(id);
  for (const [window, active] of activeTabs) {
    if (active === id) {
      activeTabs.delete(window);
    }
  }
  refresh();
  void forgetSuspendedTab(id).then(refresh, console.error);
}
chrome.tabs.onRemoved.addListener(removeClosedTab);
chrome.tabs.onReplaced.addListener((_added, removed) => removeClosedTab(removed));

/** Publishes the browser state after changes settle, and at least every 15 s. */
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
  let phase = { kind: 'idle' };
  let dirty = false;
  let heartbeatDue = false;
  let lastState;
  function schedule() {
    dirty = true;
    if (phase.kind === 'idle') {
      phase = { kind: 'waiting', timer: setTimeout(publish, 35) };
    }
  }
  async function publish() {
    phase = { kind: 'publishing' };
    dirty = false;
    const heartbeat = heartbeatDue;
    heartbeatDue = false;
    try {
      const state = JSON.stringify(await snapshot());
      if (phase.kind !== 'stopped' && (heartbeat || state !== lastState)) {
        send(state);
        lastState = state;
      }
    } catch (error) {
      if (phase.kind !== 'stopped') {
        onError(error);
      }
    } finally {
      if (phase.kind === 'publishing') {
        phase = { kind: 'idle' };
        if (dirty) {
          schedule();
        }
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
      if (phase.kind === 'waiting') {
        clearTimeout(phase.timer);
      }
      phase = { kind: 'stopped' };
      if (refresh === schedule) {
        refresh = () => {};
      }
      clearInterval(heartbeat);
      for (const event of events) {
        event.removeListener(schedule);
      }
    },
  };
}
