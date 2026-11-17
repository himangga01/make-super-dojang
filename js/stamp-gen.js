// 이름 → 도장 이미지 (28종)
import { fontString } from './fonts.js';
import { gridFor, cellOrder, fillScale, largestRectInPolygon, polygonPoints } from './core/geometry.js';
import { createRandom, hashString } from './core/random.js';

const BASE = 400; // mult = 1 일 때 도장 기준 크기(px)
const MEASURE_PX = 200;

export const STAMP_CATEGORIES = [
  { id: 'all', label: '전체' },
  { id: 'circle', label: '원형' },
  { id: 'ellipse', label: '타원형' },
  { id: 'square', label: '사각형' },
  { id: 'poly', label: '다각형·기타' },
  { id: 'line', label: '가로·세로형' },
  { id: 'special', label: '둘레글자·날짜' },
];

// outline: ellipse | rect | round | chamfer | polygon | scallop | none
// layout(한글): column 세로 한 줄, grid 격자, row 가로 한 줄
export const STAMP_SHAPES = [
  { id: 'circle', label: '원형', cat: 'circle', outline: 'ellipse', layout: 'grid' },
  { id: 'circle-double', label: '이중 원', cat: 'circle', outline: 'ellipse', layout: 'grid', double: true },
  { id: 'circle-thick', label: '굵은 테 원', cat: 'circle', outline: 'ellipse', layout: 'grid', thick: true },
  { id: 'circle-inverted', label: '음각 원', cat: 'circle', outline: 'ellipse', layout: 'grid', inverted: true },
  { id: 'circle-dotted', label: '점선 원', cat: 'circle', outline: 'ellipse', layout: 'grid', dotted: true },
  { id: 'circle-scallop', label: '꽃테 원', cat: 'circle', outline: 'scallop', layout: 'grid' },
  { id: 'circle-cross', label: '칸 나눔 원', cat: 'circle', outline: 'ellipse', layout: 'grid', dividers: true },
  { id: 'ellipse', label: '타원', cat: 'ellipse', outline: 'ellipse', layout: 'column' },
  { id: 'ellipse-double', label: '이중 타원', cat: 'ellipse', outline: 'ellipse', layout: 'column', double: true },
  { id: 'ellipse-inverted', label: '음각 타원', cat: 'ellipse', outline: 'ellipse', layout: 'column', inverted: true },
  { id: 'ellipse-h', label: '가로 타원', cat: 'ellipse', outline: 'ellipse', layout: 'row' },
  { id: 'square', label: '정사각', cat: 'square', outline: 'rect', layout: 'grid' },
  { id: 'square-double', label: '이중 사각', cat: 'square', outline: 'rect', layout: 'grid', double: true },
  { id: 'square-thick', label: '굵은 테 사각', cat: 'square', outline: 'rect', layout: 'grid', thick: true },
  { id: 'square-inverted', label: '음각 사각', cat: 'square', outline: 'rect', layout: 'grid', inverted: true },
  { id: 'square-grid', label: '칸 나눔 사각', cat: 'square', outline: 'rect', layout: 'grid', dividers: true },
  { id: 'rounded', label: '둥근 사각', cat: 'square', outline: 'round', layout: 'grid' },
  { id: 'rounded-inverted', label: '음각 둥근 사각', cat: 'square', outline: 'round', layout: 'grid', inverted: true },
  { id: 'chamfer', label: '모서리 깎은 사각', cat: 'poly', outline: 'chamfer', layout: 'grid' },
  { id: 'octagon', label: '팔각', cat: 'poly', outline: 'polygon', sides: 8, start: Math.PI / 8, layout: 'grid' },
  { id: 'hexagon', label: '육각', cat: 'poly', outline: 'polygon', sides: 6, start: 0, layout: 'grid' },
  { id: 'diamond', label: '마름모', cat: 'poly', outline: 'polygon', sides: 4, start: 0, layout: 'grid' },
  { id: 'borderless', label: '테두리 없음', cat: 'poly', outline: 'none', layout: 'grid' },
  { id: 'rect-h', label: '가로형', cat: 'line', outline: 'rect', layout: 'row' },
  { id: 'rect-h-inverted', label: '음각 가로형', cat: 'line', outline: 'rect', layout: 'row', inverted: true },
  { id: 'rect-v', label: '세로형', cat: 'line', outline: 'rect', layout: 'column' },
  { id: 'ring', label: '둘레글자 원', cat: 'special', special: 'ring' },
  { id: 'date', label: '날짜 도장', cat: 'special', special: 'date' },
];

