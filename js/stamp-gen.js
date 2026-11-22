// 이름 → 도장 이미지 (97종)
import { fontString } from './fonts.js';
import { gridFor, cellOrder, fillScale, largestRectInPolygon, polygonPoints, rectInEllipse } from './core/geometry.js';
import { createRandom, hashString } from './core/random.js';
import { sealGlyph } from './core/seal-glyph.js';
// 확장 모양: 둘레글자·인장체 추가 디자인은 각자 파일에 둔다 (아래 export 한 그리기 도구를 가져다 쓴다)
import { RING_EXTRA_SHAPES, RING_EXTRA_DRAW } from './stamp-ring-extra.js';
import { SEAL_EXTRA_SHAPES, SEAL_EXTRA_DRAW } from './stamp-seal-extra.js';

const BASE = 400; // mult = 1 일 때 도장 기준 크기(px)
const MEASURE_PX = 200;

// 둘레글자를 맨 앞에 둔다: 분류 버튼 순서이자 '전체'에서 카드가 나오는 순서 (app.js CAT_ORDER)
export const STAMP_CATEGORIES = [
  { id: 'all', label: '전체' },
  { id: 'ring', label: '둘레글자' },
  { id: 'circle', label: '원형' },
  { id: 'ellipse', label: '타원형' },
  { id: 'square', label: '사각형' },
  { id: 'poly', label: '다각형·기타' },
  { id: 'line', label: '가로·세로형' },
  { id: 'seal', label: '인장체' },
  { id: 'office', label: '날짜·결재' },
];

// outline: ellipse | rect | round | chamfer | polygon | scallop | gear | notch | none
// layout(한글): column 세로 한 줄, grid 격자, row 가로 한 줄
// 꾸밈: double 안쪽 보조선, thick 굵은 테, inverted 음각, dotted 점선, dividers 칸 나눔선,
//       stars 별 띠, inner 안쪽 틀(rect | ellipse), worn 닳은 테, corners 꺾쇠, radius 모서리 둥글기
// 새 모양은 뒤에 붙인다. 추천 글꼴을 목록 순서로 돌려 쓰므로, 중간에 끼우면 기존 모양의 글꼴이 바뀐다
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
  { id: 'ring', label: '둘레글자 원', cat: 'ring', special: 'ring', sealCenter: true },
  { id: 'date', label: '날짜 도장', cat: 'office', special: 'date' },
  // ── 추가 24종 ──
  // 추천 글꼴이 목록 순서로 정해지므로, 획이 아주 굵은 글꼴(가석·베이글)이 글자가 큰 사각 계열에 오도록 순서를 골랐다.
  // 화면에서는 분류 순서로 모아 보여 준다 (app.js)
  { id: 'square-corner', label: '꺾쇠 사각', cat: 'square', outline: 'rect', layout: 'grid', corners: true },
  { id: 'rounded-double', label: '이중 둥근 사각', cat: 'square', outline: 'round', layout: 'grid', double: true },
  { id: 'circle-square', label: '원 속 사각', cat: 'circle', outline: 'ellipse', layout: 'grid', inner: 'rect' },
  { id: 'circle-worn', label: '닳은 원', cat: 'circle', outline: 'ellipse', layout: 'grid', worn: true },
  { id: 'ellipse-thick', label: '굵은 테 타원', cat: 'ellipse', outline: 'ellipse', layout: 'column', thick: true },
  { id: 'ellipse-dotted', label: '점선 타원', cat: 'ellipse', outline: 'ellipse', layout: 'column', dotted: true },
  { id: 'ellipse-scallop', label: '꽃테 타원', cat: 'ellipse', outline: 'scallop', layout: 'column' },
  { id: 'ellipse-h-double', label: '이중 가로 타원', cat: 'ellipse', outline: 'ellipse', layout: 'row', double: true },
  { id: 'rect-h-double', label: '이중 가로형', cat: 'line', outline: 'rect', layout: 'row', double: true },
  { id: 'circle-gear', label: '톱니 원', cat: 'circle', outline: 'gear', layout: 'grid' },
  { id: 'rect-v-inverted', label: '음각 세로형', cat: 'line', outline: 'rect', layout: 'column', inverted: true },
  { id: 'square-circle', label: '사각 속 원', cat: 'square', outline: 'rect', layout: 'grid', inner: 'ellipse' },
  { id: 'octagon-double', label: '이중 팔각', cat: 'poly', outline: 'polygon', sides: 8, start: Math.PI / 8, layout: 'grid', double: true },
  { id: 'hexagon-inverted', label: '음각 육각', cat: 'poly', outline: 'polygon', sides: 6, start: 0, layout: 'grid', inverted: true },
  { id: 'circle-star', label: '별테 원', cat: 'circle', outline: 'ellipse', layout: 'grid', stars: true },
  { id: 'notched', label: '오목 모서리 사각', cat: 'poly', outline: 'notch', layout: 'grid', double: true },
  { id: 'chamfer-double', label: '이중 깎은 사각', cat: 'poly', outline: 'chamfer', layout: 'grid', double: true },
  { id: 'square-dotted', label: '점선 사각', cat: 'square', outline: 'rect', layout: 'grid', dotted: true },
  { id: 'rect-v-round', label: '둥근 세로형', cat: 'line', outline: 'round', layout: 'column', radius: 0.35 },
  { id: 'ring-star', label: '별 직인', cat: 'ring', special: 'ring-star', sealCenter: true },
  { id: 'ring-square', label: '사각 둘레글자', cat: 'ring', special: 'ring-square' },
  { id: 'receipt', label: '접수인', cat: 'office', special: 'receipt' },
  { id: 'approval', label: '결재 칸', cat: 'office', special: 'approval', selfBleed: true },
  { id: 'confirm-h', label: '확인 가로형', cat: 'office', special: 'confirm' },
  // ── 인장체 4종: 웹 글꼴 대신 자모로 만든 획(core/seal-glyph.js)을 쓴다. seal: plain 기본형 | folded 구첩 ──
  { id: 'seal-square', label: '인장체 사각', cat: 'seal', special: 'seal', outline: 'rect', seal: 'plain', fontLabel: '인장체' },
  { id: 'seal-circle', label: '인장체 원', cat: 'seal', special: 'seal', outline: 'ellipse', seal: 'plain', fontLabel: '인장체' },
  { id: 'seal-folded-square', label: '구첩 사각', cat: 'seal', special: 'seal', outline: 'rect', seal: 'folded', fontLabel: '인장체' },
  { id: 'seal-folded-circle', label: '구첩 원', cat: 'seal', special: 'seal', outline: 'ellipse', seal: 'folded', fontLabel: '인장체' },
  ...RING_EXTRA_SHAPES,
  ...SEAL_EXTRA_SHAPES,
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
  const draw = SPECIAL_DRAW[o.shape.special] ?? drawFramed;
  let canvas = draw(o);
  // 음각은 번짐을 채운 면에만 준다 (글자를 지운 뒤에 번지면 흰 글자가 메워진다). drawFramed 에서 처리.
  // selfBleed 모양(결재 칸)도 흰 글자를 지우기 전에 그리는 함수 안에서 번지게 한다
  if (o.bleed && !o.shape.inverted && !o.shape.selfBleed) canvas = applyBleed(canvas, o.mult ?? 1);
  if (o.texture) applyTexture(canvas, hashString(`${o.shape.id}|${o.font.family}|${o.text}`));
  if (o.rotation) canvas = rotateCanvas(canvas, o.rotation);
  return canvas;
}

