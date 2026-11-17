import data from './catalogue.json';
import type { IconDef, IconShape } from './contracts';

const SHAPES: readonly IconShape[] = ['letter-box', 'ring', 'train', 'solid', 'round', 'square'];
const COLOR = /^#[0-9a-f]{6}$/i;

function fail(id: unknown, message: string): never {
  throw new Error(`Subway icon ${String(id)}: ${message}`);
}

function icon(value: IconDef): IconDef {
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(value.id)) fail(value.id, 'id must be operator/line');
  if (!SHAPES.includes(value.shape)) fail(value.id, 'unknown shape');
  if (!COLOR.test(value.color) || (value.secondaryColor && !COLOR.test(value.secondaryColor))) {
    fail(value.id, 'colours must be #rrggbb');
  }
  return Object.freeze({ ...value });
}

/** Every line symbol the displays and the dev gallery can draw. Throws at import when the data is inconsistent. */
export const ICON_CATALOGUE: readonly IconDef[] = Object.freeze(
  (data.icons as IconDef[]).map((entry, index, list) => {
    if (list.findIndex((other) => other.id === entry.id) !== index) fail(entry.id, 'duplicate id');
    return icon(entry);
  }),
);

const byId = new Map(ICON_CATALOGUE.map((entry) => [entry.id, entry]));

export function findIcon(id: string): IconDef | undefined {
  return byId.get(id);
}

/** For ids that data files reference: an unknown one is a data error, not something to draw around. */
export function iconFor(id: string): IconDef {
  const found = byId.get(id);
  if (!found) fail(id, 'is not in the catalogue');
  return found;
}
