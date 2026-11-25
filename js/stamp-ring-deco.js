// 둘레글자 추가: 꾸밈 4가지 (별 양옆선·점선 둘레·음각 직인·별띠 둘레). stamp-gen.js 가 모양 목록과 그리기 함수를 합친다.
// 그리기 도구는 stamp-gen.js · stamp-ring-extra.js 에서 가져온다 (순환 가져오기: 가져온 값은 함수 안에서만 쓴다)
import { fontString } from './fonts.js';
import { rectInEllipse } from './core/geometry.js';
import { MEASURE_PX, SEAL_CENTERS, SEAL_CENTER_FONT, makeCanvas, applyBleed, drawStar, drawFittedGlyph, strokeCircle, ringUnits } from './stamp-gen.js';
import {
  ringName, runWeight, planRun, circlePath, centerContent, sheet, useFont, dot, sealCenterIn,
} from './stamp-ring-extra.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const SEP = null; // 되풀이 사이·영문 띄어쓰기 자리 (점을 찍는다)

// sealCenter: 가운데 글자 선택지(#stamp-seal-center)를 쓰는 모양. app.js 가 이 표시를 보고 한자 글꼴을 미리 받는다
const ring = (id, label, extra = {}) => ({ id, label, cat: 'ring', special: id, sealCenter: true, ...extra });

/** 모양 목록 (STAMP_SHAPES 끝에 붙는다). cat 은 'ring' */
export const RING_DECO_SHAPES = [
  ring('ring-star-bars', '별 양옆선'), // 公章 재발급형: 큰 별 양옆 가로선, 위로 두른 이름, 별 아래 가운데 글자 한두 줄
  ring('ring-dotted-single', '점선 둘레'), // 점 한 줄 테 + 바로 안쪽 가는 실선
  ring('ring-inverted-full', '음각 직인', { selfBleed: true }), // 원 전체가 잉크, 이름·선·가운데 글자를 흰색으로 지운다
  ring('ring-star-band', '별띠 둘레', { selfBleed: true }), // 굵은 잉크 테에 흰 별 12개를 지워 낸 별띠. 번진 뒤에 별을 지운다
];

/** special 값 → 그리기 함수 */
export const RING_DECO_DRAW = {
  'ring-star-bars': drawStarBars,
  'ring-dotted-single': drawDottedSingle,
  'ring-inverted-full': drawInvertedFull,
  'ring-star-band': drawStarBand,
};

/**
 * 크기는 모두 S(도장 기준 크기) 배수.
 * gap: 글자 칸과 테·선·점·별(그리고 가운데 글자) 사이 여백. 가는 선 굵기(0.014)의 두 배로, 글자 획 두 개쯤이다.
 * 획 하나만큼 띄우면 글자가 테에 붙어 보인다 (인장체 테두리 여백과 같은 기준).
 * 긴 이름은 글자 높이를 지키고 폭을 줄인다: minAspect 는 칸 폭/높이의 하한, squeeze 는 글자를 칸에 늘려 그릴 때
 * 가로 배율/세로 배율의 하한 (넓은 한글 음절도 0.4 칸을 높이까지 채우도록 0.4 보다 조금 낮게)
 */
