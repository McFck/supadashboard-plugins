import { fields, idInRange, title, website } from './protocol.js';

let selectedWindow;

async function activeTab(tabs) {
  const selected = tabs.find((tab) => tab.active && tab.windowId === selectedWindow);
  if (selected) {
    return selected;
  }
  const last = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  return (
    tabs.find((tab) => tab.active && tab.windowId === last?.id) ?? tabs.find((tab) => tab.active)
  );
}

async function page(tab, message) {
  if (!tab.url || !website(tab.url)) {
    throw new Error('This page does not allow browser controls');
  }
  const send = () => chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  try {
    return await send();
  } catch {
    // Existing tabs and newly navigated documents may not have the content script yet.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page.js'] });
    return send();
  }
}

async function mediaOn(tab) {
  try {
    const status = await page(tab, { kind: 'status' });
    if (status) {
      return { tab: tab.id, ...status };
    }
  } catch {
    // Chrome blocks scripting on some pages, and tabs can close during a snapshot.
  }
  return null;
}

async function mediaState(tabs, active) {
  const current = active ? await mediaOn(active) : null;
  let media = current;
  if (current?.paused !== false) {
    const audible = tabs.filter((tab) => tab.audible && tab.id !== active?.id);
    const players = await Promise.all(audible.map(mediaOn));
    media = players.find((player) => player?.paused === false) ?? current;
  }
  if (!media) {
    return null;
  }
  const tab = tabs.find((item) => item.id === media.tab);
  const window = await chrome.windows.get(tab.windowId).catch(() => null);
  return window ? { ...media, fullscreen: window.state === 'fullscreen' } : null;
}

async function snapshot() {
  const all = (await chrome.tabs.query({ windowType: 'normal' })).filter((tab) =>
    idInRange(tab.id, 0x7fffffff),
  );
  const active = await activeTab(all);
  const tabs = all.slice(0, 256);
  if (active && !tabs.includes(active)) {
    tabs[255] = active;
  }
  const media = await mediaState(tabs, active);
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
        };
      }),
      activeTab: active?.id ?? null,
      media,
    },
  };
}

async function run(action) {
  switch (action.kind) {
    case 'activate': {
      const tab = await chrome.tabs.update(action.tab, { active: true });
      selectedWindow = tab.windowId;
      return;
    }
    case 'close':
      await chrome.tabs.remove(action.tab);
      return;
    case 'open': {
      const url = website(action.url);
      const tab = await activeTab(await chrome.tabs.query({ windowType: 'normal', active: true }));
      if (!url || !tab) {
        throw new Error('No browser window or invalid URL');
      }
      if (action.destination === 'current') {
        await chrome.tabs.update(tab.id, { url });
      } else if (action.destination === 'new') {
        await chrome.tabs.create({ windowId: tab.windowId, url, active: true });
      } else {
        throw new Error('Invalid destination');
      }
      return;
    }
    case 'scroll': {
      const tab = await activeTab(await chrome.tabs.query({ windowType: 'normal', active: true }));
      if (!tab || tab.id !== action.tab || (await page(tab, action)) !== true) {
        throw new Error('No active scroll target');
      }
      return;
    }
    case 'media': {
      const tab = await chrome.tabs.get(action.tab);
      if (action.input.kind === 'fullscreen') {
        const window = await chrome.windows.get(tab.windowId);
        await chrome.windows.update(tab.windowId, {
          state: window.state === 'fullscreen' ? 'normal' : 'fullscreen',
        });
      } else if ((await page(tab, action)) !== true) {
        throw new Error('No media target');
      }
      return;
    }
    default:
      throw new Error('Unknown browser action');
  }
}

export async function reply(message) {
  if (!fields(message, 'id', 'action') || !idInRange(message.id, 0xffffffff)) {
    throw new Error('Invalid browser request');
  }
  try {
    await run(message.action);
    return { kind: 'done', id: message.id, ok: true };
  } catch {
    return { kind: 'done', id: message.id, ok: false };
  }
}

export function observe(send, onError) {
  const events = [
    chrome.tabs.onCreated,
    chrome.tabs.onUpdated,
    chrome.tabs.onActivated,
    chrome.tabs.onRemoved,
    chrome.tabs.onMoved,
    chrome.tabs.onAttached,
    chrome.tabs.onDetached,
    chrome.tabs.onReplaced,
    chrome.windows.onBoundsChanged,
  ];
  let timer;
  let running = false;
  let pending = false;
  let stopped = false;
  function refresh() {
    pending = true;
    if (!running && timer === undefined && !stopped) {
      timer = setTimeout(publish, 35);
    }
  }
  async function publish() {
    timer = undefined;
    running = true;
    pending = false;
    try {
      const state = await snapshot();
      if (!stopped) {
        send(state);
      }
    } catch (error) {
      if (!stopped) {
        onError(error);
      }
    } finally {
      running = false;
      if (pending) {
        refresh();
      }
    }
  }
  function focus(windowId) {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
      selectedWindow = undefined;
      refresh();
    }
  }
  function media(message, sender) {
    if (message?.kind === 'media_changed' && sender.tab && sender.frameId === 0) {
      refresh();
    }
  }
  for (const event of events) {
    event.addListener(refresh);
  }
  chrome.windows.onFocusChanged.addListener(focus);
  chrome.runtime.onMessage.addListener(media);
  // Idle traffic keeps the MV3 worker alive and recovers missed page notifications.
  const heartbeat = setInterval(refresh, 15_000);
  refresh();
  return {
    refresh,
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      for (const event of events) {
        event.removeListener(refresh);
      }
      chrome.windows.onFocusChanged.removeListener(focus);
      chrome.runtime.onMessage.removeListener(media);
    },
  };
}
