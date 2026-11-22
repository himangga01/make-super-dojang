// 인장체 추가 디자인 12종과 인감체 2종·둥근 인장체 6종·삼첩 원. stamp-gen.js 가 모양 목록과 그리기 함수를 합친다.
// 그리기 도구는 stamp-gen.js 에서 가져온다 (순환 가져오기: 함수 안에서만 쓴다)
//
// 글자 획은 기본 인장체(drawSeal)와 같은 core/seal-glyph.js 의 꺾은선이다. 여기서는 테·칸·배치와
// 그리는 방법(지워 내기, 둥근 끝, 모서리 굴리기, 돌려 놓기, 칸 잇기)만 바꾼다.
// lw 는 글자 획 굵기(자모 간격도 이 값으로 정한다), S 는 도장 기준 크기(BASE × mult).
import {
  BASE, MEASURE_PX, makeCanvas, clamp, applyBleed, roundRectPath, koContent, drawFittedGlyph,
  sealGridCells, sealThreeCells, sealLines, sealLineCells, sealChar, discWarp, subdivide, rrectPoints, SEAL_STROKE, SEAL_WARP,
} from './stamp-gen.js';
import { sealGlyph } from './core/seal-glyph.js';
import { cellOrder, fillScale } from './core/geometry.js';
import { fontString, INGAM_FONT } from './fonts.js';

const shape = (id, label, extra = {}) => ({ id, label, cat: 'seal', special: id, fontLabel: '인장체', ...extra });

/** 모양 목록 (STAMP_SHAPES 끝에 붙는다). cat 은 'seal' */
export const SEAL_EXTRA_SHAPES = [
  // 흰 글자를 지워 내는 모양은 번짐을 지우기 전에 준다 (selfBleed: 지운 뒤에 번지면 흰 획이 메워진다)
  shape('seal-white', '백문 사각', { selfBleed: true }),
  shape('seal-mixed', '주백상간', { selfBleed: true }),
  shape('seal-thick', '굵은 테 인장'),
  shape('seal-double', '이중 테 원'),
  shape('seal-interlock', '인상체'),
  shape('seal-cross', '십자 칸 인장'),
  shape('seal-oval', '타원 인장'),
  shape('seal-fine', '가는 둥근선'),
  shape('seal-curve', '소전 곡선'),
  shape('seal-fold3', '삼첩 사각'),
  shape('seal-radial', '방사 인장'),
  shape('seal-royal', '어보 구첩'),
  // 인감체: 인장체 획 대신 정해 둔 웹 글꼴(INGAM_FONT)을 칸에 꽉 차게 늘려 쓴다. 글꼴 선택을 따르지 않는다 (app.js stampFont)
  shape('seal-thin-square', '인감체 사각', { fontLabel: '인감체', font: INGAM_FONT }),
  shape('seal-thin-circle', '인감체 원', { fontLabel: '인감체', font: INGAM_FONT }),
  shape('seal-fold3-circle', '삼첩 원'),
  // 둥근 인장체: 가는 획 · 둥근 끝 · 둥근 꺾임 (기본형 · 삼첩 · 구첩 × 사각 · 원)
  shape('seal-round-plain-square', '둥근 인장 사각'),
  shape('seal-round-fold3-square', '둥근 삼첩 사각'),
  shape('seal-round-folded-square', '둥근 구첩 사각'),
  shape('seal-round-plain-circle', '둥근 인장 원'),
  shape('seal-round-fold3-circle', '둥근 삼첩 원'),
  shape('seal-round-folded-circle', '둥근 구첩 원'),
];

/** special 값 → 그리기 함수 */
export const SEAL_EXTRA_DRAW = {
  'seal-white': drawWhite,
  'seal-mixed': (o) => drawTiled(o, { mixed: true }),
  'seal-thick': (o) => drawFramed(o, framed().thick),
  'seal-double': (o) => drawFramed(o, framed().double),
  'seal-interlock': drawInterlock,
  'seal-cross': (o) => drawTiled(o, { mixed: false }),
  'seal-oval': drawOval,
  'seal-fine': (o) => drawFramed(o, framed().fine),
  'seal-curve': (o) => drawFramed(o, framed().curve),
  'seal-fold3': (o) => drawFramed(o, framed().fold3),
  'seal-radial': drawRadial,
  'seal-royal': (o) => drawFramed(o, framed().royal),
  'seal-thin-square': (o) => drawIngam(o, false),
  'seal-thin-circle': (o) => drawIngam(o, true),
  'seal-fold3-circle': drawFold3Circle,
  'seal-round-plain-square': (o) => drawRoundSeal(o, { level: 'plain', round: false }),
  'seal-round-fold3-square': (o) => drawRoundSeal(o, { level: 'fold3', round: false }),
  'seal-round-folded-square': (o) => drawRoundSeal(o, { level: 'folded', round: false }),
  'seal-round-plain-circle': (o) => drawRoundSeal(o, { level: 'plain', round: true }),
  'seal-round-fold3-circle': (o) => drawRoundSeal(o, { level: 'fold3', round: true }),
  'seal-round-folded-circle': (o) => drawRoundSeal(o, { level: 'folded', round: true }),
};

// ───────────── 공통: 획 굵기와 글자 칸 ─────────────

/** 글자 하나의 획. sw 는 자모 간격을 정하는 획 굵기, iw·ih 는 가운데선이 놓일 칸 크기 */
function glyphOf(ch, style, folds, sw, iw, ih) {
  return sealGlyph(sealChar(ch), { style, folds, stroke: { x: sw / Math.max(1e-3, iw), y: sw / Math.max(1e-3, ih) } });
}

/**
 * 글자 칸과 획 굵기를 정한다 (drawSeal 과 같은 방식: 칸 크기 × k, 획이 아주 많은 음절은 fit 만큼 가늘게).
 * cfg.area(lw, S) → { w, h } 글자 영역, cfg.gap 글자 사이 틈(lw 배수), cfg.draw 그리는 굵기 배율,
 * cfg.k 칸 크기에 곱할 획 굵기 비율, cfg.squeeze 원·타원에서 눌리는 만큼 칸을 작게 보는 값, cfg.min·max 획 굵기 범위(S 배수),
 * cfg.style·folds 글자 모양(seal-glyph), cfg.content(n) 한글 격자를 직접 정할 때,
 * cfg.cells(lw, S) 를 주면 칸 배치를 직접 정한다 ({ cells, size })
 */
function setup(o, cfg) {
  const { lang, chars, text, order = 'horizontal', mult = 1 } = o;
  const S = BASE * mult;
  const ko = lang === 'ko';
  // 칸 나눔선이 있는 모양도 3자는 성을 크게 두는 배치를 쓴다 (1열 3행이면 인장체 글자가 너무 납작해진다)
  const content = ko ? (cfg.content ? cfg.content(chars.length) : koContent(chars, 'grid', null)) : null;
  const lines = ko ? null : sealLines(text);
  const style = cfg.style ?? 'plain';
  const draw = cfg.draw ?? 1;
  const plan = (lw) => {
    if (cfg.cells) return { ...cfg.cells(lw, S), gap: lw * (cfg.gap ?? 2.2) };
    const { w, h } = cfg.area(lw, S);
    const gap = lw * (cfg.gap ?? 2.2);
    if (!ko) {
      const r = sealLineCells(lines, w, h, gap, lw);
      return { cells: r.cells, size: r.size, w, h, gap };
    }
    const cells = content.three
      ? sealThreeCells(chars, order, w, h, gap)
      : sealGridCells(chars, content.cols, content.rows, order, w, h, gap);
    return { cells, size: Math.min(...cells.map((c) => Math.min(c.w, c.h))), w, h, gap };
  };
  let lw = S * 0.03;
  for (let i = 0; i < 2; i++) lw = clamp(plan(lw).size * cfg.k * (cfg.squeeze ?? 1), S * (cfg.min ?? 0.016), S * (cfg.max ?? 0.05));
  const base = lw;
  for (let i = 0; i < 3; i++) {
    const fit = Math.min(...plan(lw).cells.map((c) => glyphOf(c.ch, style, cfg.folds, lw, c.w - lw * draw, c.h - lw * draw)?.fit ?? 1));
    if (fit > 0.995 || lw <= base * 0.6) break;
    lw = Math.max(base * 0.6, lw * fit * 0.97);
  }
  return { S, lw, ko, content, style, folds: cfg.folds, ...plan(lw) };
}

