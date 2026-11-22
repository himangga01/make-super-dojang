// 둘레글자 추가 디자인 12종. stamp-gen.js 가 모양 목록과 그리기 함수를 합친다.
// 그리기 도구는 stamp-gen.js 에서 가져온다 (순환 가져오기: 함수 안에서만 쓴다)
import { fontString } from './fonts.js';
import {
  BASE, MEASURE_PX, makeCanvas, applyBleed, drawStar, drawFittedGlyph, initials,
  strokeCircle, ringUnits, drawSealCenter, SEAL_CENTERS, SEAL_CENTER_FONT,
} from './stamp-gen.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const SEP = null; // 되풀이 사이·영문 띄어쓰기 자리 (점을 찍는다)
const STAR = Object.freeze({ star: true }); // 되풀이 사이에 별을 찍는 자리 (반복 별점)
const OVAL_H = 2 / 3; // 타원 도장 높이 (폭 대비)

// sealCenter: 가운데 글자 선택지(#stamp-seal-center)를 쓰는 모양. app.js 가 이 표시를 보고 한자 글꼴을 미리 받는다
const ring = (id, label, extra = {}) => ({ id, label, cat: 'ring', special: id, sealCenter: true, ...extra });

/**
 * 모양 목록 (STAMP_SHAPES 끝에 붙는다). cat 은 'ring'.
 * 추천 글꼴은 STAMP_SHAPES 순서로 돌려 쓰므로(app.js), 순서를 글꼴에 맞춰 골랐다:
 * 획이 아주 굵은 가석·베이글은 흰 글자(음각 띠)와 넓게 벌린 글자(열린 둘레)에, 가는 붓글씨는 큰 글자(반복 별점)에,
 * 명조는 公章·서양식 인장에 온다
 */
export const RING_EXTRA_SHAPES = [
  ring('ring-scallop', '꽃테 둘레'), // 구기
  ring('ring-repeat', '반복 별점'), // 나눔손글씨 붓
  ring('ring-arcs', '상하 호글'), // 고딕 A1
  ring('ring-dotted', '겹점 테'), // 해바라기
  ring('ring-inverted', '음각 띠', { selfBleed: true }), // 가석. 흰 글자를 지우기 전에 번지게 한다
  ring('ring-open', '열린 둘레'), // 베이글
  ring('ring-oval-tier', '감제 타원'), // 아스타
  ring('ring-oval', '타원 둘레'), // 흑백사진
  ring('ring-gongjang', '공장 별', { sealCenter: false }), // 나눔명조. 가운데는 언제나 큰 별
  ring('ring-star-line', '별 아래글'), // 본명조
  ring('ring-west', '가운데 두 줄'), // 송명
  ring('ring-thin', '두 선 띠'), // 검은고딕
];

/** special 값 → 그리기 함수 */
export const RING_EXTRA_DRAW = {
  'ring-gongjang': drawGongjang,
  'ring-star-line': drawStarLine,
  'ring-arcs': drawArcs,
  'ring-dotted': drawDotted,
  'ring-scallop': drawScallop,
  'ring-oval': drawOval,
  'ring-oval-tier': drawOvalTier,
  'ring-open': drawOpen,
  'ring-repeat': drawRepeatStar,
  'ring-inverted': drawInverted,
  'ring-west': drawWest,
  'ring-thin': drawThin,
};

// ───────────── 계산 (DOM 없음) ─────────────

/** 둘레에 쓸 이름 (되풀이 없이). 한글은 '인'을 붙이기 전 이름, 영문은 대문자이고 띄어쓰기는 SEP */
export function ringName(lang, chars, baseChars, text) {
  const list = lang === 'ko'
    ? (baseChars ?? chars ?? []).filter((c) => c && c.trim())
    : Array.from(String(text ?? '').toUpperCase().trim()).map((c) => (/\s/.test(c) ? SEP : c));
  const out = list.filter((c, i) => c !== SEP || list[i - 1] !== SEP);
  return out.length ? out : ['A'];
}

/** 칸 수 (SEP 은 sepW 칸, STAR 는 starW 칸) */
export function runWeight(units, sepW = 0.5, starW = sepW) {
  return units.reduce((t, u) => t + (u === SEP ? sepW : u === STAR ? starW : 1), 0);
}

function repeatName(name, k, closed, joint) {
  const out = [];
  for (let i = 0; i < k; i++) {
    if (i) out.push(joint);
    out.push(...name);
  }
  if (closed) out.push(joint); // 고리는 끝과 처음 사이에도
  return out;
}

