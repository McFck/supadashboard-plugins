import type { RunSnapshot } from '../../simulation/run';
import type { ScreenLanguage, ScreenPage } from '../../rendering/screens';
import { e235Data as data, e235Station, e235TrainStop } from './data';

const pages: Record<string, ScreenPage> = {
  RouteMap: 'broad',
  DetailedRouteMap: 'nearby',
  Door: 'door',
  Platform: 'platform',
  Transfers: 'transfers',
  Alert: 'notice',
  PrioritySeat: 'priority',
  MobilePhone: 'mobile',
};
// Transfer icons of a line with several of them take turns at this interval.
export const E235_ICON_DWELL_MS = 3_000;
const ICON_PAGES = new Set<ScreenPage>(['nearby', 'transfers', 'platform', 'door', 'closing']);
const locale = (value: string | null): ScreenLanguage =>
  value === 'English' ? 'en' : value === 'Hiragana' ? 'kana' : 'ja';
function routineStep(
  steps: { duration: number | null; language: string | null; mode: string | null }[],
  elapsed: number,
) {
  const period = steps.reduce((sum, s) => sum + (s.duration ?? 0) * 1000, 0);
  let position = elapsed % period;
  for (const step of steps) {
    const duration = (step.duration ?? 0) * 1000;
    if (position < duration) return { ...step, deadline: elapsed + duration - position };
    position -= duration;
  }
  throw new Error('Empty E235 display routine');
}

export function e235Routine(
  snapshot: RunSnapshot,
  elapsed: number,
  viewingSide: 'left' | 'right',
  languages: readonly ScreenLanguage[],
  offset = 0,
) {
  const code = ['stopped', 'doorsClosing', 'arriving'].includes(snapshot.state)
    ? snapshot.station
    : snapshot.next || snapshot.station;
  const stop = e235TrainStop(
    code,
    snapshot.direction,
    snapshot.initialStop ? 'initial' : 'regular',
  );
  const stage: { Duration: number; Main?: number; Right?: number; Left?: number } | null =
    snapshot.state === 'stopped' || snapshot.state === 'doorsClosing'
      ? stop.stopping
      : snapshot.state === 'approaching' || snapshot.state === 'arriving'
        ? stop.arriving
        : snapshot.state === 'departing' && stop.departing && stop.departing.Duration > 0
          ? stop.departing
          : stop.running;
  const index = stage?.[viewingSide === 'right' ? 'Right' : 'Left'] ?? 0;
  const steps = data.optionalAreaRoutines[index]!.steps;
  const period = steps.reduce((sum, step) => sum + (step.duration ?? 0) * 1000, 0);
  const running = snapshot.state === 'departing' || snapshot.state === 'cruising';
  const budget = snapshot.screenRunDurationMs;
  const scale = running && budget && budget > 0 ? Math.min(1, budget / period) : 1;
  const body = routineStep(steps, elapsed / scale);
  const main = routineStep(data.mainAreaRoutines[stage?.Main ?? 0]!.steps, elapsed);
  const requested = (value: string | null, header = false) => {
    const lang = locale(value);
    if (header && lang === 'kana' && languages.length > 1 && languages.includes('ja')) return lang;
    const allowed = languages.includes(lang) ? lang : (languages[0] ?? 'ja');
    return (
      languages[(languages.indexOf(allowed) + offset + languages.length) % languages.length] ??
      allowed
    );
  };
  return {
    page: pages[body.mode!]!,
    language: requested(body.language),
    headerLanguage: requested(main.language, true),
    iconsRotate:
      ICON_PAGES.has(pages[body.mode!]!) &&
      e235Station(code).transfers.some((transfer) => transfer.icons.length > 1),
    pageDeadline: body.deadline * scale,
    languageDeadline: main.deadline,
  };
}

// The Yamanote header shows the wall-clock minute, so the screen also wakes at each minute boundary.
export function e235WallClock(wallMs: number): { label: string; wakeInMs: number } {
  return {
    label: new Date(wallMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    wakeInMs: 60_000 - (wallMs % 60_000),
  };
}
