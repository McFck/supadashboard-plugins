import { ensure, isSelected, pagePort } from './browser.js';
import { fields, idInRange } from './protocol.js';

function valid(action) {
  if (!fields(action, 'kind', 'tab', 'input') || !idInRange(action.tab, 0x7fffffff)) {
    return false;
  }
  const { input } = action;
  if (input?.kind === 'move') {
    return (
      fields(input, 'kind', 'dx', 'dy') &&
      [input.dx, input.dy].every((delta) => Number.isInteger(delta) && Math.abs(delta) <= 2048)
    );
  }
  return fields(input, 'kind') && ['begin', 'click', 'down', 'up', 'cancel'].includes(input.kind);
}

function send(port, input) {
  try {
    port.postMessage({ kind: 'pointer_input', input });
    return true;
  } catch {
    // The previous document can disconnect while a tab change is being delivered.
    return false;
  }
}

export class BrowserPointer {
  #session;
  #stopped = false;
  #tail = Promise.resolve();

  constructor() {
    chrome.tabs.onActivated.addListener(this.#activeChanged);
    chrome.windows.onFocusChanged.addListener(this.#activeChanged);
    chrome.tabs.onUpdated.addListener(this.#navigated);
  }

  dispatch(action) {
    if (!valid(action)) {
      return Promise.resolve(false);
    }
    const next = this.#tail.then(() => this.#apply(action));
    this.#tail = next.catch(() => this.#cancel());
    return next;
  }

  stop() {
    this.#stopped = true;
    chrome.tabs.onActivated.removeListener(this.#activeChanged);
    chrome.windows.onFocusChanged.removeListener(this.#activeChanged);
    chrome.tabs.onUpdated.removeListener(this.#navigated);
    this.#cancel();
  }

  #activeChanged = () => {
    if (this.#session && !isSelected(this.#session.tab)) {
      this.#cancel();
    }
  };

  #navigated = (tab, change) => {
    if (change.status === 'loading' && this.#session?.tab === tab) {
      this.#cancel();
    }
  };

  #cancel() {
    const session = this.#session;
    this.#session = undefined;
    if (session) {
      send(session.port, { kind: 'cancel' });
    }
  }

  async #begin(tab, input) {
    let port = pagePort(tab);
    if (!port) {
      const candidate = await chrome.tabs.get(tab);
      await ensure(candidate);
      port = pagePort(tab);
    }
    if (!port || this.#stopped || !isSelected(tab)) {
      return false;
    }
    if (this.#session?.port !== port) {
      this.#cancel();
    }
    if (!send(port, input)) {
      return false;
    }
    this.#session = { tab, port };
    return true;
  }

  async #apply({ tab, input }) {
    if (input.kind === 'cancel') {
      if (this.#session?.tab === tab) {
        this.#cancel();
      }
      return true;
    }
    if (this.#stopped || !isSelected(tab)) {
      return false;
    }
    if (input.kind === 'begin') {
      return this.#begin(tab, input);
    }
    const session = this.#session;
    if (session?.tab !== tab || session.port !== pagePort(tab)) {
      return false;
    }
    return send(session.port, input);
  }
}
