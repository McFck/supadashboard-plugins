(() => {
  if (globalThis.webcompanionHover) {
    return;
  }
  const attribute = 'data-supadashboard-hover';
  const selectors = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\\.)|:hover(?![\w-])/gi;
  const processed = new WeakMap();
  const roots = new Set();
  let active = false;
  let scheduled = false;
  let again = false;

  function* rules(container) {
    let children;
    try {
      children = container.cssRules;
    } catch {
      // The browser protects stylesheets loaded without cross-origin access.
      return;
    }
    for (const rule of children ?? []) {
      yield rule;
      yield* rules(rule.styleSheet ?? rule);
    }
  }

  function* sheets() {
    for (const root of roots) {
      if (root instanceof ShadowRoot && !root.host.isConnected) {
        roots.delete(root);
        continue;
      }
      for (const sheet of [...root.styleSheets, ...root.adoptedStyleSheets]) {
        if (!sheet.disabled) {
          yield* rules(sheet);
        }
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

  function apply(previous, current) {
    for (const node of previous) {
      if (!current.includes(node)) {
        node.removeAttribute(attribute);
      }
    }
    for (const node of current) {
      const root = node.getRootNode();
      if (root instanceof ShadowRoot && !roots.has(root)) {
        roots.add(root);
        prepare();
      }
      if (!previous.includes(node)) {
        node.setAttribute(attribute, '');
      }
    }
  }

  roots.add(document);
  document.addEventListener(
    'load',
    (event) => {
      if (active && event.target instanceof HTMLLinkElement && event.target.rel === 'stylesheet') {
        prepare();
      }
    },
    true,
  );
  globalThis.webcompanionHover = { apply, prepare };
})();
