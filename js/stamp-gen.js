// 이름 → 도장 이미지
import { fontString } from './fonts.js';
import { gridFor, cellOrder, rectInEllipse, fillScale } from './core/geometry.js';
import { createRandom, hashString } from './core/random.js';

const BASE = 400; // mult = 1 일 때 도장 기준 크기(px)
const MEASURE_PX = 200;

export const KO_SHAPES = [
  { id: 'ellipse-v', label: '타원' },
  { id: 'circle', label: '원형' },
  { id: 'square', label: '정사각' },
  { id: 'rounded', label: '둥근 사각' },
  { id: 'double-circle', label: '이중 원' },
  { id: 'rect-h', label: '가로형' },
];

export const EN_SHAPES = [
  { id: 'rect-double', label: 'Rectangle' },
  { id: 'ellipse-h', label: 'Oval' },
  { id: 'ring', label: 'Seal' },
  { id: 'square-lines', label: 'Square' },
];

/**
 * @param {object} o
 * @param {string[]} o.chars 한글 도장 글자 목록 (lang=ko)
 * @param {string} o.text 영문 도장 글자 (lang=en)
 * @param {'ko'|'en'} o.lang
 * @param {string} o.shape 모양 id
 * @param {object} o.font
 * @param {'horizontal'|'vertical'} o.order 읽는 순서
 * @param {string} o.ink
 * @param {boolean} o.texture 인주 질감
 * @param {number} o.mult
 */
export function renderStamp(o) {
  const canvas = o.lang === 'en' ? drawEnglish(o) : drawKorean(o);
  if (o.texture) applyTexture(canvas, hashString(`${o.shape}|${o.font.family}|${o.text ?? o.chars.join('')}`));
  return canvas;
}

// ───────────── 한글 ─────────────

function drawKorean({ chars, shape, font, order = 'horizontal', ink, mult = 1 }) {
  const S = BASE * mult;
  const n = chars.length;
  const mode = shape === 'ellipse-v' ? 'column' : shape === 'rect-h' ? 'row' : 'grid';
  const { cols, rows } = gridFor(n, mode);

  // 모양 크기
  let W = S;
  let H = S;
  if (shape === 'ellipse-v') {
    W = S * clamp((cols / rows) * 1.6, 0.56, 1);
  } else if (shape === 'rect-h') {
    H = S * 0.42;
    W = H * clamp(n * 0.95 + 0.25, 1.6, 6);
  }

  const border = Math.max(2, S * 0.034);
  const margin = border * 1.2;
  const canvas = makeCanvas(W + margin * 2, H + margin * 2);
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = border;

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const gap = border * 1.4; // 테두리와 글자 사이
  const ratio = cols / rows;
  let inner; // 글자 영역 {w, h}

  if (shape === 'ellipse-v' || shape === 'circle' || shape === 'double-circle') {
    const a = W / 2 - border / 2;
    const b = H / 2 - border / 2;
    strokeEllipse(ctx, cx, cy, a, b);
    let ia = a - border / 2 - gap;
    let ib = b - border / 2 - gap;
    if (shape === 'double-circle') {
      ctx.lineWidth = border * 0.45;
      const r2a = a - border * 2.2;
      const r2b = b - border * 2.2;
      strokeEllipse(ctx, cx, cy, r2a, r2b);
      ia = r2a - border * 0.25 - gap * 0.8;
      ib = r2b - border * 0.25 - gap * 0.8;
    }
    // 곡선 모양은 글자 모서리가 비어 있어 내접 사각형보다 조금 크게 잡는다
    const r = rectInEllipse(ia, ib, ratio);
    inner = { w: Math.min(r.width * 1.1, ia * 2 * 0.92), h: Math.min(r.height * 1.1, ib * 2 * 0.92) };
  } else {
    const radius = shape === 'rounded' ? Math.min(W, H) * 0.16 : Math.min(W, H) * 0.02;
    strokeRoundRect(ctx, cx - W / 2 + border / 2, cy - H / 2 + border / 2, W - border, H - border, radius);
    inner = { w: W - border * 2 - gap * 2, h: H - border * 2 - gap * 2 };
  }

  // 한 줄 가로형은 읽는 순서 옵션과 상관없이 왼쪽부터 쓴다
  const gridOrder = mode === 'row' ? 'horizontal' : order;
  drawCharGrid(ctx, { chars, font, cols, rows, order: gridOrder, cx, cy, w: inner.w, h: inner.h });
  return canvas;
}

