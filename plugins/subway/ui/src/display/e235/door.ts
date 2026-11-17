import type { ScreenSchedule } from '../../rendering/screens';
import { UI, label, polygon } from './page-draw';
import { thisSide } from './stop';

export function e235DoorFrame(time: number) {
  const phase = (time % 6000) / 1000;
  return {
    width: 120 + 80 * Math.max(0, Math.min(1, (phase - 1) / 2)),
    arrowY: phase < 3 ? 120 : phase < 4 ? 100 * (4 - phase) : 0,
  };
}
export function door(ctx: CanvasRenderingContext2D, model: ScreenSchedule, time: number) {
  const near = thisSide(model),
    blue = near ? '#0d50a6' : '#000000';
  ctx.fillStyle = blue;
  ctx.fillRect(0, 400, 960, 140);
  polygon(
    ctx,
    [
      [115, 527],
      [133, 515],
      [257, 515],
      [275, 527],
    ],
    '#c0c000',
  );
  const frame = e235DoorFrame(time),
    width = near ? frame.width : 120;
  for (const [index, x] of [195 - width / 2, 195 + width / 2 - 60].entries()) {
    ctx.fillStyle = '#e6ebf0';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, 410.5, 59, 104, 2.5);
    ctx.fill();
    ctx.stroke();
    const seam = ctx.createLinearGradient(index ? x + 5 : x + 55, 0, index ? x + 1 : x + 59, 0);
    seam.addColorStop(0.2, '#e6ebf04f');
    seam.addColorStop(0.4, '#d0d000');
    ctx.fillStyle = seam;
    ctx.fillRect(index ? x + 1 : x + 55, 411, 4, 103);
    const foot = ctx.createLinearGradient(0, 494, 0, 514);
    foot.addColorStop(0, '#e6ebf04f');
    foot.addColorStop(0.05, '#b0c0d05f');
    foot.addColorStop(0.5, '#b0c0d0df');
    foot.addColorStop(0.55, '#7a90a0ef');
    ctx.fillStyle = foot;
    ctx.fillRect(x + 1, 494, 58, 20);
    // The inner WPF Border starts after the leaf's 1px border and its 8px top margin.
    const window = ctx.createLinearGradient(x + 12.4, 419, x + 47.6, 471);
    window.addColorStop(0.4, blue);
    window.addColorStop(1, near ? '#d0edff' : '#d0e0ff');
    ctx.fillStyle = window;
    ctx.beginPath();
    ctx.roundRect(x + 8.5, 419.5, 43, 51, 2.5);
    ctx.fill();
    ctx.stroke();
  }
  if (near) {
    for (const sign of [-1, 1]) {
      ctx.save();
      ctx.translate(195 + sign * (width / 2 + 34), 462.5);
      ctx.scale(-sign, 1);
      polygon(
        ctx,
        [
          [0, 0],
          [12, -13],
          [12, -7],
          [26, -7],
          [26, 7],
          [12, 7],
          [12, 13],
        ],
        '#ffffff',
      );
      ctx.restore();
    }
    const y = 498 + frame.arrowY;
    polygon(
      ctx,
      [
        [163.5, y + 21],
        [195, y],
        [226.5, y + 21],
      ],
      '#ffffff',
    );
    polygon(
      ctx,
      [
        [168, y + 19.6],
        [195, y + 1.6],
        [222, y + 19.6],
      ],
      '#d00000',
    );
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(195, 468, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d00000';
    ctx.beginPath();
    ctx.arc(195, 468, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(177, 464, 36, 8);
  }
  label(
    ctx,
    near ? 'こちら側のドアが開きます' : '反対側のドアが開きます',
    390,
    468,
    52,
    0,
    '#ffffff',
    UI,
  );
  label(
    ctx,
    near ? 'Doors on this side will open.' : 'Doors on the opposite side will open.',
    near ? 440 : 395,
    499,
    28,
    0,
    '#ffffff',
  );
}