/**
 * @param {object} o
 * @param {'ko'|'en'} o.lang
 * @param {string[]} o.chars 한글 도장 글자('인' 포함 가능)
 * @param {string[]} [o.baseChars] '인'을 붙이기 전 이름 글자 (둘레글자·날짜 도장용)
 * @param {string} o.text 원래 이름
 * @param {object} o.shape STAMP_SHAPES 항목
 * @param {object} o.font
 * @param {'horizontal'|'vertical'} [o.order]
 * @param {string} o.ink
 * @param {boolean} [o.texture] 인주 질감
 * @param {boolean} [o.bleed] 잉크 번짐
 * @param {number} [o.rotation] 회전(도)
 * @param {string} [o.date] 날짜 도장 날짜 문자열
 * @param {string} [o.dateLabel] 날짜 도장 문구
 * @param {number} [o.mult]
 */
export function renderStamp(o) {
  let canvas;
  if (o.shape.special === 'ring') canvas = drawRing(o);
  else if (o.shape.special === 'date') canvas = drawDate(o);
  else canvas = drawFramed(o);
  // 음각은 번짐을 채운 면에만 준다 (글자를 지운 뒤에 번지면 흰 글자가 메워진다). drawFramed 에서 처리
  if (o.bleed && !o.shape.inverted) canvas = applyBleed(canvas, o.mult ?? 1);
  if (o.texture) applyTexture(canvas, hashString(`${o.shape.id}|${o.font.family}|${o.text}`));
  if (o.rotation) canvas = rotateCanvas(canvas, o.rotation);
  return canvas;
}

// ───────────── 테두리 있는 기본 도장 ─────────────

function drawFramed({ lang, chars, text, shape, font, order = 'horizontal', ink, bleed = false, mult = 1 }) {
  const S = BASE * mult;
  const content = lang === 'ko' ? koContent(chars, shape.layout, shape) : enContent(text, shape.layout);
  const { W, H } = frameSize(shape, S, lang, content);

  const border = shape.outline === 'none' ? 0 : Math.max(2, S * 0.034) * (shape.thick ? 2 : 1);
  const margin = Math.max(border, S * 0.02) * 1.2;
  const canvas = makeCanvas(W + margin * 2, H + margin * 2);
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  const thin = Math.max(1.5, S * 0.034) * 0.45;

  // 1) 바깥 테두리
  if (shape.inverted) {
    tracePath(ctx, shape, cx, cy, W, H);
    ctx.fill();
    if (bleed) {
      const bled = applyBleed(canvas, mult);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bled, 0, 0);
    }
  } else if (border > 0) {
    ctx.lineWidth = border;
    if (shape.dotted) {
      ctx.setLineDash([0.01, border * 1.9]);
      ctx.lineCap = 'round';
      ctx.lineWidth = border * 1.15;
    }
    tracePath(ctx, shape, cx, cy, W - border, H - border);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
  }

  // 2) 안쪽 보조선
  let inset = border + S * 0.034 * 0.6; // 테두리 안쪽에서 글자까지의 거리
  if (shape.double || shape.dotted || shape.outline === 'scallop' || shape.inverted) {
    const d = border + S * 0.034 * 1.1;
    ctx.lineWidth = thin;
    if (shape.inverted) ctx.globalCompositeOperation = 'destination-out';
    tracePath(ctx, shape, cx, cy, W - d * 2, H - d * 2);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    inset = d + thin + S * 0.02;
  }
  if (shape.outline === 'none') inset = 0;

  // 3) 글자 영역
  const cw = W - inset * 2;
  const chh = H - inset * 2;
  const ratio = content.cols / content.rows;
  const area = textArea(shape, cw, chh, ratio);

  if (shape.inverted) ctx.globalCompositeOperation = 'destination-out';
  if (shape.dividers) {
    const grid = lang === 'ko' ? content : { cols: 1, rows: content.lines.length };
    drawDividers(ctx, shape, cx, cy, cw, chh, area, grid, thin);
  }
  // 칸 나눔선이 있으면 글자를 칸 안쪽으로 더 들이고, 마지막 줄을 가운데로 모으지 않는다 (선과 겹치지 않게)
  const fill = shape.dividers ? 0.82 : 0.9;
  ctx.font = fontString(font, MEASURE_PX);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (lang === 'ko') {
    const gridOrder = shape.layout === 'row' ? 'horizontal' : order;
    if (content.three) drawThree(ctx, { chars, order: gridOrder, cx, cy, w: area.w, h: area.h, fill });
    else drawCharGrid(ctx, { chars, cols: content.cols, rows: content.rows, order: gridOrder, cx, cy, w: area.w, h: area.h, fill, centerLastRow: !shape.dividers });
  } else {
    drawLines(ctx, content.lines, cx, cy, area.w, area.h, { bands: Boolean(shape.dividers) });
  }
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

