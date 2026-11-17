import type { ScreenSchedule } from '../../rendering/screens';
import { e235TrainStop } from './data';
import { e235Target } from './draw';

export function target(model: ScreenSchedule) {
  return e235Target(model).code;
}

export function stopFor(model: ScreenSchedule) {
  return e235TrainStop(
    target(model),
    model.snapshot.direction,
    model.snapshot.initialStop ? 'initial' : 'regular',
  );
}

export function thisSide(model: ScreenSchedule) {
  return stopFor(model).door?.toLowerCase() === (model.viewingSide ?? 'right');
}