function drawCharGrid(ctx, { chars, font, cols, rows, order, cx, cy, w, h }) {
  const cw = w / cols;
  const ch = h / rows;
  const cells = cellOrder(chars.length, cols, rows, order);
  // 마지막 줄이 덜 차면 가운데로 모은다 (가로 순서일 때)
  const lastRowCount = chars.length - (rows - 1) * cols;

  ctx.font = fontString(font, MEASURE_PX);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  chars.forEach((c, i) => {
    const { col, row } = cells[i];
    let x0 = cx - w / 2 + col * cw;
    if (order === 'horizontal' && row === rows - 1 && lastRowCount < cols) {
      x0 += ((cols - lastRowCount) * cw) / 2;
    }
    const y0 = cy - h / 2 + row * ch;
    drawFittedGlyph(ctx, c, x0 + cw / 2, y0 + ch / 2, cw * 0.94, ch * 0.94);
  });
}

/** 글자의 실제 경계 상자를 칸에 꽉 차게 늘려 그린다 */
function drawFittedGlyph(ctx, text, cx, cy, cw, ch, minAspect, maxAspect) {
  const m = ctx.measureText(text);
  const left = m.actualBoundingBoxLeft ?? 0;
  const right = m.actualBoundingBoxRight ?? m.width;
  const ascent = m.actualBoundingBoxAscent ?? MEASURE_PX * 0.8;
  const descent = m.actualBoundingBoxDescent ?? MEASURE_PX * 0.2;
  const gw = left + right;
  const gh = ascent + descent;
  const { sx, sy } = fillScale(gw, gh, cw, ch, minAspect, maxAspect);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(sx, sy);
  ctx.fillText(text, (left - right) / 2, (ascent - descent) / 2);
  ctx.restore();
}

// ───────────── 영문 ─────────────

function drawEnglish({ text, shape, font, ink, mult = 1 }) {
  const S = BASE * mult;
  const label = text.toUpperCase();
  const border = Math.max(2, S * 0.03);
  let W;
  let H;
  if (shape === 'rect-double') {
    H = S * 0.46;
    W = H * clamp(label.length * 0.5 + 0.8, 2, 5.2);
  } else if (shape === 'ellipse-h') {
    H = S * 0.62;
    W = H * clamp(label.length * 0.32 + 0.9, 1.5, 3.2);
  } else {
    W = S;
    H = S;
  }
  const margin = border * 1.2;
  const canvas = makeCanvas(W + margin * 2, H + margin * 2);
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = border;
  ctx.font = fontString(font, MEASURE_PX);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  if (shape === 'rect-double') {
    strokeRoundRect(ctx, cx - W / 2 + border / 2, cy - H / 2 + border / 2, W - border, H - border, H * 0.04);
    ctx.lineWidth = border * 0.4;
    const inset = border * 2.4;
    strokeRoundRect(ctx, cx - W / 2 + inset, cy - H / 2 + inset, W - inset * 2, H - inset * 2, H * 0.02);
    const pad = inset + border * 1.6;
    drawFittedGlyph(ctx, label, cx, cy, W - pad * 2, H - pad * 2, 0.55, 1.4);
  } else if (shape === 'ellipse-h') {
    const a = W / 2 - border / 2;
    const b = H / 2 - border / 2;
    strokeEllipse(ctx, cx, cy, a, b);
    const ia = a - border * 2;
    const ib = b - border * 2;
    const r = rectInEllipse(ia, ib, Math.max(1.5, a / b * 1.4));
    drawFittedGlyph(ctx, label, cx, cy, r.width, r.height * 0.9, 0.55, 1.4);
  } else if (shape === 'ring') {
    drawRingSeal(ctx, { label, font, cx, cy, S, border });
  } else {
    // square-lines: 단어마다 한 줄
    strokeRoundRect(ctx, cx - W / 2 + border / 2, cy - H / 2 + border / 2, W - border, H - border, W * 0.03);
    const words = label.split(/\s+/).filter(Boolean);
    const lines = words.length > 3 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : words;
    const pad = border * 3;
    const innerW = W - pad * 2;
    const innerH = H - pad * 2;
    const lh = innerH / lines.length;
    lines.forEach((line, i) => {
      drawFittedGlyph(ctx, line, cx, cy - innerH / 2 + lh * (i + 0.5), innerW, lh * 0.82, 0.45, 1.6);
    });
  }
  return canvas;
}

