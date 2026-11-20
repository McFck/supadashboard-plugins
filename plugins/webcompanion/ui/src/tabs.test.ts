import { expect, it } from 'vitest';
import { displayTargets } from './display-targets';
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

it('matches mixed-DPI displays before falling back to display order', () => {
  const current = tab(1);
  const displays = [
    { id: 'left', name: 'Generic', windows: [] },
    {
      id: 'current',
      name: 'Generic',
      windows: [1],
      bounds: { left: 0, top: 0, width: 2560, height: 1440 },
    },
    {
      id: 'top',
      name: 'Generic',
      windows: [],
      bounds: { left: 0, top: -1080, width: 1920, height: 1080 },
    },
  ];
  const monitors = [
    { label: 'Main', left: 0, top: 0, width: 2560, height: 1440, scaleFactor: 1 },
    { label: 'Upper', left: 0, top: -1620, width: 2880, height: 1620, scaleFactor: 1.5 },
    { label: 'Side', left: -1920, top: 0, width: 1920, height: 1080, scaleFactor: 1 },
  ];
  expect(
    displayTargets(
      {
        kind: 'connected',
        tabs: [current],
        groups: [],
        activeTab: 1,
        media: null,
        suspended: false,
        displays,
      },
      current,
      monitors,
    ),
  ).toEqual([
    { id: 'left', label: 'Side' },
    { id: 'top', label: 'Upper' },
  ]);
});
