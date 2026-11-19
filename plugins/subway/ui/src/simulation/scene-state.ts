import { readonly, writable } from 'svelte/store';
import { carNumber } from './config';
import type { LineDefinition } from './lines';
import { discreteKey } from './projection';
import type { RunSnapshot } from './run';

export interface SubwaySceneState {
  line: LineDefinition;
  snapshot: RunSnapshot;
  config: Readonly<Record<string, unknown>>;
}

const sceneState = writable<SubwaySceneState | undefined>(undefined);
export const subwaySceneState = readonly(sceneState);

export class ScenePublisher {
  private lastKey = '';
  private lastAt = Number.NEGATIVE_INFINITY;
  private published = false;
  private ride = { key: '', car: 1 };

  publish(scene: {
    line: LineDefinition;
    snapshot: RunSnapshot;
    ride: string;
    config: Readonly<Record<string, unknown>>;
    shown: boolean;
    now: number;
    force: boolean;
  }) {
    if (!scene.shown && this.published) {
      return;
    }
    const { line, snapshot, config, now } = scene;
    const key = [discreteKey(snapshot), config.displayLanguages, config.announcementLanguages].join(
      '|',
    );
    if (!scene.force && key === this.lastKey && now - this.lastAt < 250) {
      return;
    }
    this.lastKey = key;
    this.lastAt = now;
    this.published = true;
    const car = carNumber(config.carNumber, line.carCount) ?? this.carFor(line, scene.ride);
    sceneState.set(
      Object.freeze({
        line,
        snapshot: Object.freeze(snapshot),
        config: Object.freeze({ ...config, carNumber: car }),
      }),
    );
  }

  private carFor(line: LineDefinition, ride: string) {
    const key = `${line.id}|${ride}`;
    if (this.ride.key !== key) {
      this.ride = { key, car: 1 + Math.floor(Math.random() * line.carCount) };
    }
    return this.ride.car;
  }

  clear() {
    sceneState.set(undefined);
  }
}
