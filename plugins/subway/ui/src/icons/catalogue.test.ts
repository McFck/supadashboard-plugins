import { describe, expect, it } from 'vitest';
import { LINE_CATALOGUE } from '../data/load';
import { e235Data } from '../display/e235/data';
import { findIcon } from './catalogue';

describe('Subway icon catalogue references', () => {
  it('resolves every line identity and every imported transfer icon', () => {
    for (const line of LINE_CATALOGUE) expect(findIcon(line.iconId), line.id).toBeDefined();
    const ids = e235Data.stations.flatMap((station) =>
      station.transfers.flatMap((transfer) => transfer.icons),
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => !findIcon(id))).toEqual([]);
  });
});