function koContent(chars, layout, shape) {
  // 3자(성+이름 두 자)를 1열 3행으로 쓰면 원·사각 가운데에 가는 띠만 남아 양옆이 빈다.
  // 전통 배치처럼 성을 한 칸 크게, 이름 두 자를 나란히 둔다 (칸 나눔선이 있는 모양은 제외)
  if (layout === 'grid' && chars.length === 3 && !shape?.dividers) return { cols: 2, rows: 2, n: 3, three: true };
  const { cols, rows } = gridFor(chars.length, layout);
  return { cols, rows, n: chars.length };
}

/** 3자 배치. 세로(전통): 오른쪽 열에 성, 왼쪽 열 위아래에 이름. 가로: 윗줄에 성, 아랫줄에 이름 두 자 */
function drawThree(ctx, { chars, order, cx, cy, w, h, fill }) {
  const [a, b, c] = chars;
  if (order === 'vertical') {
    drawFittedGlyph(ctx, a, cx + w / 4, cy, (w / 2) * fill, h * fill * 0.94, 0.45, 1.6); // 세로로 길게 늘린다
    drawFittedGlyph(ctx, b, cx - w / 4, cy - h / 4, (w / 2) * fill, (h / 2) * fill);
    drawFittedGlyph(ctx, c, cx - w / 4, cy + h / 4, (w / 2) * fill, (h / 2) * fill);
  } else {
    drawFittedGlyph(ctx, a, cx, cy - h / 4, w * fill * 0.94, (h / 2) * fill, 0.45, 1.6);
    drawFittedGlyph(ctx, b, cx - w / 4, cy + h / 4, (w / 2) * fill, (h / 2) * fill);
    drawFittedGlyph(ctx, c, cx + w / 4, cy + h / 4, (w / 2) * fill, (h / 2) * fill);
  }
}

/** 영문은 글자 칸 대신 줄 단위로 배치한다 */
function enContent(text, layout) {
  const label = text.toUpperCase().trim();
  // 한 줄 배치는 글자 수만큼 가로로 긴 영역을 쓴다 (고정 비율이면 긴 타원에서 가운데만 쓴다)
  if (layout === 'row') return { lines: [label], cols: clamp(label.length * 0.5, 2, 7), rows: 1, len: label.length };
  let words = label.split(/\s+/).filter(Boolean);
  if (words.length > 3) {
    const half = Math.ceil(words.length / 2);
    words = [words.slice(0, half).join(' '), words.slice(half).join(' ')];
  }
  const longest = Math.max(...words.map((w) => w.length), 1);
  // 줄 수와 가장 긴 줄 길이로 글자 영역 비율을 정한다
  const ratio = Math.min(2.2, Math.max(0.8, (longest * 0.6) / words.length));
  return { lines: words, cols: ratio, rows: 1, len: label.length };
}

