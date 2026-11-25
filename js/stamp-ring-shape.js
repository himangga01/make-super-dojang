// 둘레글자 추가: 테 모양 4가지 (둥근 사각·육각·팔각·톱니). stamp-gen.js 가 모양 목록과 그리기 함수를 합친다.
// 그리기 도구는 stamp-gen.js · stamp-ring-extra.js 에서 가져온다 (순환 가져오기: 가져온 값은 함수 안에서만 쓴다)
import { fontString } from './fonts.js';
import { BASE, MEASURE_PX, makeCanvas, drawStar, drawFittedGlyph, strokeCircle, ringUnits, drawSealCenter, sealCenterFont } from './stamp-gen.js';
import { ringName, runWeight, ringCellMaxW } from './stamp-ring-extra.js';

const TAU = Math.PI * 2;
const SEP = null; // 되풀이 사이·영문 띄어쓰기 자리 (점을 찍는다)

const ring = (id, label) => ({ id, label, cat: 'ring', special: id, sealCenter: true });

/** 모양 목록 (STAMP_SHAPES 끝에 붙는다). cat 은 'ring' */
export const RING_SHAPE_SHAPES = [
  ring('ring-rounded-square', '둥근 사각 둘레'),
  ring('ring-hexagon', '육각 둘레'),
  ring('ring-octagon', '팔각 둘레'),
  ring('ring-gear', '톱니 둘레'),
];

/** special 값 → 그리기 함수 */
export const RING_SHAPE_DRAW = {
  'ring-rounded-square': drawRoundedSquare,
  'ring-hexagon': drawHexagon,
  'ring-octagon': drawOctagon,
  'ring-gear': drawGear,
};

/**
 * 크기는 S(도장 기준 크기) 배수.
 * gap: 글자 칸(글자 잉크가 꽉 차는 상자)과 테·선·꾸밈 사이에 늘 남기는 흰 여백.
 * 둘레 글자 높이는 0.18S (둘레글자 원 0.179S). 글자가 많으면 높이는 두고 폭을 줄인다:
 * 칸 폭/높이를 한글·한자 0.42, 라틴 글자(본래 좁다) 0.3 까지 (fitMin 은 drawFittedGlyph 가 글자를 홀쭉하게 늘리는 한도)
 */
export const RING_SHAPE = {
  pad: 0.034 * 1.2, // 캔버스 가장자리 여백 (다른 둘레글자와 같은 크기 433px 이 되도록)
  thin: 0.01, // 가는 선 (가운데 원·팔각)
  gap: 0.034, // 글자 칸 ↔ 선·꾸밈
  glyphGap: 0.012, // 이웃 글자 칸 사이 (가장 가까운 모서리끼리)
  aspect: 0.95, // 글자 칸 폭 / 높이 최대
  condenseKo: 0.42, // 한글·한자 칸 폭 / 높이 최소
  condenseLatin: 0.3, // 라틴 글자 칸 폭 / 높이 최소
  fitMin: 0.3, // drawFittedGlyph 가로 배율 / 세로 배율 최소
  sep: 0.012, // 되풀이 사이 점 반지름
};

const CJK = /[ᄀ-ᇿ㄰-㆏가-힣㐀-鿿豈-﫿]/;

/** 칸을 이만큼까지 홀쭉하게 해도 된다 (폭/높이): 한글·한자가 있으면 0.42, 라틴 글자만이면 0.3 */
export function minCellAspect(units) {
  return units.some((u) => u && CJK.test(u)) ? RING_SHAPE.condenseKo : RING_SHAPE.condenseLatin;
}

// ───────────── 계산 (DOM 없음) ─────────────

/**
 * 원 둘레 글자 칸. 칸 전체(바깥 모서리 포함)가 반지름 inner~outer 사이에 든다. 높이는 hMax 까지.
 * 칸 수 n 과 맨 위 표시 자리는 둘레글자 원과 같은 규칙: 다섯 칸 이상이면 한 칸을 비우고, 그보다 적으면 반 칸.
 * 이웃 칸은 돌려 놓은 직사각형의 안쪽 모서리끼리 glyphGap 을 둔다 (ringCellMaxW). 칸이 좁아지면 높이는 두고 폭만
 * minAspect 까지 줄인다
 * @returns {{step: number, first: number, mid: number, cellW: number, cellH: number}} 각도는 맨 위에서 시계 방향
 */
