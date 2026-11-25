import { test } from 'node:test';
import assert from 'node:assert/strict';
// stamp-gen.js 를 먼저 불러야 한다: stamp-ring-shape.js 와 서로 가져오므로, 반대 순서면
// STAMP_SHAPES 를 만들 때 RING_SHAPE_SHAPES 가 아직 준비되지 않는다
import { STAMP_SHAPES, STAMP_CATEGORIES, SEAL_CENTERS, renderStamp, usesSealCenter } from '../js/stamp-gen.js';
import {
  RING_SHAPE_SHAPES, RING_SHAPE_DRAW, RING_SHAPE, circleLayout, ringFit, innerFor, polyBand, sideRuns, squareRuns, hexRuns,
  minCellAspect, convexDistance,
} from '../js/stamp-ring-shape.js';
import { ringName } from '../js/stamp-ring-extra.js';
import { stampChars } from '../js/core/text.js';

const IDS = ['ring-rounded-square', 'ring-hexagon', 'ring-octagon', 'ring-gear'];

// ───────────── 모양 목록 ─────────────

test('테 모양 4종: id·special 이 겹치지 않고, 분류는 ring, 이름표는 8자 이하, 가운데 글자 선택지를 쓴다', () => {
  assert.deepEqual(RING_SHAPE_SHAPES.map((s) => s.id), IDS);
  assert.equal(new Set(STAMP_SHAPES.map((s) => s.id)).size, STAMP_SHAPES.length, '전체 목록에서 id 중복');
  const others = STAMP_SHAPES.filter((s) => !RING_SHAPE_SHAPES.includes(s));
  const oldSpecials = new Set(others.map((s) => s.special).filter(Boolean));
  const oldLabels = new Set(others.map((s) => s.label));
  for (const s of RING_SHAPE_SHAPES) {
    assert.equal(s.cat, 'ring', s.id);
    assert.ok(STAMP_CATEGORIES.some((c) => c.id === s.cat));
    assert.ok(s.label && Array.from(s.label).length <= 8, `${s.id}: ${s.label}`);
    assert.ok(!oldLabels.has(s.label), `${s.id}: 이름표가 기존 모양과 겹침`);
    assert.equal(s.special, s.id);
    assert.equal(typeof RING_SHAPE_DRAW[s.special], 'function', `${s.id}: 그리기 함수`);
    assert.ok(!oldSpecials.has(s.special), `${s.id}: 기존 special 과 겹침`);
    assert.ok(STAMP_SHAPES.includes(s), `${s.id}: STAMP_SHAPES 에 없음`);
    assert.ok(usesSealCenter(s), `${s.id}: 직인 가운데 선택지를 따라야 한다`);
  }
  assert.equal(new Set(RING_SHAPE_SHAPES.map((s) => s.label)).size, 4, '이름표 중복');
  assert.deepEqual(Object.keys(RING_SHAPE_DRAW).sort(), [...IDS].sort());
});

// ───────────── 계산 ─────────────

test('squareRuns: 세 자 이하는 변마다 한 번, 그보다 길면 네 변에 이어서 한 번 (좌우 대칭, 남는 글자는 위·아래부터)', () => {
  const ko = (s) => Array.from(s);
  const counts = (s) => squareRuns(ko(s)).map((r) => r.length);
  assert.deepEqual(squareRuns(['이']), [['이'], ['이'], ['이'], ['이']]);
  assert.deepEqual(squareRuns(ko('홍길동')), [0, 1, 2, 3].map(() => ko('홍길동')));
  // [위, 오른쪽, 아래, 왼쪽]: 왼쪽과 오른쪽이 늘 같고, 위가 아래보다 적지 않다
  const expect = {
    회사이름: [1, 1, 1, 1], 한국무역협: [2, 1, 1, 1], 한국무역협회: [2, 1, 2, 1], 한국무역협회장: [2, 2, 1, 2],
    주식회사지혜행정: [2, 2, 2, 2], 가나다라마바사아자: [3, 2, 2, 2], 가나다라마바사아자차: [3, 2, 3, 2],
    가나다라마바사아자차카: [3, 3, 2, 3], 가나다라마바사아자차카타: [3, 3, 3, 3], 가나다라마바사아자차카타파: [4, 3, 3, 3],
    가나다라마바사아자차카타파하: [4, 3, 4, 3],
  };
  for (const [s, c] of Object.entries(expect)) {
    assert.deepEqual(counts(s), c, s);
    assert.equal(squareRuns(ko(s)).flat().join(''), s, `${s}: 시계 방향으로 이어 읽힌다`);
  }
  // 영문 두 낱말은 변마다 한 낱말씩 두 번 (JA | NE | DO | E 처럼 낱말을 자르지 않는다)
  const words = (t) => squareRuns(ringName('en', [], [], t)).map((r) => r.map((u) => u ?? ' ').join(''));
  assert.deepEqual(words('Jane Doe'), ['JANE', 'DOE', 'JANE', 'DOE']);
  assert.deepEqual(words('Kim Lee'), ['KIM', 'LEE', 'KIM', 'LEE']);
  assert.deepEqual(words('A B C D'), ['A', 'B', 'C', 'D']);
  // 긴 두 낱말도 낱말을 자르지 않고 글자를 홀쭉하게 한다
  assert.deepEqual(words('Abcdefg Hijklm'), ['ABCDEFG', 'HIJKLM', 'ABCDEFG', 'HIJKLM']);
  // 세 낱말은 한 번만 자른다
  const acme = words('Acme Holdings Inc');
  assert.equal(acme.join(''), 'ACMEHOLDINGSINC');
  assert.equal(acme.filter((w) => ['ACME', 'HOLDINGS', 'INC'].includes(w)).length, 2, acme.join('|'));
  assert.deepEqual(words('Lee'), ['LEE', 'LEE', 'LEE', 'LEE']);
  // 글자가 세 자 이하면 띄어쓰기 때문에 무게가 3 을 넘어도 변마다 한 번 (네 변에 나눌 수 없다)
  assert.deepEqual(squareRuns(['A', 'B', null, 'C']), [0, 1, 2, 3].map(() => ['A', 'B', null, 'C']));
  assert.deepEqual(squareRuns(ringName('en', [], [], 'J R R')).map((r) => r.length), [5, 5, 5, 5]);
});