function frameSize(shape, S, lang, content) {
  const ellipse = shape.outline === 'ellipse';
  if (shape.layout === 'row') {
    const units = lang === 'ko' ? content.n : content.len * 0.55;
    if (ellipse) {
      const H = S * 0.56;
      return { W: H * clamp(units * 0.85 + 0.7, 1.6, 4.8), H };
    }
    const H = S * (shape.inverted ? 0.5 : 0.42);
    return { W: H * clamp(units * 0.95 + 0.35, 1.6, 6), H };
  }
  if (shape.layout === 'column') {
    if (lang === 'en') return { W: S * clamp(0.5 + content.cols * 0.18, 0.62, 0.85), H: S };
    const r = content.cols / content.rows;
    return { W: S * clamp(r * (ellipse ? 1.6 : 1.35), ellipse ? 0.56 : 0.5, 1), H: S };
  }
  return { W: S, H: S };
}

/** 모양 안에서 글자를 넣을 사각형 */
function textArea(shape, w, h, ratio) {
  switch (shape.outline) {
    case 'rect':
    case 'none':
      return { w, h };
    case 'round':
      return { w: w * 0.96, h: h * 0.96 };
    case 'chamfer':
      return { w: w * 0.9, h: h * 0.9 };
    default: {
      const poly = outlinePoints(shape, w, h);
      const r = largestRectInPolygon(poly, ratio);
      // 내접 사각형보다 크게 잡으면 '재', '인'처럼 모서리까지 획이 있는 글자가 테두리에 닿는다.
      // 마름모만 내접 사각형이 너무 작아 조금 키운다.
      const k = shape.outline === 'polygon' && shape.sides === 4 ? 1.08 : 1;
      return { w: Math.min(r.width * k, w * 0.92), h: Math.min(r.height * k, h * 0.92) };
    }
  }
}

/** 원점 중심 모양의 꼭짓점 근사 (글자 영역 계산용) */
function outlinePoints(shape, w, h) {
  const a = w / 2;
  const b = h / 2;
  if (shape.outline === 'polygon') return polygonPoints(shape.sides, a, b, shape.start);
  if (shape.outline === 'scallop') return polygonPoints(72, a * 0.93, b * 0.93);
  return polygonPoints(72, a, b);
}

function tracePath(ctx, shape, cx, cy, w, h) {
  const a = Math.max(1, w / 2);
  const b = Math.max(1, h / 2);
  ctx.beginPath();
  switch (shape.outline) {
    case 'ellipse':
      ctx.ellipse(cx, cy, a, b, 0, 0, Math.PI * 2);
      break;
    case 'rect':
      roundRectPath(ctx, cx - a, cy - b, w, h, Math.min(w, h) * 0.02);
      break;
    case 'round':
      roundRectPath(ctx, cx - a, cy - b, w, h, Math.min(w, h) * 0.17);
      break;
    case 'chamfer': {
      const c = Math.min(w, h) * 0.15;
      polyPath(ctx, cx, cy, [
        { x: -a + c, y: -b }, { x: a - c, y: -b }, { x: a, y: -b + c }, { x: a, y: b - c },
        { x: a - c, y: b }, { x: -a + c, y: b }, { x: -a, y: b - c }, { x: -a, y: -b + c },
      ]);
      break;
    }
    case 'polygon':
      polyPath(ctx, cx, cy, polygonPoints(shape.sides, a, b, shape.start));
      break;
    case 'scallop': {
      const bumps = 18;
      const pts = Array.from({ length: 360 }, (_, i) => {
        const t = (i / 360) * Math.PI * 2;
        const k = 1 - 0.07 * (1 - Math.abs(Math.sin((bumps * t) / 2)));
        return { x: Math.cos(t) * a * k, y: Math.sin(t) * b * k };
      });
      polyPath(ctx, cx, cy, pts);
      break;
    }
    default:
      break;
  }
  ctx.closePath();
}

function polyPath(ctx, cx, cy, pts) {
  pts.forEach((p, i) => (i ? ctx.lineTo(cx + p.x, cy + p.y) : ctx.moveTo(cx + p.x, cy + p.y)));
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
}