export function circleLayout(n, inner, outer, S, C = RING_SHAPE) {
  const aspect = C.aspect ?? RING_SHAPE.aspect;
  const minAspect = C.minAspect ?? RING_SHAPE.condenseKo;
  const slots = n + (n >= 5 ? 1 : 0);
  const step = TAU / slots;
  const first = n >= 5 ? step : step / 2;
  const band = Math.min(outer - inner, C.hMax ?? Infinity);
  const wMax = Math.max(0, ringCellMaxW(inner + band / 2, band, step, S * (C.glyphGap ?? RING_SHAPE.glyphGap)));
  let h = band;
  let w;
  for (let i = 0; i < 4; i++) {
    w = Math.min(h * aspect, wMax);
    // 바깥 모서리가 outer 원 안에 들도록
    h = Math.min(band, Math.sqrt(outer * outer - (w * w) / 4) - inner);
    if (w < h * minAspect) h = w / minAspect;
  }
  w = Math.min(h * aspect, wMax);
  const top = Math.sqrt(outer * outer - (w * w) / 4); // 칸 바깥 끝이 닿을 수 있는 반지름
  h = Math.min(h, top - inner);
  w = Math.min(w, h * aspect); // 폭은 줄기만 하므로 바깥 모서리는 여전히 outer 안
  return { step, first, mid: (inner + top) / 2, cellW: w, cellH: h };
}

/**
 * 글자 칸이 가장 크게 나오는 둘레 안쪽 반지름(inner ≥ innerMin)과 그 배치.
 * 보통은 innerMin 에서 높이 hMax 가 나온다. 그래도 칸이 모자라면 둘레를 바깥으로 옮겨 칸을 넓힌다
 */
export function ringFit(n, innerMin, outer, S, C = RING_SHAPE) {
  const hi = Math.max(innerMin, outer - S * 0.09);
  let best = null;
  for (let i = 0; i <= 64; i++) {
    const inner = innerMin + ((hi - innerMin) * i) / 64;
    const L = circleLayout(n, inner, outer, S, C);
    if (!best || L.cellH > best.cellH + 1e-9) best = { ...L, inner };
  }
  return best;
}

/** hMax 높이 칸(폭 aspect·hMax)이 outer 원 안에 들 때의 안쪽 반지름: 둘레글자 기본 배치의 가운데 원 자리 */
export function innerFor(outer, hMax, aspect = RING_SHAPE.aspect) {
  return Math.sqrt(outer * outer - ((aspect * hMax) / 2) ** 2) - hMax;
}

/**
 * 정다각형 변 띠 (윗변이 평평, 0번 변이 맨 위, 시계 방향). 글자 칸은 변과 나란히 놓여 바깥 변이 테와 평행하다
 * (원 둘레처럼 칸 바깥 모서리가 테 쪽으로 튀어나오지 않는다).
 * A: 칸 바깥 끝 변심거리, hMax: 칸 높이, maxW: 가장 긴 변의 칸 수.
 * 이웃 변 끝 칸끼리는 모서리 이등분선을 사이에 두고 안쪽 모서리가 glyphGap 떨어진다
 * @returns {{h: number, w: number, pitch: number, mid: number, xLim: number}} mid: 칸 가운데 변심거리, xLim: 한 변 칸 끝 한계
 */
export function polyBand(N, A, hMax, maxW, S, { aspect = RING_SHAPE.aspect, minAspect = RING_SHAPE.condenseKo } = {}) {
  const half = Math.PI / N;
  const gg = S * RING_SHAPE.glyphGap;
  const mid = A - hMax / 2; // 칸이 낮아져도 띠 가운데에 둔다
  const lim = (h) => (mid - h / 2) * Math.tan(half) - gg / (2 * Math.cos(half));
  let h = hMax;
  for (let i = 0; i < 6; i++) {
    const pitch = (2 * lim(h)) / Math.max(maxW, 1e-9);
    h = Math.min(hMax, Math.min(pitch - gg, hMax * aspect) / minAspect);
  }
  const xLim = lim(h);
  const pitch = (2 * xLim) / Math.max(maxW, 1e-9);
  let w = Math.min(pitch - gg, h * aspect);
  if (w < h * minAspect) h = w / minAspect; // 높이가 줄면 안쪽 끝이 바깥으로 가서 xLim 은 여전히 지켜진다
  w = Math.max(0, w);
  return { h, w, pitch, mid, xLim };
}

/** 점 (px, py) 에서 돌려 놓은 칸 {x, y, rot, w, h} 까지 거리 (칸 안이면 0) */
export function cellDistance(px, py, c) {
  const dx = px - c.x;
  const dy = py - c.y;
  const u = dx * Math.cos(c.rot) + dy * Math.sin(c.rot);
  const v = -dx * Math.sin(c.rot) + dy * Math.cos(c.rot);
  return Math.hypot(Math.max(0, Math.abs(u) - c.w / 2), Math.max(0, Math.abs(v) - c.h / 2));
}

