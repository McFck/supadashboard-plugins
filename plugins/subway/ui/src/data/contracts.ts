export interface CatalogueDirection {
  id: string;
  delta: 1 | -1;
  title: string;
  /** Terminus station code; absent on loops. */
  target?: string;
}

export interface LineFacts {
  id: string;
  title: string;
  code: string;
  /** Catalogue id of the line symbol; it carries the accent colour. */
  iconId: string;
  carCount: number;
  loop: boolean;
  /** Two-row loop placement; the first station of each row is the leftmost cell. */
  loopMap?: { upper: readonly string[]; lower: readonly string[] };
  /** Display presets the line supports; the first one is the default. */
  displayLanguages: readonly string[];
  directions: readonly CatalogueDirection[];
  stations: readonly string[];
}
