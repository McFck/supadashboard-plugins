import { describe, expect, it } from 'vitest';
import { effectGain } from './audio-level';

function buffer(samples: number[], sampleRate = 1000): AudioBuffer {
  const data = Float32Array.from(samples);
  return {
    sampleRate,
    length: data.length,
    numberOfChannels: 1,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

describe('effect levels', () => {
  it('plays a short loud door hit and a long quiet chime at the same momentary level', () => {
    const hit = buffer([...Array(950).fill(0), ...Array(50).fill(0.8)]);
    const chime = buffer(Array(1000).fill(0.1));
    const level = (source: AudioBuffer) => {
      const gain = effectGain(source, 0, 1, 1);
      return Math.max(...source.getChannelData(0).map((sample) => Math.abs(sample * gain)));
    };
    expect(level(hit)).toBeCloseTo(level(chime), 6);
    expect(effectGain(buffer(Array(1000).fill(0)), 0, 1, 0.7)).toBe(0.7);
  });
});
