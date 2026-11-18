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