/**
 * 인장체 글자 하나를 칸(cx, cy, w, h)에 꽉 차게 긋는다 (stamp-gen.js 의 drawSealGlyph 를 넓힌 것).
 * lw 그리는 굵기, sw 자모 간격용 굵기, cap·join 선 끝·꺾임, corner 꺾인 곳을 굴릴 반지름(px),
 * oval ㅇ 을 타원으로, warp 좌표 변환, extra 함께 그을 선({ pts, closed }, px)
 */
function drawGlyph(ctx, ch, cx, cy, w, h, { lw, sw = lw, style = 'plain', folds, font, warp = null, cap = 'square', join = 'miter', corner = 0, oval = false, extra = null }) {
  const iw = Math.max(1e-3, w - lw); // 획 바깥 가장자리가 칸 끝에 맞도록 가운데선은 반 굵기만큼 들인다
  const ih = Math.max(1e-3, h - lw);
  const g = glyphOf(ch, style, folds, sw, iw, ih);
  if (!g) {
    // 인장체가 없는 글자(기호 등)는 고른 글꼴로. 크기는 칸 높이에 맞추고 비율은 그대로 둔다
    ctx.save();
    ctx.font = fontString(font, MEASURE_PX);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const k = Math.min((h * 0.8) / MEASURE_PX, (w * 0.9) / Math.max(1, ctx.measureText(ch).width));
    ctx.translate(cx, cy);
    ctx.scale(k, k);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    if (extra) strokeLines(ctx, extra, { lw, cap, join, corner: 0, warp });
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
    const sw2 = s.w * iw;
    const sh2 = s.h * ih;
    if (oval) lines.push({ ellipse: [x + sw2 / 2, y + sh2 / 2, sw2 / 2, sh2 / 2], closed: true });
    else lines.push({ rrect: [x, y, sw2, sh2, Math.min(sw2, sh2) * s.r], closed: true });
  }
  if (extra) lines.push(...extra);
  strokeLines(ctx, lines, { lw, cap, join, corner, warp });
}

function strokeLines(ctx, lines, { lw, cap, join, corner, warp }) {
  ctx.save();
  ctx.lineWidth = lw;
  ctx.lineCap = cap;
  ctx.lineJoin = join;
  ctx.miterLimit = 3;
  ctx.beginPath();
  for (const line of lines) {
    if (!warp && line.rrect) {
      roundRectPath(ctx, ...line.rrect);
    } else if (!warp && line.ellipse) {
      const [ex, ey, rx, ry] = line.ellipse;
      ctx.moveTo(ex + rx, ey);
      ctx.ellipse(ex, ey, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
    } else {
      let pts;
      if (line.rrect) pts = rrectPoints(...line.rrect);
      else if (line.ellipse) pts = ellipsePoints(...line.ellipse);
      else pts = corner > 0 ? filletPoints(line.pts, line.closed, corner) : line.pts;
      // 휘게 그릴 때는 마디를 잘게 나눠 곡선을 따르게 한다
      const fine = warp ? subdivide(pts, line.closed, lw * 0.6).map(([x, y]) => warp(x, y)) : pts;
      fine.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    }
    if (line.closed) ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
}

function ellipsePoints(cx, cy, rx, ry, n = 48) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  });
}

/**
 * 꺾은선의 꺾인 곳마다 반지름 r 의 원호를 넣은 점 목록 (소전처럼 모서리를 굴린다).
 * 마디가 짧으면 마디 절반까지만 깎아 이웃 원호와 겹치지 않게 한다
 */
export function filletPoints(pts, closed, r) {
  const n = pts.length;
  if (n < 3 || !(r > 0)) return pts;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(p);
      continue;
    }
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]);
    const l2 = Math.hypot(b[0] - p[0], b[1] - p[1]);
    if (l1 < 1e-6 || l2 < 1e-6) {
      out.push(p);
      continue;
    }
    const u1 = [(p[0] - a[0]) / l1, (p[1] - a[1]) / l1];
    const u2 = [(b[0] - p[0]) / l2, (b[1] - p[1]) / l2];
    const cross = u1[0] * u2[1] - u1[1] * u2[0];
    const phi = Math.atan2(Math.abs(cross), u1[0] * u2[0] + u1[1] * u2[1]); // 꺾이는 각 (0 ~ π)
    if (phi < 0.05 || phi > Math.PI - 0.05) {
      out.push(p);
      continue;
    }
    const tanHalf = Math.tan(phi / 2);
    // 꺾임이 날카로울수록(N·M 의 대각선) 반지름을 줄인다: 깎는 길이를 r 이하로
    const t = Math.min(r * tanHalf, r, l1 / 2, l2 / 2);
    const rr = t / tanHalf;
    const s = Math.sign(cross);
    const A = [p[0] - u1[0] * t, p[1] - u1[1] * t];
    const C = [A[0] - u1[1] * s * rr, A[1] + u1[0] * s * rr];
    const a0 = Math.atan2(A[1] - C[1], A[0] - C[0]);
    const steps = Math.max(2, Math.ceil(phi / (Math.PI / 16)));
    for (let k = 0; k <= steps; k++) {
      const ang = a0 + (s * phi * k) / steps;
      out.push([C[0] + Math.cos(ang) * rr, C[1] + Math.sin(ang) * rr]);
    }
  }
  return out;
}

/** 바깥 가장자리가 W×H 인 사각 테 (모서리 반지름 radius 는 바깥 기준) */
function strokeRectFrame(ctx, cx, cy, W, H, width, radius) {
  ctx.save();
  ctx.lineWidth = width;
  ctx.beginPath();
  roundRectPath(ctx, cx - (W - width) / 2, cy - (H - width) / 2, W - width, H - width, Math.max(0, radius - width / 2));
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/** 바깥 가장자리가 W×H 인 원·타원 테 */
function strokeEllipseFrame(ctx, cx, cy, W, H, width) {
  ctx.save();
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.5, (W - width) / 2), Math.max(0.5, (H - width) / 2), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** 정사각 격자를 타원 안에 펴 넣는 변환 (discWarp 를 가로·세로 반지름 a, b 로 늘린 것) */
function ovalWarp(cx, cy, a, b, t) {
  const disc = discWarp(0, 0, 1, t);
  return (x, y) => {
    const [u, v] = disc((x - cx) / a, (y - cy) / b);
    return [cx + u * a, cy + v * b];
  };
}

/** 그린 것에 번짐을 준다 (흰 글자를 지우기 전에) */
function bleedNow(canvas, ctx, mult) {
  const bled = applyBleed(canvas, mult);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bled, 0, 0);
}

