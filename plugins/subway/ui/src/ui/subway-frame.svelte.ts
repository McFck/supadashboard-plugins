import { fromStore } from 'svelte/store';
import type { PreparedFrame, SubwayScreen } from '../rendering/contracts';
import { prepareFrame, sceneLanguages } from '../rendering/scene';
import { subwaySceneState } from '../simulation/scene-state';
import {
  loadSubwayEditorPreview,
  previewForView,
  type SubwayEditorPreview,
} from '../rendering/preview';
import { sessionKey } from '../rendering/screens';
import { PhaseClock } from '../rendering/engine/phase-clock';
import { e235Images } from '../display/e235/images';

export interface SubwayFrameHost {
  mode(): 'runtime' | 'editor' | undefined;
  /** Runtime only: a page showing the applet is live, so the display keeps waking itself. */
  active(): boolean;
  view(): string;
  screen(): SubwayScreen;
  /** The settings the editor preview shows. */
  previewConfig(): Readonly<Record<string, unknown>>;
}

/**
 * The frame the display draws: the editor preview, or the runtime scene at its visible elapsed time. It wakes
 * itself when the screen's next page or the clock is due, and repaints once late images arrive.
 */
export class SubwayFrame {
  #pulse = $state(0);
  #preview = $state.raw<SubwayEditorPreview>();
  #scene = fromStore(subwaySceneState);
  #clock = new PhaseClock();
  #stop: () => void;

  readonly frame: PreparedFrame | undefined = $derived.by(() => this.#prepare());

  constructor(private readonly host: SubwayFrameHost) {
    const stopImages = e235Images.subscribe(() => {
      this.#pulse++;
    });
    const stopEffects = $effect.root(() => {
      $effect(() => this.#loadPreview());
      $effect(() => this.#scheduleWake());
    });
    this.#stop = () => {
      stopImages();
      stopEffects();
    };
  }

  destroy(): void {
    this.#stop();
  }

  #loadPreview() {
    const config = this.host.previewConfig();
    if (this.host.mode() !== 'editor') {
      this.#preview = undefined;
      return;
    }
    const controller = new AbortController();
    void loadSubwayEditorPreview(config, controller.signal)
      .then((preview) => {
        if (!controller.signal.aborted) {
          this.#preview = preview;
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.warn('Subway preview unavailable', error);
          this.#preview = undefined;
        }
      });
    return () => controller.abort();
  }

  #prepare(): PreparedFrame | undefined {
    const view = this.host.view();
    const screen = this.host.screen();
    if (this.host.mode() === 'editor') {
      const preview = this.#preview;
      return preview
        ? prepareFrame({ ...previewForView(preview, view), visibleElapsed: 0 }, view, screen)
        : undefined;
    }
    void this.#pulse;
    const source = this.#scene.current;
    if (!source) {
      return undefined;
    }
    const wallMs = Date.now();
    const visibleElapsed = this.#clock.elapsed(
      sessionKey(source.snapshot, { line: source.line, languages: sceneLanguages(source) }),
      wallMs,
    );
    return prepareFrame({ ...source, visibleElapsed, wallMs }, view, screen);
  }

  #scheduleWake() {
    const wakeInMs = this.frame?.wakeInMs ?? null;
    if (this.host.mode() === 'editor' || !this.host.active() || wakeInMs === null) {
      return;
    }
    const timeout = setTimeout(() => {
      this.#pulse++;
    }, wakeInMs);
    return () => clearTimeout(timeout);
  }
}