export const RING_DECO = {
  gap: 0.028,
  minAspect: 0.4,
  squeeze: 0.34,
  // 별 양옆선: 테, 큰 별(외접 반지름), 양옆 가로선(굵기·x 범위), 위 호 글자 높이와 호 각도(도: 글자 칸이 덮는 최소 · 칸 자리 전체 최대),
  // 되풀이 점 자리(글자 칸 대비 sepW), 이웃 글자 칸 안쪽 모서리 사이(apart),
  // 별 아래 글자: 최대 폭, 한 줄(가운데 y·높이), 두 줄(가운데 y 둘·줄 높이). 둘 가운데 글자가 더 큰 쪽을 쓴다
  starBars: {
    rim: 0.034, star: 0.13, barH: 0.024, barX0: 0.14, barX1: 0.285, cellH: 0.15, minArc: 248, maxArc: 268, sepW: 0.8, apart: 0.008,
    textW: 0.4, line1: { y: 0.238, h: 0.1 }, line2: { y: [0.205, 0.31], h: 0.085 },
  },
  // 점선 둘레: 점 개수·반지름, 점과 가는 실선 사이·실선 굵기, 가운데 원 굵기, 칸 폭 비율,
  // 가운데 글자가 차지하는 반지름(centre: 둘레글자 원의 가운데 글자가 가장 넓게 차지하는 0.2065 × 0.8865 = 0.1831 이상)
  dotted: { dots: 64, dot: 0.0122, lineGap: 0.0045, line: 0.008, innerW: 0.011, centre: 0.1832, wRatio: 1.0 },
  // 음각 직인: 글자와 원 가장자리 사이 잉크 폭(테처럼 보이게), 흰 가운데 원 반지름·굵기,
  // 이웃 흰 글자 사이 잉크(apart)·칸 폭 비율(wRatio)·가운데 글자와 흰 원 사이(centreGap): 굵은 글꼴도 흰 면이 뭉치지 않게.
  // 둘레 흰 글자가 이름 띠의 whiteMax 넘게 차지하면(굵은 글꼴·긴 이름) 흰 글자 획을 깎는다 (가장자리에서 최대 erodeMax)
  inverted: { edge: 0.036, inner: 0.245, line: 0.011, apart: 0.024, wRatio: 1.05, centreGap: 0.04, whiteMax: 0.27, erodeMax: 0.007 },
  // 별띠 둘레: 바깥 잉크 띠 굵기(band), 흰 별 꼭짓점과 띠 가장자리 사이 잉크(ink), 별 개수·안쪽 꼭짓점 비율(통통한 별이
  // 카드 크기에서도 별로 보인다), 가운데 글자가 차지하는 반지름(centre: 가운데 원 선이 없어 이름 띠와 가운데가 그만큼 넓다),
  // 칸 폭 비율, 이웃 칸 사이
  starBand: { band: 0.07, ink: 0.0065, stars: 12, starInner: 0.5, centre: 0.185, wRatio: 1.0, apart: 0.007 },
};

// ───────────── 계산 (DOM 없음) ─────────────

/**
 * 고리 띠에 n 칸을 고르게 두르는 배치. 둘레글자 원과 같은 규칙: 다섯 칸 이상이면 맨 위 표시 자리를 한 칸 따로 둔다.
 * inner·outer 는 띠 양쪽 선의 끝(띠 쪽). 글자 칸은 안쪽 변이 inner + gapIn 밖, 바깥 모서리가 outer - gapOut 안에 든다
 * (칸이 원을 따라 돌아 있어 바깥 모서리가 가장 바깥이다). 이웃 칸끼리는 안쪽 모서리에서 apart 만큼 떨어진다.
 * 칸 높이는 hMax 까지, 폭은 높이 × wRatio 까지. 글자가 많으면 높이는 두고 폭을 줄이다가, 폭/높이가 minAspect 아래로 가야
 * 할 때만 높이도 줄인다.
 * @returns {{step: number, first: number, mid: number, cellW: number, cellH: number, markerRoom: number, sepRoom: number}}
 *   step: 칸 사이 각도, first: 맨 위에서 첫 칸까지 각도, mid: 칸 가운데 반지름,
 *   markerRoom·sepRoom: 맨 위 표시·되풀이 점이 이웃 글자와 clear 를 두는 가장 큰 반지름
 */
