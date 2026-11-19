import type { AppletRuntimeContext, EventAncestry } from '@supadashboard/kit';
import { SUBWAY_VIEWS } from '../settings';
import { createSubwayRuntime, type SubwayRuntimeHandle } from './runtime';
import type { RunCommand } from './run-state';

let active: { handle: SubwayRuntimeHandle; context: AppletRuntimeContext } | undefined;

export function runtime(context: AppletRuntimeContext): () => void {
  const current = { handle: createSubwayRuntime(context), context };
  active = current;
  return () => {
    current.handle.dispose();
    if (active === current) {
      active = undefined;
    }
  };
}

export function dispatchSubwayCommand(command: RunCommand, ancestry?: EventAncestry): boolean {
  return active?.handle.dispatch(command, ancestry) ?? false;
}

export function requestSubwayLine(
  args: { line?: unknown; direction?: unknown; startStation?: unknown },
  ancestry?: EventAncestry,
): boolean {
  return active?.handle.requestLine(args, ancestry) ?? false;
}

export function setSubwayImmersion(enabled?: boolean, ancestry?: EventAncestry): boolean {
  return active?.handle.setImmersion(enabled, ancestry) ?? false;
}

export async function requestSubwayView(
  viewId: string,
  ancestry?: EventAncestry,
): Promise<boolean> {
  if (!active || !SUBWAY_VIEWS.some((view) => view.id === viewId)) {
    return false;
  }
  return active.context.setView(viewId, ancestry);
}