/** 이름을 낱말(띄어쓰기로 나눈 글자 묶음)로 */
function wordsOf(name) {
  const words = [[]];
  for (const u of name) {
    if (u === SEP) words.push([]);
    else words.at(-1).push(u);
  }
  return words.filter((w) => w.length);
}

function trimSep(list) {
  let a = 0;
  let b = list.length;
  while (a < b && list[a] === SEP) a++;
  while (b > a && list[b - 1] === SEP) b--;
  return list.slice(a, b);
}

/** 0 ~ n 사이에 오름차순 자름 자리 k 개 (각 조각이 비지 않게) */
function* cutsOf(n, k, from = 1, acc = []) {
  if (k === 0) {
    yield acc;
    return;
  }
  for (let c = from; c <= n - k; c++) yield* cutsOf(n, k - 1, c + 1, [...acc, c]);
}

/** 빈 변 e 개 고르기: 좌우 대칭, 맨 위 우선, 고르게 흩어지게 */
function chooseEmpties(N, e) {
  if (e <= 0) return new Set();
  let best = null;
  for (let mask = 0; mask < 1 << N; mask++) {
    const set = [];
    for (let s = 0; s < N; s++) if (mask & (1 << s)) set.push(s);
    if (set.length !== e) continue;
    const has = (s) => set.includes(((s % N) + N) % N);
    let asym = 0;
    for (let s = 1; s < N; s++) if (has(s) !== has(N - s)) asym++;
    const gaps = set.map((s, i) => ((set[(i + 1) % e] - s + N) % N) || N);
    const cost = [asym, has(0) ? 0 : 1, N % 2 === 0 && has(N / 2) ? 0 : 1, gaps.reduce((t, g) => t + g * g, 0)];
    if (!best || lexLess(cost, best.cost)) best = { set, cost };
  }
  return new Set(best.set);
}

/**
 * N 변에 나눌 글자 [0번(위), 1번, …] (시계 방향).
 * - copies: 세 자 이하의 짧은 이름은 변마다 한 벌 (둥근 사각)
 * - 글자가 변 수 이하이면 한 변에 한 자씩: 이름(띄어쓰기 뺌)을 되풀이해 변을 채우고, 남는 변은 비운다
 *   (좌우 대칭·맨 위 우선. 빈 변에는 꾸밈을 둔다)
 * - 그보다 길면 이어서 한 번 두른다. cell(가장 긴 변 칸 수) → {w, h} (S 배수) 로 따져
 *   글자 높이가 가장 높게 → 낱말을 덜 자르게 (한 글자만 떨어지면 더 나쁘게) → 칸이 넓게 → 고르게 → 좌우 대칭 →
 *   위가 아래보다 적지 않게 → 위·아래가 더 갖게 → 변 안 띄어쓰기가 적게.
 *   영문 두 낱말은 한 변에 한 낱말씩 두는 배치도 견준다 (네 변: JANE | DOE | JANE | DOE, 여섯 변: 빈 위·아래 + 두 번).
 *   blanks 면(빈 변에 꾸밈이 있는 육각·팔각) 여러 낱말일 때 위·아래 변을 비워 낱말을 덜 자르는 배치도 견준다
 *   (육각 ACME HOLDINGS INC → · ACME HOLD · INGS INC). 빈 변은 낱말을 덜 자를 때만 쓴다
 * 변 경계에 걸린 띄어쓰기(SEP)는 모서리가 대신하므로 뺀다
 */
