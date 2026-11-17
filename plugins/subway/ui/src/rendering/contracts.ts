import type { LineDefinition } from '../simulation/lines';
import type { HibiyaPairSchedule } from '../display/tokyo-metro-13000/schedule';
import type { ScreenSchedule } from './screens';

// Hibiya has two physical screens; the applet shows one of them.
export type SubwayScreen = 'left' | 'right';

// One prepare() result per tick feeds the paint-cache revision, the next wake-up and the draw.
export type PreparedFrame = {
  readonly line: LineDefinition;
  readonly revision: string;
  /** Whether the spare room around the LCD is filled by stretching its edge pixels. */
  readonly fill: boolean;
  // Milliseconds from preparation until the content changes by itself; null when it never does.
  readonly wakeInMs: number | null;
} & (
  | { readonly kind: 'screen'; readonly schedule: ScreenSchedule }
  | { readonly kind: 'pair'; readonly pair: HibiyaPairSchedule; readonly panel: 0 | 1 }
);