function newCanvas(W, H, m, ink) {
  const canvas = makeCanvas(W + m * 2, H + m * 2);
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  return { canvas, ctx, cx: canvas.width / 2, cy: canvas.height / 2 };
}

// ───────────── 테 모양 (굵은 테·이중 테·가는 둥근선·소전 곡선·삼첩·어보) ─────────────
// rings: 바깥에서 안으로 [굵기, 앞 테와의 틈] (S 배수 또는 lw 배수), pad: 안쪽 테와 글자 사이 (lw 배수)
// stamp-gen.js 의 값(SEAL_STROKE 등)을 쓰므로 모듈을 읽을 때가 아니라 그릴 때 만든다 (순환 가져오기)

const framed = () => ({
  // 관인처럼 굵은 테와 그보다 가는 글자, 테와 글자 사이를 넉넉히
  thick: { outline: 'rect', radius: 0.03, rings: [{ w: 0.075 }], pad: (lw, S) => Math.max(lw * 2, S * 0.038), k: 0.09, max: 0.034 },
  // 바깥 테 · 틈 · 가는 안쪽 테
  double: { outline: 'circle', rings: [{ w: 0.04 }, { gap: 0.025, w: 0.018 }], pad: (lw) => lw * 2.4, k: 0.105, squeeze: 0.76, warp: SEAL_WARP },
  // 가는 획, 둥근 끝, 넓은 틈 (부전서체처럼 부드럽게). 자모 간격은 기본 굵기로 잡고 획만 가늘게 긋는다
  fine: { outline: 'circle', rings: [{ lw: 0.75 }], pad: (lw) => lw * 2.6, k: 0.105, squeeze: 0.76, warp: SEAL_WARP, draw: 0.55, gap: 3, cap: 'round', join: 'round' },
  // 꺾인 곳은 원호, ㅇ 은 타원, 둥근 끝, 모서리가 둥근 테
  curve: { outline: 'rect', radius: 0.1, rings: [{ lw: 1 }], pad: (lw) => lw * 2.4, k: 0.105, corner: 1.2, oval: true, cap: 'round', join: 'round' },
  // 한 번만 되접는 가벼운 구첩
  fold3: { outline: 'rect', radius: 0.02, rings: [{ lw: 1 }], pad: (lw) => lw * 2.5, k: 0.078, style: 'folded', folds: 1 },
  // 어보: 아주 굵은 테 · 좁은 틈 · 가는 안쪽 선, 안에 구첩
  royal: { outline: 'rect', radius: 0.025, rings: [{ w: 0.085 }, { gap: 0.02, w: 0.014 }], pad: (lw) => lw * 2.2, k: SEAL_STROKE.folded, style: 'folded' },
});

/** 테 겹들의 [바깥에서 테 가운데선까지 거리, 굵기] 와 안쪽 끝까지의 두께 */
function ringStack(rings, lw, S) {
  let d = 0;
  const out = rings.map((r) => {
    const w = r.w != null ? r.w * S : r.lw * lw;
    d += (r.gap ?? 0) * S;
    const ring = { off: d, w };
    d += w;
    return ring;
  });
  return { rings: out, depth: d };
}

function drawFramed(o, cfg) {
  const { ink, font } = o;
  const st = setup(o, {
    ...cfg,
    area: (lw, S) => {
      const side = S - 2 * (ringStack(cfg.rings, lw, S).depth + cfg.pad(lw, S));
      return { w: side, h: side };
    },
  });
  const { S, lw, cells, w: area } = st;
  const { rings } = ringStack(cfg.rings, lw, S);
  const m = Math.max(lw * 1.5, S * 0.04);
  const { canvas, ctx, cx, cy } = newCanvas(S, S, m, ink);
  for (const r of rings) {
    const D = S - r.off * 2;
    if (cfg.outline === 'circle') strokeEllipseFrame(ctx, cx, cy, D, D, r.w);
    else strokeRectFrame(ctx, cx, cy, D, D, r.w, Math.max(0, S * cfg.radius - r.off));
  }
  const warp = cfg.warp != null ? discWarp(cx, cy, area / 2, cfg.warp) : null;
  const draw = cfg.draw ?? 1;
  const opt = { lw: lw * draw, sw: lw, style: st.style, folds: st.folds, font, warp, cap: cfg.cap, join: cfg.join, corner: (cfg.corner ?? 0) * lw, oval: cfg.oval };
  for (const c of cells) drawGlyph(ctx, c.ch, cx + c.cx, cy + c.cy, c.w, c.h, opt);
  return canvas;
}

// ───────────── 백문 사각 (白文: 면을 채우고 글자를 흰 획으로 지운다) ─────────────

const WHITE_MARGIN = 1.8; // 면 가장자리와 흰 획 사이 (lw 배수)
const WHITE_DRAW = 0.9; // 흰 획 굵기 배율 (흰 획은 같은 굵기의 검은 획보다 굵어 보인다)

