// 이름 → 서명 이미지
import { fontString } from './fonts.js';
import { createRandom, hashString } from './core/random.js';

const BASE_FONT_PX = 200; // mult = 1 일 때 글자 크기

/**
 * @param {object} o
 * @param {string} o.text 이름
 * @param {{family:string,weight:number,sizeFactor?:number}} o.font
 * @param {string} o.ink 잉크 색
 * @param {number} o.slant 기울기(도)
 * @param {boolean} o.flourish 밑줄 장식
 * @param {number} o.mult 크기 배율
 * @returns {HTMLCanvasElement} 투명 배경 캔버스
 */
export function renderSignature({ text, font, ink, slant = 0, flourish = false, mult = 1 }) {
  const px = Math.round(BASE_FONT_PX * (font.sizeFactor ?? 1) * mult);
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = fontString(font, px);
  const m = measure.measureText(text);

  const left = m.actualBoundingBoxLeft ?? 0;
  const right = m.actualBoundingBoxRight ?? m.width;
  const ascent = m.actualBoundingBoxAscent ?? px * 0.8;
  const descent = m.actualBoundingBoxDescent ?? px * 0.2;
  const glyphW = left + right;

  const tan = Math.tan((slant * Math.PI) / 180);
  // 기울이면 윗부분은 오른쪽, 아랫부분은 왼쪽으로 밀린다
  const extraLeft = tan * descent;
  const extraRight = tan * ascent;

  const pad = Math.round(px * 0.25);
  const flourishRoom = flourish ? px * 0.45 : 0;
  const width = Math.ceil(glyphW + extraLeft + extraRight + pad * 2 + (flourish ? px * 0.3 : 0));
  const height = Math.ceil(ascent + descent + pad * 2 + flourishRoom);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');

  const baseX = pad + extraLeft + left;
  const baseY = pad + ascent;

  ctx.fillStyle = ink;
  ctx.font = fontString(font, px);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  // 기준선(y=0) 위의 점은 오른쪽으로, 아래 점은 왼쪽으로 기운다
  ctx.setTransform(1, 0, -tan, 1, baseX, baseY);
  ctx.fillText(text, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (flourish) {
    drawFlourish(ctx, {
      x0: pad + extraLeft * 0.5,
      x1: width - pad * 0.6,
      y: baseY + descent + px * 0.12,
      px,
      ink,
      seed: hashString(font.family + text),
    });
  }
  return canvas;
}

/** 끝이 가늘어지는 곡선 밑줄 */
function drawFlourish(ctx, { x0, x1, y, px, ink, seed }) {
  const rand = createRandom(seed);
  const len = x1 - x0;
  const p0 = { x: x0 + len * 0.05, y: y + px * 0.05 };
  const p1 = { x: x0 + len * (0.3 + rand() * 0.15), y: y + px * (0.18 + rand() * 0.1) };
  const p2 = { x: x0 + len * (0.65 + rand() * 0.1), y: y - px * (0.02 + rand() * 0.06) };
  const p3 = { x: x1, y: y - px * (0.18 + rand() * 0.1) };
  const maxW = Math.max(1.5, px * 0.045);

  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  const steps = 60;
  let prev = p0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const pt = cubic(p0, p1, p2, p3, t);
    // 가운데가 두껍고 양끝이 가는 굵기
    ctx.lineWidth = maxW * (0.25 + 0.75 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    prev = pt;
  }
}

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}