/**
 * 길(원·타원의 호) 위에 이름을 놓는 계획. 길이 단위는 호 길이.
 * 글자 한 칸은 stepMax 까지, 사이를 spread 배까지 벌린다. 그래도 minSpan 에 못 미치면 점을 끼워 되풀이한다.
 * 열린 호는 가운데가 0, 닫힌 고리는 첫 칸 앞 끝이 0 이다.
 * star 가 참이면 되풀이 사이에 점 대신 STAR 자리를 둔다.
 * @returns {{units: (string|null|object)[], step: number, span: number, at: number[], reps: number, head: number}}
 *   step: 글자 한 칸 길이, at: 칸 가운데 위치, head: 첫 이름 한 벌의 길이
 */
export function planRun(name, { minSpan, maxSpan, stepMax, spread = 1.4, sepW = 0.5, star = false, starW = sepW, closed = false, repeat = true, reps, maxReps = 16 }) {
  const joint = star ? STAR : SEP;
  const weight = (list) => runWeight(list, sepW, starW);
  let k = reps ?? 1;
  let units = repeatName(name, k, closed, joint);
  if (reps == null) {
    while (repeat && k < maxReps && weight(units) * stepMax * spread < minSpan) units = repeatName(name, ++k, closed, joint);
  }
  const W = weight(units);
  const natural = W * stepMax;
  const span = closed ? maxSpan : Math.min(maxSpan, Math.max(natural, Math.min(minSpan, natural * spread)));
  const step = span / W;
  let acc = closed ? 0 : -span / 2;
  const at = units.map((u) => {
    const w = weight([u]) * step;
    acc += w;
    return acc - w / 2;
  });
  return { units, step, span, at, reps: k, head: weight(name) * step };
}

/** 계획대로 놓을 글자 칸. 글자가 많아 칸이 좁아지면 세로도 줄여 지나치게 홀쭉해지지 않게 한다 */
export function runCell(plan, stepMax, cellH, minAspect = 0.6) {
  const cellW = Math.min(plan.step, stepMax) * 0.86;
  return { cellW, cellH: Math.min(cellH, cellW / minAspect) };
}

/** 아래 호에 쓸 짧은 글: 고른 문구, 없으면 날짜의 연도 (영문은 EST. 2026) */
export function ringYearText(lang, date, dateLabel) {
  if (dateLabel) return dateLabel;
  const y = /(\d{4})/.exec(date ?? '')?.[1] ?? String(new Date().getFullYear());
  return lang === 'ko' ? y : `EST. ${y}`;
}

/**
 * 가운데를 한두 줄로 쓸 칸. 가로쓰기는 줄마다 왼쪽부터, 세로쓰기는 오른쪽 열부터 위→아래(한 열에 두 자).
 * 한 줄 모양(maxLines 1)은 읽는 순서와 상관없이 가로 한 줄이다.
 * @returns {{cols: number, rows: number, cells: {x: number, y: number}[]}} 칸 가운데 좌표 (칸 단위)
 */
export function centerGrid(n, { maxLines = 2, vertical = false } = {}) {
  if (n <= 0) return { cols: 1, rows: 1, cells: [] };
  const cells = [];
  if (vertical && maxLines >= 2 && n >= 2) {
    const rows = 2;
    const cols = Math.ceil(n / rows);
    for (let i = 0; i < n; i++) {
      const line = Math.floor(i / rows);
      const inLine = line === cols - 1 ? n - line * rows : rows;
      cells.push({ x: cols - 1 - line + 0.5, y: (i % rows) + (rows - inLine) / 2 + 0.5 });
    }
    return { cols, rows, cells };
  }
  const rows = maxLines >= 2 && n >= 4 ? 2 : 1;
  const cols = Math.ceil(n / rows);
  for (let i = 0; i < n; i++) {
    const line = Math.floor(i / cols);
    const inLine = line === rows - 1 ? n - line * cols : cols;
    cells.push({ x: (i % cols) + (cols - inLine) / 2 + 0.5, y: line + 0.5 });
  }
  return { cols, rows, cells };
}

/** 가운데 글자: 별 | 영문 머리글자 | 글자 목록 (한자는 본명조로) */
export function centerContent(lang, chars, text, sealCenter) {
  const choice = SEAL_CENTERS.find((c) => c.id === sealCenter) ?? SEAL_CENTERS[0];
  if (choice.id === 'star') return { star: true };
  if (lang !== 'ko') return { initials: initials(String(text ?? '')) };
  const glyphs = choice.text ? Array.from(choice.text) : (chars ?? []).filter((c) => c && c.trim());
  return { glyphs, hanja: Boolean(choice.hanja) };
}

