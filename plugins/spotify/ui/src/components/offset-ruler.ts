// The song offset's ruler: the scale scrolls under a fixed needle with the lyrics' own kinetic scroll, snapping to
// 0.1 s. Values only change when a step is crossed, so a frame does one transform write and nothing reactive.
import { SONG_OFFSET_LIMIT_MS } from '../lyrics';
import { KineticScroll } from '@supadashboard/kit';

type Host = {
  readonly value: number;
  preview(offsetMs: number): void;
  save(offsetMs: number): void;
};

const STEP_MS = 100;
/** Px between two 0.1 s ticks; the scale's CSS draws its ticks at this pitch. */
export const STEP_PX = 8;
const STEPS = (2 * SONG_OFFSET_LIMIT_MS) / STEP_MS;
const KEY_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowDown: -1,
  ArrowRight: 1,
  ArrowUp: 1,
  PageDown: -10,
  PageUp: 10,
  Home: -STEPS,
  End: STEPS,
};

let stepFeedback = () => {};
/** Set by the plugin: extra feedback (a vibration) for each step crossed. */
export const setStepFeedback = (feedback: () => void) => {
  stepFeedback = feedback;
};

const positionOf = (offsetMs: number) => ((offsetMs + SONG_OFFSET_LIMIT_MS) / STEP_MS) * STEP_PX;
const offsetAt = (position: number) => {
  const step = Math.min(STEPS, Math.max(0, Math.round(position / STEP_PX)));
  return step * STEP_MS - SONG_OFFSET_LIMIT_MS;
};

export class OffsetRuler {
  readonly #host: Host;
  #scroll: KineticScroll | undefined;
  #needle: Element | null = null;
  #shown: number;

  constructor(host: Host) {
    this.#host = host;
    this.#shown = host.value;
  }

  /** Action for the ruler, whose first child is the scale it moves and whose last is the needle. */
  attach = (node: HTMLElement) => {
    const scale = node.firstElementChild;
    if (!(scale instanceof HTMLElement)) {
      return;
    }
    this.#needle = node.lastElementChild;
    const scroll = new KineticScroll(
      node,
      scale,
      {
        // Previews already keep the slider open while it moves.
        onInput: () => {},
        onRest: () => this.#host.save(this.#shown),
        onMove: this.#moved,
      },
      { axis: 'x', snap: STEP_PX },
    );
    scroll.scrollTo(positionOf(this.#shown), false);
    this.#scroll = scroll;
    return {
      destroy: () => {
        scroll.destroy();
        this.#scroll = undefined;
        this.#needle = null;
      },
    };
  };

  key = (event: KeyboardEvent) => {
    const steps = KEY_STEPS[event.key];
    if (steps === undefined) {
      return;
    }
    event.preventDefault();
    this.#set(offsetAt(positionOf(this.#shown) + steps * STEP_PX));
  };

  reset = () => this.#set(0);

  /** Jumps rather than glides: a glide would preview every step it passes after the value was saved. */
  #set(offsetMs: number) {
    this.#scroll?.scrollTo(positionOf(offsetMs), false);
    this.#host.save(offsetMs);
  }

  #moved = (position: number) => {
    const offsetMs = offsetAt(position);
    if (offsetMs === this.#shown) {
      return;
    }
    this.#shown = offsetMs;
    this.#host.preview(offsetMs);
    stepFeedback();
    // Each step crossed also brightens the needle, for screens that cannot vibrate.
    this.#needle?.animate([{ opacity: 1, transform: 'scaleY(1.12)' }, {}], {
      duration: 220,
      easing: 'ease-out',
    });
  };
}
