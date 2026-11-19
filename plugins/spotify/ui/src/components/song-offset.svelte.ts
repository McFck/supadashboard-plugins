import { toast } from '@supadashboard/kit';
import { setSongOffset, type LyricsTrack } from '../lyrics';

type Host = { canAdjust(): boolean; opened(): void };
type Tap = { x: number; y: number; t: number };

/** A tap is a press shorter than this (ms) that never moved more than SLOP_PX; two within PAIR_MS pair up. */
const TAP_MS = 300;
const PAIR_MS = 350;
const SLOP_PX = 10;
/** The slider closes after this long (ms) untouched. */
const IDLE_MS = 4000;

const apart = (a: Tap, b: Tap) => Math.hypot(a.x - b.x, a.y - b.y);

export class SongOffset {
  /** Ms, positive shows lines earlier, like the tile's own offset it adds to. */
  value = $state(0);
  open = $state(false);
  readonly #host: Host;
  #track: LyricsTrack | undefined;
  #idle: ReturnType<typeof setTimeout> | undefined;
  /** Saves run one after another, so the last value released is the one stored. */
  #saving: Promise<unknown> = Promise.resolve();

  constructor(host: Host) {
    this.#host = host;
  }

  /** A new song and its saved offset; no track while the song is not known yet. */
  use(track: LyricsTrack | undefined, offsetMs = 0) {
    this.#track = track;
    this.value = offsetMs;
    this.close();
  }

  preview(offsetMs: number) {
    this.value = offsetMs;
    this.#arm();
  }

  save(offsetMs: number) {
    const track = this.#track;
    this.preview(offsetMs);
    if (track) {
      this.#saving = this.#saving
        .then(() => setSongOffset(track, offsetMs))
        .catch(() => toast.error('Lyrics offset not saved'));
    }
  }

  close() {
    this.open = false;
    clearTimeout(this.#idle);
  }

  #arm() {
    clearTimeout(this.#idle);
    if (this.open) {
      this.#idle = setTimeout(() => this.close(), IDLE_MS);
    }
  }

  /** Action for the lyrics: a double tap without movement opens the slider. Scrolling never counts. */
  taps = (node: HTMLElement) => {
    let down: Tap | undefined;
    let last: Tap | undefined;
    const at = (event: PointerEvent): Tap => ({
      x: event.clientX,
      y: event.clientY,
      t: event.timeStamp,
    });
    const press = (event: PointerEvent) => {
      down = event.isPrimary && event.button === 0 ? at(event) : undefined;
    };
    const move = (event: PointerEvent) => {
      if (down && apart(down, at(event)) > SLOP_PX) {
        down = undefined;
        last = undefined;
      }
    };
    const lift = (event: PointerEvent) => {
      const tap = at(event);
      const start = down;
      down = undefined;
      if (!start || tap.t - start.t > TAP_MS || apart(start, tap) > SLOP_PX) {
        last = undefined;
      } else if (last && tap.t - last.t <= PAIR_MS && apart(last, tap) <= SLOP_PX * 3) {
        last = undefined;
        this.#show();
      } else {
        last = tap;
      }
    };
    const cancel = () => {
      down = undefined;
      last = undefined;
    };
    node.addEventListener('pointerdown', press);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', lift);
    node.addEventListener('pointercancel', cancel);
    return {
      destroy: () => {
        node.removeEventListener('pointerdown', press);
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', lift);
        node.removeEventListener('pointercancel', cancel);
      },
    };
  };

  #show() {
    if (!this.#track || !this.#host.canAdjust()) {
      return;
    }
    this.open = true;
    this.#host.opened();
    this.#arm();
  }

  /** Action for the open slider: a press outside closes it, and it stays while held. */
  panel = (node: HTMLElement) => {
    const press = (event: PointerEvent) => {
      if (event.target instanceof Node && node.contains(event.target)) {
        clearTimeout(this.#idle);
      } else {
        this.close();
      }
    };
    const lift = () => this.#arm();
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('pointerup', lift, true);
    return {
      destroy: () => {
        document.removeEventListener('pointerdown', press, true);
        document.removeEventListener('pointerup', lift, true);
      },
    };
  };

  destroy() {
    clearTimeout(this.#idle);
  }
}