export function ringLayout(n, { inner, outer, gapIn, gapOut = gapIn, clear = gapIn, apart = gapIn / 2, hMax = Infinity, wRatio = 1.15, minAspect = RING_DECO.minAspect }) {
  const slots = n + (n >= 5 ? 1 : 0);
  const step = TAU / slots;
  const first = n >= 5 ? step : step / 2;
  const a = inner + gapIn;
  const b = outer - gapOut;
  const half = Math.min(step / 2, Math.PI / 2 - 1e-3);
  const wNear = Math.max(0, 2 * a * Math.tan(half) - apart / Math.cos(half)); // 안쪽 모서리끼리 apart
  const h0 = Math.min(hMax, b - a);
  const corner = (w) => Math.sqrt(Math.max(0, b * b - (w * w) / 4)) - a; // 바깥 모서리가 b 에 닿는 높이
  let h = h0;
  let w = 0;
  for (let i = 0; i < 8; i++) {
    w = Math.min(h * wRatio, wNear);
    h = Math.min(h0, corner(w), w / minAspect);
  }
  w = Math.min(h * wRatio, wNear);
  h = Math.max(0, Math.min(h, corner(w)));
  w = Math.min(w, h * wRatio);
  // 남는 틈은 안팎에 반씩
  const slack = Math.max(0, b - Math.hypot(a + h, w / 2));
  const mid = a + h / 2 + slack / 2;
  const side = (t) => mid * Math.sin(Math.min(t, Math.PI / 2)) - w / 2 - clear;
  return { step, first, mid, cellW: w, cellH: h, markerRoom: side(first), sepRoom: side(step) };
}

/**
 * 별 양옆선 가로선 끝: 위 호 글자 칸의 가장 안쪽(inner)에서 gap 을 두되 x1 을 넘지 않는다.
 * 선 끝 모서리(굵기 barH)가 반지름 inner - gap 안에 든다
 */
export function barEnd(inner, gap, barH, x1) {
  return Math.min(x1, Math.sqrt(Math.max(0, (inner - gap) ** 2 - (barH / 2) ** 2)));
}

/**
 * 볼록 다각형들이 가로 띠(y0~y1)에 걸친 부분 가운데 세로축(x = 0)에 가장 가까운 |x|.
 * 띠에 걸치지 않으면 Infinity, 세로축을 가로지르면 0
 */
export function nearestAbsX(polys, y0, y1) {
  let best = Infinity;
  for (const P of polys) {
    for (let i = 0; i < P.length; i++) {
      const [ax, ay] = P[i];
      const [bx, by] = P[(i + 1) % P.length];
      // 변을 띠 안으로 자른다
      let t0 = 0;
      let t1 = 1;
      if (ay === by) {
        if (ay < y0 || ay > y1) continue;
      } else {
        const ta = (y0 - ay) / (by - ay);
        const tb = (y1 - ay) / (by - ay);
        t0 = Math.max(0, Math.min(ta, tb));
        t1 = Math.min(1, Math.max(ta, tb));
        if (t0 > t1) continue;
      }
      const x0 = ax + (bx - ax) * t0;
      const x1 = ax + (bx - ax) * t1;
      best = Math.min(best, x0 * x1 <= 0 ? 0 : Math.min(Math.abs(x0), Math.abs(x1)));
    }
  }
  return best;
}

/** 원 둘레에 돌려 세운 칸(가운데 x·y, 바깥 법선 각도 n, 폭 w·높이 h)의 네 모서리 */
export function cellCorners(x, y, n, w, h) {
  const tx = -Math.sin(n);
  const ty = Math.cos(n);
  const ux = Math.cos(n);
  const uy = Math.sin(n);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [x + tx * (w / 2) * i + ux * (h / 2) * j, y + ty * (w / 2) * i + uy * (h / 2) * j]);
}

/**
 * drawSealCenter 가 반지름 r 에 그리는 가운데 내용의 가장 바깥까지 거리 (r 배수).
 * 글자는 칸(0.94배) 모서리, 별은 꼭짓점(0.8r), 영문 머리글자는 상자 모서리. drawSealCenter 와 같은 칸 나누기를 따른다.
 * 0.9r 원에 내접한다고 어림하지 않고 실제 칸 모서리로 재서, 가운데 글자를 선택지마다 들어가는 만큼 키운다
 */
