import type { LineDefinition } from '../simulation/lines';
import type { HibiyaPairSchedule } from '../display/tokyo-metro-13000/schedule';
import type { ScreenSchedule } from './screens';

export type SubwayScreen = 'left' | 'right';

export type PreparedFrame = {
  readonly line: LineDefinition;
  readonly revision: string;
  readonly fill: boolean;
  // Milliseconds until the content changes by itself; null when it never does.
  readonly wakeInMs: number | null;
} & (
  | { readonly kind: 'screen'; readonly schedule: ScreenSchedule }
  | { readonly kind: 'pair'; readonly pair: HibiyaPairSchedule; readonly panel: 0 | 1 }
);