/**
 * 타원 둘레 길이 표. θ 는 맨 위(-π/2)에서 시계 방향으로 잰다.
 * theta(s): 맨 위에서 호 길이 s 만큼 간 점의 θ (s 는 둘레 길이로 감는다)
 */
export function ellipseTable(a, b, n = 720) {
  const s = new Float64Array(n + 1);
  let px = 0;
  let py = -b;
  for (let i = 1; i <= n; i++) {
    const t = -Math.PI / 2 + (i / n) * TAU;
    const x = a * Math.cos(t);
    const y = b * Math.sin(t);
    s[i] = s[i - 1] + Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  const L = s[n];
  const theta = (v) => {
    const u = ((v % L) + L) % L;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid] <= u) lo = mid;
      else hi = mid;
    }
    const f = (u - s[lo]) / (s[hi] - s[lo] || 1);
    return -Math.PI / 2 + ((lo + f) / n) * TAU;
  };
  return { length: L, theta };
}

/** 글자를 놓을 길: place(s) → 점과 바깥쪽 법선 각도 n. s 는 맨 위에서 시계 방향 호 길이 */
export function circlePath(cx, cy, r) {
  return {
    length: TAU * r,
    place: (s) => {
      const a = -Math.PI / 2 + s / r;
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, n: a };
    },
  };
}

/**
 * 타원 길. 글자 사이는 inset 만큼 안쪽 타원에서 고르게 잰다:
 * 양 끝은 곡률이 커서, 길 위에서 고르게 놓으면 글자 안쪽 모서리끼리 부딪친다
 */
export function ellipsePath(cx, cy, a, b, inset = 0) {
  const tab = ellipseTable(a - inset, b - inset);
  return {
    length: tab.length,
    place: (s) => {
      const t = tab.theta(s);
      return { x: cx + a * Math.cos(t), y: cy + b * Math.sin(t), n: Math.atan2(a * Math.sin(t), b * Math.cos(t)) };
    },
  };
}

/** 꽃테: 맨 위부터 n 개의 반원 물결. 마디(골) 반지름 rc 와 물결 반지름 br (바깥 끝 = rc·cos(π/n) + br) */
export function scallopGeometry(outer, n) {
  const k = Math.sin(Math.PI / n);
  const rc = outer / (Math.cos(Math.PI / n) + k);
  return { rc, br: rc * k };
}

// ───────────── 그리기 도우미 ─────────────

/** 제목처럼 한 번만 쓰는 호: 두 자 이하만 되풀이하고, 그보다 길면 글자 사이를 벌린다 */
const short = (name) => runWeight(name) <= 2;
/** 公章처럼 빽빽한 호: 짧은 이름은 촘촘히 되풀이하고, 다섯 자 이상은 한 번만 쓰고 사이를 벌린다 */
const denseSpread = (name) => (runWeight(name) >= 5 ? 1.6 : 1.3);

function sheet(o, h = 1) {
  const S = BASE * (o.mult ?? 1);
  const rim = Math.max(2, S * 0.034);
  const pad = rim * 1.2;
  const canvas = makeCanvas(S + pad * 2, S * h + pad * 2);
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = o.ink;
  ctx.fillStyle = o.ink;
  return { S, rim, canvas, ctx, cx: canvas.width / 2, cy: canvas.height / 2 };
}

