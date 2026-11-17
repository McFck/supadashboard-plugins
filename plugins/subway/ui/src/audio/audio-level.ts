// The catalogue levels each cue by its average active level against a per-role target, which leaves short
// impulsive effects such as the door mechanics several dB louder than melodies and chimes. Effects therefore
// play at one shared momentary loudness: the loudest 50 ms RMS of the cue's region, in dBFS.
const EFFECT_LEVEL_DB = -18;
const WINDOW_SECONDS = 0.05;
const MAX_GAIN = 4;

/** Loudest 50 ms RMS over all channels of the region, in dBFS; `-Infinity` when it is silent. */
function momentaryPeakDb(buffer: AudioBuffer, offset: number, duration: number): number {
  const rate = buffer.sampleRate;
  const start = Math.max(0, Math.floor(offset * rate));
  const end = Math.min(buffer.length, Math.ceil((offset + duration) * rate));
  const window = Math.max(1, Math.round(WINDOW_SECONDS * rate));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  );
  let loudest = 0;
  for (let from = start; from < end; from += window) {
    const to = Math.min(end, from + window);
    let sum = 0;
    for (const data of channels) {
      for (let index = from; index < to; index++) {
        sum += data[index] * data[index];
      }
    }
    loudest = Math.max(loudest, sum / ((to - from) * channels.length));
  }
  return 10 * Math.log10(loudest);
}

/** The gain that brings an effect cue to the shared effect level; a silent region keeps `fallback`. */
export function effectGain(
  buffer: AudioBuffer,
  offset: number,
  duration: number,
  fallback: number,
) {
  const level = momentaryPeakDb(buffer, offset, duration);
  return Number.isFinite(level)
    ? Math.min(MAX_GAIN, 10 ** ((EFFECT_LEVEL_DB - level) / 20))
    : fallback;
}
