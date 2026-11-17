import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { PluginApi } from '@supadashboard/app/features/plugins/contracts';
import * as runtimeModule from '@supadashboard/app/app/runtime/state';
import * as volumeModule from '@supadashboard/app/features/media/volume';
import * as bridge from './audio-volume';

const runtimeMock = vi.hoisted(() => ({
  snapshot: {
    online: false,
    owner: false,
    revision: 0,
    activePage: 'page-1',
    variables: { revision: 0, records: {} },
    busy: {},
    content: {},
  },
  store: undefined as
    { set(value: unknown): void; update(fn: (value: any) => any): void } | undefined,
  request: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock('@supadashboard/app/app/runtime/state', async () => {
  const { writable } = await import('svelte/store');
  const runtimeView = writable(runtimeMock.snapshot);
  runtimeMock.store = runtimeView as unknown as typeof runtimeMock.store;
  return { runtimeView };
});
vi.mock('@supadashboard/app/app/runtime/client', () => ({ requestRuntime: runtimeMock.request }));
// Only what the bridge imports: loading the whole kit takes seconds.
vi.mock('@supadashboard/kit', async () => ({
  ...(await import('@supadashboard/app/app/runtime/state')),
  ...(await import('@supadashboard/app/app/runtime/client')),
  ...(await import('@supadashboard/app/features/media/volume')),
}));

function snapshot(owner: boolean, volume: number, muted: boolean) {
  const records = {
    'subway.mixVolume': {
      definition: { id: 'subway.mixVolume', type: 'float', available: true },
      value: volume,
    },
    'subway.mixMuted': {
      definition: { id: 'subway.mixMuted', type: 'boolean', available: true },
      value: muted,
    },
  };
  return {
    online: true,
    owner,
    revision: 1,
    activePage: 'page-1',
    variables: { revision: 1, records },
    busy: {},
    content: {},
  };
}

// Every test stops its registration, so the modules are shared.
function loadBridge(owner: boolean, volume = 0.75, muted = false) {
  runtimeMock.snapshot = snapshot(owner, volume, muted);
  runtimeMock.request.mockReset();
  runtimeMock.request.mockImplementation(async (_request: unknown) => undefined);
  runtimeMock.store?.set(runtimeMock.snapshot);
  return { runtimeModule, volumeModule, bridge };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Subway mixer channel bridge', () => {
  it('publishes the owner variables as a labeled local channel and routes clamped writes to the owner', async () => {
    const { volumeModule, bridge } = loadBridge(true);
    const api = {
      setVariable: vi.fn(async (id: string, value: number | boolean) => {
        runtimeMock.store?.update((current) => {
          const records = { ...current.variables.records };
          records[id] = { ...records[id], value };
          return {
            ...current,
            revision: current.revision + 1,
            variables: { revision: current.revision + 1, records },
          };
        });
        return true;
      }),
    } as unknown as PluginApi;
    const stop = bridge.registerSubwayMixerChannel(api);
    expect(get(volumeModule.volumeChannels)).toContainEqual(
      expect.objectContaining({
        target: bridge.SUBWAY_MIX_TARGET,
        label: 'Subway',
        icon: 'TrainFront',
        volume: 0.75,
        muted: false,
      }),
    );
    await volumeModule.setVolume(bridge.SUBWAY_MIX_TARGET, 1.5);
    await volumeModule.setMuted(bridge.SUBWAY_MIX_TARGET, true);
    expect(api.setVariable).toHaveBeenNthCalledWith(1, bridge.SUBWAY_MIX_VOLUME_ID, 1);
    expect(api.setVariable).toHaveBeenNthCalledWith(2, bridge.SUBWAY_MIX_MUTED_ID, true);
    expect(get(volumeModule.volumeChannels)).toContainEqual(
      expect.objectContaining({ volume: 1, muted: true }),
    );
    stop();
  });

  it('routes panel mixer writes to the owner runtime and removes the row while offline', async () => {
    const { volumeModule, bridge } = loadBridge(false, 0.4, false);
    runtimeMock.request.mockImplementation(async (request: unknown) => {
      const payload = (request as { payload: { id: string; value: number | boolean } }).payload;
      runtimeMock.store?.update((current) => {
        const records = { ...current.variables.records };
        records[payload.id] = { ...records[payload.id], value: payload.value };
        return {
          ...current,
          revision: current.revision + 1,
          variables: { revision: current.revision + 1, records },
        };
      });
      return undefined;
    });
    const stop = bridge.registerSubwayMixerChannel({} as PluginApi);
    await volumeModule.setVolume(bridge.SUBWAY_MIX_TARGET, 0.2);
    await volumeModule.setMuted(bridge.SUBWAY_MIX_TARGET, true);
    expect(runtimeMock.request).toHaveBeenNthCalledWith(1, {
      type: 'setVariable',
      payload: { id: bridge.SUBWAY_MIX_VOLUME_ID, value: 0.2 },
    });
    expect(runtimeMock.request).toHaveBeenNthCalledWith(2, {
      type: 'setVariable',
      payload: { id: bridge.SUBWAY_MIX_MUTED_ID, value: true },
    });
    runtimeMock.store?.set({ ...runtimeMock.snapshot, online: false });
    expect(bridge.readSubwayMixerSettings()).toBeNull();
    expect(
      get(volumeModule.volumeChannels).some(
        (channel) => channel.target === bridge.SUBWAY_MIX_TARGET,
      ),
    ).toBe(false);
    stop();
  });

  it('normalizes finite out-of-range mixer values and follows runtime snapshots', async () => {
    const { bridge, runtimeModule } = loadBridge(true, 2, false);
    expect(bridge.readSubwayMixerSettings()).toEqual({ volume: 1, muted: false });
    const listener = vi.fn();
    const stop = bridge.subscribeSubwayMixerSettings(listener);
    expect(listener).toHaveBeenCalledWith({ volume: 1, muted: false });
    (runtimeModule.runtimeView as unknown as { set(value: unknown): void }).set(
      snapshot(true, 0.3, true),
    );
    expect(listener).toHaveBeenLastCalledWith({ volume: 0.3, muted: true });
    stop();
  });
});