test('hexRuns: 여섯 자 이하는 한 변에 한 자(되풀이해 채우고 남는 변은 위·아래부터 비움), 길면 이어서 한 번', () => {
  const show = (runs) => runs.map((r) => r.map((u) => u ?? '·').join(''));
  const ko = (t) => Array.from(t);
  // 육각 [위, 오른쪽 위, 오른쪽 아래, 아래, 왼쪽 아래, 왼쪽 위]
  assert.deepEqual(show(hexRuns(ko('이'))), ['이', '이', '이', '이', '이', '이']);
  assert.deepEqual(show(hexRuns(ko('김지'))), ['김', '지', '김', '지', '김', '지']);
  assert.deepEqual(show(hexRuns(ko('홍길동'))), ['홍', '길', '동', '홍', '길', '동']);
  assert.deepEqual(show(hexRuns(ko('회사이름'))), ['', '회', '사', '', '이', '름'], '빈 위·아래 변');
  assert.deepEqual(show(hexRuns(ko('한국무역협'))), ['', '한', '국', '무', '역', '협'], '빈 위 변');
  assert.deepEqual(show(hexRuns(ko('한국무역협회'))), ['한', '국', '무', '역', '협', '회']);
  // 길면 이어서 한 번: 시계 방향으로 이어 읽히고, 좌우 대칭, 위가 아래보다 적지 않다
  for (const [fn, N] of [[hexRuns, 6]]) {
    for (const t of ['한국무역협회장', '주식회사지혜행정', '가나다라마바사아자차카', '가나다라마바사아자차카타파하']) {
      const runs = fn(ko(t));
      if (Array.from(t).length <= N) continue;
      assert.equal(runs.flat().join(''), t, `${N}각 ${t}`);
      const c = runs.map((r) => r.length);
      for (let k = 1; k < N / 2; k++) assert.equal(c[k], c[N - k], `${N}각 ${t}: 좌우 대칭 ${c}`);
      assert.ok(c[0] >= c[N / 2], `${N}각 ${t}: ${c}`);
      assert.ok(Math.max(...c) - Math.min(...c) <= 1, `${N}각 ${t}: 고르게 ${c}`);
    }
  }
  // 영문 두 낱말: 육각은 빈 위·아래 + 한 변에 한 낱말씩 두 번
  assert.deepEqual(show(hexRuns(ringName('en', [], [], 'Jane Doe'))), ['', 'JANE', 'DOE', '', 'JANE', 'DOE']);
});

test('polyBand: 칸 높이는 hMax 그대로 두고 폭을 줄이며, 이웃 변 끝 칸끼리 모서리에서 glyphGap 을 둔다', () => {
  const S = 400;
  for (const N of [6, 8]) {
    const A = 0.43 * S;
    const hMax = 0.18 * S;
    for (const maxW of [1, 2, 3]) {
      const b = polyBand(N, A, hMax, maxW, S);
      if (b.w >= hMax * RING_SHAPE.condenseKo) assert.equal(b.h, hMax, `${N}각 ${maxW}칸`);
      assert.ok(b.w <= b.pitch - S * RING_SHAPE.glyphGap + 1e-9);
      // 가장 끝 칸의 안쪽 모서리 (x = xLim, 변심거리 mid - h/2) 와 모서리 이등분선 사이가 glyphGap/2 이상
      const half = Math.PI / N;
      const dIn = b.mid - b.h / 2;
      const end = (maxW * b.pitch) / 2;
      assert.ok(end <= b.xLim + 1e-9);
      const toBisector = dIn * Math.sin(half) - end * Math.cos(half);
      assert.ok(toBisector >= (S * RING_SHAPE.glyphGap) / 2 - 1e-9, `${N}각 ${maxW}칸: ${toBisector}`);
    }
  }
  // 한글은 칸 폭/높이를 0.42 까지, 라틴 글자만이면 0.3 까지 줄인다
  assert.equal(minCellAspect(['가', 'A']), RING_SHAPE.condenseKo);
  assert.equal(minCellAspect(['A', null, 'B']), RING_SHAPE.condenseLatin);
  assert.deepEqual(sideRuns(['A', 'B', 'C', 'D'], 4, { cell: () => ({ w: 0.1, h: 0.18 }) }).map((r) => r.join('')), ['A', 'B', 'C', 'D']);
});

