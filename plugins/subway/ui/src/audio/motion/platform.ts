import { BedShuffler } from './bed';
import type { Section } from './manifest';
import type { Random } from './random';

/**
 * Station air heard through the open doors. Only the current station's kind (surface or underground) is
 * decoded, and the other is released, so a train holds one platform bed at a time; a line that never meets
 * the other kind never loads it.
 */
export class PlatformAir {
  private loaded: { section: Section; buffer: Promise<AudioBuffer | undefined> } | undefined;
  private bed: BedShuffler | undefined;
  private open = false;
  private section: Section | undefined;

  constructor(
    private readonly context: BaseAudioContext,
    private readonly output: GainNode,
    private readonly random: Random,
    private readonly load: (section: Section) => Promise<AudioBuffer>,
    private readonly level: number,
  ) {}

  private buffer(section: Section) {
    if (this.loaded?.section !== section) {
      // A failed load leaves the platform silent at this stop; the train sound itself keeps playing.
      const buffer = this.load(section).catch(() => undefined);
      this.loaded = { section, buffer };
    }
    return this.loaded.buffer;
  }

  update(open: boolean, section: Section, now: number, snap: boolean) {
    const gain = this.output.gain;
    gain.setTargetAtTime(open ? this.level : 0, now, snap ? 0.005 : open ? 0.4 : 0.5);
    if (open && (!this.open || section !== this.section)) {
      this.stopBed(now, snap);
      void this.buffer(section).then((buffer) => {
        if (!buffer || !this.open || this.section !== section || this.bed) return;
        this.bed = new BedShuffler(this.context, buffer, this.output, this.random);
        this.bed.start(this.context.currentTime);
      });
    }
    if (!open) this.stopBed(now, snap);
    this.open = open;
    this.section = section;
  }

  private stopBed(now: number, snap: boolean) {
    this.bed?.stop(now + (snap ? 0.05 : 4));
    this.bed = undefined;
  }

  dispose() {
    this.open = false;
    this.bed?.stop(0);
    this.bed = undefined;
  }
}
