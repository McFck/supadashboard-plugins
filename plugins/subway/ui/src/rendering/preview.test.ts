import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSubwayEditorPreview } from './preview';

const files = import.meta.glob('../../../assets/lines/*/{line,pack}.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;
const line = Object.entries(files).find(([path]) => path.endsWith('/lines/hibiya/line.json'))?.[1];
const pack = Object.entries(files).find(([path]) => path.endsWith('/lines/hibiya/pack.json'))?.[1];
if (!line || !pack) throw new Error('Missing Hibiya editor-preview fixtures');

afterEach(() => vi.unstubAllGlobals());

describe('Subway editor preview', () => {
  it('loads a stopped, silent frame at time zero for the selected line and station', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) =>
        ({
          ok: true,
          json: async () =>
            String(input).endsWith('/pack.json') ? structuredClone(pack) : structuredClone(line),
        }) as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    const preview = await loadSubwayEditorPreview(
      {
        line: 'hibiya',
        station: 'H14',
        direction: 'to-naka-meguro',
        immersion: true,
      },
      new AbortController().signal,
    );

    expect(preview).toMatchObject({
      line: { id: 'hibiya' },
      snapshot: {
        line: 'hibiya',
        station: 'H14',
        direction: 'to-naka-meguro',
        state: 'stopped',
        doors: 'open',
        speed: 0,
        progress: 0,
        paused: false,
        immersion: false,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
