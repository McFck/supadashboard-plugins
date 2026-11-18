(() => {
  if (globalThis.webcompanionPointer) {
    return;
  }
  const doc = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important';
  const cursor = document.createElement('div');
  cursor.style.cssText =
    'position:absolute;width:14px;height:14px;translate:-50% -50%;border:2px solid white;border-radius:50%;box-shadow:0 0 0 2px #111,0 0 0 4px #2563eb;pointer-events:none';
  host.attachShadow({ mode: 'closed' }).append(cursor);
  let last;
  let hide;
  const clamp = (value, size) => Math.round(Math.max(0, Math.min(value, size - 1, 32767)));

  globalThis.webcompanionPointer = ({ dx, dy }) => {
    if (
      document.hidden ||
      innerWidth < 1 ||
      innerHeight < 1 ||
      ![dx, dy].every((delta) => Number.isInteger(delta) && Math.abs(delta) <= 2048)
    ) {
      return false;
    }
    const x = clamp((last?.x ?? innerWidth / 2) + dx, innerWidth);
    const y = clamp((last?.y ?? innerHeight / 2) + dy, innerHeight);
    last = { x, y };
    cursor.style.transform = `translate(${x}px, ${y}px)`;
    if (!host.isConnected) {
      document.documentElement.append(host);
    }
    clearTimeout(hide);
    hide = setTimeout(() => host.remove(), 3000);
    return { doc, x, y };
  };
})();