const SPECIAL_DRAW = {
  ring: drawRing,
  date: drawDate,
  'ring-star': drawRingStar,
  'ring-square': drawRingSquare,
  receipt: drawReceipt,
  approval: drawApproval,
  confirm: drawConfirm,
  seal: drawSeal,
  ...RING_EXTRA_DRAW,
  ...SEAL_EXTRA_DRAW,
};

// ───────────── 테두리 있는 기본 도장 ─────────────

const GEAR_TEETH = 40;
const GEAR_DEPTH = 0.07; // 톱니 깊이 (반지름 대비)

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
  } else if (shape.worn) {
    // 닳은 자국은 이름마다 다르되, 같은 이름이면 미리보기와 다운로드가 같다
    fillWornRing(ctx, cx, cy, W, H, border * 1.3, createRandom(hashString(`${shape.id}|${text}`)));
  } else if (shape.corners) {
    drawCornerFrame(ctx, cx, cy, W, H, border * 1.5, thin * 1.4);
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
  } else if (shape.outline === 'gear') {
    // 톱니 골보다 안쪽에 가는 원
    const d = border + (Math.min(W, H) / 2) * GEAR_DEPTH + S * 0.034 * 0.8;
    ctx.lineWidth = thin;
    tracePath(ctx, ELLIPSE, cx, cy, W - d * 2, H - d * 2);
    ctx.stroke();
    inset = d + thin + S * 0.02;
  } else if (shape.stars) {
    // 바깥 테와 안쪽 원 사이 띠에 작은 별을 고르게 둘러 찍는다
    const d = border + S * 0.1;
    ctx.lineWidth = thin * 1.3;
    tracePath(ctx, ELLIPSE, cx, cy, W - d * 2, H - d * 2);
    ctx.stroke();
    const mid = Math.min(W, H) / 2 - (border + d) / 2;
    const n = 16;
    for (let i = 0; i < n; i++) {
      const t = -Math.PI / 2 + (i / n) * Math.PI * 2;
      drawStar(ctx, cx + Math.cos(t) * mid, cy + Math.sin(t) * mid, (d - border) * 0.34, t);
    }
    inset = d + thin * 1.3 + S * 0.02;
  } else if (shape.corners) {
    inset = border * 1.5 + S * 0.034 * 0.8;
  } else if (shape.worn) {
    inset = border * 1.3 + S * 0.034 * 0.7;
  }
  if (shape.outline === 'none') inset = 0;

  const ratio = content.cols / content.rows;
  // 안쪽 틀(원 속 사각, 사각 속 원)이 있으면 글자는 그 틀 안에 넣는다
  let innerArea = null;
  if (shape.inner) {
    const lw = border * 0.6;
    const gap = S * 0.03;
    const D = Math.min(W, H) - (border + gap) * 2; // 안쪽 틀이 들어갈 지름(폭)
    ctx.lineWidth = lw;
    if (shape.inner === 'rect') {
      const side = D / Math.SQRT2 - lw; // 바깥 원에 꼭짓점이 닿기 직전까지
      tracePath(ctx, RECT, cx, cy, side, side);
      ctx.stroke();
      const t = side - lw - S * 0.035 * 2;
      innerArea = { w: t, h: t };
    } else {
      tracePath(ctx, ELLIPSE, cx, cy, D - lw, D - lw);
      ctx.stroke();
      const r = (D - lw * 2) / 2 - S * 0.03;
      const box = rectInEllipse(r, r, ratio);
      innerArea = { w: box.width, h: box.height };
    }
    inset = (Math.min(W, H) - Math.max(innerArea.w, innerArea.h)) / 2;
  }

  // 3) 글자 영역
  const cw = W - inset * 2;
  const chh = H - inset * 2;
  const area = innerArea ?? textArea(shape, cw, chh, ratio);

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
  const ellipse = shape.outline === 'ellipse' || shape.outline === 'scallop';
  if (shape.layout === 'row') {
    const units = lang === 'ko' ? content.n : content.len * 0.55;
    if (ellipse) {
      const H = S * (shape.double ? 0.66 : 0.56); // 이중 타원은 보조선 몫만큼 높인다
      return { W: H * clamp(units * 0.85 + 0.7, 1.6, 4.8), H };
    }
    const H = S * (shape.inverted || shape.double ? 0.5 : 0.42); // 안쪽 보조선 몫만큼 높인다
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
    case 'round': {
      if (!shape.radius) return { w: w * 0.96, h: h * 0.96 };
      // 많이 둥글면 글자 칸 모서리가 둥근 모서리에 닿지 않을 만큼 네 변에서 똑같이 들인다
      const p = Math.min(w, h) * shape.radius * 0.32;
      return { w: w - p * 2, h: h - p * 2 };
    }
    case 'chamfer':
      return { w: w * 0.9, h: h * 0.9 };
    case 'notch':
      return { w: w * 0.85, h: h * 0.85 }; // 안으로 파낸 모서리를 피한다
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
      roundRectPath(ctx, cx - a, cy - b, w, h, Math.min(w, h) * (shape.radius ?? 0.17));
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
    case 'gear': {
      // 톱니: 바깥·안쪽 반지름을 번갈아 이은 삼각 날
      const pts = Array.from({ length: GEAR_TEETH * 2 }, (_, i) => {
        const t = (i / (GEAR_TEETH * 2)) * Math.PI * 2;
        const k = i % 2 ? 1 - GEAR_DEPTH : 1;
        return { x: Math.cos(t) * a * k, y: Math.sin(t) * b * k };
      });
      polyPath(ctx, cx, cy, pts);
      break;
    }
    case 'notch': {
      // 네 모서리를 안쪽으로 둥글게 파낸 사각
      const c = Math.min(w, h) * 0.14;
      ctx.moveTo(cx - a + c, cy - b);
      ctx.lineTo(cx + a - c, cy - b);
      ctx.arc(cx + a, cy - b, c, Math.PI, Math.PI / 2, true);
      ctx.lineTo(cx + a, cy + b - c);
      ctx.arc(cx + a, cy + b, c, -Math.PI / 2, -Math.PI, true);
      ctx.lineTo(cx - a + c, cy + b);
      ctx.arc(cx - a, cy + b, c, 0, -Math.PI / 2, true);
      ctx.lineTo(cx - a, cy - b + c);
      ctx.arc(cx - a, cy - b, c, Math.PI / 2, 0, true);
      break;
    }
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

const ELLIPSE = { outline: 'ellipse' };
const RECT = { outline: 'rect' };

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

// ───────────── 둘레글자 원 · 별 직인 (법인 직인 형식) ─────────────
// 둘레에 이름을 고르게 한 바퀴 두르고(글자 머리가 바깥쪽), 맨 위에 ● 또는 ★,
// 가운데 작은 원 안에 '代表理事'(대표이사)를 전통 세로쓰기(오른쪽 열부터)로 넣는다.

/**
 * 가운데 글자 선택지. hanja 는 한자가 들어 있는 웹 글꼴(본명조)로 전통 세로쓰기, 한글은 카드 글꼴로 '읽는 순서'를 따른다.
 * text 가 null 이면 이름(name) 또는 별(star)
 */
export const SEAL_CENTERS = [
  { id: 'daepyo-hanja', label: '代表理事 (대표이사)', text: '代表理事', hanja: true },
  { id: 'daepyo', label: '대표이사', text: '대표이사' },
  { id: 'daepyo-in', label: '대표이사인', text: '대표이사인' },
  { id: 'jikin', label: '직인', text: '직인' },
  { id: 'in-hanja', label: '印 (인)', text: '印', hanja: true },
  { id: 'name', label: '이름', text: null },
  { id: 'star', label: '★ 별', text: null },
];
export const SEAL_CENTER_FONT = { family: 'Noto Serif KR', weight: 900, label: '본명조' };
/** app.js·MCP 가 미리 받을 가운데 글자 전체 */
export const SEAL_CENTER_TEXT = SEAL_CENTERS.map((c) => c.text ?? '').join('');

/**
 * 모양에 쓸 글꼴 (app.js·MCP 공통): 모양이 정한 글꼴(shape.font, 인감체 등) > 고른 글꼴 > 추천 조합.
 * 추천 조합은 모양마다 글꼴을 목록 순서대로 돌려 쓴다 (분류를 바꿔도 같은 모양은 같은 글꼴)
 */
export function stampFont(shape, fonts, chosen) {
  return shape.font ?? chosen ?? fonts[STAMP_SHAPES.indexOf(shape) % fonts.length];
}
/** 가운데 글자 선택지(직인 가운데)를 쓰는 모양. 추가 모양은 sealCenter 표시로, 표시가 없는 기존 둘레글자 원·별 직인은 special 로 본다 */
export function usesSealCenter(shape) {
  return Boolean(shape && (shape.sealCenter || shape.special === 'ring' || shape.special === 'ring-star'));
}
/** 가운데 한자(代表理事·印)를 그릴 글꼴: 모양이 정한 글꼴(shape.centerFont) 또는 본명조 900 */
export function sealCenterFont(shape) {
  return shape.centerFont ?? SEAL_CENTER_FONT;
}
/** 보이는 모양들이 가운데 한자에 쓰는 글꼴 (글꼴·굵기마다 한 번씩) */
export function sealCenterFonts(shapes) {
  const seen = new Map();
  for (const sh of shapes) {
    if (!usesSealCenter(sh)) continue;
    const f = sealCenterFont(sh);
    seen.set(`${f.family}|${f.weight}`, f);
  }
  return [...seen.values()];
}
const SEP = null; // 둘레에서 짧은 이름을 되풀이할 때 사이에 넣는 작은 점

function drawRing(o) {
  return drawSealRing(o, { marker: 'dot', doubleRim: false });
}

function drawRingStar(o) {
  return drawSealRing(o, { marker: 'star', doubleRim: true });
}

/** 둘레에 두를 글자. 한글은 '인'을 붙이기 전 이름, 영문은 대문자(띄어쓰기는 점). 너무 짧으면 되풀이한다 */
function ringUnits(lang, chars, baseChars, text) {
  const name = lang === 'ko'
    ? (baseChars ?? chars).filter((c) => c.trim())
    : Array.from(text.toUpperCase().trim()).map((c) => (/\s/.test(c) ? SEP : c));
  if (!name.length) return ['A'];
  return name.length <= 2 ? [...name, SEP, ...name, SEP] : name;
}

function drawSealRing({ lang, chars, baseChars, text, font, ink, order = 'horizontal', sealCenter, mult = 1 }, { marker, doubleRim }) {
  const S = BASE * mult;
  const rim = Math.max(2, S * 0.034);
  const canvas = makeCanvas(S + rim * 2.4, S + rim * 2.4);
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;

  // 1) 바깥 테 (별 직인은 굵은 테 + 가는 테)
  const R = S / 2 - rim / 2;
  strokeCircle(ctx, cx, cy, R, rim);
  let edge = R - rim / 2;
  if (doubleRim) {
    const thin = rim * 0.42;
    const r2 = edge - rim * 0.6 - thin / 2;
    strokeCircle(ctx, cx, cy, r2, thin);
    edge = r2 - thin / 2;
  }

  // 2) 가운데 원
  const innerW = Math.max(1.5, S * 0.017);
  const Rc = S * 0.215;
  strokeCircle(ctx, cx, cy, Rc, innerW);
  const inner = Rc + innerW / 2;
  const band = edge - inner;
  const mid = inner + band / 2;

  // 3) 둘레 글자: 맨 위를 비우고 고르게. 글자가 많으면 맨 위 표시 자리를 한 칸 따로 둔다
  const units = ringUnits(lang, chars, baseChars, text);
  const slots = units.length + (units.length >= 5 ? 1 : 0);
  const step = (Math.PI * 2) / slots;
  const first = units.length >= 5 ? step : step / 2;
  let cellH = band * 0.74;
  const cellW = Math.min(step * mid * 0.84, cellH * 1.15);
  if (cellW < cellH * 0.62) cellH = cellW / 0.62; // 글자가 많으면 세로도 줄여 너무 홀쭉해지지 않게
  ctx.font = fontString(font, MEASURE_PX);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  units.forEach((c, i) => {
    const a = -Math.PI / 2 + first + step * i;
    const x = cx + Math.cos(a) * mid;
    const y = cy + Math.sin(a) * mid;
    if (c === SEP) {
      ctx.beginPath();
      ctx.arc(x, y, band * 0.055, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2);
    // 인장처럼 칸을 꽉 채우도록 가로세로 비율을 넉넉히 바꿔 그린다
    drawFittedGlyph(ctx, c, 0, 0, cellW, cellH, 0.55, 1.6);
    ctx.restore();
  });

  // 4) 맨 위 표시
  const gap = (units.length >= 5 ? step * 2 : step) * mid - cellW;
  if (marker === 'star') drawStar(ctx, cx, cy - mid, Math.min(band * 0.22, gap * 0.42));
  else {
    ctx.beginPath();
    ctx.arc(cx, cy - mid, Math.min(band * 0.1, gap * 0.28), 0, Math.PI * 2);
    ctx.fill();
  }

  // 5) 가운데 글자
  drawSealCenter(ctx, { lang, chars, text, font, order, sealCenter, cx, cy, r: Rc - innerW / 2 });
  return canvas;
}

function strokeCircle(ctx, cx, cy, r, width) {
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * 가운데 원 안의 글자. 한자(代表理事·印)는 오른쪽 열부터 세로로, 한글과 이름은 '읽는 순서'를 따른다.
 * 영문 이름은 머리글자(별을 고르면 별)
 */
function drawSealCenter(ctx, { lang, chars, text, font, order, sealCenter, cx, cy, r, hanjaFont = SEAL_CENTER_FONT }) {
  const choice = SEAL_CENTERS.find((c) => c.id === sealCenter) ?? SEAL_CENTERS[0];
  if (choice.id === 'star') {
    drawStar(ctx, cx, cy, r * 0.8);
    return;
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (lang !== 'ko') {
    const side = r * Math.SQRT2 * 0.84;
    ctx.font = fontString(font, MEASURE_PX);
    drawFittedGlyph(ctx, initials(text), cx, cy, side, side * 0.6, 0.6, 1.4);
    return;
  }
  const glyphs = choice.text ? Array.from(choice.text) : chars.filter((c) => c.trim());
  const n = glyphs.length;
  if (!n) return;
  const vertical = choice.hanja || order === 'vertical';
  // 칸 수: 1 → 1, 2·3 → 한 줄, 4 → 2×2, 5·6 → 2×3, 그 이상은 정사각에 가깝게
  const major = n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : Math.ceil(Math.sqrt(n)); // 한 줄(세로쓰기는 한 열)에 들어가는 글자 수
  const lines = Math.ceil(n / major);
  const cols = vertical ? lines : major;
  const rows = vertical ? major : lines;
  // 세로쓰기 1~3자는 한 열, 가로쓰기 2·3자는 한 줄이 되도록 위에서 정했다. 원 안에 들어가는 가장 큰 사각형
  const box = rectInEllipse(r * 0.9, r * 0.9, cols / rows);
  const cw = box.width / cols;
  const ch = box.height / rows;
  const x0 = cx - box.width / 2;
  const y0 = cy - box.height / 2;
  ctx.font = fontString(choice.hanja ? hanjaFont : font, MEASURE_PX);
  glyphs.forEach((g, i) => {
    const line = Math.floor(i / major);
    const pos = i % major;
    // 마지막 줄이 덜 차면 가운데로 모은다
    const inLine = line === lines - 1 ? n - line * major : major;
    const shift = (major - inLine) / 2;
    const col = vertical ? cols - 1 - line : pos + shift;
    const row = vertical ? pos + shift : line;
    drawFittedGlyph(ctx, g, x0 + (col + 0.5) * cw, y0 + (row + 0.5) * ch, cw * 0.94, ch * 0.94, 0.7, 1.4);
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

// ───────────── 꾸밈 도우미 ─────────────

/** 꼭짓점 다섯 개짜리 별. angle 은 한 꼭짓점이 향하는 방향(라디안) */
function drawStar(ctx, x, y, r, angle = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const t = angle + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.4 : r;
    const px = x + Math.cos(t) * rr;
    const py = y + Math.sin(t) * rr;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * 닳은 테: 바깥 가장자리가 고르지 않게 깎이고 두세 군데 끊긴 원 테.
 * 바깥 끝이 W×H 타원에 닿고 안쪽으로 width 만큼 채운다. 글자보다 먼저 그려 지운 자국이 글자에 닿지 않는다
 */
function fillWornRing(ctx, cx, cy, W, H, width, rand) {
  const a = W / 2;
  const b = H / 2;
  const ph = [rand(), rand(), rand(), rand()].map((v) => v * Math.PI * 2);
  const wear = (t) => clamp(0.45 + 0.25 * Math.sin(2 * t + ph[0]) + 0.15 * Math.sin(5 * t + ph[1]) + 0.1 * Math.sin(11 * t + ph[2]) + 0.06 * Math.sin(23 * t + ph[3]), 0, 1);
  const N = 360;
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const e = width * 0.42 * wear(t); // 바깥이 깎인 깊이
    const x = cx + Math.cos(t) * (a - e);
    const y = cy + Math.sin(t) * (b - e);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const r = width * (1 + 0.07 * Math.sin(7 * t + ph[1]));
    const x = cx + Math.cos(t) * (a - r);
    const y = cy + Math.sin(t) * (b - r);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fill('evenodd');

  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  // 끊긴 곳: 테 가운데에 겹친 작은 원 몇 개로 지워 가장자리를 들쭉날쭉하게
  const gaps = 2 + Math.floor(rand() * 2);
  for (let g = 0; g < gaps; g++) {
    const t0 = ((g + rand() * 0.6) / gaps) * Math.PI * 2;
    for (let k = -1; k <= 1; k++) {
      const t = t0 + (k * width * 0.55) / a;
      const r = width * (0.55 + rand() * 0.3);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(t) * (a - width / 2), cy + Math.sin(t) * (b - width / 2), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 바깥 가장자리의 이 빠진 자국
  for (let k = 0; k < 18; k++) {
    const t = rand() * Math.PI * 2;
    const r = width * (0.2 + rand() * 0.35);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(t) * a, cy + Math.sin(t) * b, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 꺾쇠 테: 가는 사각 테 위 네 모서리에 굵은 ㄱ자 꺾쇠 */
function drawCornerFrame(ctx, cx, cy, W, H, bw, lw) {
  const a = (W - bw) / 2;
  const b = (H - bw) / 2;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.rect(cx - a, cy - b, a * 2, b * 2);
  ctx.stroke();
  const L = Math.min(W, H) * 0.24;
  ctx.lineWidth = bw;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.moveTo(cx + sx * a, cy + sy * (b - L));
    ctx.lineTo(cx + sx * a, cy + sy * b);
    ctx.lineTo(cx + sx * (a - L), cy + sy * b);
  }
  ctx.stroke();
}

/** 칸 w×h 에 글자 n개를 놓을 격자. 글자 칸이 가장 크고 빈칸이 적은 쪽을 고른다 */
function bestGrid(n, w, h) {
  let best = { cols: n, rows: 1 };
  let bestScore = -1;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    if ((rows - 1) * cols >= n) continue; // 빈 줄이 생기는 배치
    const score = Math.min(w / cols, h / rows) * (1 - 0.08 * (cols * rows - n));
    if (score > bestScore) {
      bestScore = score;
      best = { cols, rows };
    }
  }
  return best;
}

/** 한글 이름을 상자 안에 격자로. 한 줄이면 세로 읽기 순서를 쓰지 않는다 (오른쪽부터 거꾸로 읽히므로) */
function drawNameBox(ctx, chars, cx, cy, w, h, order, fill = 0.88) {
  const { cols, rows } = bestGrid(chars.length, w, h);
  // 칸이 지나치게 납작하거나 길쭉하지 않게 상자를 줄인다
  const cell = Math.min(w / cols, h / rows);
  const bw = Math.min(w, cell * 1.25 * cols);
  const bh = Math.min(h, cell * 1.25 * rows);
  drawCharGrid(ctx, { chars, cols, rows, order: rows === 1 ? 'horizontal' : order, cx, cy, w: bw, h: bh, fill });
}

/** 짧은 문구(확인, 결재, APPROVED…)를 상자 안에. 한글은 글자 칸을 벌려 쓰고, 그 밖은 한 덩어리로 */
function drawLabel(ctx, label, cx, cy, w, h, { vertical = false } = {}) {
  const list = Array.from(label);
  if (/^[가-힣]+$/.test(label)) {
    if (vertical) drawCharGrid(ctx, { chars: list, cols: 1, rows: list.length, order: 'horizontal', cx, cy, w: Math.min(w, (h / list.length) * 1.1), h, fill: 0.86 });
    else drawCharGrid(ctx, { chars: list, cols: list.length, rows: 1, order: 'horizontal', cx, cy, w: Math.min(w, h * list.length * 1.25), h, fill: 0.86 });
  } else {
    drawFittedGlyph(ctx, label, cx, cy, w, h * 0.8, 0.45, 1.4);
  }
}

/** 업무용 도장 문구. 고른 문구가 없으면 모양마다 어울리는 기본 문구 */
function labelFor(shape, lang, dateLabel) {
  if (dateLabel) return dateLabel;
  return DEFAULT_LABEL[shape.special][lang === 'ko' ? 'ko' : 'en'];
}

const DEFAULT_LABEL = {
  receipt: { ko: '접수', en: 'RECEIVED' },
  approval: { ko: '결재', en: 'APPROVED' },
  confirm: { ko: '확인', en: 'CHECKED' },
};

function initials(text) {
  return text.toUpperCase().split(/\s+/).filter(Boolean).map((w) => Array.from(w)[0]).join('').slice(0, 3) || 'A';
}

// ───────────── 사각 둘레글자 ─────────────

function drawRingSquare({ lang, chars, baseChars, text, font, ink, mult = 1 }) {
  const S = BASE * mult;
  const border = Math.max(2, S * 0.032);
  const canvas = makeCanvas(S + border * 2.4, S + border * 2.4);
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;

  const half = S / 2 - border / 2;
  ctx.lineWidth = border;
  ctx.beginPath();
  ctx.rect(cx - half, cy - half, half * 2, half * 2);
  ctx.stroke();
  const band = S * 0.2;
  const inW = border * 0.5;
  const inH = S / 2 - border - band - inW / 2; // 안쪽 사각 반폭 (선 가운데)
  ctx.lineWidth = inW;
  ctx.beginPath();
  ctx.rect(cx - inH, cy - inH, inH * 2, inH * 2);
  ctx.stroke();

  const bandIn = inH + inW / 2; // 띠 안쪽 끝
  const bandOut = S / 2 - border; // 띠 바깥 끝
  const mid = (bandIn + bandOut) / 2;
  const bandH = bandOut - bandIn;
  // 모서리 칸에는 작은 별
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    drawStar(ctx, cx + sx * mid, cy + sy * mid, bandH * 0.3, Math.atan2(sy, sx));
  }

  // 네 변에 같은 글자열. 시계 방향으로 돌며 글자 머리가 바깥을 향한다
  const name = lang === 'ko' ? (baseChars ?? chars).join('') : text.toUpperCase().trim();
  const L = inH * 2 - inW; // 모서리 칸 사이 길이
  ctx.font = fontString(font, 100);
  const probe = ctx.measureText(name.replace(/\s/g, '') || name);
  const glyphH = ((probe.actualBoundingBoxAscent ?? 75) + (probe.actualBoundingBoxDescent ?? 0)) / 100;
  let px = (bandH * 0.62) / Math.max(glyphH, 0.3);
  ctx.font = fontString(font, px);
  const slot = ctx.measureText(lang === 'ko' ? '가' : 'M').width;
  let runs;
  if (lang === 'ko' && ctx.measureText(name).width * 0.72 > L * 0.92) {
    // 한 변에 넣으면 많이 작아지는 긴 한글 이름(대략 6자 이상)은 네 변에 이어서 한 번만 두른다
    const list = Array.from(name);
    const base = Math.floor(list.length / 4);
    const rem = list.length % 4;
    let at = 0;
    runs = [0, 1, 2, 3].map((side) => {
      const n = base + (side < rem ? 1 : 0);
      const part = list.slice(at, at + n);
      at += n;
      return part;
    });
  } else {
    // 짧은 이름은 가운뎃점을 끼워 되풀이해 변을 채운다
    let run = name;
    while (ctx.measureText(`${run} · ${name}`).width < L * 0.9 && run.length < 24) run = `${run} · ${name}`;
    if (run === name && Array.from(name).length === 1) run = `· ${name} ·`;
    runs = [0, 1, 2, 3].map(() => Array.from(run));
  }
  let widths = runs.map((g) => g.map((c) => ctx.measureText(c).width));
  const longest = () => Math.max(...widths.map((ws) => ws.reduce((t, w) => t + w, 0)));
  if (longest() > L * 0.92) {
    px *= (L * 0.92) / longest();
    ctx.font = fontString(font, px);
    widths = runs.map((g) => g.map((c) => ctx.measureText(c).width));
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  runs.forEach((glyphs, side) => {
    const ws = widths[side];
    const total = ws.reduce((t, w) => t + w, 0);
    // 남는 길이를 글자 사이에 고르게 (너무 벌어지지 않게 글자 폭 정도까지만)
    const extra = glyphs.length > 1 ? Math.min((L * 0.92 - total) / (glyphs.length - 1), slot * 0.9) : 0;
    const rot = (side * Math.PI) / 2;
    ctx.save();
    ctx.translate(cx + Math.sin(rot) * mid, cy - Math.cos(rot) * mid);
    ctx.rotate(rot);
    let x = -(total + extra * (glyphs.length - 1)) / 2;
    glyphs.forEach((c, i) => {
      ctx.fillText(c, x + ws[i] / 2, 0);
      x += ws[i] + extra;
    });
    ctx.restore();
  });

  // 가운데: 한글은 '인', 영문은 머리글자
  ctx.font = fontString(font, MEASURE_PX);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const box = (inH * 2 - inW) * 0.74;
  drawFittedGlyph(ctx, lang === 'ko' ? '인' : initials(text), cx, cy, box, lang === 'ko' ? box : box * 0.62, 0.7, 1.3);
  return canvas;
}

// ───────────── 접수인 (문구 / 날짜 / 이름) ─────────────

function drawReceipt({ lang, chars, baseChars, text, shape, font, ink, date, dateLabel, mult = 1 }) {
  const S = BASE * mult;
  const border = Math.max(2, S * 0.032);
  const W = S * 1.1;
  const H = S * 0.8;
  const m = border * 1.2;
  const canvas = makeCanvas(W + m * 2, H + m * 2);
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;

  // 바깥 테 + 가는 안쪽 테
  ctx.lineWidth = border;
  tracePath(ctx, RECT, cx, cy, W - border, H - border);
  ctx.stroke();
  const thin = border * 0.45;
  const d = border + S * 0.028;
  const iw = W - d * 2;
  const ih = H - d * 2;
  ctx.lineWidth = thin;
  ctx.beginPath();
  ctx.rect(cx - iw / 2, cy - ih / 2, iw, ih);
  // 세 줄: 문구 0.3 / 날짜 0.38 / 이름 0.32
  const top = cy - ih / 2;
  const y1 = top + ih * 0.3;
  const y2 = top + ih * 0.68;
  for (const y of [y1, y2]) {
    ctx.moveTo(cx - iw / 2, y);
    ctx.lineTo(cx + iw / 2, y);
  }
  ctx.stroke();

  ctx.font = fontString(font, MEASURE_PX);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const pad = thin + S * 0.03;
  const tw = iw - pad * 2;
  drawLabel(ctx, labelFor(shape, lang, dateLabel), cx, (top + y1) / 2, tw * 0.62, y1 - top - pad * 2);
  drawFittedGlyph(ctx, date ?? '', cx, (y1 + y2) / 2, tw * 0.94, (y2 - y1 - pad * 2) * 0.86, 0.5, 1.4);
  const nameY = (y2 + top + ih) / 2;
  const nameH = top + ih - y2 - pad * 2;
  if (lang === 'ko') {
    const name = baseChars ?? chars;
    drawCharGrid(ctx, { chars: name, cols: name.length, rows: 1, order: 'horizontal', cx, cy: nameY, w: Math.min(tw, nameH * name.length * 1.15), h: nameH, fill: 0.88 });
  } else {
    drawFittedGlyph(ctx, text.toUpperCase().trim(), cx, nameY, tw, nameH * 0.82, 0.45, 1.4);
  }
  return canvas;
}

// ───────────── 결재 칸 (채운 머리줄의 흰 문구 + 이름) ─────────────

function drawApproval({ lang, chars, text, shape, font, ink, bleed = false, dateLabel, order = 'horizontal', mult = 1 }) {
  const S = BASE * mult;
  const border = Math.max(2, S * 0.034);
  const W = S;
  const H = S * 0.84;
  const m = border * 1.2;
  const canvas = makeCanvas(W + m * 2, H + m * 2);
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;

  ctx.lineWidth = border;
  ctx.beginPath();
  ctx.rect(cx - (W - border) / 2, cy - (H - border) / 2, W - border, H - border);
  ctx.stroke();
  const hh = H * 0.3;
  const top = cy - H / 2;
  ctx.fillRect(cx - W / 2, top, W, hh);

  // 이름 칸
  ctx.font = fontString(font, MEASURE_PX);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const pad = border + S * 0.035;
  const bw = W - pad * 2;
  const bh = H - hh - pad * 1.6;
  const by = top + hh + (H - hh) / 2;
  if (lang === 'ko') drawNameBox(ctx, chars, cx, by, bw, bh, order);
  else drawLines(ctx, enContent(text, 'grid').lines, cx, by, bw, bh);

  if (bleed) {
    const bled = applyBleed(canvas, mult);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bled, 0, 0);
  }
  // 머리줄 문구는 지워서 종이색으로 (음각)
  ctx.globalCompositeOperation = 'destination-out';
  drawLabel(ctx, labelFor(shape, lang, dateLabel), cx, top + hh / 2 + border * 0.2, W * 0.7, hh * 0.62);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

// ───────────── 확인 가로형 ([문구 | 이름]) ─────────────

function drawConfirm({ lang, chars, baseChars, text, shape, font, ink, dateLabel, mult = 1 }) {
  const S = BASE * mult;
  const border = Math.max(2, S * 0.034);
  const H = S * 0.46;
  const label = labelFor(shape, lang, dateLabel);
  const koLabel = /^[가-힣]+$/.test(label);
  const name = lang === 'ko' ? (baseChars ?? chars) : null;
  const en = text.toUpperCase().trim();
  const inner = H - border * 2 - S * 0.05; // 글자 높이 기준
  // 한글 문구는 세로로 쌓고, 그 밖의 문구는 글자 수만큼 넓힌다
  const lw = koLabel ? inner * (Array.from(label).length > 2 ? 0.5 : 0.62) + S * 0.06 : inner * clamp(label.length * 0.46, 0.9, 3.4) + S * 0.06;
  const nw = lang === 'ko' ? inner * 0.95 * name.length + S * 0.08 : inner * clamp(en.length * 0.42, 1.2, 4.5) + S * 0.08;
  const W = lw + nw + border * 2;
  const m = border * 1.2;
  const canvas = makeCanvas(W + m * 2, H + m * 2);
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;

  ctx.lineWidth = border;
  ctx.beginPath();
  roundRectPath(ctx, cx - (W - border) / 2, cy - (H - border) / 2, W - border, H - border, H * 0.2);
  ctx.closePath();
  ctx.stroke();
  // 나눔선
  const left = cx - W / 2 + border;
  const xd = left + lw;
  ctx.lineWidth = border * 0.6;
  ctx.beginPath();
  ctx.moveTo(xd, cy - H / 2 + border);
  ctx.lineTo(xd, cy + H / 2 - border);
  ctx.stroke();

  ctx.font = fontString(font, MEASURE_PX);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  // 영문 문구는 낮게 써서 가로로 지나치게 눌리지 않게 한다
  drawLabel(ctx, label, left + lw / 2, cy, lw - S * 0.06, koLabel ? inner : inner * 0.7, { vertical: koLabel });
  const ncx = xd + nw / 2;
  if (lang === 'ko') {
    drawCharGrid(ctx, { chars: name, cols: name.length, rows: 1, order: 'horizontal', cx: ncx, cy, w: nw - S * 0.08, h: inner, fill: 0.88 });
  } else {
    drawFittedGlyph(ctx, en, ncx, cy, nw - S * 0.08, inner * 0.78, 0.45, 1.4);
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

// ───────────── 인장체 (자모로 만든 전서풍 글자 + 가는 테) ─────────────
// 웹 글꼴 대신 core/seal-glyph.js 가 만든 획을 칸에 꽉 차게 늘려 긋는다 (가로세로 비율을 고정하지 않는다).
// 테 굵기는 글자 획 굵기와 같다. 인장체가 없는 글자(기호 등)만 고른 글꼴로 그린다

// 획 굵기 = 글자 칸 짧은 변 × 이 값 (도장 크기의 1.6~5% 안에서). 구첩은 되접을 자리를 위해 가늘게
const SEAL_STROKE = { plain: 0.105, folded: 0.058 };
// 원형 테: 글자 격자(정사각)를 원 안에 펴 넣는 정도. 0 이면 내접 정사각, 1 이면 격자 가장자리가 원을 따라 휜다
const SEAL_WARP = 0.35;
// 테 안쪽과 글자 사이 (획 굵기 배). 1.5 이면 보이는 틈이 획 하나뿐이라 글자가 테에 붙어 보였다 (참고 도장은 획 두 개쯤)
const SEAL_PAD = 2.5;

function drawSeal({ lang, chars, text, shape, font, order = 'horizontal', ink, mult = 1 }) {
  const S = BASE * mult;
  const style = shape.seal ?? 'plain';
  const ko = lang === 'ko';
  const content = ko ? koContent(chars, 'grid', shape) : null;
  const lines = ko ? null : sealLines(text);
  const round = shape.outline === 'ellipse';
  const plan = (lw) => sealPlan({ ko, chars, content, lines, order, round, S, lw });
  const k = SEAL_STROKE[style] ?? SEAL_STROKE.plain;
  // 칸 크기는 획 굵기(여백)에 따라 조금 바뀌므로 두 번 맞춘다
  let lw = S * 0.03;
  for (let i = 0; i < 2; i++) lw = clamp(plan(lw).size * k, S * 0.016, S * 0.05);
  // 획이 아주 많은 음절이 있으면 도장 전체 획을 가늘게 해(최대 40%) 획끼리 붙지 않게 한다
  const base = lw;
  for (let i = 0; i < 3; i++) {
    const fit = Math.min(...plan(lw).cells.map((c) => sealGlyph(sealChar(c.ch), { style, stroke: sealStroke(lw, c.w, c.h) })?.fit ?? 1));
    if (fit > 0.995 || lw <= base * 0.6) break;
    lw = Math.max(base * 0.6, lw * fit * 0.97);
  }
  const { cells, area } = plan(lw);

  const m = lw * 1.5;
  const canvas = makeCanvas(S + m * 2, S + m * 2);
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = lw;
  tracePath(ctx, round ? ELLIPSE : RECT, cx, cy, S - lw, S - lw);
  ctx.stroke();
  const warp = round ? discWarp(cx, cy, area / 2, SEAL_WARP) : null;
  for (const c of cells) drawSealGlyph(ctx, c.ch, cx + c.cx, cy + c.cy, c.w, c.h, { lw, style, font, warp });
  return canvas;
}

/** 글자 칸 배치 (도장 가운데 기준 좌표). size 는 획 굵기를 정할 때 쓰는 칸 크기 */
function sealPlan({ ko, chars, content, lines, order, round, S, lw }) {
  const gap = lw * 2.2; // 글자 사이 흰 틈 (자모 사이 틈보다 조금 넓게 해 음절 경계가 보이게)
  const inner = S - lw * 2 - lw * SEAL_PAD * 2; // 테 안쪽에서 획 굵기의 SEAL_PAD 배를 띄운다
  // 원형은 정사각 격자를 원 안으로 펴 넣는다(discWarp). 가장자리가 눌리는 만큼 획 굵기를 정할 칸을 작게 본다
  const w = inner;
  const h = inner;
  const squeeze = round ? 0.76 : 1;
  if (!ko) {
    const r = sealLineCells(lines, w, h, gap, lw);
    return { ...r, area: inner, size: r.size * squeeze };
  }
  const cells = content.three
    ? sealThreeCells(chars, order, w, h, gap)
    : sealGridCells(chars, content.cols, content.rows, order, w, h, gap);
  return { cells, area: inner, size: Math.min(...cells.map((c) => Math.min(c.w, c.h))) * squeeze };
}

/** 격자 칸. 끝 줄(세로 읽기는 끝 열)에 글자가 모자라면 남은 글자를 늘려 채운다 (칸 두 배까지) */
function sealGridCells(chars, cols, rows, order, w, h, gap) {
  const cw = (w - gap * (cols - 1)) / cols;
  const ch = (h - gap * (rows - 1)) / rows;
  const cells = cellOrder(chars.length, cols, rows, order).map(({ col, row }, i) => ({
    ch: chars[i], col, row, cx: -w / 2 + col * (cw + gap) + cw / 2, cy: -h / 2 + row * (ch + gap) + ch / 2, w: cw, h: ch,
  }));
  if (!cells.length) return cells;
  const vertical = order === 'vertical' && cols > 1;
  const key = vertical ? 'col' : 'row';
  const tail = cells.filter((c) => c[key] === cells[cells.length - 1][key]);
  if (tail.length < (vertical ? rows : cols)) {
    const span = vertical ? h : w;
    const size = Math.min((span - gap * (tail.length - 1)) / tail.length, (vertical ? ch : cw) * 2);
    const total = size * tail.length + gap * (tail.length - 1);
    tail.forEach((c, i) => {
      const p = -total / 2 + i * (size + gap) + size / 2;
      if (vertical) {
        c.cy = p;
        c.h = size;
      } else {
        c.cx = p;
        c.w = size;
      }
    });
  }
  return cells;
}

/** 3자: 세로(전통)는 오른쪽 열에 성을 길게, 가로는 윗줄에 성을 넓게 (drawThree 와 같은 배치) */
function sealThreeCells([a, b, c], order, w, h, gap) {
  const cw = (w - gap) / 2;
  const ch = (h - gap) / 2;
  const left = -w / 2 + cw / 2;
  const right = w / 2 - cw / 2;
  const top = -h / 2 + ch / 2;
  const bottom = h / 2 - ch / 2;
  if (order === 'vertical') {
    return [{ ch: a, cx: right, cy: 0, w: cw, h }, { ch: b, cx: left, cy: top, w: cw, h: ch }, { ch: c, cx: left, cy: bottom, w: cw, h: ch }];
  }
  return [{ ch: a, cx: 0, cy: top, w, h: ch }, { ch: b, cx: left, cy: bottom, w: cw, h: ch }, { ch: c, cx: right, cy: bottom, w: cw, h: ch }];
}

/** 영문 줄. 단어별 줄(enContent)에서 너무 긴 줄은 반으로 나눠 글자가 지나치게 홀쭉해지지 않게 한다 */
function sealLines(text) {
  let lines = enContent(text, 'grid').lines;
  while (lines.length < 4) {
    const longest = lines.reduce((a, b) => (Array.from(b).length > Array.from(a).length ? b : a));
    const list = Array.from(longest);
    if (list.length <= Math.max(4, lines.length * 2 + 1)) break;
    const half = Math.ceil(list.length / 2);
    const i = lines.indexOf(longest);
    lines = [...lines.slice(0, i), list.slice(0, half).join('').trim(), list.slice(half).join('').trim(), ...lines.slice(i + 1)];
  }
  return lines.filter(Boolean);
}

function sealAspect(c) {
  if (c === ' ') return 0.4;
  return sealGlyph(sealChar(c))?.aspect ?? 0.7;
}

/** 인장체는 영문 대문자만 있으므로 소문자는 대문자로 (한글 이름에 섞인 영문 포함) */
function sealChar(c) {
  return /^[a-z]$/.test(c) ? c.toUpperCase() : c;
}

/** 칸 w×h 에서 획 굵기 lw 를 글자 단위 좌표로 (가운데선은 반 굵기씩 들어가 있다) */
function sealStroke(lw, w, h) {
  return { x: lw / Math.max(1e-3, w - lw), y: lw / Math.max(1e-3, h - lw) };
}

/** 영문: 줄마다 같은 높이, 글자는 본래 비율대로 나눈 뒤 줄 폭에 맞춰 늘린다 (두 배까지) */
function sealLineCells(lines, w, h, gap, lw) {
  const n = lines.length;
  const rowH = (h - gap * (n - 1)) / n;
  const letterGap = lw * 1.8;
  const cells = [];
  let size = rowH;
  lines.forEach((line, r) => {
    const list = Array.from(line);
    const asp = list.map(sealAspect);
    const natural = asp.reduce((t, a) => t + a, 0) * rowH;
    const sx = Math.min((w - letterGap * (list.length - 1)) / natural, 2);
    const total = natural * sx + letterGap * (list.length - 1);
    const cy = -h / 2 + r * (rowH + gap) + rowH / 2;
    let x = -total / 2;
    list.forEach((c, i) => {
      const cw = asp[i] * rowH * sx;
      if (c !== ' ') cells.push({ ch: c, cx: x + cw / 2, cy, w: cw, h: rowH });
      x += cw + letterGap;
    });
    size = Math.min(size, rowH * sx);
  });
  return { cells, size };
}

/** 인장체 글자 하나를 칸(cx, cy, w, h)에 꽉 차게 긋는다. 획 굵기 lw 는 칸 모양과 상관없이 고르다 */
function drawSealGlyph(ctx, ch, cx, cy, w, h, { lw, style = 'plain', font, warp = null }) {
  const iw = Math.max(1e-3, w - lw); // 획 바깥 가장자리가 칸 끝에 맞도록 가운데선은 반 굵기만큼 들인다
  const ih = Math.max(1e-3, h - lw);
  const g = sealGlyph(sealChar(ch), { style, stroke: sealStroke(lw, w, h) });
  if (!g) {
    // 인장체가 없는 글자는 고른 글꼴로. 경계 상자를 칸에 늘리면 가운뎃점 같은 작은 기호가 큰 덩어리가 되므로
    // 글꼴 크기를 칸 높이에 맞추고 비율은 그대로 둔다
    ctx.save();
    ctx.font = fontString(font, MEASURE_PX);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const k = Math.min((h * 0.8) / MEASURE_PX, (w * 0.9) / Math.max(1, ctx.measureText(ch).width));
    ctx.translate(cx, cy);
    ctx.scale(k, k);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    return;
  }
  const x0 = cx - iw / 2;
  const y0 = cy - ih / 2;
  const map = ([x, y]) => [x0 + x * iw, y0 + y * ih];
  const lines = g.paths.map((path) => {
    const last = path[path.length - 1];
    const closed = path.length > 3 && last[0] === path[0][0] && last[1] === path[0][1];
    return { pts: (closed ? path.slice(0, -1) : path).map(map), closed };
  });
  for (const s of g.shapes) {
    const [x, y] = map([s.x, s.y]);
    lines.push({ rrect: [x, y, s.w * iw, s.h * ih, Math.min(s.w * iw, s.h * ih) * s.r], closed: true });
  }
  ctx.save();
  ctx.lineWidth = lw;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 3;
  ctx.beginPath();
  for (const line of lines) {
    if (!warp && line.rrect) {
      roundRectPath(ctx, ...line.rrect);
    } else {
      // 휘게 그릴 때는 둥근 사각도 꺾은선으로 바꾸고, 마디를 잘게 나눠 곡선을 따르게 한다
      const pts = line.rrect ? rrectPoints(...line.rrect) : line.pts;
      const fine = warp ? subdivide(pts, line.closed, lw * 0.6).map(([x, y]) => warp(x, y)) : pts;
      fine.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    }
    if (line.closed) ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * 정사각 격자를 원 안에 펴 넣는 변환. (cx, cy) 가운데, 반폭 a 인 정사각을 반지름 a 인 원으로 보낸다.
 * t = 1 이면 원판 사상(x√(1−y²/2), y√(1−x²/2))으로 격자 가장자리가 원을 따르고, 0 이면 내접 정사각으로 줄인다.
 * 어느 쪽이든 모서리는 원 위에 오고 나머지는 원 안에 있다
 */
function discWarp(cx, cy, a, t) {
  return (x, y) => {
    const u = clamp((x - cx) / a, -1, 1);
    const v = clamp((y - cy) / a, -1, 1);
    const k = (1 - t) * Math.SQRT1_2;
    return [cx + a * (k * u + t * u * Math.sqrt(1 - (v * v) / 2)), cy + a * (k * v + t * v * Math.sqrt(1 - (u * u) / 2))];
  };
}

/** 꺾은선 마디를 step 보다 짧게 나눈다 */
function subdivide(pts, closed, step) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    out.push(a);
    if (i === n - 1 && !closed) break;
    const b = pts[(i + 1) % n];
    const k = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(step, 0.5));
    for (let j = 1; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  return out;
}

/** 둥근 사각 테두리 점 (닫힌 꺾은선) */
function rrectPoints(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  const corners = [[x + w - rr, y + rr, -Math.PI / 2], [x + w - rr, y + h - rr, 0], [x + rr, y + h - rr, Math.PI / 2], [x + rr, y + rr, Math.PI]];
  const pts = [];
  for (const [ox, oy, a0] of corners) {
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (i / 8) * (Math.PI / 2);
      pts.push([ox + Math.cos(a) * rr, oy + Math.sin(a) * rr]);
    }
  }
  return pts;
}

// ───────────── 확장 모듈용 그리기 도구 ─────────────
// stamp-ring-extra.js · stamp-seal-extra.js 가 가져다 쓴다. 두 모듈은 이 파일과 서로 가져오므로(순환)
// 가져온 값은 함수 안에서만 쓰고 모듈 맨 위에서 바로 쓰지 않는다.
export { BASE, MEASURE_PX, RECT, ELLIPSE, makeCanvas, clamp, applyBleed, tracePath, polyPath, roundRectPath, drawStar, drawFittedGlyph, koContent, drawCharGrid, initials, fillWornRing, drawCornerFrame };
// 둘레글자 도구
export { strokeCircle, ringUnits, drawSealCenter, drawSealRing };
// 인장체 도구
export { drawSeal, sealPlan, sealGridCells, sealThreeCells, sealLines, sealLineCells, sealChar, sealStroke, drawSealGlyph, discWarp, SEAL_STROKE, SEAL_WARP, subdivide, rrectPoints };