export function centerExtent(lang, chars, sealCenter, order) {
  const choice = SEAL_CENTERS.find((c) => c.id === sealCenter) ?? SEAL_CENTERS[0];
  if (choice.id === 'star') return 0.8;
  if (lang !== 'ko') {
    const side = Math.SQRT2 * 0.84;
    return Math.hypot(side / 2, side * 0.3);
  }
  const n = choice.text ? Array.from(choice.text).length : (chars ?? []).filter((c) => c && c.trim()).length;
  if (!n) return 0.8;
  const vertical = choice.hanja || order === 'vertical';
  const major = n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : Math.ceil(Math.sqrt(n));
  const lines = Math.ceil(n / major);
  const cols = vertical ? lines : major;
  const rows = vertical ? major : lines;
  const box = rectInEllipse(0.9, 0.9, cols / rows);
  const cw = box.width / cols;
  const ch = box.height / rows;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const line = Math.floor(i / major);
    const inLine = line === lines - 1 ? n - line * major : major;
    const shift = (major - inLine) / 2;
    const col = vertical ? cols - 1 - line : (i % major) + shift;
    const row = vertical ? (i % major) + shift : line;
    const x = Math.abs((col + 0.5) * cw - box.width / 2) + cw * 0.47;
    const y = Math.abs((row + 0.5) * ch - box.height / 2) + ch * 0.47;
    k = Math.max(k, Math.hypot(x, y));
  }
  return k;
}

/** 가운데 내용을 반지름 R 안에 꽉 차게 (drawSealCenter 에 넘길 반지름을 내용마다 정한다) */
function centerIn(ctx, o, cx, cy, R) {
  sealCenterIn(ctx, o, cx, cy, R / centerExtent(o.lang, o.chars, o.sealCenter, o.order ?? 'horizontal'));
}

// ───────────── 그리기 도우미 ─────────────

/**
 * 이름을 고리 띠에 고르게 두르고(글자 머리가 바깥쪽) 맨 위에 표시. 되풀이 점·표시는 이웃 글자와 clear 를 둔다.
 * glyphCtx 를 주면 글자만 그쪽에 그린다 (음각 직인이 흰 글자를 따로 깎는다)
 */
function drawRingName(ctx, o, cx, cy, band, { marker = 'dot', markerMax, sepMax, glyphCtx = ctx }) {
  const units = ringUnits(o.lang, o.chars, o.baseChars, o.text);
  const L = ringLayout(units.length, band);
  const sepR = Math.max(0, Math.min(sepMax, L.sepRoom));
  useFont(glyphCtx, o.font);
  units.forEach((c, i) => {
    const a = -Math.PI / 2 + L.first + L.step * i;
    const x = cx + Math.cos(a) * L.mid;
    const y = cy + Math.sin(a) * L.mid;
    if (c === SEP) {
      if (sepR > 0) dot(ctx, x, y, sepR);
      return;
    }
    glyphCtx.save();
    glyphCtx.translate(x, y);
    glyphCtx.rotate(a + Math.PI / 2);
    // 인장처럼 칸을 꽉 채우도록 가로세로 비율을 넉넉히 바꿔 그린다. 긴 이름의 좁은 칸도 높이까지 채운다 (squeeze)
    drawFittedGlyph(glyphCtx, c, 0, 0, L.cellW, L.cellH, RING_DECO.squeeze, 1.6);
    glyphCtx.restore();
  });
  const mr = Math.min(markerMax, L.markerRoom, L.cellH * 0.5);
  if (mr <= 0) return L;
  if (marker === 'star') drawStar(ctx, cx, cy - L.mid, mr);
  else dot(ctx, cx, cy - L.mid, mr * 0.75); // 점은 별보다 작게 (별 외접 반지름의 3/4)
  return L;
}

function fillRect(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
}

// ───────────── 1. 별 양옆선: 큰 별 + 양옆 가로선, 위로 두른 이름, 별 아래 한두 줄 (公章 재발급형) ─────────────