/** 바깥 고리에 이름을 둘러 쓰고 가운데에 머리글자를 넣는다 */
function drawRingSeal(ctx, { label, font, cx, cy, S, border }) {
  const R = S / 2 - border / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  const innerR = R * 0.64;
  ctx.lineWidth = border * 0.5;
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.stroke();

  // 고리 글자
  const ringMid = (R - border / 2 + innerR) / 2;
  const bandH = R - border / 2 - innerR;
  let px = bandH * 0.62;
  const unit = `${label} ★ `;
  ctx.font = fontString(font, px);
  const circ = 2 * Math.PI * ringMid;
  let unitW = ctx.measureText(unit).width;
  let repeat = Math.max(1, Math.min(3, Math.floor((circ * 0.9) / unitW)));
  if (unitW * repeat > circ * 0.95) {
    px *= (circ * 0.95) / (unitW * repeat);
    ctx.font = fontString(font, px);
    unitW = ctx.measureText(unit).width;
  }
  const full = Array.from(unit.repeat(repeat));
  const widths = full.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((s, w) => s + w, 0);
  const extra = (circ - total) / full.length; // 남는 간격을 고르게 나눈다
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let angle = -Math.PI / 2 - (widths[0] + extra) / 2 / ringMid;
  full.forEach((c, i) => {
    const step = (widths[i] + extra) / ringMid;
    const a = angle + step / 2;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * ringMid, cy + Math.sin(a) * ringMid);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(c, 0, 0);
    ctx.restore();
    angle += step;
  });

  // 가운데 머리글자
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => Array.from(w)[0])
    .join('')
    .slice(0, 3) || label.slice(0, 1);
  ctx.font = fontString(font, MEASURE_PX);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const box = innerR * 1.2;
  drawFittedGlyph(ctx, initials, cx, cy, box, box * 0.62, 0.7, 1.3);
}

// ───────────── 공통 ─────────────

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function strokeEllipse(ctx, cx, cy, a, b) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(1, a), Math.max(1, b), 0, 0, Math.PI * 2);
  ctx.stroke();
}

function strokeRoundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.stroke();
}

/** 작은 점을 지워 찍힌 도장 같은 질감을 낸다. 시드가 같으면 결과도 같다 */
function applyTexture(canvas, seed) {
  const ctx = canvas.getContext('2d');
  const rand = createRandom(seed);
  const { width: w, height: h } = canvas;
  const unit = Math.min(w, h) / 400; // 크기와 상관없이 같은 모양이 되도록
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const dots = Math.round((w * h) / (unit * unit) / 260);
  for (let i = 0; i < dots; i++) {
    const r = unit * (0.4 + rand() * rand() * 3.2);
    ctx.globalAlpha = 0.35 + rand() * 0.65;
    ctx.beginPath();
    ctx.arc(rand() * w, rand() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 몇 군데는 잉크가 옅게 묻은 것처럼 넓게 흐리게 지운다
  const patches = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < patches; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = Math.min(w, h) * (0.12 + rand() * 0.15);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
