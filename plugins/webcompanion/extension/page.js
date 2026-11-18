(() => {
  if (globalThis.webcompanionInstalled) {
    return;
  }
  globalThis.webcompanionInstalled = true;

  function player() {
    const elements = [...document.querySelectorAll('video, audio')];
    return (
      elements.find((item) => !item.paused && !item.ended) ??
      elements.find((item) => item.currentSrc) ??
      elements[0]
    );
  }

  function status() {
    const element = player();
    return element ? { paused: element.paused || element.ended, rate: element.playbackRate } : null;
  }

  function scroll(input) {
    switch (input.kind) {
      case 'drag':
        window.scrollBy({ top: input.pixels, behavior: 'instant' });
        break;
      case 'fling':
        window.scrollBy({ top: input.pixels, behavior: 'smooth' });
        break;
      case 'page_up':
        window.scrollBy({ top: -window.innerHeight, behavior: 'smooth' });
        break;
      case 'page_down':
        window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
        break;
      case 'top':
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'bottom':
        window.scrollTo({ top: document.scrollingElement.scrollHeight, behavior: 'smooth' });
        break;
      default:
        return false;
    }
    return true;
  }

  async function media(input) {
    const element = player();
    if (!element) {
      return false;
    }
    switch (input.kind) {
      case 'toggle':
        if (element.paused || element.ended) {
          await element.play();
        } else {
          element.pause();
        }
        break;
      case 'back':
        element.currentTime = Math.max(0, element.currentTime - 10);
        break;
      case 'forward':
        element.currentTime = Math.min(element.duration || Infinity, element.currentTime + 10);
        break;
      case 'speed':
        element.playbackRate = input.rate;
        break;
      default:
        return false;
    }
    return true;
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) {
      return false;
    }
    switch (message.kind) {
      case 'status':
        respond(status());
        return false;
      case 'scroll':
        respond(scroll(message.input));
        return false;
      case 'media':
        media(message.input).then(respond, () => respond(false));
        return true;
      default:
        return false;
    }
  });

  function changed() {
    chrome.runtime.sendMessage({ kind: 'media_changed' }).catch(() => {
      // The browser may be disconnected or the extension may have reloaded.
    });
  }
  for (const event of ['play', 'pause', 'ended', 'ratechange', 'loadedmetadata']) {
    document.addEventListener(event, changed, true);
  }
  const observer = new MutationObserver((records) => {
    const hasPlayer = (node) =>
      node instanceof Element &&
      (node.matches('audio, video') || node.querySelector('audio, video'));
    if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some(hasPlayer))) {
      changed();
    }
  });
  observer.observe(document, { childList: true, subtree: true });
})();
