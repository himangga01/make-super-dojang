// 이름 + 서명 형태 → 서명 이미지
import { fontString, signatureFont } from './fonts.js';
import { createRandom, hashString } from './core/random.js';
import { chars } from './core/text.js';
import { trimCanvas } from './exporter.js';

const BASE_FONT_PX = 200; // mult = 1 일 때 글자 크기

/** 형태에 따라 표시할 글자를 바꾼다 */
export function transformText(text, transform) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (transform === 'first-initial' && words.length >= 2) {
    return `${chars(words[0])[0].toUpperCase()}. ${words.slice(1).join(' ')}`;
  }
  if (transform === 'monogram') {
    const initials = words.map((w) => chars(w)[0].toUpperCase()).slice(0, 3).join('');
    return initials || text;
  }
  return text;
}

/**
 * @param {object} o
 * @param {string} o.text 이름
 * @param {object} o.style SIGNATURE_STYLES 항목
 * @param {string} o.ink 잉크 색
 * @param {number} [o.slantAdjust] 기울기 추가(도)
 * @param {number} [o.weight] 굵게(0~3)
 * @param {number} [o.mult] 크기 배율
 * @returns {HTMLCanvasElement} 여백을 자른 투명 배경 캔버스
 */
export function renderSignature({ text, style, ink, slantAdjust = 0, weight = 0, mult = 1 }) {
  const font = signatureFont(style.font);
  const px = BASE_FONT_PX * font.sizeFactor * (style.size ?? 1) * mult;
  const display = transformText(text, style.transform);

  const measure = document.createElement('canvas').getContext('2d');
  const layout = layoutText(measure, display, font, px, style);
  const b0 = layout.bbox;
  const bw = b0.x1 - b0.x0;
  const bh = b0.y1 - b0.y0;
  const cx0 = (b0.x0 + b0.x1) / 2;
  const cy0 = (b0.y0 + b0.y1) / 2;

  const slant = (style.slant ?? 0) + slantAdjust;
  const tan = Math.tan((slant * Math.PI) / 180);
  const rot = ((style.rotate ?? 0) * Math.PI) / 180;

  const W = Math.ceil(bw * 1.3 + bh * (0.6 + Math.abs(tan)) + px * 1.8);
  const H = Math.ceil(bh * 1.4 + bw * Math.abs(Math.sin(rot)) + px * 1.8);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, W);
  canvas.height = Math.max(1, H);
  const ctx = canvas.getContext('2d');
  ctx.translate(W / 2, H / 2);
  ctx.rotate(rot);

  // 글자: 상자 가운데를 기준으로 기울인다
  ctx.save();
  ctx.transform(1, 0, -tan, 1, 0, 0);
  ctx.translate(-cx0, -cy0);
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineJoin = 'round';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (const run of layout.runs) {
    ctx.font = fontString(font, run.px);
    ctx.fillText(run.text, run.x, run.y);
    if (weight > 0) {
      ctx.lineWidth = run.px * 0.012 * weight;
      ctx.strokeText(run.text, run.x, run.y);
    }
  }
  ctx.restore();

  // 꾸밈: 가운데 기준 좌표의 글자 상자
  if (style.deco && style.deco !== 'none') {
    const box = { x0: b0.x0 - cx0, x1: b0.x1 - cx0, y0: b0.y0 - cy0, y1: b0.y1 - cy0, tan };
    const rand = createRandom(hashString(style.id + display));
    const maxW = Math.max(1.2, px * 0.045 * (1 + weight * 0.25));
    DECOS[style.deco]?.(ctx, box, px, maxW, ink, rand);
  }

  return trimCanvas(canvas, 0.04) ?? canvas;
}

