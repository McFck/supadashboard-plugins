(() => {
  if (globalThis.webcompanionOutline) {
    return;
  }

  const doc = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const excluded =
    'form:has(input[type="password"], [autocomplete^="cc-"], [autocomplete$="password"]), input, select, textarea, [contenteditable]:not([contenteditable="false"]), [hidden], [inert], [aria-hidden="true"]';
  const actionable =
    'a[href], button, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"]';
  const images = 'img, picture, video, canvas, iframe, svg';
  const headings = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
  const ring = document.createElement('div');
  ring.setAttribute('aria-hidden', 'true');
  const ids = new WeakMap();
  let nextId = 0;
  let seq = 0;
  let current;
  let bridge;
  let events;
  let update;
  let expiry;
  let preview;
  let anchor;
  let lastPublish = -Infinity;
  let lastScroll = -Infinity;

  function clear() {
    preview = undefined;
    ring.remove();
    clearTimeout(expiry);
  }

  function rectangle(node, width, height) {
    const raw = node.getBoundingClientRect();
    let left = Math.max(0, raw.left);
    let top = Math.max(0, raw.top);
    let right = Math.min(width, raw.right);
    let bottom = Math.min(height, raw.bottom);
    if (left >= right || top >= bottom) {
      return;
    }
    for (
      let parent = node.parentElement;
      parent && parent !== document.body;
      parent = parent.parentElement
    ) {
      const style = getComputedStyle(parent);
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        const box = parent.getBoundingClientRect();
        if (style.overflowX !== 'visible') {
          left = Math.max(left, box.left + parent.clientLeft);
          right = Math.min(right, box.left + parent.clientLeft + parent.clientWidth);
        }
        if (style.overflowY !== 'visible') {
          top = Math.max(top, box.top + parent.clientTop);
          bottom = Math.min(bottom, box.top + parent.clientTop + parent.clientHeight);
        }
      }
    }
    const x = Math.ceil(left);
    const y = Math.ceil(top);
    const w = Math.floor(right) - x;
    const h = Math.floor(bottom) - y;
    const style = getComputedStyle(node);
    return w > 0 &&
      h > 0 &&
      style.visibility === 'visible' &&
      node.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      })
      ? { x, y, w, h }
      : undefined;
  }

  function fingerprint(node) {
    const context = node.closest('article, li, [role="listitem"], tr') ?? node.parentElement;
    return [
      location.href,
      node.getAttribute('href'),
      node.getAttribute('aria-label'),
      node.getAttribute('role'),
      node.textContent?.slice(0, 256),
      context?.textContent?.slice(0, 512),
    ].join('\0');
  }

  function label(node, kind) {
    const text =
      node.getAttribute('aria-label') ?? (node.querySelector(excluded) ? '' : node.innerText) ?? '';
    const cleaned = text
      .replace(/(?:\b\w+:\/\/|\bwww\.)\S+/gi, '')
      .replace(/[\s\p{Cc}]+/gu, ' ')
      .trim();
    return (
      Array.from(cleaned.slice(0, 160)).slice(0, 80).join('') ||
      (kind === 'link' ? 'Link' : 'Button')
    );
  }

  function target(node, rect) {
    const signature = fingerprint(node);
    let identity = ids.get(node);
    if (!identity || identity.signature !== signature) {
      identity = { id: ++nextId, signature };
      ids.set(node, identity);
    }
    const kind = node.matches('a[href], [role="link"]') ? 'link' : 'button';
    return { id: identity.id, kind, rect, label: label(node, kind) };
  }

  function moving() {
    return bridge?.moving() || performance.now() - lastScroll < 150;
  }

  function extract(width, height) {
    const shapes = [];
    const targets = [];
    const nodes = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        return node === ring || node.matches(excluded)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let scan = 0; scan < 4500; scan++) {
      const node = walker.nextNode();
      if (!node) {
        break;
      }
      const interactive =
        targets.length < 80 &&
        node instanceof HTMLElement &&
        !node.matches(':disabled, [aria-disabled="true"]') &&
        node.matches(actionable);
      let kind;
      if (shapes.length < 160) {
        if (node.matches(images)) {
          kind = 'image';
        } else if (node.matches(headings)) {
          kind = 'heading';
        } else if (
          node.matches('p, li, dd, label, blockquote') ||
          (node.firstChild?.nodeType === Node.TEXT_NODE && node.firstChild.textContent.trim())
        ) {
          kind = 'text';
        }
      }
      if (!interactive && !kind) {
        continue;
      }
      const rect = rectangle(node, width, height);
      if (rect && interactive) {
        const entry = target(node, rect);
        nodes.set(entry.id, { node, signature: ids.get(node).signature });
        targets.push(entry);
      } else if (rect && kind) {
        shapes.push({ kind, rect });
      }
    }
    return { shapes, targets, nodes };
  }

  function publish() {
    update = undefined;
    if (!bridge || !document.body || document.hidden) {
      return;
    }
    const width = Math.min(innerWidth, 32768);
    const height = Math.min(innerHeight, 32768);
    if (width <= 0 || height <= 0) {
      return;
    }
    const { shapes, targets, nodes } = extract(width, height);
    const inMotion = moving();
    current = { nodes, seq: ++seq };
    lastPublish = performance.now();
    bridge.send({
      kind: 'outline',
      view: { doc, seq, width, height, moving: inMotion, shapes, targets },
    });
    if (inMotion) {
      schedule();
    }
  }

  function schedule() {
    if (bridge && update === undefined) {
      update = setTimeout(publish, Math.max(0, lastPublish + 150 - performance.now()));
    }
  }

  const observer = new MutationObserver((records) => {
    if (
      records.some(
        ({ target, type, addedNodes, removedNodes }) =>
          target !== ring &&
          (type !== 'childList' || [...addedNodes, ...removedNodes].some((node) => node !== ring)),
      )
    ) {
      schedule();
    }
  });

  function scroll() {
    lastScroll = performance.now();
    clear();
    schedule();
  }

  function watch(next) {
    if (next && bridge) {
      return;
    }
    observer.disconnect();
    events?.abort();
    clearTimeout(update);
    update = undefined;
    current = undefined;
    anchor = undefined;
    clear();
    bridge = next;
    if (bridge) {
      events = new AbortController();
      document.addEventListener('scroll', scroll, { capture: true, signal: events.signal });
      document.addEventListener('visibilitychange', schedule, { signal: events.signal });
      window.addEventListener('resize', schedule, { signal: events.signal });
      observer.observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      schedule();
    }
  }

  function resolve(selection) {
    if (
      !bridge ||
      !current ||
      document.hidden ||
      moving() ||
      selection.doc !== doc ||
      selection.seq > current.seq
    ) {
      return;
    }
    const entry = current.nodes.get(selection.target);
    if (
      !entry?.node.isConnected ||
      entry.node.closest(excluded) ||
      entry.node.matches(':disabled, [aria-disabled="true"]') ||
      entry.signature !== fingerprint(entry.node)
    ) {
      return;
    }
    const rect = rectangle(entry.node, innerWidth, innerHeight);
    const { x, y } = selection;
    if (!rect || x < rect.x || y < rect.y || x >= rect.x + rect.w || y >= rect.y + rect.h) {
      return;
    }
    if (!entry.node.contains(document.elementFromPoint(x + 0.5, y + 0.5))) {
      return { covered: true };
    }
    return { ...entry, rect };
  }

  function select(input) {
    const { selection } = input;
    if (input.kind === 'clear_preview') {
      if (selection.doc === doc && preview?.token === selection.token) {
        clear();
      }
      return true;
    }
    const entry = resolve(selection);
    if (!entry || entry.covered) {
      clear();
      return input.kind === 'press' && entry?.covered ? { covered: true } : false;
    }
    if (input.kind === 'preview') {
      clear();
      preview = { ...selection, signature: entry.signature };
      anchor = [selection.x, selection.y];
      const { x, y, w, h } = entry.rect;
      ring.style.cssText = `all:initial;position:fixed;pointer-events:none;z-index:2147483647;left:${x}px;top:${y}px;width:${w}px;height:${h}px;outline:2px solid #fff;box-shadow:0 0 0 4px #2563eb;border-radius:3px`;
      document.documentElement.append(ring);
      expiry = setTimeout(clear, 2500);
      return true;
    }
    const armed = preview;
    clear();
    if (
      !armed ||
      armed.signature !== entry.signature ||
      ['doc', 'seq', 'target', 'x', 'y', 'token'].some((key) => armed[key] !== selection[key])
    ) {
      return false;
    }
    if (input.background) {
      return entry.node instanceof HTMLAnchorElement ? { url: entry.node.href } : false;
    }
    entry.node.click();
    return true;
  }

  globalThis.webcompanionOutline = { watch, select, schedule, anchor: () => anchor };
})();