function drawWhite(o) {
  const { ink, font, bleed = false, mult = 1 } = o;
  const st = setup(o, {
    k: SEAL_STROKE.plain,
    gap: 2.4,
    draw: WHITE_DRAW,
    area: (lw, S) => ({ w: S - lw * WHITE_MARGIN * 2, h: S - lw * WHITE_MARGIN * 2 }),
  });
  const { S, lw, cells } = st;
  const m = Math.max(lw * 1.5, S * 0.04);
  const { canvas, ctx, cx, cy } = newCanvas(S, S, m, ink);
  ctx.beginPath();
  roundRectPath(ctx, cx - S / 2, cy - S / 2, S, S, S * 0.025);
  ctx.closePath();
  ctx.fill();
  if (bleed) bleedNow(canvas, ctx, mult);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  for (const c of cells) drawGlyph(ctx, c.ch, cx + c.cx, cy + c.cy, c.w, c.h, { lw: lw * WHITE_DRAW, sw: lw, font });
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

// ───────────── 칸 나눈 사각 (주백상간 · 십자 칸) ─────────────

/**
 * 글자 칸을 테 안쪽 전체로 넓힌 타일. 한 줄(세로 읽기는 한 열)씩 묶어 줄 경계와 줄 안 경계를 틈 가운데에 둔다.
 * 끝 줄 글자가 모자라 칸이 늘어나도 타일은 빈틈 없이 테 안을 채운다. 영문은 줄마다 타일 하나
 */
function tilesFor(cells, half, { byCol, perLine }) {
  const along = byCol ? ['cy', 'h'] : ['cx', 'w'];
  const across = byCol ? ['cx', 'w'] : ['cy', 'h'];
  const groups = new Map();
  for (const c of cells) {
    const key = Math.round(c[across[0]] * 1000);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const list = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
  const lo = (c, [p, s]) => c[p] - c[s] / 2;
  const hi = (c, [p, s]) => c[p] + c[s] / 2;
  const tiles = [];
  list.forEach((g, gi) => {
    const a0 = gi === 0 ? -half : (Math.max(...list[gi - 1].map((c) => hi(c, across))) + Math.min(...g.map((c) => lo(c, across)))) / 2;
    const a1 = gi === list.length - 1 ? half : (Math.max(...g.map((c) => hi(c, across))) + Math.min(...list[gi + 1].map((c) => lo(c, across)))) / 2;
    const row = g.slice().sort((p, q) => p[along[0]] - q[along[0]]);
    const parts = perLine ? [row] : row.map((c) => [c]);
    parts.forEach((part, pi) => {
      const b0 = pi === 0 ? -half : (hi(parts[pi - 1][parts[pi - 1].length - 1], along) + lo(part[0], along)) / 2;
      const b1 = pi === parts.length - 1 ? half : (hi(part[part.length - 1], along) + lo(parts[pi + 1][0], along)) / 2;
      const t = byCol ? { x0: a0, x1: a1, y0: b0, y1: b1 } : { x0: b0, x1: b1, y0: a0, y1: a1 };
      tiles.push({ ...t, cells: part, line: gi, pos: pi });
    });
  });
  return tiles;
}

const TILE = {
  mixed: { divider: 0.9, margin: 2 }, // 주백상간: 칸 나눔선 굵기, 칸 끝과 글자 사이 (lw 배수)
  cross: { divider: 0.8, margin: 2 },
};

function drawTiled(o, { mixed }) {
  const { ink, font, bleed = false, order = 'horizontal', mult = 1 } = o;
  const T = mixed ? TILE.mixed : TILE.cross;
  // 주백상간인데 칸이 하나뿐이면(1자, 한 줄 영문) 붉은 면을 테에서 띄워 백문 사각과 다르게 보이게 한다
  const lone = mixed && (o.lang === 'ko' ? o.chars.length <= 1 : sealLines(o.text).length <= 1);
  const ring = lone ? T.divider : 0;
  const st = setup(o, {
    k: SEAL_STROKE.plain,
    gap: T.divider + T.margin * 2,
    area: (lw, S) => {
      const side = S - lw * 2 - lw * (T.margin + ring) * 2;
      return { w: side, h: side };
    },
  });
  const { S, lw, cells, ko, content } = st;
  const half = S / 2 - lw; // 테 안쪽
  const byCol = ko && order === 'vertical' && (content.three || content.cols > 1);
  const tiles = tilesFor(cells, half, { byCol, perLine: !ko });
  // 어느 칸을 붉은 면(흰 글자)으로 할지: 2×2 는 오른쪽 위·왼쪽 아래, 그 밖은 바둑판.
  // 3자 배치는 큰 칸(성)만, 칸이 하나면 그 칸을, 영문은 둘째 줄부터 번갈아
  for (const t of tiles) {
    if (!mixed) t.ink = false;
    else if (tiles.length === 1) t.ink = true;
    else if (!ko) t.ink = t.line % 2 === 1;
    else if (content.three) t.ink = t.cells[0] === cells[0];
    else t.ink = (t.line + t.pos) % 2 === 1;
  }
  const m = Math.max(lw * 1.5, S * 0.04);
  const { canvas, ctx, cx, cy } = newCanvas(S, S, m, ink);
  strokeRectFrame(ctx, cx, cy, S, S, lw, S * 0.02);
  // 붉은 칸은 테와 칸 나눔선 밑으로 조금 넓혀 칠한다 (경계가 맞닿기만 하면 안티에일리어싱으로 흐린 줄이 남는다)
  const e = lone ? -lw * ring : lw * Math.min(T.divider, 1) * 0.45;
  for (const t of tiles) if (t.ink) ctx.fillRect(cx + t.x0 - e, cy + t.y0 - e, t.x1 - t.x0 + e * 2, t.y1 - t.y0 + e * 2);
  // 칸 나눔선: 타일 경계 가운데 (테에 닿는 변은 빼고)
  ctx.save();
  ctx.lineWidth = lw * T.divider;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  const inner = (v) => Math.abs(Math.abs(v) - half) > 1e-6;
  for (const t of tiles) {
    if (inner(t.x1)) {
      ctx.moveTo(cx + t.x1, cy + t.y0);
      ctx.lineTo(cx + t.x1, cy + t.y1);
    }
    if (inner(t.y1)) {
      ctx.moveTo(cx + t.x0, cy + t.y1);
      ctx.lineTo(cx + t.x1, cy + t.y1);
    }
  }
  ctx.stroke();
  ctx.restore();
  const opt = { lw, font };
  for (const t of tiles) if (!t.ink) for (const c of t.cells) drawGlyph(ctx, c.ch, cx + c.cx, cy + c.cy, c.w, c.h, opt);
  if (mixed) {
    if (bleed) bleedNow(canvas, ctx, mult);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#000';
    const white = { lw: lw * WHITE_DRAW, sw: lw, font };
    for (const t of tiles) if (t.ink) for (const c of t.cells) drawGlyph(ctx, c.ch, cx + c.cx, cy + c.cy, c.w, c.h, white);
    ctx.globalCompositeOperation = 'source-over';
  }
  return canvas;
}

// ───────────── 인상체 (印相体: 글자가 원을 꽉 채우고, 획 끝이 테까지 뻗고, 이웃 칸끼리 잇는 획으로 얽힌다) ─────────────
// 바깥 변을 따라 달리는 획(ㅣ 등)까지 테에 붙이면 테 속에 묻혀 글자가 사라진다. 그래서 글자 영역은 테에서 조금 띄우고,
// 바깥쪽을 향해 끝나는 획만 테까지 늘려 붙인다

const INTERLOCK = { rim: 1.5, gap: 1.2, warp: 0.6 }; // 테 굵기 · 테와 글자 영역 모서리 사이 (lw 배수) · 원 펴기 정도

function drawInterlock(o) {
  const { ink, font } = o;
  const st = setup(o, {
    k: 0.112,
    squeeze: 0.8,
    gap: 2.2,
    area: (lw, S) => {
      const side = S - lw * (INTERLOCK.rim + INTERLOCK.gap) * 2;
      return { w: side, h: side };
    },
  });
  const { S, lw, cells, w: area, style } = st;
  const m = Math.max(lw * 1.5, S * 0.04);
  const { canvas, ctx, cx, cy } = newCanvas(S, S, m, ink);
  const rimW = lw * INTERLOCK.rim;
  strokeEllipseFrame(ctx, cx, cy, S, S, rimW);
  const warp = discWarp(cx, cy, area / 2, INTERLOCK.warp);
  const bridges = interlockBridges(cells, lw, style);
  const toAbs = ([x, y]) => [cx + x, cy + y];
  cells.forEach((c, i) => {
    drawGlyph(ctx, c.ch, cx + c.cx, cy + c.cy, c.w, c.h, {
      lw, style, font, warp,
      extra: bridges[i].map(({ pts }) => ({ pts: pts.map(toAbs), closed: false })),
    });
  });
  // 테로 뻗는 획: 휜 획 끝의 방향 그대로 테 안쪽 끝을 조금 넘을 때까지
  const R = S / 2 - rimW + lw * 0.4;
  const spokes = [];
  for (const { pt, inner } of rimEnds(cells, lw, style)) {
    const p = warp(...toAbs(pt));
    const q = warp(...toAbs(inner));
    const hit = rayCircle(p, [p[0] - q[0], p[1] - q[1]], [cx, cy], R);
    // 너무 긴 획은 빈 곳을 가로질러 글자처럼 보이므로 짧은 것만 (획 굵기 4.5배까지)
    const len = hit ? Math.hypot(hit[0] - p[0], hit[1] - p[1]) : 0;
    if (len > lw * 0.3 && len < lw * 4.5) spokes.push({ pts: [p, hit], closed: false });
  }
  if (spokes.length) strokeLines(ctx, spokes, { lw, cap: 'butt', join: 'miter', corner: 0, warp: null });
  return canvas;
}

/** 점 p 에서 방향 d 로 나아가 원(c, R)에 닿는 곳. p 가 원 밖이면 null */
function rayCircle(p, d, c, R) {
  const len = Math.hypot(d[0], d[1]);
  if (len < 1e-9) return null;
  const ux = d[0] / len;
  const uy = d[1] / len;
  const fx = p[0] - c[0];
  const fy = p[1] - c[1];
  const b = fx * ux + fy * uy;
  const disc = b * b - (fx * fx + fy * fy - R * R);
  if (disc < 0 || fx * fx + fy * fy > R * R) return null;
  const s = -b + Math.sqrt(disc);
  return [p[0] + ux * s, p[1] + uy * s];
}

/**
 * 바깥(이웃 칸이 없는 쪽)을 향해 끝나는 획 끝. { pt 끝 가운데선 점, inner 획을 따라 안쪽으로 조금 들어간 점 } (도장 가운데 기준 px)
 */
function rimEnds(cells, lw, style) {
  const out = [];
  const covered = (A, side, v) => cells.some((B) => {
    if (B === A) return false;
    const gx = side === 'left' ? A.cx - A.w / 2 - (B.cx + B.w / 2) : side === 'right' ? B.cx - B.w / 2 - (A.cx + A.w / 2) : null;
    const gy = side === 'top' ? A.cy - A.h / 2 - (B.cy + B.h / 2) : side === 'bottom' ? B.cy - B.h / 2 - (A.cy + A.h / 2) : null;
    if (gx != null) return gx > -lw && gx < lw * 4 && v >= B.cy - B.h / 2 && v <= B.cy + B.h / 2;
    return gy > -lw && gy < lw * 4 && v >= B.cx - B.w / 2 && v <= B.cx + B.w / 2;
  });
  for (const c of cells) {
    const iw = Math.max(1e-3, c.w - lw);
    const ih = Math.max(1e-3, c.h - lw);
    const g = glyphOf(c.ch, style, undefined, lw, iw, ih);
    if (!g) continue;
    const map = ([x, y]) => [c.cx - iw / 2 + x * iw, c.cy - ih / 2 + y * ih];
    for (const path of g.paths) {
      const last = path[path.length - 1];
      if (path.length > 3 && last[0] === path[0][0] && last[1] === path[0][1]) continue; // 닫힌 선은 끝이 없다
      for (const [e, q] of [[path[0], path[1]], [last, path[path.length - 2]]]) {
        const dx = e[0] - q[0];
        const dy = e[1] - q[1];
        let side = null;
        if (Math.abs(dy) < 1e-9 && e[0] < 1e-6 && dx < 0) side = 'left';
        else if (Math.abs(dy) < 1e-9 && e[0] > 1 - 1e-6 && dx > 0) side = 'right';
        else if (Math.abs(dx) < 1e-9 && e[1] < 1e-6 && dy < 0) side = 'top';
        else if (Math.abs(dx) < 1e-9 && e[1] > 1 - 1e-6 && dy > 0) side = 'bottom';
        if (!side) continue;
        const pt = map(e);
        const qq = map(q);
        if (covered(c, side, side === 'left' || side === 'right' ? pt[1] : pt[0])) continue;
        const len = Math.hypot(pt[0] - qq[0], pt[1] - qq[1]);
        const k = Math.min(lw, len) / Math.max(len, 1e-9);
        out.push({ pt, inner: [pt[0] + (qq[0] - pt[0]) * k, pt[1] + (qq[1] - pt[1]) * k] });
      }
    }
  }
  return out;
}

/**
 * 이웃 칸을 잇는 짧은 획. 맞닿은 변의 1/3·2/3 높이(가로로 이웃) 또는 폭(세로로 이웃)에 두되,
 * 두 글자 모두 그 변에 획이 닿아 있는 자리만 쓴다 (허공에 뜬 토막이 생기지 않게). 가까운 자리를 찾지 못하면 건너뛴다.
 * 결과는 칸마다 [{ pts }] (도장 가운데 기준 px)
 */
function interlockBridges(cells, lw, style) {
  const edges = cells.map((c) => glyphEdges(c, lw, style));
  const out = cells.map(() => []);
  const near = (a, b) => Math.abs(a - b) < lw * 0.8;
  for (let i = 0; i < cells.length; i++) {
    for (let j = 0; j < cells.length; j++) {
      if (i === j) continue;
      const A = cells[i];
      const B = cells[j];
      const gapX = B.cx - B.w / 2 - (A.cx + A.w / 2);
      const gapY = B.cy - B.h / 2 - (A.cy + A.h / 2);
      // 가로로 이웃: A 오른쪽 변 ↔ B 왼쪽 변
      if (gapX > 0 && gapX < lw * 4) {
        const y0 = Math.max(A.cy - A.h / 2, B.cy - B.h / 2);
        const y1 = Math.min(A.cy + A.h / 2, B.cy + B.h / 2);
        if (y1 - y0 > lw * 3) {
          for (const f of [1 / 3, 2 / 3]) {
            const y = bridgeAt(edges[i].right, edges[j].left, y0 + (y1 - y0) * f, (y1 - y0) * 0.16, lw);
            if (y == null) continue;
            const xa = A.cx + A.w / 2 - lw / 2;
            const xb = B.cx - B.w / 2 + lw / 2;
            if (!out[i].some((p) => near(p.pts[0][1], y) && near(p.pts[0][0], xa))) out[i].push({ pts: [[xa, y], [xb, y]] });
          }
        }
      }
      // 세로로 이웃: A 아래 변 ↔ B 위 변
      if (gapY > 0 && gapY < lw * 4) {
        const x0 = Math.max(A.cx - A.w / 2, B.cx - B.w / 2);
        const x1 = Math.min(A.cx + A.w / 2, B.cx + B.w / 2);
        if (x1 - x0 > lw * 3) {
          for (const f of [1 / 3, 2 / 3]) {
            const x = bridgeAt(edges[i].bottom, edges[j].top, x0 + (x1 - x0) * f, (x1 - x0) * 0.16, lw);
            if (x == null) continue;
            const ya = A.cy + A.h / 2 - lw / 2;
            const yb = B.cy - B.h / 2 + lw / 2;
            if (!out[i].some((p) => near(p.pts[0][0], x) && near(p.pts[0][1], ya))) out[i].push({ pts: [[x, ya], [x, yb]] });
          }
        }
      }
    }
  }
  return out;
}

/** 두 변의 획이 함께 닿는 자리 가운데 want 에 가장 가까운 곳 (±range 안). 없으면 null */
function bridgeAt(a, b, want, range, lw) {
  let best = null;
  for (const [p0, p1] of a) {
    for (const [q0, q1] of b) {
      const lo = Math.max(p0, q0) + lw * 0.5;
      const hi = Math.min(p1, q1) - lw * 0.5;
      if (hi < lo) continue;
      const v = clamp(want, lo, hi);
      if (Math.abs(v - want) <= range && (best == null || Math.abs(v - want) < Math.abs(best - want))) best = v;
    }
  }
  return best;
}

/** 글자 칸 네 변에 획이 닿는 구간 (도장 가운데 기준 px). 변 위의 직선 획과 변에서 끝나는 획 끝 */
function glyphEdges(c, lw, style) {
  const iw = Math.max(1e-3, c.w - lw);
  const ih = Math.max(1e-3, c.h - lw);
  const g = glyphOf(c.ch, style, undefined, lw, iw, ih);
  const e = { left: [], right: [], top: [], bottom: [] };
  if (!g) return e;
  const x0 = c.cx - iw / 2;
  const y0 = c.cy - ih / 2;
  const X = (x) => x0 + x * iw;
  const Y = (y) => y0 + y * ih;
  const at = (v, t) => Math.abs(v - t) < 1e-6;
  const half = lw / 2;
  for (const path of g.paths) {
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, ay] = path[i];
      const [bx, by] = path[i + 1];
      if (at(ax, bx)) {
        const span = [Y(Math.min(ay, by)) - half, Y(Math.max(ay, by)) + half];
        if (at(ax, 0)) e.left.push(span);
        if (at(ax, 1)) e.right.push(span);
      }
      if (at(ay, by)) {
        const span = [X(Math.min(ax, bx)) - half, X(Math.max(ax, bx)) + half];
        if (at(ay, 0)) e.top.push(span);
        if (at(ay, 1)) e.bottom.push(span);
      }
      // 변에서 끝나는 가로획(세로획)은 그 높이(폭)에서 변에 닿는다
      for (const [px, py] of [[ax, ay], [bx, by]]) {
        if (at(ay, by) && (at(px, 0) || at(px, 1))) (at(px, 0) ? e.left : e.right).push([Y(py) - half, Y(py) + half]);
        if (at(ax, bx) && (at(py, 0) || at(py, 1))) (at(py, 0) ? e.top : e.bottom).push([X(px) - half, X(px) + half]);
      }
    }
  }
  for (const s of g.shapes) {
    const r = Math.min(s.w * iw, s.h * ih) * s.r;
    if (at(s.x, 0)) e.left.push([Y(s.y) + r, Y(s.y + s.h) - r]);
    if (at(s.x + s.w, 1)) e.right.push([Y(s.y) + r, Y(s.y + s.h) - r]);
    if (at(s.y, 0)) e.top.push([X(s.x) + r, X(s.x + s.w) - r]);
    if (at(s.y + s.h, 1)) e.bottom.push([X(s.x) + r, X(s.x + s.w) - r]);
  }
  return e;
}