function useFont(ctx, font) {
  ctx.font = fontString(font, MEASURE_PX);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function diamond(ctx, x, y, r, angle = 0) {
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const t = angle + (i * Math.PI) / 2;
    const rr = i % 2 ? r * 0.62 : r;
    const px = x + Math.cos(t) * rr;
    const py = y + Math.sin(t) * rr;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/** 계획(planRun)대로 길 위에 글자를 놓는다. inward 면 글자 머리가 안쪽이고 왼쪽부터 읽힌다 (아래 호) */
function drawRun(ctx, plan, path, { origin = 0, inward = false, cellW, cellH, sep, star }) {
  plan.units.forEach((u, i) => {
    const p = path.place(inward ? origin - plan.at[i] : origin + plan.at[i]);
    if (u === SEP || u === STAR) {
      (u === SEP ? sep : star)?.(p);
      return;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.n + (inward ? -Math.PI / 2 : Math.PI / 2));
    // 인장처럼 칸을 꽉 채우도록 가로세로 비율을 넉넉히 바꿔 그린다 (drawSealRing 과 같은 범위)
    drawFittedGlyph(ctx, u, 0, 0, cellW, cellH, 0.55, 1.6);
    ctx.restore();
  });
}

/**
 * 짧은 글(연도·문구)을 길 위에 글꼴 본래 폭으로 쓴다. 잉크 높이 inkH, 길이 maxLen 을 넘으면 줄인다.
 * at 은 글 가운데 위치. 쓴 길이를 돌려준다
 */
function drawPathString(ctx, str, path, { at, inkH, maxLen, font, inward = false, track = 0.14 }) {
  const list = Array.from(str);
  if (!list.length) return 0;
  ctx.font = fontString(font, MEASURE_PX);
  const m = ctx.measureText(str);
  const asc = m.actualBoundingBoxAscent ?? MEASURE_PX * 0.72;
  const desc = m.actualBoundingBoxDescent ?? 0;
  let k = inkH / Math.max(asc + desc, MEASURE_PX * 0.3); // MEASURE_PX → 실제 크기 배율
  const adv = list.map((c) => ctx.measureText(c).width);
  const gap = MEASURE_PX * track;
  const raw = adv.reduce((t, w) => t + w, 0) + gap * (list.length - 1);
  k = Math.min(k, maxLen / raw);
  ctx.font = fontString(font, MEASURE_PX * k);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const base = ((asc - desc) / 2) * k;
  let s = (-raw * k) / 2;
  list.forEach((c, i) => {
    const mid = s + (adv[i] * k) / 2;
    s += (adv[i] + gap) * k;
    if (!c.trim()) return;
    const p = path.place(inward ? at - mid : at + mid);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.n + (inward ? -Math.PI / 2 : Math.PI / 2));
    ctx.fillText(c, 0, base);
    ctx.restore();
  });
  ctx.textAlign = 'left';
  return raw * k;
}

/**
 * 고리 띠 한 바퀴에 이름을 고르게 (둘레글자 원과 같은 규칙: 짧은 이름은 ringUnits 가 되풀이하고,
 * 다섯 자 이상이면 맨 위 표시 자리를 한 칸 따로 둔다). marker: dot | star
 */
function drawRingAround(ctx, o, { cx, cy, inner, outer, marker = 'dot', hFill = 0.74 }) {
  const units = ringUnits(o.lang, o.chars, o.baseChars, o.text);
  const band = outer - inner;
  const mid = inner + band / 2;
  const slots = units.length + (units.length >= 5 ? 1 : 0);
  const step = TAU / slots;
  const first = units.length >= 5 ? step : step / 2;
  let cellH = band * hFill;
  const cellW = Math.min(step * mid * 0.84, cellH * 1.15);
  if (cellW < cellH * 0.62) cellH = cellW / 0.62;
  useFont(ctx, o.font);
  units.forEach((c, i) => {
    const a = -Math.PI / 2 + first + step * i;
    const x = cx + Math.cos(a) * mid;
    const y = cy + Math.sin(a) * mid;
    if (c === SEP) {
      dot(ctx, x, y, band * 0.055);
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2);
    drawFittedGlyph(ctx, c, 0, 0, cellW, cellH, 0.55, 1.6);
    ctx.restore();
  });
  const gap = (units.length >= 5 ? step * 2 : step) * mid - cellW;
  if (marker === 'star') drawStar(ctx, cx, cy - mid, Math.min(band * 0.22, gap * 0.42));
  else dot(ctx, cx, cy - mid, Math.min(band * 0.1, gap * 0.28));
}

/**
 * 가운데 글자를 w×h 상자에 한두 줄로. 별을 고르면 별, 영문은 머리글자.
 * 두 줄 모양은 한자(代表理事)·세로 읽기면 오른쪽 열부터 세로로 쓴다 (drawSealCenter 와 같은 규칙)
 */
function drawCenterBlock(ctx, o, { cx, cy, w, h, maxLines = 2, starR }) {
  const c = centerContent(o.lang, o.chars, o.text, o.sealCenter);
  if (c.star) {
    drawStar(ctx, cx, cy, starR ?? Math.min(w, h) * 0.5);
    return;
  }
  useFont(ctx, o.font);
  if (c.initials != null) {
    // 머리글자는 줄 글자보다 낮게: 상자를 꽉 채우면 둘레 글자에 바싹 붙는다
    drawFittedGlyph(ctx, c.initials, cx, cy, w * 0.86, Math.min(h * 0.62, w * 0.45), 0.6, 1.4);
    return;
  }
  if (!c.glyphs.length) return;
  const vertical = maxLines >= 2 && (c.hanja || o.order === 'vertical');
  const g = centerGrid(c.glyphs.length, { maxLines, vertical });
  let cw = w / g.cols;
  let ch = h / g.rows;
  cw = Math.min(cw, ch * 1.15);
  ch = Math.min(ch, cw * 1.2);
  const x0 = cx - (cw * g.cols) / 2;
  const y0 = cy - (ch * g.rows) / 2;
  if (c.hanja) ctx.font = fontString(SEAL_CENTER_FONT, MEASURE_PX);
  c.glyphs.forEach((gl, i) => {
    drawFittedGlyph(ctx, gl, x0 + g.cells[i].x * cw, y0 + g.cells[i].y * ch, cw * 0.92, ch * 0.92, 0.7, 1.4);
  });
}

function sealCenterIn(ctx, o, cx, cy, r) {
  drawSealCenter(ctx, { lang: o.lang, chars: o.chars, text: o.text, font: o.font, order: o.order ?? 'horizontal', sealCenter: o.sealCenter, cx, cy, r });
}

// ───────────── 1. 공장 별: 큰 별 + 위로 두른 이름 (중국 公章 꼴) ─────────────

function drawGongjang(o) {
  const { S, rim, canvas, ctx, cx, cy } = sheet(o);
  strokeCircle(ctx, cx, cy, S / 2 - rim / 2, rim);
  const edge = S / 2 - rim;
  drawStar(ctx, cx, cy, S * 0.17);
  const cellH = S * 0.15;
  const r = edge - S * 0.014 - cellH / 2;
  const stepMax = (cellH * 0.95) / 0.86;
  const name = ringName(o.lang, o.chars, o.baseChars, o.text);
  const plan = planRun(name, { minSpan: 240 * DEG * r, maxSpan: 290 * DEG * r, stepMax, spread: denseSpread(name) });
  const cell = runCell(plan, stepMax, cellH, 0.55);
  useFont(ctx, o.font);
  drawRun(ctx, plan, circlePath(cx, cy, r), { ...cell, sep: (p) => dot(ctx, p.x, p.y, S * 0.013) });
  return canvas;
}

// ───────────── 2. 별 아래글: 위 호 이름, 별 아래 가로 한 줄 ─────────────

function drawStarLine(o) {
  const { S, rim, canvas, ctx, cx, cy } = sheet(o);
  strokeCircle(ctx, cx, cy, S / 2 - rim / 2, rim);
  const edge = S / 2 - rim;
  const cellH = S * 0.13;
  const r = edge - S * 0.014 - cellH / 2;
  const stepMax = (cellH * 1.0) / 0.86;
  const name = ringName(o.lang, o.chars, o.baseChars, o.text);
  const plan = planRun(name, { minSpan: 200 * DEG * r, maxSpan: 245 * DEG * r, stepMax, spread: denseSpread(name) });
  useFont(ctx, o.font);
  drawRun(ctx, plan, circlePath(cx, cy, r), { ...runCell(plan, stepMax, cellH), sep: (p) => dot(ctx, p.x, p.y, S * 0.012) });
  const c = centerContent(o.lang, o.chars, o.text, o.sealCenter);
  if (c.star) {
    drawStar(ctx, cx, cy, S * 0.17);
  } else {
    drawStar(ctx, cx, cy - S * 0.05, S * 0.12);
    drawCenterBlock(ctx, o, { cx, cy: cy + S * 0.15, w: S * 0.44, h: S * 0.105, maxLines: 1 });
  }
  return canvas;
}

// ───────────── 3. 상하 호글: 위 호 이름, 아래 호 연도, 9시·3시 점 ─────────────

function drawArcs(o) {
  const { S, rim, canvas, ctx, cx, cy } = sheet(o);
  strokeCircle(ctx, cx, cy, S / 2 - rim / 2, rim);
  const edge = S / 2 - rim;
  const lw = Math.max(1.5, S * 0.014);
  const Rc = S * 0.27;
  strokeCircle(ctx, cx, cy, Rc, lw);
  const inner = Rc + lw / 2;
  const band = edge - inner;
  const r = inner + band / 2;
  const path = circlePath(cx, cy, r);
  const cellH = band * 0.7;
  const stepMax = (cellH * 1.1) / 0.86;
  const name = ringName(o.lang, o.chars, o.baseChars, o.text);
  const plan = planRun(name, { minSpan: 120 * DEG * r, maxSpan: 160 * DEG * r, stepMax, spread: 1.6, repeat: short(name) });
  useFont(ctx, o.font);
  drawRun(ctx, plan, path, { ...runCell(plan, stepMax, cellH), sep: (p) => dot(ctx, p.x, p.y, band * 0.05) });
  for (const a of [0, Math.PI]) dot(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, band * 0.075);
  drawPathString(ctx, ringYearText(o.lang, o.date, o.dateLabel), path, {
    at: path.length / 2, inkH: band * 0.42, maxLen: 110 * DEG * r, font: o.font, inward: true,
  });
  sealCenterIn(ctx, o, cx, cy, Rc - lw / 2);
  return canvas;
}

// ───────────── 4. 겹점 테: 엇갈린 점 두 줄 테 ─────────────

function dotRing(ctx, cx, cy, R, n, d, phase) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + ((i + phase) / n) * TAU;
    dot(ctx, cx + Math.cos(a) * R, cy + Math.sin(a) * R, d);
  }
}

