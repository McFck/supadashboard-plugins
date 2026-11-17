import type { StationDefinition } from '../../simulation/lines';
import type { ScreenLanguage } from '../../rendering/screens';
import { JAPANESE_FONT, LATIN_FONT } from './layout';
export function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  size: number,
  min: number,
  color: string,
  weight = 700,
  family = JAPANESE_FONT,
  align: CanvasTextAlign = 'left',
): void {
  ctx.font = `${weight} ${size}px ${family}`;
  const fitted = Math.max(
    min,
    Math.min(size, (size * width) / Math.max(1, ctx.measureText(text).width)),
  );
  ctx.font = `${weight} ${fitted}px ${family}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y, width);
}

const captions: Record<string, Partial<Record<ScreenLanguage, string>>> = {
  stopped: { ja: '停車中', kana: 'ていしゃちゅう', en: 'Stopped', zh: '停靠中', ko: '정차 중' },
  doorsClosing: {
    ja: 'ドアが閉まります',
    kana: 'ドアがしまります',
    en: 'Doors closing',
    zh: '车门关闭',
    ko: '문이 닫힙니다',
  },
  departing: {
    ja: '発車します',
    kana: 'はっしゃします',
    en: 'Departing',
    zh: '即将发车',
    ko: '출발합니다',
  },
  cruising: { ja: '次は', kana: 'つぎは', en: 'Next', zh: '下一站', ko: '다음 역' },
  approaching: {
    ja: 'まもなく',
    kana: 'まもなく',
    en: 'Approaching',
    zh: '即将到达',
    ko: '곧 도착',
  },
  arriving: { ja: '到着', kana: 'とうちゃく', en: 'Arriving', zh: '到达', ko: '도착' },
  emergency: {
    ja: '緊急停止',
    kana: 'きんきゅうていし',
    en: 'Emergency stop',
    zh: '紧急停车',
    ko: '비상 정차',
  },
  suspended: {
    ja: '運転見合わせ',
    kana: 'うんてんみあわせ',
    en: 'Service suspended',
    zh: '暂停服务',
    ko: '운행 중단',
  },
  platform: {
    ja: '乗車位置',
    kana: 'じょうしゃいち',
    en: 'Platform positions',
    zh: '乘车位置',
    ko: '승차 위치',
  },
  nearby: {
    ja: '近くの駅',
    kana: 'ちかくのえき',
    en: 'Nearby stations',
    zh: '附近车站',
    ko: '주변 역',
  },
  transfers: {
    ja: '乗り換え案内',
    kana: 'のりかえあんない',
    en: 'Transfers',
    zh: '换乘',
    ko: '환승',
  },
  doors: {
    ja: 'ドア・安全案内',
    kana: 'ドア・あんぜんあんない',
    en: 'Doors and safety',
    zh: '车门与安全',
    ko: '문과 안전 안내',
  },
  open: {
    ja: 'ドアが開いています',
    kana: 'ドアがあいています',
    en: 'Doors open',
    zh: '车门已打开',
    ko: '문이 열려 있습니다',
  },
  closed: {
    ja: 'ドアが閉まっています',
    kana: 'ドアがしまっています',
    en: 'Doors closed',
    zh: '车门已关闭',
    ko: '문이 닫혀 있습니다',
  },
  approachingDoor: {
    ja: '停車後にドアが開きます',
    kana: 'ていしゃごにドアがあきます',
    en: 'Doors open after the train stops',
    zh: '列车停稳后车门将打开',
    ko: '열차가 정차한 뒤 문이 열립니다',
  },
  thisSide: { ja: 'こちら側', kana: 'こちらがわ', en: 'This side', zh: '本侧', ko: '이쪽' },
  oppositeSide: {
    ja: '反対側',
    kana: 'はんたいがわ',
    en: 'Opposite side',
    zh: '对侧',
    ko: '반대쪽',
  },
  bothSides: { ja: '両側', kana: 'りょうがわ', en: 'Both sides', zh: '两侧', ko: '양쪽' },
};

export function phrase(language: ScreenLanguage, key: string): string {
  const values = captions[key];
  return values?.[language] ?? values?.ja ?? values?.en ?? key;
}

export function fontFamily(language: ScreenLanguage): string {
  return language === 'ja' || language === 'kana' || language === 'zh' ? JAPANESE_FONT : LATIN_FONT;
}

export function stationName(station: StationDefinition, language: ScreenLanguage): string {
  return station.names[language] ?? station.names.ja ?? station.names.en ?? station.code;
}
