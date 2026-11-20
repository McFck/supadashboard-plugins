(() => {
  if (globalThis.webcompanionHover) {
    return;
  }
  const attribute = 'data-supadashboard-hover';
  const HOVER_DWELL_MS = 120;
  const selectors = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\\.)|:hover(?![\w-])/gi;
  const processed = new WeakMap();
  const versions = new WeakMap();
  const roots = new Set();
  let active = false;
  let scheduled = false;
  let again = false;
  let applied = [];
  let hoverTimer;

  function cssRules(container) {
    try {
      return container.cssRules;
    } catch {
      // The browser protects stylesheets loaded without cross-origin access.
      return undefined;
    }
  }

  function* rules(children) {
    for (const rule of children ?? []) {
      yield rule;
      yield* rules(cssRules(rule.styleSheet ?? rule));
    }
  }

  function* sheets() {
    for (const root of roots) {
      if (root instanceof ShadowRoot && !root.host.isConnected) {
        roots.delete(root);
        continue;
      }
      for (const sheet of [...root.styleSheets, ...root.adoptedStyleSheets]) {
        if (sheet.disabled) {
          continue;
        }
        const children = cssRules(sheet);
        if (!children) {
          continue;
        }
        const version = versions.get(sheet);
        const length = children.length;
        const first = children[0];
        const last = children[length - 1];
        if (version?.length === length && version.first === first && version.last === last) {
          continue;
        }
        yield* rules(children);
        versions.set(sheet, { length, first, last });
      }
    }
  }

  function prepare() {
    active = true;
    if (scheduled) {
      again = true;
      return;
    }
    scheduled = true;
    again = false;
    const pending = sheets();
    function scan(deadline) {
      do {
        const next = pending.next();
        if (next.done) {
          scheduled = false;
          if (again) {
            prepare();
          }
          return;
        }
        const rule = next.value;
        if (rule instanceof CSSStyleRule && processed.get(rule) !== rule.selectorText) {
          const before = rule.selectorText;
          // Keep the original cascade, specificity, and physical mouse hover behavior.
          const after = before.replace(
            selectors,
            (_, literal) => literal ?? `:is(:hover,[${attribute}])`,
          );
          if (before !== after) {
            rule.selectorText = after;
          }
          processed.set(rule, rule.selectorText);
        }
      } while (deadline.timeRemaining() > 2);
      requestIdleCallback(scan, { timeout: 120 });
    }
    requestIdleCallback(scan, { timeout: 120 });
  }

  function settle(current) {
    clearTimeout(hoverTimer);
    if (applied.length > 0) {
      applied = applied.filter((node) => {
        if (current.includes(node)) {
          return true;
        }
        node.removeAttribute(attribute);
        return false;
      });
    }
    if (applied.length < current.length) {
      // A hover selector can restyle a whole subtree. Wait for motion to settle before adding it.
      hoverTimer = setTimeout(() => mark(current), HOVER_DWELL_MS);
    }
  }

  function mark(current) {
    for (const node of current) {
      if (node.isConnected && !applied.includes(node)) {
        const root = node.getRootNode();
        if (root instanceof ShadowRoot && !roots.has(root)) {
          roots.add(root);
          prepare();
        }
        node.setAttribute(attribute, '');
        applied.push(node);
      }
    }
  }

  roots.add(document);
  document.addEventListener(
    'load',
    (event) => {
      if (active && event.target instanceof HTMLLinkElement && event.target.rel === 'stylesheet') {
        if (event.target.sheet) {
          versions.delete(event.target.sheet);
        }
        prepare();
      }
    },
    true,
  );
  globalThis.webcompanionHover = { settle, prepare };
})();
