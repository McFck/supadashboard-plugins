(() => {
  if (globalThis.webcompanionPointer) {
    return;
  }
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important';
  const cursor = document.createElement('div');
  cursor.style.cssText =
    'position:absolute;width:14px;height:14px;translate:-50% -50%;border:2px solid white;border-radius:50%;box-shadow:0 0 0 2px #111,0 0 0 4px #2563eb;pointer-events:none';
  host.attachShadow({ mode: 'closed' }).append(cursor);
  let last;
  let pressed;
  let hovered;
  let hoverPath = [];
  let hide;
  const clamp = (value, size) => Math.round(Math.max(0, Math.min(value, size - 1, 32767)));

  function targetAt(x, y) {
    let target = document.elementFromPoint(x, y);
    for (
      let child = target?.shadowRoot?.elementFromPoint(x, y);
      child && child !== target;
      child = target.shadowRoot?.elementFromPoint(x, y)
    ) {
      target = child;
    }
    return target;
  }

  function event(target, type, buttons, relatedTarget = null) {
    const moving = /(?:move|over|out|enter|leave)$/.test(type);
    const boundary = /(?:enter|leave)$/.test(type);
    const options = {
      bubbles: !boundary,
      composed: !boundary,
      cancelable: !boundary,
      view: window,
      clientX: last.x,
      clientY: last.y,
      button: 0,
      buttons,
      relatedTarget,
      detail: type === 'click' ? 1 : 0,
    };
    const synthetic = type.startsWith('pointer')
      ? new PointerEvent(type, {
          ...options,
          button: moving ? -1 : 0,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        })
      : new MouseEvent(type, options);
    return target.dispatchEvent(synthetic);
  }

  function path(target) {
    const nodes = [];
    for (let node = target; node;) {
      nodes.push(node);
      const root = node.getRootNode();
      node = node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    }
    return nodes;
  }

  function hover(target) {
    if (target === hovered) {
      return;
    }
    const buttons = pressed ? 1 : 0;
    const previous = hoverPath;
    hoverPath = path(target);
    globalThis.webcompanionHover.apply(previous, hoverPath);
    if (hovered?.isConnected) {
      event(hovered, 'pointerout', buttons, target);
      event(hovered, 'mouseout', buttons, target);
    }
    for (const node of previous) {
      if (node.isConnected && !hoverPath.includes(node)) {
        event(node, 'pointerleave', buttons, target);
        event(node, 'mouseleave', buttons, target);
      }
    }
    if (target) {
      event(target, 'pointerover', buttons, hovered);
      event(target, 'mouseover', buttons, hovered);
    }
    for (let index = hoverPath.length - 1; index >= 0; index--) {
      const node = hoverPath[index];
      if (!previous.includes(node)) {
        event(node, 'pointerenter', buttons, hovered);
        event(node, 'mouseenter', buttons, hovered);
      }
    }
    hovered = target;
  }

  function position(dx, dy) {
    if (innerWidth < 1 || innerHeight < 1) {
      return null;
    }
    const x = clamp((last?.x ?? innerWidth / 2) + dx, innerWidth);
    const y = clamp((last?.y ?? innerHeight / 2) + dy, innerHeight);
    last = { x, y };
    cursor.style.transform = `translate(${x}px, ${y}px)`;
    if (!host.isConnected) {
      document.documentElement.append(host);
    }
    clearTimeout(hide);
    hide = setTimeout(cancel, 3000);
    return targetAt(x, y);
  }

  function down(target) {
    pressed = target;
    if (event(target, 'pointerdown', 1)) {
      event(target, 'mousedown', 1);
    }
  }

  function up(cancelled = false) {
    const target = pressed;
    pressed = undefined;
    if (target?.isConnected) {
      event(target, cancelled ? 'pointercancel' : 'pointerup', 0);
      event(target, 'mouseup', 0);
    }
  }

  function cancel() {
    clearTimeout(hide);
    up(true);
    hover(null);
    host.remove();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancel();
    }
  });
  window.addEventListener('pagehide', cancel);
  document.addEventListener(
    'scroll',
    () => {
      if (last && host.isConnected) {
        hover(targetAt(last.x, last.y));
      }
    },
    true,
  );

  function input(action) {
    if (action.kind === 'cancel') {
      cancel();
      return true;
    }
    if (document.hidden || !['begin', 'move', 'down', 'up', 'click'].includes(action.kind)) {
      return false;
    }
    const dx = action.kind === 'move' ? action.dx : 0;
    const dy = action.kind === 'move' ? action.dy : 0;
    if (![dx, dy].every((delta) => Number.isInteger(delta) && Math.abs(delta) <= 2048)) {
      return false;
    }
    const target = position(dx, dy);
    hover(target);
    if (!target) {
      return false;
    }
    switch (action.kind) {
      case 'begin':
        globalThis.webcompanionHover.prepare();
        event(target, 'mousemove', 0);
        return true;
      case 'move': {
        const receiver = pressed?.isConnected ? pressed : target;
        event(receiver, 'pointermove', pressed ? 1 : 0);
        event(receiver, 'mousemove', pressed ? 1 : 0);
        return true;
      }
      case 'down':
        down(target);
        return true;
      case 'up':
        up();
        return true;
      case 'click':
        down(target);
        up();
        if (target.isConnected && targetAt(last.x, last.y) === target) {
          event(target, 'click', 0);
        }
        return true;
    }
  }

  globalThis.webcompanionPointer = { input, anchor: () => last && [last.x, last.y] };
})();
