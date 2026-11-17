// Canvas port of NextStation's E235-0 optional templates.
// NextStation, Copyright (C) 2015-2020 WatakuCity (tokiensis).
import type { ScreenSchedule } from '../../rendering/screens';
import { e235Station } from './data';
import { e235Images } from './images';
import { JA, SANS, UI, label } from './page-draw';
import { drawE235Platform, transferGrid } from './platform';
import { stopFor, target, thisSide } from './stop';
import { door } from './door';

function notice(ctx: CanvasRenderingContext2D, en: boolean) {
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = 15;
  ctx.strokeRect(7.5, 167.5, 945, 365);
  const title = en ? 'Security Notice' : '特別警戒実施のお知らせ';
  label(
    ctx,
    title,
    480,
    en ? 219 : 215,
    en ? 42 : 34,
    en ? 0 : 340,
    '#ff0000',
    en ? 'Arial' : JA,
    700,
    'center',
  );
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(en ? 318 : 298, en ? 227 : 222, en ? 324 : 364, en ? 3 : 2);
  const lines = en
    ? [
        'JR East Group and the Police Department together are',
        'now on |a high alert|.',
        'If you find |something suspicious| at a station or on a train,',
        'please inform station staff, conductors or security guards',
        'as soon as possible.',
      ]
    : [
        'ただいま、JR 東日本グループでは、警察と連携し、|特別警戒|を実施して',
        'おります。防犯カメラを駅構内に設置しているほか、社員および警備員による',
        '駅構内・列車内の巡回を強化して、お客さまに安心してご利用いただけるよう',
        'に努めております。',
        '駅構内で|不審物や気がかりなこと|がございましたら、お近くの駅係員、車掌',
        'または警備員までお知らせください。お客さまのご協力をお願いいたします。',
      ];
  const size = en ? 32 : 25,
    family = en ? 'Arial' : JA;
  const runs = lines.map((line) =>
    line.split('|').flatMap((part, index) =>
      (en ? [part] : part.split(/(JR)/)).filter(Boolean).map((value) => ({
        value,
        family: !en && value === 'JR' ? SANS : family,
        color: index % 2 ? '#ff0000' : '#000000',
      })),
    ),
  );
  const measure = (run: (typeof runs)[number][number]) => {
    ctx.font = `700 ${size}px ${run.family}`;
    return ctx.measureText(run.value).width;
  };
  const width = Math.max(...runs.map((line) => line.reduce((sum, run) => sum + measure(run), 0)));
  const scale = Math.min(1, (en ? 882 : 884) / width);
  ctx.save();
  ctx.translate((960 - width * scale) / 2, en ? 283 : 273);
  ctx.scale(scale, en ? 1 : 270 / 252);
  runs.forEach((line, i) => {
    let x = 0;
    line.forEach((run) => {
      label(ctx, run.value, x, i * (en ? 48 : 42), size, 0, run.color, run.family, 700);
      x += measure(run);
    });
  });
  ctx.restore();
}

export function drawE235Page(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  if (model.page === 'door' || model.page === 'platform' || model.page === 'closing') {
    drawE235Platform(ctx, model);
    if (model.page === 'platform') {
      transferGrid(ctx, model, 'Platform');
      const station = e235Station(target(model)),
        stop = stopFor(model),
        info = station.platformInfos.find((i) => i.ref === stop.platformRef);
      if (info) {
        label(
          ctx,
          `${info.updateYear}年${info.updateMonth}月現在`,
          950,
          518,
          15,
          0,
          '#000000',
          UI,
          400,
          'right',
        );
        label(
          ctx,
          `As of ${info.updateMonthEnglish}, ${info.updateYearEnglish}`,
          950,
          536,
          15,
          0,
          '#000000',
          SANS,
          400,
          'right',
        );
      }
    }
  } else if (model.page === 'transfers') {
    ctx.fillStyle = '#dae0f0';
    ctx.fillRect(0, 160, 960, 34);
    label(ctx, 'のりかえ案内', 490, 185, 22, 0, '#000000', JA, 400, 'right');
    label(ctx, 'Transfer', 512, 185, 24);
    transferGrid(ctx, model, 'Transfers');
  } else if (model.page === 'notice') notice(ctx, model.language === 'en');
  else if (model.page === 'priority') {
    ctx.strokeStyle = '#d0d0d0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(190.5, 165.5, 579, 327, 8);
    ctx.stroke();
    e235Images.draw(ctx, 'PrioritySeat', 195, 170, 572, (572 * 445.66898) / 800);
    label(
      ctx,
      '優先席を必要とされるお客さまがいらっしゃいましたら、席をお譲りください。',
      480,
      516,
      18,
      580,
      '#000000',
      JA,
      400,
      'center',
    );
    label(
      ctx,
      'Please offer your seat to those who may need it.',
      480,
      533,
      14,
      0,
      '#000000',
      SANS,
      400,
      'center',
    );
  } else if (model.page === 'mobile') {
    e235Images.draw(ctx, 'MobilePhone', 110, 245, 240, (240 * 349.633) / 400);
    ctx.font = `42px ${JA}`;
    const textWidth = Math.max(
      ctx.measureText('マナーモードに設定の上、').width,
      ctx.measureText('通話はご遠慮ください。').width,
    );
    ctx.save();
    ctx.translate(410, 278);
    ctx.scale(Math.min(1, 400 / textWidth), 0.8);
    label(ctx, 'マナーモードに設定の上、', 0, 36, 42, 0, '#000000', JA);
    label(ctx, '通話はご遠慮ください。', 0, 86, 42, 0, '#000000', JA);
    ctx.restore();
    label(ctx, 'Please set your mobile phone to silent mode', 410, 393, 22, 500);
    label(ctx, 'and refrain from talking on the phone.', 410, 419, 22, 500);
  }
}
export function drawE235PageOverlay(
  ctx: CanvasRenderingContext2D,
  model: ScreenSchedule,
  time: number,
) {
  if (model.page === 'door' || model.page === 'closing') {
    door(ctx, model, time);
    return thisSide(model);
  }
  return false;
}