/** 글자 배치. 간격·첫 글자 강조·세로쓰기가 없으면 한 번에 그려 필기체 이음과 자간을 살린다 */
function layoutText(ctx, text, font, px, style) {
  const runs = [];
  const bbox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = (x0, y0, x1, y1) => {
    bbox.x0 = Math.min(bbox.x0, x0);
    bbox.y0 = Math.min(bbox.y0, y0);
    bbox.x1 = Math.max(bbox.x1, x1);
    bbox.y1 = Math.max(bbox.y1, y1);
  };
  const metrics = (s, size) => {
    ctx.font = fontString(font, size);
    const m = ctx.measureText(s);
    return {
      left: m.actualBoundingBoxLeft ?? 0,
      right: m.actualBoundingBoxRight ?? m.width,
      ascent: m.actualBoundingBoxAscent ?? size * 0.8,
      descent: m.actualBoundingBoxDescent ?? size * 0.2,
      width: m.width,
    };
  };

  const list = chars(text);
  const spacing = (style.spacing ?? 0) * px;
  const initial = style.initial ?? 1;

  if (style.vertical) {
    let y = 0;
    for (const c of list) {
      if (c === ' ') {
        y += px * 0.4;
        continue;
      }
      const m = metrics(c, px);
      const x = (m.left - m.right) / 2;
      runs.push({ text: c, x, y, px });
      grow(x - m.left, y - m.ascent, x + m.right, y + m.descent);
      y += px * 0.88 + spacing;
    }
  } else if (spacing === 0 && initial === 1) {
    const m = metrics(text, px);
    runs.push({ text, x: 0, y: 0, px });
    grow(-m.left, -m.ascent, m.right, m.descent);
  } else {
    let x = 0;
    list.forEach((c, i) => {
      const size = i === 0 ? px * initial : px;
      const m = metrics(c, size);
      runs.push({ text: c, x, y: 0, px: size });
      if (c !== ' ') grow(x - m.left, -m.ascent, x + m.right, m.descent);
      x += m.width + spacing;
    });
  }
  if (!runs.length) grow(0, -px * 0.8, px * 0.1, px * 0.2);
  return { runs, bbox };
}

// ───────────── 꾸밈 ─────────────

/** 굵기가 바뀌는 선. profile(t) 는 0~1 의 굵기 비율 */
function taper(ctx, pts, maxW, ink, profile = (t) => 0.2 + 0.8 * Math.sin(Math.PI * t)) {
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  for (let i = 1; i < pts.length; i++) {
    ctx.lineWidth = Math.max(0.6, maxW * profile(i / (pts.length - 1)));
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
}

function cubicPts(p0, p1, p2, p3, steps = 60) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  });
}

/** 기울인 글자의 y 높이에서 x 가 밀리는 양 */
const shift = (b, y) => -b.tan * y;