// ───────────── 타원 인장 (세로로 긴 타원, 글자는 한 줄로 세워 타원에 맞춰 휜다) ─────────────

const OVAL_W = 0.76;

/**
 * 타원 안 한글 격자: 1~2자는 한 줄로 세우고, 3자는 성을 크게, 그 밖은 세로로 긴 격자(행 ≥ 열).
 * 폭이 0.76 인 타원에 3자 이상을 한 줄로 세우면 글자가 2.5:1 넘게 납작해져 읽기 어렵다
 */
export function ovalContent(n) {
  if (n <= 2) return { cols: 1, rows: Math.max(1, n), n };
  if (n === 3) return { cols: 2, rows: 2, n, three: true };
  const cols = Math.ceil(n / Math.ceil(Math.sqrt(n / OVAL_W)));
  return { cols, rows: Math.ceil(n / cols), n };
}

function drawOval(o) {
  const { ink, font } = o;
  const pad = 2.5;
  const st = setup(o, {
    k: SEAL_STROKE.plain,
    squeeze: 0.8,
    content: ovalContent,
    area: (lw, S) => ({ w: S * OVAL_W - lw * 2 - lw * pad * 2, h: S - lw * 2 - lw * pad * 2 }),
  });
  const { S, lw, cells, w, h } = st;
  const m = Math.max(lw * 1.5, S * 0.04);
  const { canvas, ctx, cx, cy } = newCanvas(S * OVAL_W, S, m, ink);
  strokeEllipseFrame(ctx, cx, cy, S * OVAL_W, S, lw);
  const warp = ovalWarp(cx, cy, w / 2, h / 2, 0.3);
  for (const c of cells) drawGlyph(ctx, c.ch, cx + c.cx, cy + c.cy, c.w, c.h, { lw, font, warp });
  return canvas;
}