function drawDotted(o) {
  const { S, canvas, ctx, cx, cy } = sheet(o);
  const d = S * 0.0125;
  const R1 = S / 2 - d;
  const R2 = R1 - S * 0.031;
  dotRing(ctx, cx, cy, R1, 72, d, 0);
  dotRing(ctx, cx, cy, R2, 72, d, 0.5);
  const lw = Math.max(1.5, S * 0.017);
  const Rc = S * 0.215;
  strokeCircle(ctx, cx, cy, Rc, lw);
  drawRingAround(ctx, o, { cx, cy, inner: Rc + lw / 2, outer: R2 - d - S * 0.012, marker: 'dot' });
  sealCenterIn(ctx, o, cx, cy, Rc - lw / 2);
  return canvas;
}

// ───────────── 5. 꽃테 둘레: 반원 물결 테 ─────────────

function drawScallop(o) {
  const { S, canvas, ctx, cx, cy } = sheet(o);
  const lw = Math.max(1.5, S * 0.026);
  const N = 28;
  const { rc, br } = scallopGeometry(S / 2 - lw / 2, N);
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const am = -Math.PI / 2 + ((i + 0.5) / N) * TAU; // 물결 가운데 방향
    const bx = cx + Math.cos(am) * rc * Math.cos(Math.PI / N);
    const by = cy + Math.sin(am) * rc * Math.cos(Math.PI / N);
    ctx.arc(bx, by, br, am - Math.PI / 2, am + Math.PI / 2);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.lineJoin = 'miter';
  const ilw = Math.max(1.5, S * 0.017);
  const Rc = S * 0.215;
  strokeCircle(ctx, cx, cy, Rc, ilw);
  drawRingAround(ctx, o, { cx, cy, inner: Rc + ilw / 2, outer: rc - lw / 2 - S * 0.012, marker: 'star' });
  sealCenterIn(ctx, o, cx, cy, Rc - ilw / 2);
  return canvas;
}

