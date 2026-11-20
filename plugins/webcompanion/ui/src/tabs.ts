import type { ControlConfig, PluginBrowserSnapshot } from '@supadashboard/kit';

type Browser = Extract<PluginBrowserSnapshot, { kind: 'connected' }>;
export type BrowserTab = Browser['tabs'][number];
type Group = Browser['groups'][number];
type GroupRow = { kind: 'group'; group: Group; tabs: BrowserTab[] };
type Window = {
  id: number;
  pinned: BrowserTab[];
  rows: (GroupRow | { kind: 'tab'; tab: BrowserTab })[];
};

export const tabOrientation = (options: ControlConfig['options']) =>
  options?.tabOrientation === 'horizontal' ? 'horizontal' : 'vertical';

export function tabWindows(browser: Browser | null): Window[] {
  if (!browser) {
    return [];
  }
  const windows = new Map<number, Window>();
  const groups = new Map(browser.groups.map((group) => [group.id, group]));
  const grouped = new Map<number, GroupRow>();
  for (const tab of browser.tabs) {
    let window = windows.get(tab.window);
    if (!window) {
      window = { id: tab.window, pinned: [], rows: [] };
      windows.set(tab.window, window);
    }
    if (tab.pinned) {
      window.pinned.push(tab);
      continue;
    }
    const group = tab.group === null ? undefined : groups.get(tab.group);
    if (!group) {
      window.rows.push({ kind: 'tab', tab });
      continue;
    }
    let row = grouped.get(group.id);
    if (!row) {
      row = { kind: 'group', group, tabs: [] };
      grouped.set(group.id, row);
      window.rows.push(row);
    }
    if (!group.collapsed || tab.active) {
      row.tabs.push(tab);
    }
  }
  return [...windows.values()];
}

/** `next` with each unchanged tab kept as its previous object, so a title or icon update rerenders one row. */
export function reuseTabs(previous: PluginBrowserSnapshot, next: PluginBrowserSnapshot) {
  if (previous.kind !== 'connected' || next.kind !== 'connected') {
    return next;
  }
  const old = new Map(previous.tabs.map((tab) => [tab.id, tab]));
  const same = (a: BrowserTab, b: BrowserTab) =>
    (Object.keys(b) as (keyof BrowserTab)[]).every((key) => a[key] === b[key]);
  return {
    ...next,
    tabs: next.tabs.map((tab) => {
      const before = old.get(tab.id);
      return before && same(before, tab) ? before : tab;
    }),
  };
}

/** The displays `tab` can be sent to: every display but the one its window is on, when there are several. */
export function displayTargets(browser: Browser, tab: BrowserTab) {
  const { displays } = browser;
  if (displays.length < 2) {
    return [];
  }
  return displays.flatMap(({ id, name, windows }, index) => {
    const repeated = displays.filter((other) => other.name === name).length > 1;
    const label = name && !repeated ? name : `${name || 'Display'} ${index + 1}`;
    return windows.includes(tab.window) ? [] : [{ id, label }];
  });
}
