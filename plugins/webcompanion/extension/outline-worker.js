import { fields, idInRange, isHex } from './protocol.js';

const AXIS = 32768;
const encoder = new TextEncoder();

function positive(value, max = 0xffffffff) {
  return idInRange(value, max) && value > 0;
}

export function isSelection(selection) {
  return (
    fields(selection, 'tab', 'doc', 'seq', 'target', 'x', 'y', 'token') &&
    idInRange(selection.tab, 0x7fffffff) &&
    isHex(selection.doc, 32) &&
    positive(selection.seq) &&
    positive(selection.target) &&
    idInRange(selection.x, AXIS - 1) &&
    idInRange(selection.y, AXIS - 1) &&
    isHex(selection.token, 32)
  );
}

function fits(rect, width, height) {
  return (
    fields(rect, 'x', 'y', 'w', 'h') &&
    idInRange(rect.x, width) &&
    idInRange(rect.y, height) &&
    positive(rect.w, width - rect.x) &&
    positive(rect.h, height - rect.y)
  );
}

function validView(view) {
  if (
    !fields(view, 'doc', 'seq', 'width', 'height', 'moving', 'shapes', 'targets') ||
    !isHex(view.doc, 32) ||
    !positive(view.seq) ||
    !positive(view.width, AXIS) ||
    !positive(view.height, AXIS) ||
    typeof view.moving !== 'boolean' ||
    !Array.isArray(view.shapes) ||
    view.shapes.length > 160 ||
    !Array.isArray(view.targets) ||
    view.targets.length > 80
  ) {
    return false;
  }
  const { width, height, shapes, targets } = view;
  return (
    shapes.every(
      (shape) =>
        fields(shape, 'kind', 'rect') &&
        ['text', 'heading', 'image'].includes(shape.kind) &&
        fits(shape.rect, width, height),
    ) &&
    targets.every(
      (target) =>
        fields(target, 'id', 'kind', 'rect', 'label') &&
        positive(target.id) &&
        ['button', 'link'].includes(target.kind) &&
        fits(target.rect, width, height) &&
        typeof target.label === 'string' &&
        target.label.length <= 160 &&
        Array.from(target.label).length <= 80 &&
        !/\p{Cc}/u.test(target.label),
    ) &&
    new Set(targets.map(({ id }) => id)).size === targets.length
  );
}

export class OutlineWatch {
  #enabled = false;
  #source;
  #watching;

  constructor(send) {
    this.send = send;
  }

  enable(enabled) {
    this.#enabled = enabled;
    this.#sync();
  }

  source(id, port) {
    if (this.#source?.port !== port || this.#source?.id !== id) {
      this.#source = port ? { id, port } : undefined;
      this.#sync();
    }
  }

  invalidate(id) {
    if (this.#source?.id === id) {
      this.source();
    }
  }

  #signal(source, enabled) {
    try {
      source.port.postMessage({ kind: 'outline_watch', enabled });
      return true;
    } catch {
      // The tab navigated before its port disconnect was delivered.
      return false;
    }
  }

  #sync() {
    const next = this.#enabled ? this.#source : undefined;
    if (this.#watching === next) {
      return;
    }
    if (this.#watching) {
      this.#signal(this.#watching, false);
      if (this.#enabled) {
        this.send('{"kind":"outline","view":null}');
      }
    }
    this.#watching = next && this.#signal(next, true) ? next : undefined;
  }

  receive(port, message) {
    if (
      this.#watching?.port !== port ||
      !fields(message, 'kind', 'view') ||
      !validView(message.view)
    ) {
      return;
    }
    const frame = JSON.stringify({
      kind: 'outline',
      view: { ...message.view, tab: this.#watching.id },
    });
    if (encoder.encode(frame).length <= 64 * 1024) {
      this.send(frame);
    }
  }
}