// ───────────── 6. 타원 둘레: 가로 타원 한 바퀴 ─────────────

function drawOval(o) {
  const { S, rim, canvas, ctx, cx, cy } = sheet(o, OVAL_H);
  const a = S / 2;
  const b = (S * OVAL_H) / 2;
  ctx.lineWidth = rim;
  ctx.beginPath();
  ctx.ellipse(cx, cy, a - rim / 2, b - rim / 2, 0, 0, TAU);
  ctx.stroke();
  const cellH = S * 0.1;
  const off = rim + S * 0.012 + cellH / 2;
  const path = ellipsePath(cx, cy, a - off, b - off, cellH * 0.4);
  const stepMax = (cellH * 1.05) / 0.86;
  const plan = planRun(ringName(o.lang, o.chars, o.baseChars, o.text), {
    minSpan: path.length, maxSpan: path.length, stepMax, spread: 1.5, closed: true, sepW: 0.6,
  });
  useFont(ctx, o.font);
  drawRun(ctx, plan, path, { origin: -plan.head / 2, ...runCell(plan, stepMax, cellH), sep: (p) => dot(ctx, p.x, p.y, S * 0.011) });
  // 가운데: 안쪽 타원에 들어가는 상자
  const ia = a - off - cellH / 2 - S * 0.02;
  const ib = b - off - cellH / 2 - S * 0.02;
  drawCenterBlock(ctx, o, { cx, cy, w: ia * 2 * 0.74, h: ib * 2 * 0.72, maxLines: 2, starR: ib * 0.85 });
  return canvas;
}

// ───────────── 7. 감제 타원: 위 호 이름 / 가운데 한 줄 / 아래 호 연도 ─────────────

