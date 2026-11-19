export type IconShape = 'letter-box' | 'ring' | 'train' | 'solid' | 'round' | 'square';

export interface PaintedIcon {
  shape: IconShape;
  color: string;
  secondaryColor?: string;
  letter?: string;
}

export interface IconDef extends PaintedIcon {
  /** Stable `operator/line` id; never derived from a station code or a translated name. */
  id: string;
  names?: { ja: string; en: string };
  source: string;
}