export function sideRuns(name, N, { cell, copies = false, sepW = 0.5, blanks: allowBlank = false }) {
  const glyphs = name.filter((u) => u !== SEP);
  const g = glyphs.length;
  if (copies && g <= 3) return Array.from({ length: N }, () => [...name]);
  if (!copies && g <= N) {
    const seq = Array.from({ length: Math.floor(N / g) }, () => glyphs).flat();
    const empties = chooseEmpties(N, N - seq.length);
    let k = 0;
    return Array.from({ length: N }, (_, s) => (empties.has(s) ? [] : [seq[k++]]));
  }
  const weight = (list) => runWeight(list, sepW);
  const q = (v) => Math.round(v * 500) / 500;
  const words = wordsOf(name);
  const cost = (runs, breaks) => {
    const ws = runs.map(weight);
    const { w, h } = cell(Math.max(...ws));
    let sym = 0;
    for (let s = 1; s < N / 2; s++) sym += Math.abs(ws[s] - ws[N - s]);
    const top = ws[0];
    const bottom = N % 2 === 0 ? ws[N / 2] : 0;
    const seps = runs.reduce((t, r) => t + r.filter((u) => u === SEP).length, 0);
    const empty = runs.filter((r) => !r.length).length;
    return [-q(h), breaks, empty, -q(w), ws.reduce((t, x) => t + x * x, 0), sym, bottom > top ? 1 : 0, -(top + bottom), seps];
  };
  let best = null;
  const consider = (runs, breaks) => {
    const c = cost(runs, breaks);
    if (!best || lexLess(c, best.cost)) best = { runs, cost: c };
  };
  if (words.length === 2 && N === 4) consider([words[0], words[1], words[0], words[1]].map((w) => [...w]), 0);
  if (words.length === 2 && N === 6) consider([[], words[0], words[1], [], words[0], words[1]].map((w) => [...w]), 0);
  if (words.length === N) consider(words.map((w) => [...w]), 0);
  // 글자 자리마다 낱말 번호 (띄어쓰기는 -1)
  const wordAt = [];
  let wi = 0;
  name.forEach((u, i) => {
    if (u === SEP) {
      wordAt.push(-1);
      if (i && name[i - 1] !== SEP) wi++;
    } else wordAt.push(wi);
  });
  // 비울 변: 낱말이 여럿이면 위·아래(좌우 대칭이 깨지지 않는 변)를 비우는 경우도 본다
  const blanks = allowBlank && words.length > 1 ? [[], [0], ...(N % 2 === 0 ? [[N / 2], [0, N / 2]] : [])] : [[]];
  for (const blank of blanks) {
    const sides = Array.from({ length: N }, (_, i) => i).filter((i) => !blank.includes(i));
    for (const cuts of cutsOf(name.length, sides.length - 1)) {
      const bounds = [0, ...cuts, name.length];
      const parts = sides.map((_, i) => trimSep(name.slice(bounds[i], bounds[i + 1])));
      if (parts.some((r) => !r.some((u) => u !== SEP))) continue;
      const runs = Array.from({ length: N }, () => []);
      sides.forEach((side, i) => (runs[side] = parts[i]));
      // 낱말 안에서 자른 경계마다 1, 낱말 조각이 한 글자뿐이면 0.5 더
      let breaks = 0;
      if (words.length > 1) {
        for (const c of cuts) if (wordAt[c - 1] >= 0 && wordAt[c - 1] === wordAt[c]) breaks++;
        for (const r of parts) {
          const ws = wordsOf(r);
          for (const w of [ws[0], ws.at(-1)]) {
            if (w && w.length === 1 && words.find((x) => x.length > 1 && x.includes(w[0]))) breaks += 0.5;
          }
        }
      }
      consider(runs, breaks);
    }
  }
  return best.runs;
}

function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-9) return a[i] < b[i];
  }
  return false;
}

/** 정다각형 꼭짓점 (원점 중심, 반지름 R, 첫 꼭짓점 각도 start) */
export function polygonVertices(sides, R, start) {
  return Array.from({ length: sides }, (_, i) => {
    const t = start + (i / sides) * TAU;
    return { x: Math.cos(t) * R, y: Math.sin(t) * R };
  });
}

/** 볼록 다각형 둘 사이 거리 (겹치면 0) */
export function convexDistance(A, B) {
  if (A.some((p) => insideConvex(p, B)) || B.some((p) => insideConvex(p, A))) return 0;
  // 변끼리 엇갈리면 꼭짓점이 안에 없어도 겹친다
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < B.length; j++) {
      if (segmentsCross(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return 0;
    }
  }
  let d = Infinity;
  for (const [P, Q] of [[A, B], [B, A]]) {
    for (const p of P) {
      for (let i = 0; i < Q.length; i++) d = Math.min(d, pointSeg(p.x, p.y, Q[i], Q[(i + 1) % Q.length]));
    }
  }
  return d;
}

function insideConvex(p, poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(c) < 1e-12) continue;
    if (!sign) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function pointSeg(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a.x + dx * t - px, a.y + dy * t - py);
}

// ───────────── 그리기 도우미 ─────────────

/** 캔버스: 테 바깥 끝이 S·w × S·h 상자에 들고, 둘레에 pad 여백 */
function sheet(o, w = 1, h = 1) {
  const S = BASE * (o.mult ?? 1);
  const pad = Math.max(2.4, S * RING_SHAPE.pad);
  const canvas = makeCanvas(S * w + pad * 2, S * h + pad * 2);
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = o.ink;
  ctx.fillStyle = o.ink;
  return { S, thin: Math.max(1.2, S * RING_SHAPE.thin), gap: S * RING_SHAPE.gap, canvas, ctx, cx: canvas.width / 2, cy: canvas.height / 2 };
}

