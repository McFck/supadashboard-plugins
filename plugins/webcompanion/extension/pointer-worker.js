import { ensure, isSelected } from './browser.js';
import { fields, idInRange, isHex, website } from './protocol.js';

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

function send(tab, doc, input) {
  return chrome.tabs.sendMessage(tab, { kind: 'pointer_input', doc, input }, { frameId: 0 });
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
    void this.#cancel();
  }

  #activeChanged = () => {
    if (this.#session && !isSelected(this.#session.tab)) {
      void this.#cancel();
    }
  };

  #navigated = (tab, change) => {
    if (change.status === 'loading' && this.#session?.tab === tab) {
      void this.#cancel();
    }
  };

  async #cancel() {
    const session = this.#session;
    this.#session = undefined;
    if (session?.doc) {
      await send(session.tab, session.doc, { kind: 'cancel' }).catch(() => {
        // The old document may have gone away with the gesture.
      });
    }
  }

  async #begin(tab, input) {
    if (this.#session?.tab === tab && this.#session.doc) {
      const session = this.#session;
      if ((await send(tab, session.doc, input)) === true) {
        return this.#session === session && !this.#stopped && isSelected(tab);
      }
    }
    await this.#cancel();
    const candidate = await chrome.tabs.get(tab);
    if (!candidate.active || candidate.status !== 'complete' || !website(candidate.url)) {
      return false;
    }
    await ensure(candidate);
    if (this.#stopped || !isSelected(tab)) {
      return false;
    }
    const session = { tab, doc: undefined };
    this.#session = session;
    const response = await send(tab, null, input);
    if (
      this.#session !== session ||
      this.#stopped ||
      !isSelected(tab) ||
      !fields(response, 'doc') ||
      !isHex(response.doc, 32)
    ) {
      return false;
    }
    session.doc = response.doc;
    return true;
  }

  async #apply({ tab, input }) {
    if (input.kind === 'cancel') {
      if (this.#session?.tab === tab) {
        await this.#cancel();
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
    if (session?.tab !== tab || !session.doc) {
      return false;
    }
    return (await send(tab, session.doc, input)) === true;
  }
}