function drawStarBars(o) {
  const K = RING_DECO.starBars;
  const { S, canvas, ctx, cx, cy } = sheet(o);
  const gap = S * RING_DECO.gap;
  const rim = Math.max(2, S * K.rim);
  strokeCircle(ctx, cx, cy, S / 2 - rim / 2, rim);
  const edge = S / 2 - rim;
  drawStar(ctx, cx, cy, S * K.star);

  // 위 호 이름: 가장 넓은 칸의 바깥 모서리가 테 안쪽에서 gap 떨어지는 반지름
  const cellH = S * K.cellH;
  const stepMax = (cellH * 0.95) / 0.86;
  const wMax = stepMax * 0.86;
  const r = Math.sqrt((edge - gap) ** 2 - (wMax / 2) ** 2) - cellH / 2;
  const name = ringName(o.lang, o.chars, o.baseChars, o.text);
  // 칸 폭: 이웃 칸의 안쪽 모서리끼리 apart 만큼 떨어지게 (호 안쪽은 칸 사이가 좁다).
  // 긴 이름은 높이를 두고 폭만 줄이다가 폭/높이가 minAspect 아래로 가야 할 때만 높이도 줄인다
  const cellOf = (plan) => {
    const cell = { cellW: wMax, cellH };
    for (let i = 0; i < 3; i++) {
      cell.cellW = Math.min(wMax, plan.step * ((r - cell.cellH / 2) / r) - S * K.apart);
      cell.cellH = Math.min(cellH, cell.cellW / RING_DECO.minAspect);
    }
    return cell;
  };
  // 호: 첫 칸 바깥 끝부터 끝 칸 바깥 끝까지 minArc 이상. 사이를 벌린 짧은 이름은 양 끝 칸 옆 빈자리만큼 모자라 호를 늘린다
  // (늘린 호가 벌릴 수 있는 폭을 넘으면 planRun 이 이름을 되풀이한다)
  const maxSpan = K.maxArc * DEG * r;
  let minSpan = K.minArc * DEG * r;
  let plan;
  let cell;
  for (let k = 0; k < 4; k++) {
    plan = planRun(name, { minSpan, maxSpan, stepMax, spread: runWeight(name) >= 5 ? 1.6 : 1.3, sepW: K.sepW });
    cell = cellOf(plan);
    const short = K.minArc * DEG * r - (plan.span - plan.step + cell.cellW);
    if (short <= 1e-9 || minSpan >= maxSpan) break;
    minSpan = Math.min(maxSpan, minSpan + short);
  }
  // 되풀이 점: 양옆 글자 칸 옆변에서 gap
  const sepR = Math.max(0, Math.min(S * 0.012, (K.sepW / 2 + 0.5) * plan.step - cell.cellW / 2 - gap));
  const path = circlePath(cx, cy, r);
  useFont(ctx, o.font);
  plan.units.forEach((u, i) => {
    const p = path.place(plan.at[i]);
    if (u === SEP) {
      if (sepR > 0) dot(ctx, p.x, p.y, sepR);
      return;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.n + Math.PI / 2);
    drawFittedGlyph(ctx, u, 0, 0, cell.cellW, cell.cellH, RING_DECO.squeeze, 1.6);
    ctx.restore();
  });

  // 양옆 가로선 (y = 0): 별에서 떨어져 시작하고, 위 호 글자 칸 안쪽 끝에서 gap 앞에서 멈춘다
  const barH = Math.max(1.5, S * K.barH);
  const x0 = S * K.barX0;
  const x1 = barEnd(r - cellH / 2, gap, barH, S * K.barX1);
  fillRect(ctx, cx + x0, cy - barH / 2, x1 - x0, barH);
  fillRect(ctx, cx - x1, cy - barH / 2, x1 - x0, barH);

  // 별 아래 가운데 글자 (별을 고르면 큰 별과 가로선만)
  const polys = plan.units.map((u, i) => {
    const p = path.place(plan.at[i]);
    const [w, h] = u === SEP ? [sepR * 2, sepR * 2] : [cell.cellW, cell.cellH];
    return cellCorners(p.x - cx, p.y - cy, p.n, w, h);
  });
  drawUnderStar(ctx, o, { S, cx, cy, gap, edge, polys, K });
  return canvas;
}

