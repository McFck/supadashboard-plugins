import type { ResolvedCue } from './sound-types';

/** Plays one cue region. Recorded cues carry their recording's background noise; fade it so it never switches. */
export function playCueSource(
  context: BaseAudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  cue: ResolvedCue,
  when: number,
): AudioBufferSourceNode {
  const source = context.createBufferSource();
  const gain = context.createGain();
  const end = when + cue.duration;
  const fadeIn = Math.min(0.04, cue.duration / 4);
  const fadeOut = Math.min(0.25, cue.duration / 3);
  source.buffer = buffer;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(cue.gain, when + fadeIn);
  gain.gain.setValueAtTime(cue.gain, end - fadeOut);
  gain.gain.linearRampToValueAtTime(0, end);
  source.connect(gain).connect(destination);
  source.onended = () => gain.disconnect();
  source.start(when, cue.offset, cue.duration);
  return source;
}