/** 칸 나눔선. 사각은 테두리까지, 원은 안쪽 원 안에서만 긋는다 */
function drawDividers(ctx, shape, cx, cy, w, h, area, content, width) {
  const cols = Math.max(1, Math.round(content.cols));
  const rows = Math.max(1, Math.round(content.rows));
  ctx.save();
  ctx.lineWidth = width;
  if (shape.outline === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.clip();
  }
  // 원은 안쪽 원으로 잘라 내고, 사각은 테두리 안쪽 끝까지 긋는다
  const ext = shape.outline === 'ellipse' ? Math.max(w, h) : 0;
  const x0 = cx - (shape.outline === 'ellipse' ? ext : w / 2);
  const x1 = cx + (shape.outline === 'ellipse' ? ext : w / 2);
  const y0 = cy - (shape.outline === 'ellipse' ? ext : h / 2);
  const y1 = cy + (shape.outline === 'ellipse' ? ext : h / 2);
  ctx.beginPath();
  for (let c = 1; c < cols; c++) {
    const x = cx - area.w / 2 + (area.w / cols) * c;
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
  }
  for (let r = 1; r < rows; r++) {
    const y = cy - area.h / 2 + (area.h / rows) * r;
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawCharGrid(ctx, { chars, cols, rows, order, cx, cy, w, h, fill = 0.9, centerLastRow = true }) {
  const cw = w / cols;
  const ch = h / rows;
  const cells = cellOrder(chars.length, cols, rows, order);
  const lastRowCount = chars.length - (rows - 1) * cols;
  chars.forEach((c, i) => {
    const { col, row } = cells[i];
    let x0 = cx - w / 2 + col * cw;
    if (centerLastRow && order === 'horizontal' && row === rows - 1 && lastRowCount < cols) {
      x0 += ((cols - lastRowCount) * cw) / 2;
    }
    const y0 = cy - h / 2 + row * ch;
    // 칸을 꽉 채우면 굵은 글꼴에서 글자 사이가 글자 안 간격보다 좁아져 음절 경계가 흐려진다
    drawFittedGlyph(ctx, c, x0 + cw / 2, y0 + ch / 2, cw * fill, ch * fill);
  });
}

/**
 * 영문 여러 줄. 모든 줄의 세로 배율을 같게 해 글자 높이를 맞추고,
 * 줄마다 실제로 잰 위·아래 끝(악센트, J·Q 꼬리 포함)으로 자리를 잡아 테두리나 다음 줄에 닿지 않게 한다.
 * bands 가 참이면 줄마다 같은 높이의 칸(칸 나눔선 사이) 안에 넣는다.
 */
function drawLines(ctx, lines, cx, cy, w0, h0, { bands = false } = {}) {
  const w = w0 * 0.92; // 한글 격자처럼 안쪽 여백을 둔다
  const h = h0 * 0.92;
  const ms = lines.map((line) => {
    const m = ctx.measureText(line);
    return {
      left: m.actualBoundingBoxLeft ?? 0,
      right: m.actualBoundingBoxRight ?? m.width,
      ascent: m.actualBoundingBoxAscent ?? MEASURE_PX * 0.75,
      descent: m.actualBoundingBoxDescent ?? 0,
    };
  });
  const n = lines.length;
  const gap = MEASURE_PX * 0.16; // 줄 사이 (배율 적용 전)
  let sy = bands
    ? Math.min(...ms.map((m) => ((h / n) * 0.86) / (m.ascent + m.descent)))
    : h / (ms.reduce((t, m) => t + m.ascent + m.descent, 0) + gap * (n - 1));
  // 너무 좁아지지 않게: 가로 배율이 세로의 0.45배보다 작아야 하면 세로 배율을 낮춘다
  for (const m of ms) sy = Math.min(sy, w / (m.left + m.right) / 0.45);
  const xs = ms.map((m) => Math.min(w / (m.left + m.right), sy * 1.15)); // 짧은 줄을 지나치게 넓히지 않는다

  let y = bands ? cy - h / 2 : cy - (ms.reduce((t, m) => t + (m.ascent + m.descent) * sy, 0) + gap * sy * (n - 1)) / 2;
  ms.forEach((m, i) => {
    const lineH = (m.ascent + m.descent) * sy;
    const top = bands ? cy - h / 2 + (h / n) * i + (h / n - lineH) / 2 : y;
    ctx.save();
    ctx.translate(cx, top + m.ascent * sy);
    ctx.scale(xs[i], sy);
    ctx.fillText(lines[i], (m.left - m.right) / 2, 0);
    ctx.restore();
    y += lineH + gap * sy;
  });
}

/** 글자의 실제 경계 상자를 칸에 꽉 차게 늘려 그린다 */
function drawFittedGlyph(ctx, text, cx, cy, cw, ch, minAspect, maxAspect) {
  const m = ctx.measureText(text);
  const left = m.actualBoundingBoxLeft ?? 0;
  const right = m.actualBoundingBoxRight ?? m.width;
  const ascent = m.actualBoundingBoxAscent ?? MEASURE_PX * 0.8;
  const descent = m.actualBoundingBoxDescent ?? MEASURE_PX * 0.2;
  const { sx, sy } = fillScale(left + right, ascent + descent, cw, ch, minAspect, maxAspect);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(sx, sy);
  ctx.fillText(text, (left - right) / 2, (ascent - descent) / 2);
  ctx.restore();
}

// ───────────── 둘레글자 원 ─────────────

function drawRing({ lang, chars, baseChars, text, font, ink, mult = 1 }) {
  const S = BASE * mult;
  const border = Math.max(2, S * 0.03);
  const canvas = makeCanvas(S + border * 2.4, S + border * 2.4);
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;

  const R = S / 2 - border / 2;
  ctx.lineWidth = border;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  const innerR = R * 0.62;
  ctx.lineWidth = border * 0.5;
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.stroke();

  // 이름이 원래 '인'으로 끝나면(지인, 수인…) 지우면 안 되므로 붙이기 전 글자를 쓴다
  const name = lang === 'ko' ? (baseChars ?? chars).join('') : text.toUpperCase().trim();
  drawCircularText(ctx, {
    unit: lang === 'ko' ? `${name} ★ ` : `${name} ★ `,
    font, cx, cy, mid: (R - border / 2 + innerR) / 2, band: R - border / 2 - innerR,
  });

  // 가운데: 한글은 '인', 영문은 머리글자
  const center = lang === 'ko'
    ? '인'
    : text.toUpperCase().split(/\s+/).filter(Boolean).map((w) => Array.from(w)[0]).join('').slice(0, 3) || 'A';
  ctx.font = fontString(font, MEASURE_PX);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const box = innerR * 1.25;
  drawFittedGlyph(ctx, center, cx, cy, lang === 'ko' ? box * 0.8 : box, lang === 'ko' ? box * 0.8 : box * 0.6, 0.7, 1.3);
  return canvas;
}

/** 원을 따라 글자를 고르게 두른다. 짧은 이름은 반복해 원을 채운다 */
function drawCircularText(ctx, { unit, font, cx, cy, mid, band }) {
  const circ = 2 * Math.PI * mid;
  // 글꼴마다 글자가 실제로 차지하는 높이가 달라(붓글씨는 글꼴 크기의 절반 정도) 잰 높이로 크기를 정한다
  ctx.font = fontString(font, 100);
  const probe = ctx.measureText(unit.replace(/[\s\u2605]/g, '') || unit);
  const glyphH = ((probe.actualBoundingBoxAscent ?? 75) + (probe.actualBoundingBoxDescent ?? 0)) / 100;
  let px = Math.min((band * 0.62) / Math.max(glyphH, 0.3), band * 1.1);
  ctx.font = fontString(font, px);
  let unitW = ctx.measureText(unit).width;
  // 원 둘레를 채우도록 반복한다. 글자 사이 여백이 글자 폭의 절반을 넘지 않게 최대 8번
  let repeat = Math.max(1, Math.min(8, Math.round(circ / (unitW * 1.25))));
  if (unitW * repeat > circ * 0.95) {
    px *= (circ * 0.95) / (unitW * repeat);
    ctx.font = fontString(font, px);
    unitW = ctx.measureText(unit).width;
  }
  const full = Array.from(unit.repeat(repeat));
  const widths = full.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((t, w) => t + w, 0);
  const extra = (circ - total) / full.length;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let angle = -Math.PI / 2 - (widths[0] + extra) / 2 / mid;
  full.forEach((c, i) => {
    const step = (widths[i] + extra) / mid;
    const a = angle + step / 2;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * mid, cy + Math.sin(a) * mid);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(c, 0, 0);
    ctx.restore();
    angle += step;
  });
}

// ───────────── 날짜 도장 ─────────────

function drawDate({ lang, chars, baseChars, text, font, ink, date, dateLabel, mult = 1 }) {
  const S = BASE * mult;
  const border = Math.max(2, S * 0.03);
  const canvas = makeCanvas(S + border * 2.4, S + border * 2.4);
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;

  const R = S / 2 - border / 2;
  ctx.lineWidth = border;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  const Ri = R - border * 1.9;
  ctx.lineWidth = border * 0.45;
  ctx.beginPath();
  ctx.arc(cx, cy, Ri, 0, Math.PI * 2);
  ctx.stroke();

  // 가운데 띠
  const bh = Ri * 0.2;
  const chord = (y) => 2 * Math.sqrt(Math.max(0, Ri * Ri - y * y));
  ctx.beginPath();
  for (const y of [-bh, bh]) {
    const half = chord(y) / 2;
    ctx.moveTo(cx - half, cy + y);
    ctx.lineTo(cx + half, cy + y);
  }
  ctx.stroke();

  ctx.font = fontString(font, MEASURE_PX);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  drawFittedGlyph(ctx, date, cx, cy, chord(bh) * 0.82, bh * 2 * 0.62, 0.5, 1.4);

  // 위: 이름, 아래: 문구
  const regionH = Ri - bh;
  const boxH = regionH * 0.5;
  const yC = bh + regionH * 0.42;
  const boxW = chord(yC + boxH / 2) * 0.92;
  const name = lang === 'ko' ? (baseChars ?? chars) : null;
  if (lang === 'ko') {
    // 7자 이상은 한 줄에 넣으면 너무 작아져 두 줄로 나눈다
    const rows = name.length > 6 ? 2 : 1;
    const cols = Math.ceil(name.length / rows);
    const w = Math.min(boxW, ((boxH * 1.25) / rows) * cols * 1.1);
    drawCharGrid(ctx, { chars: name, cols, rows, order: 'horizontal', cx, cy: cy - yC, w, h: boxH * (rows === 2 ? 1.25 : 1) });
  } else {
    drawFittedGlyph(ctx, text.toUpperCase().trim(), cx, cy - yC, boxW, boxH * 0.8, 0.45, 1.4);
  }
  const label = dateLabel || (lang === 'ko' ? '확인' : 'APPROVED');
  const labelChars = Array.from(label);
  if (lang === 'ko' && /^[가-힣]+$/.test(label)) {
    drawCharGrid(ctx, { chars: labelChars, cols: labelChars.length, rows: 1, order: 'horizontal', cx, cy: cy + yC, w: Math.min(boxW, boxH * labelChars.length * 1.1), h: boxH });
  } else {
    drawFittedGlyph(ctx, label, cx, cy + yC, boxW, boxH * 0.8, 0.45, 1.4);
  }
  return canvas;
}

// ───────────── 효과 ─────────────

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** 작은 점을 지워 찍힌 도장 같은 질감을 낸다. 시드가 같으면 결과도 같다 */
function applyTexture(canvas, seed) {
  const ctx = canvas.getContext('2d');
  const rand = createRandom(seed);
  const { width: w, height: h } = canvas;
  const unit = Math.min(w, h) / 400; // 크기와 상관없이 같은 모양이 되도록
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  const dots = Math.round((w * h) / (unit * unit) / 260);
  for (let i = 0; i < dots; i++) {
    const r = unit * (0.4 + rand() * rand() * 3.2);
    ctx.globalAlpha = 0.35 + rand() * 0.65;
    ctx.beginPath();
    ctx.arc(rand() * w, rand() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
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

/** 잉크가 종이에 번진 듯 획 가장자리를 살짝 넓히고 흐리게 한다 (canvas filter 없이) */
function applyBleed(canvas, mult) {
  const out = makeCanvas(canvas.width, canvas.height);
  const ctx = out.getContext('2d');
  const r = Math.max(0.8, 1.6 * mult);
  ctx.globalAlpha = 0.28;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.drawImage(canvas, Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.globalAlpha = 1;
  ctx.drawImage(canvas, 0, 0);
  return out;
}

function rotateCanvas(canvas, deg) {
  const rad = (deg * Math.PI) / 180;
  const { width: w, height: h } = canvas;
  const W = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
  const H = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(canvas, -w / 2, -h / 2);
  return out;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