test('circleLayout: 칸 바깥 모서리는 outer 원 안, 안쪽 끝은 inner 바깥, 이웃 칸은 겹치지 않는다', () => {
  const S = 400;
  for (const n of [1, 2, 3, 4, 5, 6, 8, 10, 14, 20]) {
    const inner = 100;
    const outer = 165;
    const L = circleLayout(n, inner, outer, S);
    assert.ok(L.cellW > 0 && L.cellH > 0);
    assert.ok(L.mid - L.cellH / 2 >= inner - 1e-9, `n=${n}: 안쪽 끝`);
    assert.ok(Math.hypot(L.mid + L.cellH / 2, L.cellW / 2) <= outer + 1e-9, `n=${n}: 바깥 모서리`);
    assert.ok(L.cellW <= L.cellH * RING_SHAPE.aspect + 1e-9);
    // 이웃 칸 안쪽 모서리 사이 (반지름 mid - h/2, 각도 step)
    const ri = L.mid - L.cellH / 2;
    const chord = 2 * ri * Math.sin(L.step / 2);
    if (n > 1) assert.ok(chord - L.cellW * Math.cos(L.step / 2) >= S * RING_SHAPE.glyphGap * 0.99, `n=${n}: 이웃 칸`);
  }
});

test('ringFit: 폭을 줄여 열다섯 칸까지 기본 자리에서 hMax, 그보다 많아 폭이 한도에 닿으면 둘레를 바깥으로 옮겨 칸을 키운다', () => {
  const S = 400;
  const outer = 0.424 * S;
  const hMax = 0.18 * S;
  const inner0 = innerFor(outer, hMax, 0.85);
  const C = { hMax, aspect: 0.85, minAspect: RING_SHAPE.condenseKo };
  for (const n of [3, 4, 6, 9, 12, 15]) {
    const L = ringFit(n, inner0, outer, S, C);
    assert.ok(Math.abs(L.cellH - hMax) < 1e-6 && Math.abs(L.inner - inner0) < 1e-9, `n=${n}: ${L.cellH}`);
    assert.ok(L.cellW >= L.cellH * RING_SHAPE.condenseKo - 1e-9);
  }
  const long = ringFit(28, inner0, outer, S, C);
  const fixed = circleLayout(28, inner0, outer, S, C);
  assert.ok(long.inner > inner0 && long.cellH > fixed.cellH * 1.05, `${long.cellH} vs ${fixed.cellH}`);
  assert.ok(Math.hypot(long.mid + long.cellH / 2, long.cellW / 2) <= outer + 1e-9);
  assert.ok(long.mid - long.cellH / 2 >= long.inner - 1e-9);
});