// ───────────── 방사 인장 (글자 머리를 테 쪽으로 돌려 가운데를 둘러 놓는다) ─────────────

const RADIAL_RIM = 1.5; // 테 굵기 (lw 배수)

/** 방사 배치를 쓸 글자 (한글 2~5자, 영문 2~5자). 그 밖은 null → 격자 */
function radialUnits(o) {
  if (o.lang === 'ko') return o.chars.length >= 2 && o.chars.length <= 5 ? o.chars : null;
  const list = Array.from(o.text.toUpperCase().replace(/\s+/g, ''));
  return list.length >= 2 && list.length <= 5 ? list : null;
}

/**
 * n 칸을 가운데 둘레에 놓는다. 칸은 폭(둘레 방향)·높이(반지름 방향) 비율 aspect 인 사각이고
 * 이웃 칸과 gap, 가운데 점과 gap 을 띄우고 테 안쪽 원(R)을 넘지 않는 가장 큰 크기 (이분 탐색)
 */
export function radialLayout(n, R, dotR, gap, aspect) {
  // 이웃 칸과의 경계(두 칸 사이 이등분선)에서 안쪽 모서리가 gap/2 이상 떨어지도록
  const sin = Math.sin(Math.PI / n);
  const cos = Math.cos(Math.PI / n);
  const center = (h) => {
    const w = h * aspect;
    return { w, rc: Math.max(h / 2 + ((w / 2) * cos + gap / 2) / sin, dotR + gap + h / 2) };
  };
  let lo = 0;
  let hi = R;
  for (let i = 0; i < 40; i++) {
    const h = (lo + hi) / 2;
    const { w, rc } = center(h);
    if ((rc + h / 2) ** 2 + (w / 2) ** 2 <= R * R) lo = h;
    else hi = h;
  }
  const { w, rc } = center(lo);
  return { w, h: lo, rc };
}

const RADIAL_ASPECT = { 2: 1.25, 3: 1, 4: 1, 5: 0.94 };

function drawRadial(o) {
  const units = radialUnits(o);
  const { ink, font, order = 'horizontal' } = o;
  const pad = 2.2;
  const dot = (lw, S) => Math.max(lw * 1.3, S * 0.04);
  const st = setup(o, units
    ? {
      k: SEAL_STROKE.plain,
      cells: (lw, S) => {
        const n = units.length;
        const R = S / 2 - lw * RADIAL_RIM - lw * pad;
        const gap = lw * 2.2;
        const { w, h, rc } = radialLayout(n, R, dot(lw, S), gap, RADIAL_ASPECT[n]);
        const dir = order === 'vertical' ? -1 : 1; // 가로 읽기는 시계 방향, 세로 읽기는 반시계 방향
        const cells = units.map((ch, i) => {
          const a = -Math.PI / 2 + (dir * i * Math.PI * 2) / n;
          return { ch, cx: Math.cos(a) * rc, cy: Math.sin(a) * rc, w, h, rot: a + Math.PI / 2 };
        });
        return { cells, size: Math.min(w, h) };
      },
    }
    : {
      k: SEAL_STROKE.plain,
      squeeze: 0.76,
      area: (lw, S) => {
        const side = S - lw * RADIAL_RIM * 2 - lw * pad * 2;
        return { w: side, h: side };
      },
    });
  const { S, lw, cells } = st;
  const m = Math.max(lw * 1.5, S * 0.04);
  const { canvas, ctx, cx, cy } = newCanvas(S, S, m, ink);
  strokeEllipseFrame(ctx, cx, cy, S, S, lw * RADIAL_RIM);
  if (units) {
    ctx.beginPath();
    ctx.arc(cx, cy, dot(lw, S), 0, Math.PI * 2);
    ctx.fill();
    for (const c of cells) {
      ctx.save();
      ctx.translate(cx + c.cx, cy + c.cy);
      ctx.rotate(c.rot);
      drawGlyph(ctx, c.ch, 0, 0, c.w, c.h, { lw, font });
      ctx.restore();
    }
  } else {
    const warp = discWarp(cx, cy, st.w / 2, SEAL_WARP);
    for (const c of cells) drawGlyph(ctx, c.ch, cx + c.cx, cy + c.cy, c.w, c.h, { lw, font, warp });
  }
  return canvas;
}

