/** Two-tone emergency alert; every oscillator registers in `sources` so a stop silences it. */
export function playEmergencyAlert(
  context: AudioContext,
  destination: AudioNode,
  sources: Map<AudioScheduledSourceNode, string | undefined>,
) {
  const start = context.currentTime;
  for (const [frequency, at] of [
    [660, 0],
    [880, 0.15],
  ] as const) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const onset = start + at;
    oscillator.frequency.setValueAtTime(frequency, onset);
    envelope.gain.setValueAtTime(0, onset);
    envelope.gain.linearRampToValueAtTime(0.16, onset + 0.015);
    envelope.gain.setValueAtTime(0.16, onset + 0.095);
    envelope.gain.linearRampToValueAtTime(0, onset + 0.12);
    oscillator.connect(envelope).connect(destination);
    sources.set(oscillator, undefined);
    oscillator.onended = () => {
      sources.delete(oscillator);
      oscillator.disconnect();
      envelope.disconnect();
    };
    oscillator.start(onset);
    oscillator.stop(onset + 0.125);
  }
}