function drawOvalTier(o) {
  const { S, rim, canvas, ctx, cx, cy } = sheet(o, OVAL_H);
  const a = S / 2;
  const b = (S * OVAL_H) / 2;
  ctx.lineWidth = rim;
  ctx.beginPath();
  ctx.ellipse(cx, cy, a - rim / 2, b - rim / 2, 0, 0, TAU);
  ctx.stroke();
  const band = S * 0.115;
  const lw = Math.max(1.2, S * 0.012);
  const ia = a - rim - band;
  const ib = b - rim - band;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.ellipse(cx, cy, ia, ib, 0, 0, TAU);
  ctx.stroke();
  const off = rim + (band - lw / 2) / 2;
  const cellH = band * 0.72;
  const path = ellipsePath(cx, cy, a - off, b - off, cellH * 0.4);
  const L = path.length;
  const stepMax = (cellH * 1.05) / 0.86;
  const name = ringName(o.lang, o.chars, o.baseChars, o.text);
  const plan = planRun(name, { minSpan: L * 0.26, maxSpan: L * 0.43, stepMax, spread: 1.6, repeat: short(name) });
  useFont(ctx, o.font);
  drawRun(ctx, plan, path, { ...runCell(plan, stepMax, cellH), sep: (p) => dot(ctx, p.x, p.y, S * 0.01) });
  for (const s of [L / 4, (L * 3) / 4]) {
    const p = path.place(s);
    dot(ctx, p.x, p.y, band * 0.075);
  }
  drawPathString(ctx, ringYearText(o.lang, o.date, o.dateLabel), path, {
    at: L / 2, inkH: band * 0.4, maxLen: L * 0.2, font: o.font, inward: true,
  });
  drawCenterBlock(ctx, o, { cx, cy, w: ia * 2 * 0.78, h: ib * 2 * 0.6, maxLines: 1, starR: ib * 0.8 });
  return canvas;
}

// ───────────── 8. 열린 둘레: 300° 이름, 아래 ◆, 큰 가운데 ─────────────

function drawOpen(o) {
  const { S, rim, canvas, ctx, cx, cy } = sheet(o);
  strokeCircle(ctx, cx, cy, S / 2 - rim / 2, rim);
  const edge = S / 2 - rim;
  const cellH = S * 0.125;
  const r = edge - S * 0.014 - cellH / 2;
  const path = circlePath(cx, cy, r);
  const stepMax = (cellH * 1.05) / 0.86;
  const plan = planRun(ringName(o.lang, o.chars, o.baseChars, o.text), {
    minSpan: 300 * DEG * r, maxSpan: 300 * DEG * r, stepMax, spread: 1.75,
  });
  useFont(ctx, o.font);
  drawRun(ctx, plan, path, { ...runCell(plan, stepMax, cellH), sep: (p) => dot(ctx, p.x, p.y, S * 0.012) });
  diamond(ctx, cx, cy + r, S * 0.032, Math.PI / 2);
  sealCenterIn(ctx, o, cx, cy, S * 0.29);
  return canvas;
}

// ───────────── 9. 반복 별점: 이름 두세 번, 사이에 별 ─────────────

function drawRepeatStar(o) {
  const { S, rim, canvas, ctx, cx, cy } = sheet(o);
  strokeCircle(ctx, cx, cy, S / 2 - rim / 2, rim);
  const edge = S / 2 - rim;
  const lw = Math.max(1.5, S * 0.016);
  const Rc = S * 0.2;
  strokeCircle(ctx, cx, cy, Rc, lw);
  const inner = Rc + lw / 2;
  const band = edge - inner;
  const r = inner + band / 2;
  const path = circlePath(cx, cy, r);
  const cellH = Math.min(S * 0.14, band * 0.6);
  const stepMax = (cellH * 1.1) / 0.86;
  const name = ringName(o.lang, o.chars, o.baseChars, o.text);
  const starW = 0.85;
  const n = runWeight(name);
  // 두세 번 되풀이하되 글자가 너무 작아지면 줄인다 (한 글자 이름은 네 번)
  const fits = (k) => path.length / (k * (n + starW)) >= stepMax * 0.82;
  const reps = n <= 1 ? 4 : [3, 2].find(fits) ?? 1;
  const plan = planRun(name, { minSpan: path.length, maxSpan: path.length, stepMax, star: true, starW, closed: true, reps });
  const starR = Math.min(band * 0.2, plan.step * starW * 0.42);
  useFont(ctx, o.font);
  drawRun(ctx, plan, path, {
    origin: (plan.step * starW) / 2, // 마지막 별이 맨 위에 온다
    ...runCell(plan, stepMax, cellH),
    sep: (p) => dot(ctx, p.x, p.y, band * 0.05),
    star: (p) => drawStar(ctx, p.x, p.y, starR, p.n),
  });
  sealCenterIn(ctx, o, cx, cy, Rc - lw / 2);
  return canvas;
}

// ───────────── 10. 음각 띠: 잉크 띠에 흰 이름 ─────────────

