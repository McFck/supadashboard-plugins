// NextStation, Copyright (C) 2015-2020 WatakuCity (tokiensis).
import data from './yamanote-data.json';
import type { RunSnapshot } from '../../simulation/run';
import { iconFor } from '../../icons/catalogue';

export const e235Data = data;
export const e235Station = (code: string) => data.stations.find((s) => s.code === code)!;
export function e235TrainStop(
  code: string,
  direction: string,
  visit: 'initial' | 'regular' | 'last' = 'regular',
) {
  const train = data.trainSettings.find(
    (t) => t.direction === (direction === 'inner' ? 'Opposite' : 'Forward'),
  )!;
  const ref = e235Station(code).ref;
  const rows = train.stations.filter((s) => s.ref === ref);
  return (
    (visit === 'initial' ? rows.find((s) => s.arrivalTime === 0) : undefined) ??
    rows.find(
      (s) =>
        (s.arrivalTime ?? 0) > 0 &&
        (visit === 'last' ? s.use !== 'ExceptLastLoop' : s.use !== 'LastLoopOnly'),
    )!
  );
}

/** ArrivalTime is an interstation minute count, including asymmetric inner/outer timings. */
export function e235Minutes(snapshot: Readonly<RunSnapshot>, route: readonly { code: string }[]) {
  let minutes = 0;
  return new Map(
    route.map((s, i) => {
      if (i) minutes += e235TrainStop(s.code, snapshot.direction).arrivalTime ?? 0;
      return [s.code, minutes] as const;
    }),
  );
}

export function e235TransferLayout(
  code: string,
  direction: string,
  mode: string,
  language: string,
) {
  const station = e235Station(code);
  const definition =
    station.transferDisplays.find((d) => d.direction === direction) ??
    station.transferDisplays.find((d) => d.direction === null);
  const lang = language === 'en' ? 'English' : 'Kanji';
  const layout =
    definition?.layouts.find((l) => l.mode === mode && l.language === lang) ??
    definition?.layouts.find((l) => l.mode === mode && l.language === null);
  return {
    rows: layout?.rows ?? station.transfers.length,
    columns: layout?.columns ?? 1,
    lines: (
      layout?.lines ??
      station.transfers.map((_, ref) => ({
        ref,
        iconRef: null,
        row: ref,
        column: 0,
        columnSpan: 1,
        aliasJa: '',
        aliasEn: '',
      }))
    ).map((item) => {
      const transfer = station.transfers[item.ref]!;
      return { ...item, transfer: { ...transfer, icons: transfer.icons.map(iconFor) } };
    }),
  };
}