test('convexDistance: 떨어진 거리, 겹침, 엇갈림', () => {
  const sq = (x, y, s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
  assert.equal(convexDistance(sq(0, 0, 1), sq(3, 0, 1)), 2);
  assert.equal(convexDistance(sq(0, 0, 2), sq(1, 1, 2)), 0);
  const plus = [{ x: -1, y: 0.4 }, { x: 3, y: 0.4 }, { x: 3, y: 0.6 }, { x: -1, y: 0.6 }];
  assert.equal(convexDistance(sq(0, 0, 1), plus), 0);
});

// ───────────── 가짜 canvas 로 그려 보기 ─────────────
// Node 에는 canvas 가 없어서, 변환 행렬을 따라가며 그린 것을 기록하는 가짜 2D 문맥을 쓴다.
// 글자는 drawFittedGlyph 가 경계 상자를 칸에 꽉 채우므로, 기록한 글자 상자가 곧 잉크가 닿을 수 있는 범위다.
// 선·면은 꺾은선으로 기록하고(호는 촘촘히 나눠서), 글자 상자와의 실제 거리를 잰다

class FakeCtx {
  constructor(canvas) {
    this.canvas = canvas;
    this.m = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.font = '10px sans-serif';
    this.lineWidth = 1;
    this.lineJoin = 'miter';
    this.textAlign = 'start';
    this.textBaseline = 'alphabetic';
    this.globalCompositeOperation = 'source-over';
    this.globalAlpha = 1;
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.marks = [];
    this.subs = [];
  }
  save() { this.stack.push([[...this.m], this.font, this.lineWidth, this.textAlign]); }
  restore() { [this.m, this.font, this.lineWidth, this.textAlign] = this.stack.pop(); }
  translate(x, y) { const [a, b, c, d, e, f] = this.m; this.m = [a, b, c, d, a * x + c * y + e, b * x + d * y + f]; }
  rotate(t) { const [a, b, c, d, e, f] = this.m; const cs = Math.cos(t); const sn = Math.sin(t); this.m = [a * cs + c * sn, b * cs + d * sn, c * cs - a * sn, d * cs - b * sn, e, f]; }
  scale(x, y) { const [a, b, c, d, e, f] = this.m; this.m = [a * x, b * x, c * y, d * y, e, f]; }
  pt(x, y) { const [a, b, c, d, e, f] = this.m; return { x: a * x + c * y + e, y: b * x + d * y + f }; }
  px() { return Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 10); }
  measureText(t) {
    const px = this.px();
    const w = Array.from(t).reduce((s, ch) => s + px * (/[가-힣一-鿿]/.test(ch) ? 0.95 : /[A-Z0-9]/.test(ch) ? 0.68 : 0.36), 0);
    return { width: w, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w * 0.96, actualBoundingBoxAscent: px * 0.8, actualBoundingBoxDescent: px * 0.08 };
  }
  fillText(t, x, y) {
    const m = this.measureText(t);
    const x0 = this.textAlign === 'center' ? x - m.width / 2 : x;
    const box = [[x0, y - m.actualBoundingBoxAscent], [x0 + m.actualBoundingBoxRight, y - m.actualBoundingBoxAscent], [x0 + m.actualBoundingBoxRight, y + m.actualBoundingBoxDescent], [x0, y + m.actualBoundingBoxDescent]];
    this.marks.push({ type: 'glyph', text: t, pts: box.map(([px, py]) => this.pt(px, py)) });
  }
  beginPath() { this.subs = []; }
  cur() { if (!this.subs.length) this.subs.push({ pts: [], closed: false }); return this.subs.at(-1); }
  moveTo(x, y) { this.subs.push({ pts: [this.pt(x, y)], closed: false }); }
  lineTo(x, y) { this.cur().pts.push(this.pt(x, y)); }
  closePath() { if (this.subs.length) this.cur().closed = true; }
  rect(x, y, w, h) { this.subs.push({ pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => this.pt(a, b)), closed: true }); }
  arc(x, y, r, a0, a1, ccw = false) {
    if (r < 0) throw new Error('IndexSizeError: 반지름이 음수');
    let sweep = a1 - a0;
    if (!ccw && sweep < 0) sweep += Math.PI * 2;
    if (ccw && sweep > 0) sweep -= Math.PI * 2;
    if (Math.abs(a1 - a0) >= Math.PI * 2 - 1e-9) sweep = ccw ? -Math.PI * 2 : Math.PI * 2;
    const n = Math.max(2, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * 360));
    const sub = this.cur();
    for (let i = 0; i <= n; i++) {
      const t = a0 + (sweep * i) / n;
      sub.pts.push(this.pt(x + Math.cos(t) * r, y + Math.sin(t) * r));
    }
  }
  ellipse() { throw new Error('ellipse 는 쓰지 않는다'); }
  arcTo() { throw new Error('arcTo 는 쓰지 않는다 (둥근 모서리는 arc 로)'); }
  fill() { this.marks.push({ type: 'fill', subs: this.subs.map((s) => ({ ...s, pts: [...s.pts] })) }); }
  stroke() { this.marks.push({ type: 'stroke', lw: this.lineWidth, subs: this.subs.map((s) => ({ ...s, pts: [...s.pts] })) }); }
  setLineDash() {}
  fillRect() {}
  clearRect() {}
  drawImage() { this.marks.push({ type: 'image' }); }
  getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; }
  putImageData() {}
  createRadialGradient() { return { addColorStop() {} }; }
}

globalThis.document = {
  createElement: () => {
    const canvas = { width: 300, height: 150 };
    canvas.getContext = () => (canvas.ctx ??= new FakeCtx(canvas));
    return canvas;
  },
};

function segments(sub) {
  const out = [];
  for (let i = 1; i < sub.pts.length; i++) out.push([sub.pts[i - 1], sub.pts[i]]);
  if (sub.closed && sub.pts.length > 2) out.push([sub.pts.at(-1), sub.pts[0]]);
  if (sub.pts.length === 1) out.push([sub.pts[0], sub.pts[0]]);
  return out;
}

function pointSeg(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
}
function inside(p, quad) {
  let sign = 0;
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % quad.length];
    const c = Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    if (!c) continue;
    if (!sign) sign = c;
    else if (c !== sign) return false;
  }
  return true;
}
function cross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
/** 선분과 볼록 사각형 사이 거리 (닿거나 안에 있으면 0) */
function segQuad([a, b], quad) {
  if (inside(a, quad) || inside(b, quad)) return 0;
  let d = Math.min(...quad.map((q) => pointSeg(q, a, b)));
  for (let i = 0; i < 4; i++) {
    const p = quad[i];
    const q = quad[(i + 1) % 4];
    if (cross(a, b, p, q)) return 0;
    d = Math.min(d, pointSeg(a, p, q), pointSeg(b, p, q));
  }
  return d;
}
function quadsOverlap(A, B) {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      const b = P[(i + 1) % P.length];
      const nx = a.y - b.y;
      const ny = b.x - a.x;
      const pa = A.map((p) => p.x * nx + p.y * ny);
      const pb = B.map((p) => p.x * nx + p.y * ny);
      if (Math.max(...pa) <= Math.min(...pb) + 1e-9 || Math.max(...pb) <= Math.min(...pa) + 1e-9) return false;
    }
  }
  return true;
}

/**
 * 그린 결과 검사: 캔버스 안, 글자끼리 겹치지 않음, 그리고 글자 상자와 모든 선(선 굵기 절반을 뺀 가장자리)·면(꾸밈) 사이 여백 ≥ need.
 * 가장 좁은 여백(px)을 돌려준다
 */
