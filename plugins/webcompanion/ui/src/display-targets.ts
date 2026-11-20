import type { PluginBrowserSnapshot, PluginDisplay } from '@supadashboard/kit';
import type { BrowserTab } from './tabs';

type Browser = Extract<PluginBrowserSnapshot, { kind: 'connected' }>;
type BrowserDisplay = Browser['displays'][number];

function matchDisplays(displays: BrowserDisplay[], monitors: readonly PluginDisplay[]) {
  const matches = new Map<BrowserDisplay, PluginDisplay>();
  const unused = new Set(monitors);
  const near = (dip: number, pixels: number, scale: number) => Math.abs(dip - pixels / scale) <= 1;
  function match(sizesOnly: boolean) {
    const pending = displays.filter((display) => !matches.has(display));
    const candidates = pending.map((display) => {
      const bounds = display.bounds;
      return [...unused].filter(
        ({ left, top, width, height, scaleFactor }) =>
          bounds &&
          near(bounds.width, width, scaleFactor) &&
          near(bounds.height, height, scaleFactor) &&
          (sizesOnly ||
            (near(bounds.left, left, scaleFactor) && near(bounds.top, top, scaleFactor))),
      );
    });
    pending.forEach((display, index) => {
      const [monitor] = candidates[index];
      if (
        monitor &&
        candidates[index].length === 1 &&
        candidates.filter((choices) => choices.includes(monitor)).length === 1
      ) {
        matches.set(display, monitor);
        unused.delete(monitor);
      }
    });
  }

  match(false);
  // Chromium adjusts origins to keep adjacent mixed-DPI displays touching in DIP.
  match(true);
  if (displays.length === monitors.length) {
    const ordered = [...unused].sort((a, b) => a.left - b.left || a.top - b.top);
    displays
      .filter((display) => !matches.has(display))
      .forEach((display, index) => matches.set(display, ordered[index]));
  }
  return matches;
}

export function displayTargets(
  { displays }: Browser,
  tab: BrowserTab,
  monitors: readonly PluginDisplay[] = [],
) {
  if (displays.length < 2) {
    return [];
  }
  const matches = matchDisplays(displays, monitors);
  const names = displays.map((display) => matches.get(display)?.label ?? display.name);
  return displays.flatMap(({ id, windows }, index) => {
    const name = names[index];
    const repeated = names.filter((other) => other === name).length > 1;
    const label = name && !repeated ? name : `${name || 'Display'} ${index + 1}`;
    return windows.includes(tab.window) ? [] : [{ id, label }];
  });
}