/**
 * 별 아래 글자 줄 배치 (DOM 없음). 줄마다 쓸 수 있는 반폭 room(y0, y1) 안에서 한 줄과 두 줄(윗줄에 반 올림)을 견주어
 * 글자 칸의 짧은 변이 더 긴 쪽을 고른다 (같으면 한 줄). 칸은 가로 ≤ 높이 × 1.15, 높이 ≤ 가로 × 1.2.
 * @returns {{rows: {y: number, n: number}[], cw: number, ch: number}}
 */
export function underStarPlan(n, room, { line1, line2 }) {
  const plans = [];
  const one = room(line1.y - line1.h / 2, line1.y + line1.h / 2);
  const cw1 = Math.min((2 * one) / n, line1.h * 1.15);
  plans.push({ rows: [{ y: line1.y, n }], cw: cw1, ch: Math.min(line1.h, cw1 * 1.2) });
  if (n >= 3) {
    const top = Math.ceil(n / 2);
    const half = Math.min(...line2.y.map((y) => room(y - line2.h / 2, y + line2.h / 2)));
    const cw2 = Math.min((2 * half) / top, line2.h * 1.15);
    plans.push({ rows: [{ y: line2.y[0], n: top }, { y: line2.y[1], n: n - top }], cw: cw2, ch: Math.min(line2.h, cw2 * 1.2) });
  }
  const score = (p) => Math.min(p.cw, p.ch);
  return plans.reduce((a, b) => (score(b) > score(a) + 1e-9 ? b : a));
}

/** 별 아래 가운데 글자: 호 끝 글자 칸과 테 안쪽에서 gap 을 두는 폭 안에 한 줄 또는 두 줄. 영문은 머리글자 한 줄 */
function drawUnderStar(ctx, o, { S, cx, cy, gap, edge, polys, K }) {
  const c = centerContent(o.lang, o.chars, o.text, o.sealCenter);
  if (c.star) return;
  const room = (y0, y1) => Math.min(
    (S * K.textW) / 2,
    nearestAbsX(polys, y0 - gap, y1 + gap) - gap,
    Math.sqrt(Math.max(0, (edge - gap) ** 2 - Math.max(y0 * y0, y1 * y1))),
  );
  const line1 = { y: S * K.line1.y, h: S * K.line1.h };
  const line2 = { y: K.line2.y.map((v) => S * v), h: S * K.line2.h };
  useFont(ctx, o.font);
  if (c.initials != null) {
    const half = room(line1.y - line1.h / 2, line1.y + line1.h / 2);
    if (half > 0) drawFittedGlyph(ctx, c.initials, cx, cy + line1.y, half * 2 * 0.9, line1.h * 0.8, 0.6, 1.4);
    return;
  }
  const n = c.glyphs.length;
  if (!n) return;
  const best = underStarPlan(n, room, { line1, line2 });
  if (best.cw <= 0) return;
  if (c.hanja) ctx.font = fontString(SEAL_CENTER_FONT, MEASURE_PX);
  let i = 0;
  for (const row of best.rows) {
    for (let j = 0; j < row.n; j++, i++) {
      drawFittedGlyph(ctx, c.glyphs[i], cx + (j - (row.n - 1) / 2) * best.cw, cy + row.y, best.cw * 0.92, best.ch * 0.92, 0.7, 1.4);
    }
  }
}

// ───────────── 2. 점선 둘레: 점 한 줄 테 + 바로 안쪽 가는 실선, 이름 띠, 가운데 원 ─────────────