function inspect(canvas, label, need) {
  const ctx = canvas.ctx;
  assert.ok(ctx, `${label}: 그리지 않음`);
  const glyphs = ctx.marks.filter((m) => m.type === 'glyph');
  assert.ok(glyphs.length > 0, `${label}: 글자 없음`);
  const tol = 0.5;
  const inCanvas = (p, pad = 0) => p.x - pad >= -tol && p.y - pad >= -tol && p.x + pad <= canvas.width + tol && p.y + pad <= canvas.height + tol;
  for (const g of glyphs) assert.ok(g.pts.every((p) => inCanvas(p)), `${label}: 글자 '${g.text}' 가 캔버스 밖`);
  const strokes = ctx.marks.filter((m) => m.type === 'stroke');
  const fills = ctx.marks.filter((m) => m.type === 'fill');
  assert.ok(strokes.length > 0, `${label}: 선 없음`);
  for (const m of [...strokes, ...fills]) {
    const lw = m.lw ?? 0;
    // 꺾인 선(마이터)의 바깥 꼭짓점은 굵기 절반보다 더 나가므로 넉넉히 본다
    for (const s of m.subs) for (const p of s.pts) assert.ok(inCanvas(p, lw * 0.6), `${label}: 선·면이 캔버스 밖 ${JSON.stringify(p)}`);
  }
  let least = Infinity;
  for (let i = 0; i < glyphs.length; i++) {
    const G = glyphs[i].pts;
    for (let j = i + 1; j < glyphs.length; j++) {
      assert.ok(!quadsOverlap(G, glyphs[j].pts), `${label}: 글자 '${glyphs[i].text}'(${i}) 와 '${glyphs[j].text}'(${j}) 가 겹침`);
    }
    for (const m of strokes) {
      for (const s of m.subs) {
        for (const seg of segments(s)) {
          const d = segQuad(seg, G) - m.lw / 2;
          least = Math.min(least, d);
          assert.ok(d >= need, `${label}: 글자 '${glyphs[i].text}' 와 선(굵기 ${m.lw.toFixed(1)}) 사이 ${d.toFixed(1)}px < ${need.toFixed(1)}px`);
        }
      }
    }
    for (const m of fills) {
      for (const s of m.subs) {
        for (const seg of segments(s)) {
          const d = segQuad(seg, G);
          least = Math.min(least, d);
          assert.ok(d >= need, `${label}: 글자 '${glyphs[i].text}' 와 꾸밈(점·별·◆·톱니) 사이 ${d.toFixed(1)}px < ${need.toFixed(1)}px`);
        }
      }
    }
  }
  return { glyphs, least };
}