// ───────────── 삼첩 원 (삼첩 사각을 원 테에: 격자를 원 안에 펴 넣는다) ─────────────

function drawFold3Circle(o) {
  return drawFramed(o, { ...framed().fold3, outline: 'circle', radius: 0, squeeze: 0.76, warp: SEAL_WARP });
}

// ───────────── 둥근 인장체 (가는 획 · 둥근 끝 · 둥근 꺾임 · 알약꼴 ㅇ) ─────────────
// 자모 간격과 글자 사이는 굵은 획(sw) 기준으로 넉넉히 잡고, 획은 그 draw 배로 가늘게 긋는다.
// 꺾인 곳은 corner(sw 배) 반지름으로 굴리고, ㅇ 은 짧은 변 절반을 반지름으로 해 알약꼴로 늘린다.
// 둘레글자 인장체 직인(stamp-ring-extra.js)도 이 값과 drawRoundGlyph 로 둘레 글자를 긋는다

/**
 * 단계: plain 기본형, fold3 한 번 되접기(삼첩), folded 구첩. k 는 칸 짧은 변에 곱할 간격용 획 굵기.
 * 둥근 꼴에서는 ㅇ 을 겹 테 없이 알약 하나로 두고(ringFolds 0: 겹 테가 과녁처럼 보여 알약꼴과 어울리지 않는다),
 * ㅊ·ㅎ 꼭지는 짧은 가로획으로 긋는다(flatTick)
 */
export const ROUND_SEAL = {
  flatTick: true,
  draw: 0.72, // 긋는 굵기 / 간격용 굵기
  corner: 1.1, // 꺾인 곳 반지름 (간격용 굵기 배수)
  gap: 2.2, // 글자 사이 (간격용 굵기 배수)
  frame: 0.022, // 테 굵기 (S 배수)
  pad: { square: 0.06, circle: 0.05 }, // 테 안쪽과 글자 영역 사이 (S 배수)
  warp: 0.35, // 원: 격자를 원 안에 펴 넣는 정도 (discWarp, 인장체 원의 SEAL_WARP 와 같은 값)
  levels: {
    plain: { style: 'plain', k: 0.09 },
    fold3: { style: 'folded', folds: 1, ringFolds: 0, k: 0.075 },
    folded: { style: 'folded', folds: 3, ringFolds: 0, k: 0.06 },
  },
};

/** 글자 하나의 인장체 획 (paths · shapes · aspect · fit). 인장체가 없는 글자는 null */
export function roundGlyphInfo(ch, level, sw, iw, ih) {
  const L = ROUND_SEAL.levels[level] ?? ROUND_SEAL.levels.plain;
  const stroke = { x: sw / Math.max(1e-3, iw), y: sw / Math.max(1e-3, ih) };
  return sealGlyph(sealChar(ch), { style: L.style, folds: L.folds, ringFolds: L.ringFolds, flatTick: ROUND_SEAL.flatTick, stroke });
}

/**
 * 둥근 인장체 글자 하나를 칸(cx, cy, w, h)에 꽉 차게 긋는다. lw 긋는 굵기, sw 자모 간격용 굵기, corner 꺾인 곳 반지름(px).
 * 인장체가 없는 글자는 drawGlyph 처럼 고른 글꼴로
 */
export function drawRoundGlyph(ctx, ch, cx, cy, w, h, { lw, sw = lw, level = 'plain', font, warp = null, corner = 0 }) {
  const iw = Math.max(1e-3, w - lw);
  const ih = Math.max(1e-3, h - lw);
  const g = roundGlyphInfo(ch, level, sw, iw, ih);
  if (!g) {
    drawGlyph(ctx, ch, cx, cy, w, h, { lw, font });
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
    const sw2 = s.w * iw;
    const sh2 = s.h * ih;
    lines.push({ rrect: [x, y, sw2, sh2, Math.min(sw2, sh2) / 2], closed: true });
  }
  strokeLines(ctx, lines, { lw, cap: 'round', join: 'round', corner, warp });
}

function drawRoundSeal(o, { level, round }) {
  const R = ROUND_SEAL;
  const L = R.levels[level];
  const pad = round ? R.pad.circle : R.pad.square;
  const st = setup(o, {
    k: L.k,
    style: L.style,
    folds: L.folds,
    draw: R.draw,
    gap: R.gap,
    squeeze: round ? 0.76 : 1,
    min: 0.01,
    area: (lw, S) => {
      const side = S - 2 * S * (R.frame + pad);
      return { w: side, h: side };
    },
  });
  const { S, lw, cells, w: area } = st;
  const m = Math.max(lw * 1.5, S * 0.04);
  const { canvas, ctx, cx, cy } = newCanvas(S, S, m, o.ink);
  const frame = Math.max(1, S * R.frame);
  if (round) strokeEllipseFrame(ctx, cx, cy, S, S, frame);
  else strokeRectFrame(ctx, cx, cy, S, S, frame, 0);
  const warp = round ? discWarp(cx, cy, area / 2, R.warp) : null;
  const opt = { lw: lw * R.draw, sw: lw, level, font: o.font, warp, corner: R.corner * lw };
  for (const c of cells) drawRoundGlyph(ctx, c.ch, cx + c.cx, cy + c.cy, c.w, c.h, opt);
  return canvas;
}

// ───────────── 인감체 사각 · 인감체 원 (웹 글꼴 글자를 칸에 꽉 차게 늘려 쓴다) ─────────────
// 참고한 인감 도장(4자 2×2)에서 잰 비율: 가는 테, 글자는 칸을 가로세로 모두 채우고(비율 고정 없음),
// 칸 사이는 가로로 넓게(칸 폭의 18%) 세로로 좁게(칸 높이의 8%). 사각은 테 바깥에서 글자까지 0.095S,
// 원은 테 안쪽 원에 내접하는 정사각에 글자를 넣는다. 글자 획은 칸 크기 × stroke 로 고르게 맞추고, 테는 그 0.8배
// (참고 이미지 획 폭을 알파 합으로 재면 테 2.8%, 글자 세로획 3.3~3.6% — 4자 사각, 도장 크기 대비).
// 둘레글자 인감체 직인(stamp-ring-extra.js)도 아래 글자 도구를 쓴다

const INGAM = { inset: 0.095, gapX: 0.18, gapY: 0.08, circlePad: 0.035, stroke: 0.092, frame: 0.8 };

/**
 * 글자를 칸에 맞출 가로세로 비율 범위 [min, max]. 한글·한자 한 자와 여러 글자(영문 줄)는 칸을 꽉 채우도록 크게 바꾸고,
 * 영문 한 자처럼 본래 폭이 들쭉날쭉한 글자는 덜 바꾼다 (I 가 굵은 막대가 되지 않게)
 */
export function ingamAspect(text) {
  if (Array.from(text).length > 1 || /^[가-힣一-鿿]$/.test(text)) return [0.3, 3];
  return [0.55, 1.6];
}

