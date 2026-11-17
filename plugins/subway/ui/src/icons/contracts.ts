/**
 * How a line symbol is drawn. `letter-box`, `ring`, `train` and `solid` are the NextStation (E235) shapes;
 * `round` and `square` are the lettered signs of the Hibiya and Sakaisuji displays.
 */
export type IconShape = 'letter-box' | 'ring' | 'train' | 'solid' | 'round' | 'square';

/** What a painter needs; ad-hoc fallbacks (unknown transfer text) are built without a catalogue entry. */
export interface PaintedIcon {
  shape: IconShape;
  color: string;
  secondaryColor?: string;
  /** The line letter or code printed in the symbol. */
  letter?: string;
}

export interface IconDef extends PaintedIcon {
  /** Stable `operator/line` id; never derived from a station code or a translated name. */
  id: string;
  names?: { ja: string; en: string };
  /** Where the record comes from, so imported and hand-authored symbols stay distinguishable. */
  source: string;
}