test('검사 도구: 겹친 글자, 선·꾸밈에 가까운 글자, 캔버스 밖을 잡아낸다', () => {
  const make = (draw) => {
    const c = document.createElement('canvas');
    c.width = 100;
    c.height = 100;
    const ctx = c.getContext('2d');
    ctx.font = '20px x';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(50, 50, 45, 0, Math.PI * 2);
    ctx.stroke();
    draw(ctx);
    return c;
  };
  assert.doesNotThrow(() => inspect(make((ctx) => { ctx.fillText('가', 30, 55); ctx.fillText('나', 52, 55); }), 'ok', 5));
  assert.throws(() => inspect(make((ctx) => { ctx.fillText('가', 30, 55); ctx.fillText('나', 40, 57); }), 'x', 5), /겹침/);
  assert.throws(() => inspect(make((ctx) => ctx.fillText('가', 72, 55)), 'x', 5), /선\(굵기/);
  assert.throws(() => inspect(make((ctx) => ctx.fillText('가', 95, 55)), 'x', 0), /캔버스 밖/);
  assert.throws(() => inspect(make((ctx) => { ctx.fillText('가', 40, 55); ctx.beginPath(); ctx.arc(62, 48, 2, 0, Math.PI * 2); ctx.fill(); }), 'x', 5), /꾸밈/);
  // 꾸밈이 글자 상자 안에 통째로 들어가도 잡는다
  assert.throws(() => inspect(make((ctx) => { ctx.fillText('가', 40, 55); ctx.beginPath(); ctx.arc(48, 48, 1, 0, Math.PI * 2); ctx.fill(); }), 'x', 1), /꾸밈/);
});

const KO_FONT = { family: 'Nanum Myeongjo', weight: 800, label: '나눔명조' };
const EN_FONT = { family: 'Cinzel', weight: 700, label: 'Cinzel' };
const NAMES = [
  ['ko', '이'], ['ko', '김지'], ['ko', '홍길동'], ['ko', '김지혜'], ['ko', '회사이름'], ['ko', '한국무역협'], ['ko', '한국무역협회'],
  ['ko', '주식회사지혜행정'], ['ko', '가나다라마바사아자차카타파하'], ['ko', '홍길동ABC'],
  ['en', 'A'], ['en', 'Lee'], ['en', 'J R R'], ['en', 'Jane Doe'], ['en', 'Acme Holdings Inc'], ['en', 'Abcdefg Hijklm'],
];
const shapeOf = (id) => RING_SHAPE_SHAPES.find((s) => s.id === id);

function render(shape, lang, name, extra = {}) {
  const chars = stampChars(name, { addIn: extra.addIn ?? false, lang });
  const baseChars = stampChars(name, { addIn: false, lang });
  return renderStamp({
    lang, chars, baseChars, text: name, shape, font: lang === 'ko' ? KO_FONT : EN_FONT, order: 'horizontal', ink: '#c8102e',
    date: '2026.11.22', dateLabel: '', sealCenter: 'daepyo-hanja', mult: 1, ...extra,
  });
}

test('4종 모두: 이름 길이·인·읽는 순서·가운데 선택지·배율마다 글자와 테·선·꾸밈 사이 여백이 0.034S 이상', () => {
  let n = 0;
  const least = {};
  for (const shape of RING_SHAPE_SHAPES) {
    for (const [lang, name] of NAMES) {
      for (const sealCenter of SEAL_CENTERS.map((c) => c.id)) {
        for (const order of ['horizontal', 'vertical']) {
          for (const addIn of lang === 'ko' ? [false, true] : [false]) {
            for (const mult of [1, 2.5]) {
              const label = `${shape.id} ${name} ${sealCenter} ${order}${addIn ? ' +인' : ''} x${mult}`;
              const S = 400 * mult;
              // 요구: 글자 잉크와 모든 선·꾸밈 사이 흰 여백 0.034S (RING_SHAPE.gap). 0.05px 은 가짜 canvas 가 원을
              // 360 개 현으로 나눈 오차 (톱니 고리 안쪽처럼 글자 쪽으로 오목한 원은 현이 원보다 최대 0.017px 가깝다)
              const need = RING_SHAPE.gap * S - 0.05;
              const { glyphs, least: l } = inspect(render(shape, lang, name, { sealCenter, order, addIn, mult }), label, need);
              least[shape.id] = Math.min(least[shape.id] ?? Infinity, l / S);
              n++;
              // 둘레에는 이름 글자가 모두 있다 ('인'은 가운데 '이름' 선택지일 때만 더해진다)
              const drawn = glyphs.map((g) => g.text).join('');
              for (const ch of ringName(lang, [], stampChars(name, { lang }), name).filter(Boolean)) assert.ok(drawn.includes(ch), `${label}: '${ch}' 없음`);
            }
          }
        }
      }
    }
  }
  assert.ok(n > 1500, String(n));
  // 가장 좁은 여백도 RING_SHAPE.gap 이다 (S 배수)
  for (const id of IDS) assert.ok(least[id] >= RING_SHAPE.gap - 1e-4, `${id}: ${least[id]}`);
});

test('4종 모두: 배율 2.5 는 같은 배치를 2.5배로, 질감·번짐·회전도 오류 없이', () => {
  for (const shape of RING_SHAPE_SHAPES) {
    for (const [lang, name] of NAMES) {
      const a = render(shape, lang, name);
      const b = render(shape, lang, name, { mult: 2.5 });
      assert.ok(Math.abs(b.width / a.width - 2.5) < 0.02 && Math.abs(b.height / a.height - 2.5) < 0.02, `${shape.id}: ${a.width}→${b.width}`);
      const ga = a.ctx.marks.filter((m) => m.type === 'glyph');
      const gb = b.ctx.marks.filter((m) => m.type === 'glyph');
      assert.equal(ga.length, gb.length, `${shape.id} ${name}: 배율에 따라 글자 수가 바뀜`);
      ga.forEach((g, i) => {
        const p = g.pts[0];
        const q = gb[i].pts[0];
        assert.ok(Math.abs(q.x - (p.x - a.width / 2) * 2.5 - b.width / 2) < 2 && Math.abs(q.y - (p.y - a.height / 2) * 2.5 - b.height / 2) < 2, `${shape.id} ${name}: 배치가 다름`);
      });
      for (const ink of ['#c8102e', '#1a3a8f', '#000000']) {
        const fx = render(shape, lang, name, { texture: true, bleed: true, rotation: -8, ink });
        assert.ok(fx.width > a.width && fx.height > a.height, `${shape.id}: 회전한 캔버스가 커지지 않음`);
      }
    }
  }
});

/** 둘레 글자(가운데에서 0.22S 넘게 떨어진 글자) 상자의 높이(글자 머리 방향)·폭, S 배수 */
function ringBoxes(canvas, S) {
  return canvas.ctx.marks.filter((m) => m.type === 'glyph').flatMap((g) => {
    const c = g.pts.reduce((t, p) => ({ x: t.x + p.x / 4, y: t.y + p.y / 4 }), { x: 0, y: 0 });
    if (Math.hypot(c.x - canvas.width / 2, c.y - canvas.height / 2) <= 0.22 * S) return [];
    return [{ h: Math.hypot(g.pts[0].x - g.pts[3].x, g.pts[0].y - g.pts[3].y) / S, w: Math.hypot(g.pts[2].x - g.pts[3].x, g.pts[2].y - g.pts[3].y) / S }];
  });
}

test('둘레 글자 높이: 4종 모두 열네 자까지(영문 열다섯 자도) 0.18S. 글자가 많으면 높이는 두고 폭을 줄인다', () => {
  for (const shape of RING_SHAPE_SHAPES) {
    for (const [lang, name] of [...NAMES, ['ko', '가나다라마바사아자차카타'], ['ko', '가나다라마바사아자차카타파']]) {
      for (const mult of [1, 2.5]) {
        const S = 400 * mult;
        const boxes = ringBoxes(render(shape, lang, name, { mult, sealCenter: 'jikin' }), S);
        assert.ok(boxes.length > 0, `${shape.id} ${name}`);
        const h = Math.min(...boxes.map((b) => b.h));
        // 요구: 한글 열네 자까지 0.17S 이상, 영문 열일곱 칸 이상도 0.15S 이상. 실제로는 모두 0.18S
        assert.ok(h >= 0.18 - 1e-6, `${shape.id} ${name} x${mult}: ${h.toFixed(3)}S`);
        // 폭은 줄어도 한글 0.42·라틴 0.3 배 아래로는 가지 않는다
        const ko = /[가-힣]/.test(name);
        const aspect = Math.min(...boxes.map((b) => b.w / b.h));
        assert.ok(aspect >= (ko ? RING_SHAPE.condenseKo : RING_SHAPE.condenseLatin) - 1e-6, `${shape.id} ${name}: 폭/높이 ${aspect.toFixed(2)}`);
      }
    }
  }
});

/** 가운데 글자가 쓸 수 있는 원의 반지름 (S 배수): 가운데 틀(가장 안쪽 선)의 안쪽 끝에서 gap 을 뺀다 */
function centerRadius(canvas, S, sides = 0) {
  const strokes = canvas.ctx.marks.filter((m) => m.type === 'stroke');
  const c = { x: canvas.width / 2, y: canvas.height / 2 };
  const reach = (m) => Math.max(...m.subs[0].pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
  const inner = strokes.reduce((a, m) => (reach(m) < reach(a) ? m : a));
  const R = reach(inner) * (sides ? Math.cos(Math.PI / sides) : 1); // 다각형은 변심거리
  return (R - inner.lw / 2) / S - RING_SHAPE.gap;
}

test('가운데 글자 원: 육각은 둘레글자 원 이상, 팔각 0.153S·톱니 0.158S 이상 (모든 이름 길이·배율)', () => {
  // 둘레글자 원: drawSealCenter 가 가운데 원(반지름 0.215S, 굵기 0.017S) 안쪽 끝의 0.9 배 원 안에 쓴다
  const ringCenter = 0.9 * (0.215 - 0.017 / 2);
  const want = { 'ring-hexagon': [ringCenter, 0], 'ring-octagon': [0.153, 0], 'ring-gear': [0.158, 0], 'ring-rounded-square': [0.17, 0] };
  for (const shape of RING_SHAPE_SHAPES) {
    const [min, sides] = want[shape.id];
    for (const [lang, name] of NAMES) {
      for (const mult of [1, 2.5]) {
        const S = 400 * mult;
        const r = centerRadius(render(shape, lang, name, { mult }), S, sides);
        assert.ok(r >= min - 1e-6, `${shape.id} ${name} x${mult}: ${r.toFixed(4)}S < ${min.toFixed(4)}S`);
      }
    }
  }
});

test('캔버스: 육각은 윗변이 평평하고 변심거리 S/2 (높이 S, 폭 2S/√3 ≈ 1.155S), 나머지는 정사각 S', () => {
  for (const mult of [1, 2.5]) {
    const S = 400 * mult;
    const ref = render(shapeOf('ring-gear'), 'ko', '홍길동', { mult });
    const pad = (ref.width - S) / 2;
    for (const shape of RING_SHAPE_SHAPES) {
      const c = render(shape, 'ko', '홍길동', { mult });
      if (shape.id !== 'ring-hexagon') {
        assert.equal(c.width, c.height, shape.id);
        assert.equal(c.width, ref.width, shape.id);
        continue;
      }
      assert.equal(c.height, ref.height, '육각 캔버스 높이 = 다른 도장 캔버스 높이');
      assert.ok(Math.abs(c.width - ((2 * S) / Math.sqrt(3) + pad * 2)) <= 1, `${c.width}x${c.height}`);
      // 테 바깥 끝 상자: 첫 선(굵은 육각)의 꼭짓점 + 마이터 꼭짓점까지 나간 굵기
      const rim = c.ctx.marks.find((m) => m.type === 'stroke');
      const pts = rim.subs[0].pts;
      assert.equal(pts.length, 6);
      const xs = pts.map((p) => p.x - c.width / 2);
      const ys = pts.map((p) => p.y - c.height / 2);
      const w = Math.max(...xs) - Math.min(...xs) + rim.lw / Math.cos(Math.PI / 6);
      const h = Math.max(...ys) - Math.min(...ys) + rim.lw;
      assert.ok(Math.abs(h - S) < 0.01, `육각 높이 ${h} ≠ S ${S}`);
      assert.ok(Math.abs(w - (2 * S) / Math.sqrt(3)) < 0.01, `육각 폭 ${w}`);
      // 윗변이 평평하다: 맨 위 두 꼭짓점의 y 가 같다
      const top = [...ys].sort((a, b) => a - b);
      assert.ok(Math.abs(top[0] - top[1]) < 1e-6);
    }
  }
});

test('모양마다 꾸밈이 다르다: 둥근 사각 ◆ 4개, 육각 구석 점 6개 + 빈 변 ●, 팔각 구석 점 8개 + 맨 위 ★, 톱니 맨 위 ★', () => {
  const fills = (id, name = '회사이름', sealCenter = 'jikin') => render(shapeOf(id), 'ko', name, { sealCenter }).ctx.marks.filter((m) => m.type === 'fill');
  const discs = (list) => list.filter((m) => m.subs[0].pts.length > 300);
  const stars = (list) => list.filter((m) => m.subs[0].pts.length === 10);
  // ◆ 는 꼭짓점 4개짜리 닫힌 다각형
  assert.equal(fills('ring-rounded-square').filter((m) => m.subs.length === 1 && m.subs[0].pts.length === 4).length, 4);
  // 육각: 구석 점 6개 + 빈 변(회사이름은 위·아래) ●
  assert.equal(discs(fills('ring-hexagon')).length, 8);
  assert.equal(discs(fills('ring-hexagon', '한국무역협회')).length, 6, '빈 변이 없으면 구석 점만');
  // 팔각: 여덟 모서리 구석에 점, 맨 위 ★ (네 자 이름은 되풀이 점이 없다)
  assert.equal(discs(fills('ring-octagon')).length, 8);
  // 팔각·톱니: 맨 위 ★ 하나
  for (const id of ['ring-octagon', 'ring-gear']) {
    const st = stars(fills(id));
    assert.equal(st.length, 1, id);
    const c = render(shapeOf(id), 'ko', '회사이름');
    const top = st[0].subs[0].pts.reduce((t, p) => ({ x: t.x + p.x / 10, y: t.y + p.y / 10 }), { x: 0, y: 0 });
    assert.ok(Math.abs(top.x - c.width / 2) < 1 && top.y < c.height / 2, `${id}: 별이 맨 위가 아님`);
  }
  // 톱니 테는 톱니 36개 (사다리꼴 꼭짓점 4개씩) + 가운데 구멍
  const gear = fills('ring-gear').find((m) => m.subs.length === 2);
  assert.equal(gear.subs[0].pts.length, 36 * 4);
});

test('짧은 이름: 육각은 한 변에 한 자씩 되풀이, 팔각·톱니는 둘레글자 원처럼(ringUnits), 둥근 사각은 변마다 한 벌', () => {
  const text = (id, name, extra = {}) => render(shapeOf(id), 'ko', name, { sealCenter: 'star', ...extra }).ctx.marks.filter((m) => m.type === 'glyph').map((g) => g.text).join('');
  assert.equal(text('ring-hexagon', '김지'), '김지김지김지');
  assert.equal(text('ring-octagon', '김지'), '김지김지');
  assert.equal(text('ring-octagon', '이'), '이이', '팔각 한 자 이름은 둘레글자 원처럼 두 번 (점 두 개)');
  assert.equal(text('ring-octagon', '회사이름'), '회사이름');
  assert.equal(text('ring-gear', '김지'), '김지김지');
  assert.equal(text('ring-rounded-square', '김지'), '김지김지김지김지');
  // 인을 붙여도 둘레는 이름만, 가운데 '이름' 선택지에만 인이 들어간다
  assert.equal(text('ring-gear', '홍길동', { addIn: true, sealCenter: 'name' }), '홍길동홍길동인');
});

test('팔각: 이름을 원 둘레에 고르게 이어 쓴다 (영문은 낱말이 그대로 이어지고 띄어쓰기는 점, 긴 이름도 칸 간격이 같다)', () => {
  for (const [lang, name] of [['en', 'Acme Holdings Inc'], ['en', 'Jane Doe'], ['ko', '가나다라마바사아자차카타파하'], ['ko', '가나다라마바사아자차카타']]) {
    const c = render(shapeOf('ring-octagon'), lang, name, { sealCenter: 'star' });
    const glyphs = c.ctx.marks.filter((m) => m.type === 'glyph');
    assert.equal(glyphs.map((g) => g.text).join(''), name.toUpperCase().replace(/\s/g, ''), `${name}: 시계 방향으로 이어 읽힌다`);
    // 글자 칸 가운데의 각도 간격이 모두 같다 (띄어쓰기 점 자리는 한 칸)
    const ang = glyphs.map((g) => {
      const m = g.pts.reduce((t, p) => ({ x: t.x + p.x / 4, y: t.y + p.y / 4 }), { x: 0, y: 0 });
      return Math.atan2(m.x - c.width / 2, -(m.y - c.height / 2));
    });
    const units = ringName(lang, [], stampChars(name, { lang }), name);
    const step = (2 * Math.PI) / (units.length + 1);
    const at = units.flatMap((u, i) => (u === null ? [] : [i]));
    for (let i = 1; i < ang.length; i++) {
      const d = (((ang[i] - ang[i - 1]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      assert.ok(Math.abs(d - step * (at[i] - at[i - 1])) < 1e-6, `${name}: ${i} 번째 간격 ${d} ≠ ${step * (at[i] - at[i - 1])}`);
    }
    // 띄어쓰기 자리에는 점
    const dots = c.ctx.marks.filter((m) => m.type === 'fill' && m.subs[0].pts.length > 300);
    assert.equal(dots.length, 8 + units.filter((u) => u === null).length, `${name}: 구석 점 8 + 띄어쓰기 점`);
  }
});