function drawInverted(o) {
  const { S, canvas, ctx, cx, cy } = sheet(o);
  const ro = S / 2;
  const ri = S * 0.305;
  ctx.beginPath();
  ctx.arc(cx, cy, ro, 0, TAU);
  ctx.arc(cx, cy, ri, 0, TAU, true);
  ctx.fill();
  const lw = Math.max(1.5, S * 0.014);
  const Rc = S * 0.262;
  strokeCircle(ctx, cx, cy, Rc, lw);
  sealCenterIn(ctx, o, cx, cy, Rc - lw / 2);
  // 번짐은 채운 면에만: 흰 글자를 지운 뒤에 번지면 글자가 메워진다
  if (o.bleed) {
    const bled = applyBleed(canvas, o.mult ?? 1);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bled, 0, 0);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  const wl = Math.max(1, S * 0.008);
  const g = S * 0.024;
  strokeCircle(ctx, cx, cy, ro - g, wl);
  strokeCircle(ctx, cx, cy, ri + g, wl);
  drawRingAround(ctx, o, { cx, cy, inner: ri + g + wl / 2 + S * 0.006, outer: ro - g - wl / 2 - S * 0.006, marker: 'star', hFill: 0.78 });
  ctx.restore();
  return canvas;
}

// ───────────── 11. 가운데 두 줄: 서양식 회사 인장 ─────────────

function drawWest(o) {
  const { S, rim, canvas, ctx, cx, cy } = sheet(o);
  strokeCircle(ctx, cx, cy, S / 2 - rim / 2, rim);
  const edge = S / 2 - rim;
  const lw = Math.max(1.5, S * 0.013);
  const Rc = S * 0.34;
  strokeCircle(ctx, cx, cy, Rc, lw);
  const inner = Rc + lw / 2;
  const band = edge - inner;
  const r = inner + band / 2;
  const path = circlePath(cx, cy, r);
  const cellH = band * 0.72;
  const stepMax = (cellH * 1.02) / 0.86;
  const name = ringName(o.lang, o.chars, o.baseChars, o.text);
  const plan = planRun(name, { minSpan: 150 * DEG * r, maxSpan: 215 * DEG * r, stepMax, spread: 1.9, repeat: short(name) });
  useFont(ctx, o.font);
  drawRun(ctx, plan, path, { ...runCell(plan, stepMax, cellH), sep: (p) => dot(ctx, p.x, p.y, band * 0.05) });
  const used = drawPathString(ctx, ringYearText(o.lang, o.date, o.dateLabel), path, {
    at: path.length / 2, inkH: band * 0.42, maxLen: 105 * DEG * r, font: o.font, inward: true,
  });
  // 두 호 사이 빈자리 가운데에 작은 별
  const topEnd = -Math.PI / 2 + plan.span / r / 2;
  const botEnd = Math.PI / 2 - used / r / 2 - band * 0.2 / r;
  const ja = (topEnd + botEnd) / 2;
  for (const a of [ja, Math.PI - ja]) drawStar(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, band * 0.2, a);
  // 가운데: 두 줄 + 작은 별 (별을 고르면 큰 별 하나)
  const R = Rc - lw / 2;
  const c = centerContent(o.lang, o.chars, o.text, o.sealCenter);
  if (c.star) drawStar(ctx, cx, cy, R * 0.62);
  else {
    drawCenterBlock(ctx, o, { cx, cy: cy - R * 0.12, w: R * 1.36, h: R * 0.86, maxLines: 2 });
    drawStar(ctx, cx, cy + R * 0.58, R * 0.13);
  }
  return canvas;
}

// ───────────── 12. 두 선 띠: 가는 두 선 사이 작은 글자, 넓은 가운데 ─────────────

function drawThin(o) {
  const { S, canvas, ctx, cx, cy } = sheet(o);
  const lw = Math.max(1.2, S * 0.012);
  const R1 = S * 0.49;
  const R2 = S * 0.355;
  strokeCircle(ctx, cx, cy, R1, lw);
  strokeCircle(ctx, cx, cy, R2, lw);
  const inner = R2 + lw / 2;
  const outer = R1 - lw / 2;
  const band = outer - inner;
  const r = inner + band / 2;
  const path = circlePath(cx, cy, r);
  const cellH = band * 0.7;
  const stepMax = (cellH * 1.1) / 0.86;
  const plan = planRun(ringName(o.lang, o.chars, o.baseChars, o.text), {
    minSpan: path.length, maxSpan: path.length, stepMax, spread: 1.5, closed: true, sepW: 0.6,
  });
  useFont(ctx, o.font);
  drawRun(ctx, plan, path, { origin: -plan.head / 2, ...runCell(plan, stepMax, cellH), sep: (p) => dot(ctx, p.x, p.y, band * 0.07) });
  sealCenterIn(ctx, o, cx, cy, R2 - lw / 2 - S * 0.015);
  return canvas;
}