const DECOS = {
  swoosh(ctx, b, px, maxW, ink, rand) {
    const y = b.y1;
    const L = b.x1 - b.x0;
    const s = shift(b, y);
    const pts = cubicPts(
      { x: b.x0 + s, y: y + px * 0.06 },
      { x: b.x0 + s + L * (0.3 + rand() * 0.1), y: y + px * (0.26 + rand() * 0.08) },
      { x: b.x0 + s + L * (0.68 + rand() * 0.08), y: y - px * 0.02 },
      { x: b.x1 + s + px * 0.3, y: y - px * (0.2 + rand() * 0.1) },
    );
    taper(ctx, pts, maxW, ink);
  },

  double(ctx, b, px, maxW, ink) {
    const y = b.y1;
    const L = b.x1 - b.x0;
    const s = shift(b, y);
    const flat = (t) => 0.35 + 0.65 * Math.sin(Math.PI * t);
    taper(ctx, cubicPts(
      { x: b.x0 + s - px * 0.05, y: y + px * 0.14 },
      { x: b.x0 + s + L * 0.3, y: y + px * 0.18 },
      { x: b.x0 + s + L * 0.7, y: y + px * 0.12 },
      { x: b.x1 + s + px * 0.12, y: y + px * 0.08 },
    ), maxW * 0.8, ink, flat);
    taper(ctx, cubicPts(
      { x: b.x0 + s + L * 0.12, y: y + px * 0.3 },
      { x: b.x0 + s + L * 0.4, y: y + px * 0.33 },
      { x: b.x0 + s + L * 0.7, y: y + px * 0.28 },
      { x: b.x1 + s - L * 0.04, y: y + px * 0.25 },
    ), maxW * 0.7, ink, flat);
  },

  wave(ctx, b, px, maxW, ink) {
    const y = b.y1 + px * 0.2;
    const s = shift(b, b.y1);
    const x0 = b.x0 + s;
    const x1 = b.x1 + s + px * 0.2;
    const waves = Math.max(2, Math.round(((x1 - x0) / px) * 1.3));
    const pts = Array.from({ length: 121 }, (_, i) => {
      const t = i / 120;
      return { x: x0 + (x1 - x0) * t, y: y + Math.sin(t * Math.PI * 2 * waves) * px * 0.07 };
    });
    taper(ctx, pts, maxW * 0.85, ink);
  },

  tail(ctx, b, px, maxW, ink, rand) {
    const L = b.x1 - b.x0;
    const yStart = b.y1 - (b.y1 - b.y0) * 0.25;
    const pts = cubicPts(
      { x: b.x1 + shift(b, yStart) - px * 0.05, y: yStart },
      { x: b.x1 + px * (0.5 + rand() * 0.2), y: b.y1 + px * 0.55 },
      { x: b.x0 + L * 0.45, y: b.y1 + px * (0.42 + rand() * 0.1) },
      { x: b.x0 + shift(b, b.y1) - px * 0.25, y: b.y1 + px * 0.22 },
      80,
    );
    taper(ctx, pts, maxW * 1.1, ink, (t) => Math.max(0.12, 1 - t * 0.9));
  },

  circle(ctx, b, px, maxW, ink, rand) {
    const rx = (b.x1 - b.x0) / 2 + px * 0.38 + Math.abs(b.tan) * (b.y1 - b.y0) * 0.5;
    const ry = (b.y1 - b.y0) / 2 + px * 0.3;
    const start = -Math.PI * (0.9 + rand() * 0.1);
    const turns = Math.PI * 2 * 1.08;
    const pts = Array.from({ length: 161 }, (_, i) => {
      const t = i / 160;
      const a = start + turns * t;
      const k = 1 + 0.06 * t; // 끝이 조금 바깥으로 나가 손으로 그린 느낌
      return { x: Math.cos(a) * rx * k, y: Math.sin(a) * ry * k };
    });
    taper(ctx, pts, maxW * 0.8, ink, (t) => 0.25 + 0.75 * Math.sin(Math.PI * t));
  },

  box(ctx, b, px, maxW, ink, rand) {
    const m = px * 0.22;
    const skewPad = Math.abs(b.tan) * (b.y1 - b.y0) * 0.5;
    const x0 = b.x0 - m - skewPad;
    const x1 = b.x1 + m + skewPad;
    const y0 = b.y0 - m;
    const y1 = b.y1 + m;
    const o = px * 0.08; // 모서리에서 조금씩 넘치게
    const j = () => (rand() - 0.5) * px * 0.04;
    const flat = (t) => 0.55 + 0.45 * Math.sin(Math.PI * t);
    const line = (ax, ay, bx, by) => taper(ctx, cubicPts({ x: ax, y: ay }, { x: ax + (bx - ax) / 3 + j(), y: ay + (by - ay) / 3 + j() }, { x: ax + ((bx - ax) * 2) / 3 + j(), y: ay + ((by - ay) * 2) / 3 + j() }, { x: bx, y: by }, 20), maxW * 0.6, ink, flat);
    line(x0 - o, y0 + j(), x1 + o, y0 + j());
    line(x1 + j(), y0 - o, x1 + j(), y1 + o);
    line(x1 + o, y1 + j(), x0 - o, y1 + j());
    line(x0 + j(), y1 + o, x0 + j(), y0 - o);
  },

  dot(ctx, b, px, maxW, ink) {
    const y = b.y1 - px * 0.12;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(b.x1 + shift(b, y) + px * 0.16, y, maxW * 1.1, 0, Math.PI * 2);
    ctx.fill();
  },

  loop(ctx, b, px, maxW, ink) {
    // 늘어진 사이클로이드: 가운데 고리가 하나 생긴다
    const L = b.x1 - b.x0;
    const s = shift(b, b.y1);
    const k = 2.4;
    const sx = (L * 1.05) / (2 * Math.PI);
    const sy = px * 0.065;
    const cx = (b.x0 + b.x1) / 2 + s;
    const pts = Array.from({ length: 141 }, (_, i) => {
      const th = -Math.PI + (2 * Math.PI * i) / 140;
      return { x: cx + sx * (th - k * Math.sin(th)), y: b.y1 + px * 0.34 - sy * (1 - k * Math.cos(th)) };
    });
    taper(ctx, pts, maxW * 0.9, ink);
  },

  strike(ctx, b, px, maxW, ink, rand) {
    const yMid = (b.y0 + b.y1) / 2 + (b.y1 - b.y0) * 0.18;
    const y0 = yMid + px * 0.14;
    const y1 = yMid - px * (0.08 + rand() * 0.06);
    const pts = cubicPts(
      { x: b.x0 + shift(b, y0) - px * 0.35, y: y0 },
      { x: b.x0 + (b.x1 - b.x0) * 0.35, y: yMid + px * 0.1 },
      { x: b.x0 + (b.x1 - b.x0) * 0.7, y: yMid },
      { x: b.x1 + shift(b, y1) + px * 0.4, y: y1 },
    );
    taper(ctx, pts, maxW * 0.9, ink);
  },
};

export const DECO_NAMES = Object.keys(DECOS);
