import type { StationDefinition } from '../../simulation/lines';
import type { ScreenSchedule } from '../../rendering/screens';
import {
  E235_WIDTH,
  HEADER,
  LINE,
  MEIRYO,
  MEIRYO_UI,
  SANS,
  e235Target,
  langOf,
  numbering,
  stopped,
  text,
  type Lang,
} from './draw';

const HEADER_BG = '#202020';
/** Stations with a three-letter code in NextStation's Lines/Yamanote.xml (the rest have none on the real displays). */
const E235_CODES = new Set([
  'JY01',
  'JY02',
  'JY03',
  'JY05',
  'JY07',
  'JY13',
  'JY17',
  'JY20',
  'JY21',
  'JY24',
  'JY25',
  'JY28',
  'JY29',
]);
const MAJOR = new Set(['JY01', 'JY05', 'JY13', 'JY17', 'JY20', 'JY25']);

function terminiFor(model: ScreenSchedule, current: StationDefinition, lang: Lang) {
  const picks = model.route
    .slice(1)
    .filter((s) => MAJOR.has(s.code) && s.code !== current.code)
    .slice(0, 2);
  const name = (s: StationDefinition) =>
    (lang === 'en' ? s.names.en : s.names.ja) ?? s.names.ja ?? s.code;
  return picks.map(name);
}

/** MainArea: columns 240 | 50 | 410 | 100 | 160 on #202020. */
export function drawE235Header(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  const lang = langOf({ ...model, language: model.headerLanguage ?? model.language }),
    current = e235Target(model),
    state = model.snapshot.state;
  ctx.fillStyle = HEADER_BG;
  ctx.fillRect(0, 0, E235_WIDTH, HEADER);
  // Column 1: line-colour bar, Margin="2,0,2,8".
  ctx.fillStyle = LINE;
  ctx.fillRect(242, 0, 46, HEADER - 8);
  // Column 0: destination, Margin="12,4", bottom aligned in a 95px grid.
  const termini = terminiFor(model, current, lang);
  if (lang === 'en') {
    text(ctx, 'Bound for', 12, 61 + 26, 26, SANS, '#d0d0d0', { weight: 700 });
    const lines = termini.length > 1 ? [termini[0] + '&', termini[1]] : [termini[0] ?? ''];
    // WPF BlockLineHeight aligns the 32px glyph baseline 24px into each 30px line.
    lines.forEach((line, i) =>
      text(ctx, line, 12, 61 + 30 + 24 + i * 30, 32, SANS, '#ffffff', {
        weight: 700,
        maxWidth: 216,
      }),
    );
  } else {
    // NextStation's middle dot is narrow: set the two names around a tight dot instead of the wide CJK glyph.
    const destination = termini.join('･');
    const destinationFont = '"Microsoft Sans Serif", "MS UI Gothic", sans-serif';
    ctx.font = `700 48px ${destinationFont}`;
    const width = Math.min(216, ctx.measureText(destination).width);
    text(ctx, destination, 12, 116, 48, destinationFont, '#ffffff', { weight: 700, maxWidth: 216 });
    text(ctx, '方面', 12 + width, 156 - 6, 26, destinationFont, '#ffffff', {
      weight: 700,
      align: 'right',
    });
  }
  // Column 2: caption, numbering block and the station name.
  const caption =
    lang === 'en'
      ? stopped(model)
        ? 'Now stopping at'
        : state === 'approaching'
          ? 'Arriving at'
          : 'Next'
      : stopped(model)
        ? 'ただいま'
        : state === 'approaching'
          ? 'まもなく'
          : lang === 'kana'
            ? 'つぎは'
            : '次は';
  if (lang === 'en') text(ctx, caption, 305, 36, 38, SANS, '#ffffff');
  else text(ctx, caption, 305, 36, 32, MEIRYO, '#ffffff', { weight: 700 });
  // The three-letter code tab appears in every language, but only for stations that carry a code in NextStation's data.
  const code = E235_CODES.has(current.code) ? current.abbr : undefined;
  const blockHeight = code ? 30 + 70 + 8 : 70 + 16,
    blockTop = HEADER - 6 - blockHeight;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.roundRect(300, blockTop, 84, blockHeight, 8);
  ctx.fill();
  if (code) text(ctx, code, 342, blockTop + 25, 26, SANS, '#ffffff', { align: 'center' });
  numbering(ctx, current.code, 308, code ? blockTop + 30 : blockTop + 8);
  const name =
    (lang === 'en'
      ? current.names.en
      : lang === 'kana'
        ? (current.names.kana ?? current.names.ja)
        : current.names.ja) ?? current.code;
  // Names are centred in their box (510px from x=392 for Japanese, 540px for English), regular weight.
  if (lang === 'en')
    text(ctx, name, 392 + 270, 136, 109, SANS, '#ffffff', { align: 'center', maxWidth: 540 });
  else {
    // Two- and three-character names use AdvanceWidth 180 / 140, which renders as a 205 / 160px glyph pitch.
    const chars = [...name],
      pitch = chars.length === 2 ? 205 : chars.length === 3 ? 160 : 0,
      centre = 392 + 255;
    if (pitch)
      chars.forEach((ch, i) =>
        text(
          ctx,
          ch,
          centre + (i - (chars.length - 1) / 2) * pitch,
          143,
          115,
          MEIRYO_UI,
          '#ffffff',
          { align: 'center' },
        ),
      );
    else
      text(ctx, name, centre, 143, 115, MEIRYO_UI, '#ffffff', { align: 'center', maxWidth: 510 });
  }
  // Column 3: clock (hour right-aligned in 42px, colon, minute right-aligned in 42px), 38px.
  const [hour, minute] = model.clock.split(':');
  text(ctx, hour ?? '', 745, 38, 38, SANS, '#ffffff', { align: 'right' });
  text(ctx, ':', 749, 38, 38, SANS, '#ffffff', { align: 'center' });
  text(ctx, minute ?? '', 795, 38, 38, SANS, '#ffffff', { align: 'right' });
  // Column 4: car number 48px italic in the right 60px; caption 20px #D0D0D0.
  text(ctx, model.currentCar > 0 ? String(model.currentCar) : '', 926, 46, 48, SANS, '#ffffff', {
    align: 'center',
    italic: true,
  });
  if (lang === 'en')
    text(ctx, 'Car No.', 891, 24, 20, SANS, '#d0d0d0', { weight: 700, align: 'right' });
  else text(ctx, '号車', 956, 78, 20, SANS, '#d0d0d0', { weight: 700, align: 'right' });
}
