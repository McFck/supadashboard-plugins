import { website } from './protocol.js';

const key = 'webcompanionSuspendedMedia';
let pending = Promise.resolve();

async function read() {
  const stored = await chrome.storage.session.get(key);
  return stored[key] ?? {};
}

function update(change) {
  const operation = pending.then(async () => {
    const state = await read();
    const result = await change(state);
    await chrome.storage.session.set({ [key]: state });
    return result;
  });
  pending = operation.catch(() => {});
  return operation;
}

export async function mediaSuspended() {
  return Object.keys(await read()).length > 0;
}

export function forgetSuspendedTab(id, navigating = false) {
  return update((state) => {
    if (navigating && state[id]?.muted) {
      state[id].paused = false;
    } else {
      delete state[id];
    }
  });
}

async function changePlayers(suspend) {
  // Chrome keeps this isolated world with the document across worker restarts.
  const paused = (globalThis.webcompanionPausedMedia ??= new Set());
  if (suspend) {
    let changed = false;
    for (const element of document.querySelectorAll('video, audio')) {
      if (!element.paused && !element.ended) {
        paused.add(element);
        element.pause();
        changed = true;
      }
    }
    return changed;
  }
  const players = [...paused].filter((element) => element.isConnected && !element.ended);
  paused.clear();
  const results = await Promise.allSettled(players.map((element) => element.play()));
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      paused.add(players[index]);
    }
  }
  return paused.size === 0;
}

const canScript = (tab) => website(tab.url);

function changeTabPlayers(tab, suspend) {
  return chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: changePlayers,
    args: [suspend],
  });
}

async function suspendTab(tab, state) {
  const previous = state[tab.id];
  let paused = false;
  if (canScript(tab)) {
    const frames = await changeTabPlayers(tab, true).catch(() => []);
    paused = frames.some(({ result }) => result === true);
  }
  let muted = previous?.muted === true;
  if (tab.audible && !paused && !previous?.paused && !tab.mutedInfo?.muted) {
    await chrome.tabs.update(tab.id, { muted: true });
    muted = true;
  }
  if (paused || muted || previous?.paused) {
    state[tab.id] = { paused: paused || previous?.paused === true, muted };
  }
}

async function resumeTab(tab, state) {
  const entry = state[tab.id];
  if (entry.paused && canScript(tab)) {
    const frames = await changeTabPlayers(tab, false);
    entry.paused = frames.some(({ result }) => result !== true);
  } else {
    entry.paused = false;
  }
  if (entry.muted && tab.mutedInfo?.muted && tab.mutedInfo.extensionId === chrome.runtime.id) {
    await chrome.tabs.update(tab.id, { muted: false });
  }
  entry.muted = false;
  if (!entry.paused) {
    delete state[tab.id];
  }
  return !entry.paused;
}

export function suspendMedia(mode) {
  return update(async (state) => {
    const tabs = await chrome.tabs.query({ windowType: 'normal' });
    const suspend = mode === 'on' || (mode === 'toggle' && !Object.keys(state).length);
    if (suspend) {
      const attempts = await Promise.allSettled(tabs.map((tab) => suspendTab(tab, state)));
      return attempts.every((attempt) => attempt.status === 'fulfilled');
    }
    const open = new Set(tabs.map((tab) => String(tab.id)));
    for (const id of Object.keys(state)) {
      if (!open.has(id)) {
        delete state[id];
      }
    }
    const attempts = await Promise.allSettled(
      tabs.filter((tab) => state[tab.id]).map((tab) => resumeTab(tab, state)),
    );
    return attempts.every((attempt) => attempt.status === 'fulfilled' && attempt.value);
  });
}
