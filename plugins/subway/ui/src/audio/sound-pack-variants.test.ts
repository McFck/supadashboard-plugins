import { describe, expect, it } from 'vitest';
import { buildSegmentCuePlan } from './sound-pack';
import type { DoorSequenceApi, LoadedSubwayLine, RuntimeCueManifest } from './sound-types';

describe('Subway station door variants', () => {
  it('selects H22 door variants before planning and pads only verified station queues', () => {
    const files = [
      'lines/hibiya/clips/door/default.opus',
      'lines/hibiya/clips/door/h22.opus',
      'lines/hibiya/clips/voice/next-ja.opus',
      'lines/hibiya/clips/voice/next-en.opus',
      'lines/hibiya/clips/voice/arriving-ja.opus',
      'lines/hibiya/clips/voice/emergency.opus',
    ];
    const catalogue: RuntimeCueManifest = {
      version: 1,
      inputs: {},
      cues: files.map((file) => ({
        file,
        offset: 0,
        duration: 2,
        audible_end: 1.8,
        gainByRole: { voice: 1, signal: 1, mechanics: 1, melody: 1 },
        sha256: 'b'.repeat(64),
        status: 'needs ear check',
        source: 'fixture',
      })),
    };
    const line: LoadedSubwayLine = {
      line: {},
      pack: {
        id: 'hibiya',
        stations: [
          { code: 'H21', departure_melody: {} },
          {
            code: 'H22',
            next: {
              ja: [
                {
                  file: 'lines/hibiya/clips/voice/next-ja.opus',
                  station: 'H22',
                  kind: 'next',
                  directions: ['to-kita-senju'],
                  lang: 'ja',
                },
                {
                  file: 'lines/hibiya/clips/voice/other.opus',
                  station: 'H22',
                  kind: 'next',
                  direction: 'to-naka-meguro',
                  lang: 'ja',
                },
              ],
              en: [
                {
                  file: 'lines/hibiya/clips/voice/next-en.opus',
                  station: 'H22',
                  kind: 'next',
                  direction: 'to-kita-senju',
                  lang: 'en',
                },
              ],
            },
            arriving: {
              ja: [
                {
                  file: 'lines/hibiya/clips/voice/arriving-ja.opus',
                  station: 'H22',
                  kind: 'arriving',
                  direction: 'to-kita-senju',
                  lang: 'ja',
                },
              ],
            },
            transfer: {
              ja: [
                {
                  file: 'lines/hibiya/clips/voice/other.opus',
                  station: 'H22',
                  kind: 'transfer',
                  direction: 'to-kita-senju',
                  lang: 'ja',
                },
              ],
            },
          },
        ],
        doors: {
          sequence: {
            close: [
              { part: 'departure_melody', at: 0 },
              { part: 'platform_open', at: 0.5 },
            ],
            open: [{ part: 'platform_open', at: 0 }],
          },
          platform_open: { file: files[0], variants: [{ stations: ['H22'], file: files[1] }] },
        },
        emergency: [
          {
            file: 'lines/hibiya/clips/voice/emergency.opus',
            kind: 'emergency',
            scenario: 'emergency stop',
            lang: 'ja',
            direction: 'to-kita-senju',
          },
          {
            file: 'lines/hibiya/clips/voice/other.opus',
            kind: 'emergency',
            scenario: 'power outage',
            lang: 'ja',
            direction: 'to-kita-senju',
          },
        ],
      },
    };
    const calls: { action: string; platformFile: string; sequence: Record<string, unknown> }[] = [];
    const planner: DoorSequenceApi = {
      plan(input, action) {
        calls.push({
          action,
          platformFile: input.cues.platform_open.file,
          sequence: input.sequence as Record<string, unknown>,
        });
        return { events: [], end: 1, close_end: 0.8, open_end: 0.7 };
      },
    };
    const segment = buildSegmentCuePlan(
      line,
      'H21',
      'H22',
      'to-kita-senju',
      ['ja', 'en'],
      false,
      catalogue,
      'http://plugin.localhost/subway/assets/',
      planner,
    );
    expect(calls.find((call) => call.action === 'open')?.platformFile).toBe(files[1]);
    expect(calls.find((call) => call.action === 'close')?.platformFile).toBe(files[0]);
    expect(calls[0].sequence.close as unknown[]).toHaveLength(1);
    expect(segment.preClose).toBeUndefined();
    expect(segment.departure.map((item) => item.cue.file)).toEqual([files[2], files[3]]);
    expect(segment.arrival.map((item) => item.cue.file)).toEqual([files[4]]);
    expect(segment.emergency?.map((item) => item.cue.file)).toEqual([files[5]]);
    expect(Object.isFrozen(segment) && Object.isFrozen(segment.departure)).toBe(true);
  });
});
