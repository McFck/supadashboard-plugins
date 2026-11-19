import { untrack } from 'svelte';
import { prefersReducedMotion } from 'svelte/motion';
import { type NowPlayingSession, nativeSessions, KineticScroll } from '@supadashboard/kit';
import { getLyrics, getSongOffset, type LyricsView } from '../lyrics';
import { lineAt, playingSession, positionAt, untilNextLine } from '../lyric-clock';
import { SongOffset } from './song-offset.svelte';

export type TileView = { kind: 'idle' } | { kind: 'loading' } | LyricsView;
type Host = { visible(): boolean; offsetMs(): number };

/** Follow waits this long (ms) after the user's scrolling comes to rest, then glides back to the sung line. */
const HOLD_MS = 4000;
/** Height fraction where the sung line rests. */
const ANCHOR = 0.4;

export class LyricsTileController {
  view = $state<TileView>({ kind: 'idle' });
  active = $state(-1);
  readonly offset = new SongOffset({
    canAdjust: () => this.view.kind === 'synced',
    // Follow resumes at once, so the preview shows the sung line moving.
    opened: () => {
      clearTimeout(this.#holdTimer);
      this.#held = false;
      this.#follow();
    },
  });
  #scroll: KineticScroll | undefined;
  #content: HTMLElement | undefined;
  readonly #host: Host;
  #session = $state<NowPlayingSession>();
  #key = '';
  #epoch = 0;
  #lineTimer: ReturnType<typeof setTimeout> | undefined;
  #held = false;
  #holdTimer: ReturnType<typeof setTimeout> | undefined;
  /** The next scroll lands without animation: new lyrics, or a resize. */
  #jump = true;
  readonly #abort = new AbortController();
  readonly #stop: () => void;

  constructor(host: Host) {
    this.#host = host;
    this.#stop = nativeSessions('spotify')((state) => {
      this.#show(state.state === 'ready' ? playingSession(state.sessions) : undefined);
    }, this.#abort.signal);
    // The sung line changes a few times a minute, so a timer wakes for each change instead of a frame loop.
    $effect(() => {
      const session = this.#session;
      const offset = this.#host.offsetMs() + this.offset.value;
      const view = this.view;
      if (view.kind !== 'synced' || !session || !this.#host.visible()) {
        return;
      }
      const rate = session.state === 'playing' ? (session.timeline?.rate ?? 1) : 0;
      const tick = () => {
        const position = positionAt(session, Date.now(), offset);
        const index = position === null ? -1 : lineAt(view.lines, position);
        if (index !== this.active) {
          this.active = index;
          this.#follow();
        }
        const wait = position === null ? null : untilNextLine(view.lines, index, position);
        if (wait !== null && rate > 0) {
          this.#lineTimer = setTimeout(tick, wait / rate + 1);
        }
      };
      // Deferred, so this effect does not depend on `active`, which the tick writes.
      this.#lineTimer = setTimeout(tick);
      return () => clearTimeout(this.#lineTimer);
    });
  }

  #show(session: NowPlayingSession | undefined) {
    const timeline = session?.timeline;
    const durationMs = timeline ? timeline.endMs - timeline.startMs : 0;
    const present = session && session.state !== 'stopped' && (session.title || session.artist);
    this.#session = present ? session : undefined;
    const key = present
      ? JSON.stringify([
          session.artist,
          session.title,
          session.album,
          Math.round(durationMs / 1000),
        ])
      : '';
    if (key === this.#key) {
      return;
    }
    this.#key = key;
    const mine = ++this.#epoch;
    this.active = -1;
    this.#jump = true;
    this.offset.use(undefined);
    if (!present) {
      this.view = { kind: 'idle' };
      return;
    }
    this.view = { kind: 'loading' };
    // The duration is how LRCLIB tells versions apart; without it the lookup waits for the timeline.
    if (durationMs < 1000) {
      return;
    }
    const { artist, title, album } = session;
    // The lyrics service takes whole milliseconds.
    const track = { artist, title, album, durationMs: Math.round(durationMs) };
    void Promise.all([getLyrics(track), getSongOffset(track)]).then(([view, offsetMs]) => {
      if (mine === this.#epoch) {
        this.offset.use(track, offsetMs);
        this.view = view;
      }
    });
  }

  /** Scrolls the sung line to its resting height unless the user holds the scroll. Plain lyrics never move. */
  #follow() {
    const line = this.#content?.children[Math.max(0, this.active)];
    if (
      this.view.kind !== 'synced' ||
      !this.#scroll ||
      this.#held ||
      !(line instanceof HTMLElement)
    ) {
      return;
    }
    const top = line.offsetTop + line.offsetHeight / 2 - this.#scroll.size * ANCHOR;
    const smooth = !this.#jump && !prefersReducedMotion.current;
    this.#jump = false;
    this.#scroll.scrollTo(top, smooth);
  }

  /** Action for the scroller, whose first child is the content it moves. */
  scroller = (node: HTMLElement) => {
    const content = node.firstElementChild;
    if (!(content instanceof HTMLElement)) {
      return;
    }
    const scroll = new KineticScroll(node, content, { onInput: this.#hold, onRest: this.#release });
    const taps = this.offset.taps(node);
    this.#scroll = scroll;
    this.#content = content;
    return {
      destroy: () => {
        scroll.destroy();
        taps.destroy();
        if (this.#scroll === scroll) {
          this.#scroll = undefined;
          this.#content = undefined;
        }
      },
    };
  };

  #hold = () => {
    this.#held = true;
    clearTimeout(this.#holdTimer);
  };

  #release = () => {
    clearTimeout(this.#holdTimer);
    this.#holdTimer = setTimeout(() => {
      this.#held = false;
      this.#follow();
    }, HOLD_MS);
  };

  /** The tile changed size: put the sung line back at once. */
  recenter() {
    this.#jump = true;
    // Untracked: the caller's size effect must not rerun, and jump, whenever the sung line changes.
    untrack(() => this.#follow());
  }

  destroy() {
    this.#abort.abort();
    this.#stop();
    clearTimeout(this.#lineTimer);
    clearTimeout(this.#holdTimer);
    this.offset.destroy();
    this.#epoch++;
  }
}
