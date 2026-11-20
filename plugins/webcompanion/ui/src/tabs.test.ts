import { expect, it } from 'vitest';
import { tabWindows } from './tabs';

const tab = (id: number, extra: object = {}) => ({
  id,
  title: `Tab ${id}`,
  active: false,
  favicon: null,
  window: 1,
  group: null,
  pinned: false,
  ...extra,
});

it('folds a collapsed group to its active tab and keeps pinned tabs out of groups', () => {
  const windows = tabWindows({
    kind: 'connected',
    tabs: [
      tab(1, { pinned: true }),
      tab(2, { group: 7 }),
      tab(3, { group: 7, active: true }),
      tab(4, { group: 8 }),
      tab(5),
    ],
    activeTab: 3,
    groups: [
      { id: 7, window: 1, title: 'Work', color: 'blue', collapsed: true },
      { id: 8, window: 1, title: 'Read', color: 'red', collapsed: false },
    ],
    media: null,
    suspended: false,
    displays: [],
  });
  expect(windows).toHaveLength(1);
  expect(windows[0].pinned.map(({ id }) => id)).toEqual([1]);
  expect(
    windows[0].rows.map((row) => (row.kind === 'tab' ? row.tab.id : row.tabs.map(({ id }) => id))),
  ).toEqual([[3], [4], 5]);
});