function drawDottedSingle(o) {
  const K = RING_DECO.dotted;
  const { S, canvas, ctx, cx, cy } = sheet(o);
  const gap = S * RING_DECO.gap;
  const d = S * K.dot;
  const R1 = S / 2 - d;
  for (let i = 0; i < K.dots; i++) {
    const a = -Math.PI / 2 + (i / K.dots) * TAU;
    dot(ctx, cx + Math.cos(a) * R1, cy + Math.sin(a) * R1, d);
  }
  // 가는 실선은 점 바로 안쪽에 좁은 틈을 두고 (점이 실선에 붙으면 꽃테·톱니처럼 보인다)
  const lw = Math.max(1.2, S * K.line);
  const inner = R1 - d - S * K.lineGap - lw; // 실선 안쪽 끝
  strokeCircle(ctx, cx, cy, inner + lw / 2, lw);
  // 가운데: 글자가 차지하는 반지름 centre, 그 밖에 gap, 가운데 원
  const iw = Math.max(1.5, S * K.innerW);
  const centre = S * K.centre;
  const Rc = centre + gap + iw / 2;
  strokeCircle(ctx, cx, cy, Rc, iw);
  drawRingName(ctx, o, cx, cy, { inner: Rc + iw / 2, outer: inner, gapIn: gap, wRatio: K.wRatio }, { marker: 'star', markerMax: S * 0.045, sepMax: S * 0.013 });
  centerIn(ctx, o, cx, cy, centre);
  return canvas;
}

// ───────────── 3. 음각 직인: 잉크 원 전체에 흰 이름·흰 선·흰 가운데 글자 ─────────────

function drawInvertedFull(o) {
  const K = RING_DECO.inverted;
  const { S, canvas, ctx, cx, cy } = sheet(o);
  const gap = S * RING_DECO.gap;
  const ro = S / 2;
  dot(ctx, cx, cy, ro);
  // 번짐은 채운 면에만: 흰 글자를 지운 뒤에 번지면 글자가 메워진다 (renderStamp 는 selfBleed 모양을 다시 번지게 하지 않는다)
  bleedNow(o, canvas, ctx);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  const wl = Math.max(1, S * K.line);
  const Rc = S * K.inner;
  strokeCircle(ctx, cx, cy, Rc, wl);
  // 둘레 흰 글자는 따로 그려(가림판) 너무 빽빽하면 획을 깎은 뒤 한 번에 지운다. 맨 위 별·되풀이 점·가운데 글자는 바로 지운다
  // (가운데 한자는 본명조라 가는 획이 깎이면 끊긴다). 바깥은 종이라서 글자 칸과 가장자리 사이에 테만큼 잉크를 남긴다
  const mask = makeCanvas(canvas.width, canvas.height);
  const m = mask.getContext('2d');
  m.fillStyle = '#000';
  m.strokeStyle = '#000';
  drawRingName(ctx, o, cx, cy, {
    inner: Rc + wl / 2, outer: ro, gapIn: gap, gapOut: S * K.edge, apart: S * K.apart, wRatio: K.wRatio,
  }, { marker: 'star', markerMax: S * 0.045, sepMax: S * 0.013, glyphCtx: m });
  erode(mask, whiteErosion(mask, { cx, cy, r0: Rc + wl / 2, r1: ro - S * K.edge, S, target: K.whiteMax, max: S * K.erodeMax }));
  ctx.drawImage(mask, 0, 0);
  centerIn(ctx, o, cx, cy, Rc - wl / 2 - S * K.centreGap);
  ctx.restore();
  return canvas;
}

/**
 * 흰 글자 획을 얼마나 깎을지 (px). 깎는 만큼 흰 면이 둘레 길이 × 깎은 폭만큼 줄어드는 것을 이용한다:
 * 지금 흰 면 a0 가 띠 넓이 × target 이하면 0, 넘으면 넘친 만큼을 둘레 길이 p 로 나눈 폭 (max 까지)
 */
export function erosionFor(a0, p, band, target, max) {
  const over = a0 - band * target;
  if (over <= 0 || p <= 0) return 0;
  return Math.min(max, over / p);
}

