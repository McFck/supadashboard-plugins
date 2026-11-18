import { ensure, isSelected } from './browser.js';
import { fields, idInRange, isHex, website } from './protocol.js';

const MOTION = ['move', 'wheel'];
const BUTTON = ['begin', 'click', 'down', 'up', 'cancel'];
const validDelta = (delta) => Number.isInteger(delta) && Math.abs(delta) <= 2048;

function validAction({ tab, input }) {
  if (!idInRange(tab, 0x7fffffff)) {
    return false;
  }
  if (MOTION.includes(input?.kind)) {
    return fields(input, 'kind', 'dx', 'dy') && validDelta(input.dx) && validDelta(input.dy);
  }
  return fields(input, 'kind') && BUTTON.includes(input.kind);
}

export class BrowserPointer {
  #session;
  #tail = Promise.resolve();
  #idle;
  #stopped = false;

  constructor() {
    chrome.tabs.onActivated.addListener(this.#activeChanged);
    chrome.windows.onFocusChanged.addListener(this.#activeChanged);
    chrome.tabs.onUpdated.addListener(this.#navigated);
    chrome.debugger.onDetach.addListener(this.#detached);
  }

  dispatch(action) {
    if (!validAction(action)) {
      return Promise.resolve(false);
    }
    return this.#enqueue(() => this.#apply(action));
  }

  stop() {
    this.#stopped = true;
    chrome.tabs.onActivated.removeListener(this.#activeChanged);
    chrome.windows.onFocusChanged.removeListener(this.#activeChanged);
    chrome.tabs.onUpdated.removeListener(this.#navigated);
    chrome.debugger.onDetach.removeListener(this.#detached);
    void this.#enqueue(() => this.#end());
  }

  #activeChanged = () => {
    if (this.#session && !isSelected(this.#session.tab)) {
      this.#invalidate();
    }
  };

  #navigated = (tab, change) => {
    if (change.status === 'loading' && this.#session?.tab === tab) {
      this.#invalidate();
    }
  };

  #detached = ({ tabId }) => {
    if (tabId === this.#session?.tab) {
      this.#session = undefined;
      clearTimeout(this.#idle);
    }
  };

  #invalidate() {
    const session = this.#session;
    session.valid = false;
    void this.#enqueue(() => this.#end(session));
  }

  #enqueue(task) {
    const next = this.#tail.then(task);
    this.#tail = next.catch(() => this.#end());
    return next;
  }

  async #attach(tab) {
    await this.#end();
    const candidate = await chrome.tabs.get(tab);
    if (
      this.#stopped ||
      !isSelected(tab) ||
      !candidate.active ||
      candidate.status !== 'complete' ||
      !website(candidate.url)
    ) {
      return;
    }
    await ensure(candidate);
    if (this.#stopped || !isSelected(tab)) {
      return;
    }
    const target = { tabId: tab };
    await chrome.debugger.attach(target, '1.3');
    this.#session = { tab, target, valid: true, pressed: false };
  }

  async #end(session = this.#session) {
    if (!session || this.#session !== session) {
      return;
    }
    this.#session = undefined;
    clearTimeout(this.#idle);
    try {
      if (session.pressed) {
        // Release outside the page so cancel cannot activate the pressed control.
        await this.#mouse(
          session,
          'mouseReleased',
          { x: -1, y: -1 },
          {
            button: 'left',
            buttons: 0,
            clickCount: 0,
          },
        );
      }
    } catch {
      // A closed tab or manually detached debugger has already released input.
    } finally {
      await chrome.debugger.detach(session.target).catch(() => {
        // A browser-initiated detach may win the race.
      });
    }
  }

  #mouse(session, type, point, extra = {}) {
    return chrome.debugger.sendCommand(session.target, 'Input.dispatchMouseEvent', {
      type,
      x: point.x,
      y: point.y,
      ...extra,
    });
  }

  async #point(session, input) {
    const { tab } = session;
    const move = input.kind === 'move';
    const point = await chrome.tabs.sendMessage(
      tab,
      {
        kind: 'pointer_position',
        dx: move ? input.dx : 0,
        dy: move ? input.dy : 0,
      },
      { frameId: 0 },
    );
    if (!session.valid || this.#stopped || this.#session !== session || !isSelected(tab)) {
      return;
    }
    if (
      !fields(point, 'doc', 'x', 'y') ||
      !isHex(point.doc, 32) ||
      !idInRange(point.x, 32767) ||
      !idInRange(point.y, 32767) ||
      (session.doc && session.doc !== point.doc)
    ) {
      return;
    }
    session.doc = point.doc;
    return point;
  }

  async #apply({ tab, input }) {
    if (input.kind === 'cancel') {
      if (this.#session?.tab === tab) {
        await this.#end();
      }
      return true;
    }
    if (this.#stopped || !isSelected(tab)) {
      return false;
    }
    if (input.kind === 'begin' && (this.#session?.tab !== tab || !this.#session.valid)) {
      await this.#attach(tab);
    }
    const session = this.#session;
    if (!session?.valid || session.tab !== tab) {
      return false;
    }
    if (input.kind === 'up' && !session.pressed) {
      return true;
    }
    clearTimeout(this.#idle);
    const point = await this.#point(session, input);
    if (!point) {
      await this.#end(session);
      return false;
    }
    await this.#input(session, point, input);
    // A lost tablet connection or release must never leave a button held.
    this.#idle = setTimeout(() => void this.#enqueue(() => this.#end(session)), 3000);
    return true;
  }

  async #input(session, point, input) {
    switch (input.kind) {
      case 'begin':
      case 'move':
        await this.#mouse(session, 'mouseMoved', point, {
          button: session.pressed ? 'left' : 'none',
          buttons: session.pressed ? 1 : 0,
        });
        return;
      case 'wheel':
        await this.#mouse(session, 'mouseWheel', point, {
          deltaX: input.dx,
          deltaY: input.dy,
        });
        return;
      case 'down':
      case 'click':
        if (!session.pressed) {
          await this.#mouse(session, 'mousePressed', point, {
            button: 'left',
            buttons: 1,
            clickCount: input.kind === 'click' ? 1 : 0,
          });
          session.pressed = true;
        }
        if (input.kind === 'down') {
          return;
        }
        break;
      case 'up':
        break;
    }
    await this.#mouse(session, 'mouseReleased', point, {
      button: 'left',
      buttons: 0,
      clickCount: input.kind === 'click' ? 1 : 0,
    });
    session.pressed = false;
  }
}