function useFont(ctx, font) {
  ctx.font = fontString(font, MEASURE_PX);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function glyph(ctx, u, x, y, w, h) {
  drawFittedGlyph(ctx, u, x, y, w, h, RING_SHAPE.fitMin, 1.6);
}

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

/** ◆: 가로 반지름 rx, 세로 반지름 ry */
function diamond(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.moveTo(x, y - ry);
  ctx.lineTo(x + rx, y);
  ctx.lineTo(x, y + ry);
  ctx.lineTo(x - rx, y);
  ctx.closePath();
  ctx.fill();
}

/** 정다각형 선. R 은 선 가운데 꼭짓점 반지름 */
function strokePolygon(ctx, cx, cy, sides, R, start, width) {
  ctx.lineWidth = width;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  polygonVertices(sides, R, start).forEach((p, i) => (i ? ctx.lineTo(cx + p.x, cy + p.y) : ctx.moveTo(cx + p.x, cy + p.y)));
  ctx.closePath();
  ctx.stroke();
}

/** 둥근 사각 경로 (반폭 half, 모서리 반지름 r). 모서리는 arc 로 그린다 */
function roundSquarePath(ctx, cx, cy, half, r) {
  const k = half - r;
  ctx.beginPath();
  ctx.moveTo(cx - k, cy - half);
  ctx.lineTo(cx + k, cy - half);
  ctx.arc(cx + k, cy - k, r, -Math.PI / 2, 0);
  ctx.lineTo(cx + half, cy + k);
  ctx.arc(cx + k, cy + k, r, 0, Math.PI / 2);
  ctx.lineTo(cx - k, cy + half);
  ctx.arc(cx - k, cy + k, r, Math.PI / 2, Math.PI);
  ctx.lineTo(cx - half, cy - k);
  ctx.arc(cx - k, cy - k, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

/**
 * 변 띠에 글자를 놓는다 (변마다 가운데 맞춤, 글자 머리가 바깥). side s 의 바깥 방향은 맨 위에서 시계 방향 s·2π/N.
 * 빈 변에는 empty(점 위치) 를 부른다. 되풀이 점은 이웃 칸과 gap 을 둔다
 */
function drawSideRuns(ctx, o, runs, N, band, { cx, cy, S, gap, sepW, empty }) {
  useFont(ctx, o.font);
  runs.forEach((run, side) => {
    const rot = (side * TAU) / N;
    const ox = cx + Math.sin(rot) * band.mid;
    const oy = cy - Math.cos(rot) * band.mid;
    if (!run.length) {
      empty?.(ox, oy, rot);
      return;
    }
    const total = runWeight(run, sepW) * band.pitch;
    let x = -total / 2;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(rot);
    run.forEach((u) => {
      const slot = (u === SEP ? sepW : 1) * band.pitch;
      const at = x + slot / 2;
      x += slot;
      if (u === SEP) {
        // 이웃 칸 가장자리까지: 반 칸(slot/2) + 이웃 칸 반 칸(pitch/2) - 칸 폭 절반
        const r = Math.min(S * RING_SHAPE.sep, slot / 2 + band.pitch / 2 - band.w / 2 - gap);
        if (r > 0) dot(ctx, at, 0, r);
        return;
      }
      glyph(ctx, u, at, 0, band.w, band.h);
    });
    ctx.restore();
  });
}

/**
 * 원 둘레에 이름을 고르게 (글자 머리가 바깥). 칸은 반지름 L.inner~outer 안에 들고, 맨 위 표시와 되풀이 점은
 * 이웃 칸과 gap 을 둔다. marker: dot | star
 */
function drawCircleName(ctx, o, units, L, { S, cx, cy, gap, marker, markerMax }) {
  const cells = units.map((u, i) => {
    const a = -Math.PI / 2 + L.first + L.step * i;
    return { u, a, x: cx + Math.cos(a) * L.mid, y: cy + Math.sin(a) * L.mid, rot: a + Math.PI / 2, w: L.cellW, h: L.cellH };
  });
  const glyphs = cells.filter((c) => c.u !== SEP);
  const room = (x, y) => Math.min(...glyphs.map((c) => cellDistance(x, y, c))) - gap;
  useFont(ctx, o.font);
  for (const c of cells) {
    if (c.u === SEP) {
      const r = Math.min(S * RING_SHAPE.sep, room(c.x, c.y));
      if (r > 0) dot(ctx, c.x, c.y, r);
      continue;
    }
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    glyph(ctx, c.u, 0, 0, c.w, c.h);
    ctx.restore();
  }
  // 맨 위 표시: 양옆 글자와 gap 을 둔다
  const my = cy - L.mid;
  const r = Math.min(markerMax, room(cx, my));
  if (r > 0) {
    if (marker === 'star') drawStar(ctx, cx, my, r);
    else dot(ctx, cx, my, r);
  }
}

/** 가운데 글자: 테 안쪽 끝에서 gap 을 둔 원(반지름 edge - gap) 안에. drawSealCenter 는 r 의 0.9 배 원 안에 넣는다 */
function centerIn(ctx, o, cx, cy, edge, gap) {
  drawSealCenter(ctx, {
    lang: o.lang, chars: o.chars, text: o.text, font: o.font, order: o.order ?? 'horizontal', sealCenter: o.sealCenter,
    cx, cy, r: (edge - gap) / 0.9, hanjaFont: sealCenterFont(o.shape ?? {}),
  });
}

// ───────────── 1. 둥근 사각 둘레 ─────────────
// 굵은 둥근 사각 테 + 가는 가운데 원. 이름은 네 변을 시계 방향으로 돌며(글자 머리가 바깥) 모서리에서 꺾이고,
// 네 모서리에는 테의 둥근 모서리와 같은 중심에 ◆. 가운데 원 안에 직인 가운데 글자.
// 사각 둘레글자(정사각 · 별 모서리 · 사각 안 '인')와 달리 테가 둥글고, 가운데가 원이며, 긴 이름은 네 변에 이어서 한 번만 쓴다

const RSQ = { radius: 0.16, rim: 0.03, cellH: 0.18, diamond: 0.04, aspect: 1.0, sepW: 0.5 };

/** 둥근 사각 치수 (px). xMax: 한 변 글자 칸 끝 한계 */
function rsqGeometry(S) {
  const gap = S * RING_SHAPE.gap;
  const thin = Math.max(1.2, S * RING_SHAPE.thin);
  const rim = Math.max(2, S * RSQ.rim);
  const Ho = S / 2;
  const Rco = S * RSQ.radius;
  const yOut = Ho - rim - gap; // 글자 칸 바깥 끝 (가운데에서 변까지)
  const H = S * RSQ.cellH;
  const yIn = yOut - H; // 글자 칸 안쪽 끝
  const Rc = yIn - gap - thin / 2; // 가운데 원: 선 바깥 끝이 변 가운데 글자 칸 안쪽 끝에서 gap
  const dq = Ho - Rco; // 모서리 ◆: 바깥 테 둥근 모서리의 중심
  const rd = S * RSQ.diamond;
  // 한 변에 쓸 수 있는 길이: 칸이 ◆ 와 gap 을 두고, 바깥 모서리가 테의 둥근 부분에 걸리지 않으며,
  // 모서리 안쪽에서 이웃 변의 끝 칸과 glyphGap 을 둔다 (두 칸의 안쪽 모서리 사이 거리 √2·(yIn - xMax))
  const xMax = Math.min(Ho - Rco, maxRunEnd(dq, rd, yIn, yOut, gap), yIn - (S * RING_SHAPE.glyphGap) / Math.SQRT2);
  return { S, gap, thin, rim, Ho, Rco, yOut, yIn, H, Rc, dq, rd, xMax };
}

/** 둥근 사각 칸: 가장 긴 변의 칸 수 maxW → 간격·폭·높이 (px) */
function rsqCell(G, maxW, minAspect) {
  const pitch = (G.xMax * 2) / Math.max(maxW, 1e-9);
  const w = Math.max(0, Math.min(pitch - G.S * RING_SHAPE.glyphGap, G.H * RSQ.aspect));
  return { pitch, w, h: Math.min(G.H, w / minAspect), mid: (G.yIn + G.yOut) / 2 };
}

/** 나눔을 견줄 때 쓰는 칸 크기 (S 배수). 선 굵기 최솟값(px)이 끼어들지 않게 기본 크기 BASE 로 재서 나눈다 */
const perS = (S, c) => ({ w: c.w / S, h: c.h / S });

/** 둥근 사각 네 변 나눔 [위, 오른쪽, 아래, 왼쪽] (sideRuns 를 둥근 사각 치수로 따진다) */
export function squareRuns(name, sepW = RSQ.sepW) {
  const G = rsqGeometry(BASE);
  const minAspect = minCellAspect(name);
  return sideRuns(name, 4, { copies: true, sepW, cell: (maxW) => perS(BASE, rsqCell(G, maxW, minAspect)) });
}

function drawRoundedSquare(o) {
  const { S, gap, canvas, ctx, cx, cy } = sheet(o);
  const G = rsqGeometry(S);
  ctx.lineWidth = G.rim;
  roundSquarePath(ctx, cx, cy, G.Ho - G.rim / 2, G.Rco - G.rim / 2);
  ctx.stroke();
  strokeCircle(ctx, cx, cy, G.Rc, G.thin);
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) diamond(ctx, cx + sx * G.dq, cy + sy * G.dq, G.rd, G.rd);

  const name = ringName(o.lang, o.chars, o.baseChars, o.text);
  const runs = squareRuns(name);
  // 칸 간격은 가장 긴 변에 맞추고, 덜 찬 변은 같은 간격으로 가운데에 모은다
  const band = rsqCell(G, Math.max(...runs.map((r) => runWeight(r, RSQ.sepW))), minCellAspect(name));
  drawSideRuns(ctx, o, runs, 4, band, { cx, cy, S, gap, sepW: RSQ.sepW });
  centerIn(ctx, o, cx, cy, G.Rc - G.thin / 2, gap);
  return canvas;
}

/**
 * 위 변 글자 칸(높이 yIn~yOut)의 오른쪽 끝이 갈 수 있는 x. 모서리 ◆(가운데 (dq, dq), 반지름 rd. 위 변 기준이라 바깥이 +y)와 gap 을 둔다
 */
function maxRunEnd(dq, rd, yIn, yOut, gap) {
  const gem = [{ x: dq, y: dq + rd }, { x: dq + rd, y: dq }, { x: dq, y: dq - rd }, { x: dq - rd, y: dq }];
  let lo = 0;
  let hi = dq;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    const cell = [{ x: 0, y: yIn }, { x: m, y: yIn }, { x: m, y: yOut }, { x: 0, y: yOut }];
    if (convexDistance(cell, gem) >= gap) lo = m;
    else hi = m;
  }
  return lo;
}

// ───────────── 2. 육각 둘레 ─────────────
// 윗변이 평평한 육각 테. 변심거리가 S/2 라 내접원이 둘레글자 원과 같고(높이 S, 폭 2S/√3 ≈ 1.155S),
// 카드는 높이를 맞추므로 옆 도장과 같은 높이에 더 넓게 보인다.
// 이름은 여섯 변을 따라 (변과 나란히, 글자 머리가 바깥) 시계 방향으로, 여섯 모서리 구석에 점,
// 빈 변(이름이 여섯 자보다 짧을 때)에는 큰 ●. 가는 가운데 원 안에 직인 가운데 글자

const HEX = { rim: 0.021, cellH: 0.18, aspect: 0.95, corner: 0.02, cornerWhite: 0.017, mark: 0.042, sepW: 0.5 };

/** 육각 치수 (px). A: 글자 칸 바깥 끝 변심거리 */
function hexGeometry(S) {
  const rim = Math.max(2, S * HEX.rim);
  const gap = S * RING_SHAPE.gap;
  return { rim, A: S / 2 - rim - gap, hMax: S * HEX.cellH };
}

/** 육각 여섯 변 나눔 [위, 오른쪽 위, 오른쪽 아래, 아래, 왼쪽 아래, 왼쪽 위] */
export function hexRuns(name) {
  const G = hexGeometry(BASE);
  const minAspect = minCellAspect(name);
  return sideRuns(name, 6, { sepW: HEX.sepW, blanks: true, cell: (maxW) => perS(BASE, polyBand(6, G.A, G.hMax, maxW, BASE, { aspect: HEX.aspect, minAspect })) });
}

function drawHexagon(o) {
  const { S, thin, gap, canvas, ctx, cx, cy } = sheet(o, 2 / Math.sqrt(3), 1);
  const G = hexGeometry(S);
  const cos30 = Math.cos(Math.PI / 6);
  strokePolygon(ctx, cx, cy, 6, (S / 2 - G.rim / 2) / cos30, 0, G.rim);
  const name = ringName(o.lang, o.chars, o.baseChars, o.text);
  const runs = hexRuns(name);
  const band = polyBand(6, G.A, G.hMax, Math.max(1, ...runs.map((r) => runWeight(r, HEX.sepW))), S, { aspect: HEX.aspect, minAspect: minCellAspect(name) });
  // 가운데 원: 선 바깥 끝이 칸 안쪽 끝(변 가운데에서 가장 가깝다)에서 gap
  const Rc = G.A - G.hMax - gap - thin / 2;
  strokeCircle(ctx, cx, cy, Rc, thin);
  // 구석 점: 꼭짓점 방향, 테 안쪽 끝과 cornerWhite 만큼 띄운다 (글자 칸과는 훨씬 멀다)
  const rc = S * HEX.corner;
  const rho = (S / 2 - G.rim - S * HEX.cornerWhite - rc) / cos30;
  for (let i = 0; i < 6; i++) dot(ctx, cx + Math.cos((i * TAU) / 6) * rho, cy + Math.sin((i * TAU) / 6) * rho, rc);
  drawSideRuns(ctx, o, runs, 6, band, {
    cx, cy, S, gap, sepW: HEX.sepW,
    empty: (x, y) => dot(ctx, x, y, Math.min(S * HEX.mark, G.hMax / 2)),
  });
  centerIn(ctx, o, cx, cy, Rc - thin / 2, gap);
  return canvas;
}

// ───────────── 3. 팔각 둘레 ─────────────
// 윗변이 평평한 팔각 이중 테(굵은 테 + 가는 테). 이름은 둘레글자 원처럼 원 둘레에 고르게 이어 쓰고
// (짧은 이름 되풀이·영문 띄어쓰기 점은 ringUnits, 맨 위에 ★), 원 밖으로 남는 여덟 모서리 구석에 작은 점.
// 가는 가운데 원 안에 직인 가운데 글자 (가운데 틀을 팔각으로 하면 꼭짓점이 띠를 파고들어 가운데 글자 원이 0.143S 로 준다)

const OCT = { rim: 0.026, inset: 0.009, line: 0.009, cellH: 0.18, aspect: 0.85, marker: 0.034, corner: 0.012 };

function drawOctagon(o) {
  const { S, thin, gap, canvas, ctx, cx, cy } = sheet(o);
  const cos22 = Math.cos(Math.PI / 8);
  const rim = Math.max(2, S * OCT.rim);
  const lw = Math.max(1.2, S * OCT.line);
  strokePolygon(ctx, cx, cy, 8, (S / 2 - rim / 2) / cos22, Math.PI / 8, rim);
  const At = S / 2 - rim - S * OCT.inset - lw / 2; // 가는 테 가운데 변심거리
  strokePolygon(ctx, cx, cy, 8, At / cos22, Math.PI / 8, lw);
  const edge = At - lw / 2; // 가는 테 안쪽 끝 = 내접원
  const outer = edge - gap;
  const hMax = S * OCT.cellH;
  const units = ringUnits(o.lang, o.chars, o.baseChars, o.text);
  const C = { hMax, aspect: OCT.aspect, minAspect: minCellAspect(units) };
  const L = ringFit(units.length, innerFor(outer, hMax, OCT.aspect), outer, S, C);
  const Rc = L.inner - gap - thin / 2;
  strokeCircle(ctx, cx, cy, Rc, thin);
  drawCircleName(ctx, o, units, L, { S, cx, cy, gap, marker: 'star', markerMax: S * OCT.marker });
  // 구석 점: 꼭짓점 방향, 글자 칸이 닿을 수 있는 원(outer)에서 gap 넘게 바깥 (가는 테와는 0.01S 쯤 띄운다)
  const rc = S * OCT.corner;
  const rho = outer + gap + rc;
  for (let i = 0; i < 8; i++) {
    const t = Math.PI / 8 + (i * TAU) / 8;
    dot(ctx, cx + Math.cos(t) * rho, cy + Math.sin(t) * rho, rc);
  }
  centerIn(ctx, o, cx, cy, Rc - thin / 2, gap);
  return canvas;
}

// ───────────── 4. 톱니 둘레 ─────────────
// 사다리꼴 톱니가 난 고리, 가는 가운데 원, 이름은 둘레에 고르게, 맨 위에 ★

const GEAR = { teeth: 36, tip: 0.5, root: 0.476, hole: 0.458, cellH: 0.18, aspect: 0.85, marker: 0.034 };

function drawGear(o) {
  const { S, thin, gap, canvas, ctx, cx, cy } = sheet(o);
  const Rt = S * GEAR.tip;
  const Rr = S * GEAR.root;
  const Rh = S * GEAR.hole;
  const N = GEAR.teeth;
  const pa = TAU / N;
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const a = -Math.PI / 2 + i * pa;
    const pts = [[Rr, a - pa * 0.3], [Rt, a - pa * 0.17], [Rt, a + pa * 0.17], [Rr, a + pa * 0.3]];
    pts.forEach(([r, t], k) => {
      const x = cx + Math.cos(t) * r;
      const y = cy + Math.sin(t) * r;
      if (i === 0 && k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
  }
  ctx.closePath();
  ctx.moveTo(cx + Rh, cy);
  ctx.arc(cx, cy, Rh, 0, TAU, true);
  ctx.fill('evenodd');
  const outer = Rh - gap;
  const hMax = S * GEAR.cellH;
  const units = ringUnits(o.lang, o.chars, o.baseChars, o.text);
  const C = { hMax, aspect: GEAR.aspect, minAspect: minCellAspect(units) };
  const L = ringFit(units.length, innerFor(outer, hMax, GEAR.aspect), outer, S, C);
  const Rc = L.inner - gap - thin / 2;
  strokeCircle(ctx, cx, cy, Rc, thin);
  drawCircleName(ctx, o, units, L, { S, cx, cy, gap, marker: 'star', markerMax: S * GEAR.marker });
  centerIn(ctx, o, cx, cy, Rc - thin / 2, gap);
  return canvas;
}