/** 가림판(흰 글자) 이 고리 띠(r0~r1)에서 차지하는 넓이(px²)로 깎을 폭을 정한다. 픽셀을 읽을 수 없으면 0 */
function whiteErosion(mask, { cx, cy, r0, r1, S, target, max }) {
  const m = mask.getContext('2d');
  if (typeof m.getImageData !== 'function') return 0;
  const area = (c) => {
    const { data, width, height } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    let sum = 0;
    for (let y = 0; y < height; y++) {
      const dy = y + 0.5 - cy;
      for (let x = 0; x < width; x++) {
        const rr = Math.hypot(x + 0.5 - cx, dy);
        if (rr >= r0 && rr <= r1) sum += data[(y * width + x) * 4 + 3];
      }
    }
    return sum / 255;
  };
  const band = Math.PI * (r1 * r1 - r0 * r0);
  const a0 = area(mask);
  if (a0 <= band * target) return 0;
  // 조금(e0) 깎아 보고 줄어든 넓이로 글자 둘레 길이를 어림한다
  const e0 = Math.max(1, S * 0.002);
  const probe = makeCanvas(mask.width, mask.height);
  probe.getContext('2d').drawImage(mask, 0, 0);
  erode(probe, e0);
  return erosionFor(a0, (a0 - area(probe)) / e0, band, target, max);
}

/** 가림판을 e(px) 만큼 깎는다: 12 방향으로 e 만큼 옮긴 사본과 겹치는 곳만 남긴다 */
function erode(c, e) {
  if (!(e >= 0.4)) return;
  const src = makeCanvas(c.width, c.height);
  src.getContext('2d').drawImage(c, 0, 0);
  const x = c.getContext('2d');
  x.save();
  x.globalCompositeOperation = 'destination-in';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    x.drawImage(src, Math.cos(a) * e, Math.sin(a) * e);
  }
  x.restore();
}

function bleedNow(o, canvas, ctx) {
  if (!o.bleed) return;
  const bled = applyBleed(canvas, o.mult ?? 1);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bled, 0, 0);
}

// ───────────── 4. 별띠 둘레: 흰 별을 지워 낸 굵은 잉크 테, 이름 띠, 가운데 ─────────────
// 별띠를 따로 두지 않고 바깥 테 안에 넣는다: 이름 띠와 가운데가 둘레글자 원만큼 넓다.
// 가운데 원 선 없이 가운데 글자와 이름 사이를 gap 으로 띄운다

/** 별띠 테의 별: 띠(바깥 끝 outer, 굵기 band) 안에서 바깥을 향한 별의 꼭짓점과 아래 두 꼭짓점이 띠 가장자리에서 ink 떨어진다 */
export function rimStars(outer, band, ink) {
  const r = (band - 2 * ink) / (1 + Math.cos(Math.PI / 5));
  return { r, at: outer - ink - r };
}

function drawStarBand(o) {
  const K = RING_DECO.starBand;
  const { S, canvas, ctx, cx, cy } = sheet(o);
  const gap = S * RING_DECO.gap;
  const band = S * K.band;
  strokeCircle(ctx, cx, cy, S / 2 - band / 2, band);
  const centre = S * K.centre;
  drawRingName(ctx, o, cx, cy, {
    inner: centre, outer: S / 2 - band, gapIn: gap, wRatio: K.wRatio, apart: S * K.apart,
  }, { marker: 'dot', markerMax: S * 0.034, sepMax: S * 0.012 });
  centerIn(ctx, o, cx, cy, centre);
  // 번진 뒤에 별을 지운다 (지운 뒤에 번지면 흰 별이 메워진다)
  bleedNow(o, canvas, ctx);
  const star = rimStars(S / 2, band, S * K.ink);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  for (let i = 0; i < K.stars; i++) {
    const a = -Math.PI / 2 + (i / K.stars) * TAU;
    fatStar(ctx, cx + Math.cos(a) * star.at, cy + Math.sin(a) * star.at, star.r, a, K.starInner);
  }
  ctx.restore();
  return canvas;
}

/** 꼭짓점 다섯 개 별 (안쪽 꼭짓점 반지름 비율 inner: drawStar 의 0.4 보다 통통하게) */
function fatStar(ctx, x, y, r, angle, inner) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const t = angle + (i * Math.PI) / 5;
    const rr = i % 2 ? r * inner : r;
    if (i) ctx.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr);
    else ctx.moveTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr);
  }
  ctx.closePath();
  ctx.fill();
}
