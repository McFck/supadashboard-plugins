export interface CatalogueDirection {
  id: string;
  delta: 1 | -1;
  title: string;
  /** Terminus station code; the Japanese direction label names it. Absent on loops. */
  target?: string;
}

export interface LineFacts {
  id: string;
  title: string;
  code: string;
  /** Catalogue id of the line's identity symbol; it carries the accent colour. */
  iconId: string;
  carCount: number;
  loop: boolean;
  /** Fixed two-row placement of a loop on a display; the first station of each row is the leftmost cell. */
  loopMap?: { upper: readonly string[]; lower: readonly string[] };
  /** Display presets the line supports; the first one is the default. */
  displayLanguages: readonly string[];
  directions: readonly CatalogueDirection[];
  stations: readonly string[];
}
