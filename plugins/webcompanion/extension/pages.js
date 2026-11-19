import { fields, idInRange, isMedia, MAX_TAB_ID, website } from './protocol.js';

const pages = new Map();
const injections = new Map();
let lastMediaTab;
let changed = () => {};

export function onPagesChanged(listener) {
  changed = listener;
}

export function pagePort(id) {
  return pages.get(id)?.port;
}

export function pageMedia(id) {
  return pages.get(id)?.media;
}

export function forgetInjection(id) {
  injections.delete(id);
}

export function forgetPage(id) {
  pages.delete(id);
  injections.delete(id);
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
    attempt.catch(() => {
      if (injections.get(tab.id) === attempt) {
        injections.delete(tab.id);
      }
    });
    injections.set(tab.id, attempt);
  }
  await attempt;
}

export function mediaTab(tabs, active) {
  if (pageMedia(active?.id)) {
    return active;
  }
  return (
    tabs.find((tab) => tab.audible && pageMedia(tab.id)?.paused === false) ??
    tabs.find((tab) => pageMedia(tab.id)?.paused === false) ??
    tabs.find((tab) => tab.id === lastMediaTab && pageMedia(tab.id)) ??
    tabs.find((tab) => pageMedia(tab.id))
  );
}

chrome.runtime.onConnect.addListener((port) => {
  const sender = port.sender;
  const id = sender?.tab?.id;
  if (
    port.name !== 'webcompanion-page' ||
    sender?.id !== chrome.runtime.id ||
    sender.frameId !== 0 ||
    !idInRange(id, MAX_TAB_ID) ||
    !sender.url ||
    !website(sender.url)
  ) {
    port.disconnect();
    return;
  }
  const page = { port, media: null };
  pages.set(id, page);
  changed();
  port.onMessage.addListener((message) => {
    if (
      pages.get(id) !== page ||
      !fields(message, 'kind', 'media') ||
      message.kind !== 'media_changed' ||
      !isMedia(message.media)
    ) {
      return;
    }
    page.media = message.media;
    if (message.media?.paused === false) {
      lastMediaTab = id;
    }
    changed();
  });
  port.onDisconnect.addListener(() => {
    if (pages.get(id) === page) {
      pages.delete(id);
      changed();
    }
  });
});