/** 칸 w×h 에 맞춰 늘린 배율 (drawFittedGlyph 와 같은 계산). ctx.font 는 MEASURE_PX 크기 글꼴이어야 한다 */
function ingamScale(ctx, text, w, h) {
  const m = ctx.measureText(text);
  const gw = (m.actualBoundingBoxLeft ?? 0) + (m.actualBoundingBoxRight ?? m.width);
  const gh = (m.actualBoundingBoxAscent ?? MEASURE_PX * 0.8) + (m.actualBoundingBoxDescent ?? MEASURE_PX * 0.2);
  return fillScale(gw, gh, w, h, ...ingamAspect(text));
}

/** 칸에 늘려 그린 글자의 획 굵기(px): 글꼴의 stem(글꼴 크기 대비 획 굵기) × 가로·세로 배율 평균 */
export function ingamStroke(ctx, text, w, h, font) {
  const { sx, sy } = ingamScale(ctx, text, w, h);
  return (MEASURE_PX * (font?.stem ?? 0.06) * (sx + sy)) / 2;
}

/**
 * 인감체 글자 하나(영문은 한 줄)를 칸 가운데 (cx, cy) 의 w×h 에 꽉 차게.
 * stroke(px)를 주면, 늘린 뒤 획이 그보다 굵은 글자는 글자 윤곽을 따라 지워 그만큼 가늘게 한다:
 * 작게 디자인된 글자(하이멜로디의 '이'·'사'는 글꼴 크기의 절반 높이)를 칸에 맞춰 크게 늘려도 다른 글자와 획 굵기가 같다
 */
export function drawIngamGlyph(ctx, text, cx, cy, w, h, { font, stroke } = {}) {
  const [lo, hi] = ingamAspect(text);
  drawFittedGlyph(ctx, text, cx, cy, w, h, lo, hi);
  if (!(stroke > 0) || typeof ctx.strokeText !== 'function') return; // 테스트의 가짜 canvas 에는 strokeText 가 없다
  const m = ctx.measureText(text);
  const left = m.actualBoundingBoxLeft ?? 0;
  const right = m.actualBoundingBoxRight ?? m.width;
  const ascent = m.actualBoundingBoxAscent ?? MEASURE_PX * 0.8;
  const descent = m.actualBoundingBoxDescent ?? MEASURE_PX * 0.2;
  const { sx, sy } = fillScale(left + right, ascent + descent, w, h, lo, hi);
  // 글꼴 크기(MEASURE_PX) 기준으로 지울 두께 (획 양쪽에서 반씩). 획이 사라지지 않게 본래 굵기의 70%까지만
  const stem = MEASURE_PX * (font?.stem ?? 0.06);
  const cut = Math.min(stem - (2 * stroke) / (sx + sy), stem * 0.7);
  if (cut <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.translate(cx, cy);
  ctx.scale(sx, sy);
  ctx.lineWidth = cut;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, (left - right) / 2, (ascent - descent) / 2);
  ctx.restore();
}

/** 칸 n 개와 그 사이 틈(칸 크기 × gap)이 span 을 채울 때의 칸 크기 */
const ingamCell = (span, n, gap) => span / (n + gap * (n - 1));

/**
 * 인감체 칸 배치 (도장 가운데 기준 좌표, w×h 영역). 한글은 koContent 격자(3자는 성을 크게),
 * 끝 줄(세로 읽기는 끝 열)이 덜 차면 남은 글자를 늘려 채운다(칸 두 배까지). 영문은 줄마다 한 칸
 */
export function ingamCells({ ko, chars, content, lines, order = 'horizontal', w, h }) {
  const { gapX, gapY } = INGAM;
  if (!ko) {
    const ch = ingamCell(h, lines.length, gapY);
    return lines.map((t, i) => ({ ch: t, cx: 0, cy: -h / 2 + i * ch * (1 + gapY) + ch / 2, w, h: ch }));
  }
  if (content.three) {
    const [a, b, c] = chars;
    const cw = ingamCell(w, 2, gapX);
    const ch = ingamCell(h, 2, gapY);
    const left = -w / 2 + cw / 2;
    const right = w / 2 - cw / 2;
    const top = -h / 2 + ch / 2;
    const bottom = h / 2 - ch / 2;
    if (order === 'vertical') return [{ ch: a, cx: right, cy: 0, w: cw, h }, { ch: b, cx: left, cy: top, w: cw, h: ch }, { ch: c, cx: left, cy: bottom, w: cw, h: ch }];
    return [{ ch: a, cx: 0, cy: top, w, h: ch }, { ch: b, cx: left, cy: bottom, w: cw, h: ch }, { ch: c, cx: right, cy: bottom, w: cw, h: ch }];
  }
  const { cols, rows } = content;
  const cw = ingamCell(w, cols, gapX);
  const ch = ingamCell(h, rows, gapY);
  const cells = cellOrder(chars.length, cols, rows, order).map(({ col, row }, i) => ({
    ch: chars[i], col, row, cx: -w / 2 + col * cw * (1 + gapX) + cw / 2, cy: -h / 2 + row * ch * (1 + gapY) + ch / 2, w: cw, h: ch,
  }));
  if (!cells.length) return cells;
  const vertical = order === 'vertical' && cols > 1;
  const key = vertical ? 'col' : 'row';
  const tail = cells.filter((c) => c[key] === cells[cells.length - 1][key]);
  if (tail.length < (vertical ? rows : cols)) {
    const gap = vertical ? gapY : gapX;
    const size = Math.min(ingamCell(vertical ? h : w, tail.length, gap), (vertical ? ch : cw) * 2);
    const total = size * tail.length + size * gap * (tail.length - 1);
    tail.forEach((c, i) => {
      const p = -total / 2 + i * size * (1 + gap) + size / 2;
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

function drawIngam(o, round) {
  const { lang, chars, text, order = 'horizontal', ink, font, mult = 1 } = o;
  const S = BASE * mult;
  const ko = lang === 'ko';
  const content = ko ? koContent(chars, 'grid', null) : null;
  const lines = ko ? null : sealLines(text);
  const { canvas, ctx, cx, cy } = newCanvas(S, S, S * 0.04, ink);
  ctx.font = fontString(font, MEASURE_PX);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const plan = (lw) => {
    const side = round ? (S / 2 - lw - S * INGAM.circlePad) * Math.SQRT2 : S * (1 - INGAM.inset * 2);
    return ingamCells({ ko, chars, content, lines, order, w: side, h: side });
  };
  // 글자 획 굵기: 칸 크기에 비례(4자 2×2 사각이면 도장의 약 3.4%). 그보다 굵게 늘어난 글자는 가늘게 깎는다.
  // 테 굵기: 실제 글자 획 굵기의 가운데 값 × 0.8 (참고 이미지에서 테는 글자 획보다 조금 가늘다)
  const median = (list) => list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)];
  let lw = S * 0.017;
  let stroke = 0;
  for (let i = 0; i < 2; i++) {
    const cells = plan(lw);
    stroke = clamp(INGAM.stroke * median(cells.map((c) => Math.min(c.w, c.h))), S * 0.014, S * 0.036);
    lw = clamp(median(cells.map((c) => Math.min(stroke, ingamStroke(ctx, c.ch, c.w, c.h, font)))) * INGAM.frame, S * 0.012, S * 0.03);
  }
  if (round) strokeEllipseFrame(ctx, cx, cy, S, S, lw);
  else strokeRectFrame(ctx, cx, cy, S, S, lw, 0);
  for (const c of plan(lw)) drawIngamGlyph(ctx, c.ch, cx + c.cx, cy + c.cy, c.w, c.h, { font, stroke });
  return canvas;
}
