import { test } from 'node:test';
import assert from 'node:assert/strict';
// stamp-gen.js 를 먼저 불러야 한다: 확장 모듈과 서로 가져오므로, 반대 순서면
// STAMP_SHAPES 를 만들 때 RING_DECO_SHAPES 가 아직 준비되지 않는다
import { STAMP_SHAPES, STAMP_CATEGORIES, SEAL_CENTERS, renderStamp, usesSealCenter, drawSealCenter } from '../js/stamp-gen.js';
import {
  RING_DECO_SHAPES, RING_DECO_DRAW, RING_DECO, ringLayout, barEnd, nearestAbsX, cellCorners, centerExtent, rimStars, underStarPlan, erosionFor,
} from '../js/stamp-ring-deco.js';
import { ringName } from '../js/stamp-ring-extra.js';
import { stampChars } from '../js/core/text.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const IDS = ['ring-star-bars', 'ring-dotted-single', 'ring-inverted-full', 'ring-star-band'];
const byId = (id) => RING_DECO_SHAPES.find((s) => s.id === id);

// ───────────── 모양 목록 ─────────────

test('둘레글자 꾸밈 4종: id·special 이 겹치지 않고, 분류는 ring, 이름표는 8자 이하, 목록 끝에 붙는다', () => {
  assert.deepEqual(RING_DECO_SHAPES.map((s) => s.id), IDS);
  assert.equal(new Set(STAMP_SHAPES.map((s) => s.id)).size, STAMP_SHAPES.length, '전체 목록에서 id 중복');
  assert.equal(new Set(STAMP_SHAPES.map((s) => s.label)).size, STAMP_SHAPES.length, '전체 목록에서 이름표 중복');
  const others = STAMP_SHAPES.filter((s) => !RING_DECO_SHAPES.includes(s));
  const oldSpecials = new Set(others.map((s) => s.special).filter(Boolean));
  for (const s of RING_DECO_SHAPES) {
    assert.equal(s.cat, 'ring', s.id);
    assert.ok(STAMP_CATEGORIES.some((c) => c.id === s.cat));
    assert.ok(s.label && Array.from(s.label).length <= 8, `${s.id}: ${s.label}`);
    assert.equal(s.special, s.id);
    assert.equal(typeof RING_DECO_DRAW[s.special], 'function', `${s.id}: 그리기 함수`);
    assert.ok(!oldSpecials.has(s.special), `${s.id}: 기존 special 과 겹침`);
    // 가운데 글자 선택지(직인 가운데)를 따른다: app.js 가 이 표시로 한자 글꼴을 미리 받는다
    assert.equal(s.sealCenter, true, s.id);
    assert.ok(usesSealCenter(s), s.id);
  }
  assert.equal(Object.keys(RING_DECO_DRAW).length, 4);
  // 새 모양은 목록 끝에 붙어 앞 모양들의 추천 글꼴 순번이 바뀌지 않는다
  assert.deepEqual(STAMP_SHAPES.slice(-4), RING_DECO_SHAPES);
  // 흰 글자·흰 별을 지우는 두 모양은 번짐을 스스로 처리한다 (지우기 전에 번지게)
  assert.deepEqual(RING_DECO_SHAPES.filter((s) => s.selfBleed).map((s) => s.id), ['ring-inverted-full', 'ring-star-band']);
});

// ───────────── 계산 ─────────────

test('ringLayout: 칸 안쪽 변은 안쪽 선에서 gapIn, 바깥 모서리는 바깥 선에서 gapOut, 이웃 칸은 apart 떨어진다', () => {
  for (const n of [3, 4, 5, 6, 8, 9, 12, 14, 16]) {
    for (const [inner, outer] of [[90, 180], [100, 150], [60, 190]]) {
      const opt = { inner, outer, gapIn: 11, gapOut: 14, apart: 5 };
      const L = ringLayout(n, opt);
      const label = `n=${n} ${inner}-${outer}`;
      assert.ok(L.cellH > 0 && L.cellW > 0, label);
      assert.ok(L.mid - L.cellH / 2 >= inner + opt.gapIn - 1e-9, `${label}: 안쪽 여백`);
      assert.ok(Math.hypot(L.mid + L.cellH / 2, L.cellW / 2) <= outer - opt.gapOut + 1e-9, `${label}: 바깥 모서리 여백`);
      assert.ok(L.cellW <= L.cellH * 1.15 + 1e-9, `${label}: 칸 폭`);
      // 맨 위 표시 자리: 다섯 칸 이상이면 한 칸
      assert.ok(close(L.step, (Math.PI * 2) / (n + (n >= 5 ? 1 : 0))), label);
      assert.ok(close(L.first, n >= 5 ? L.step : L.step / 2), label);
      // 이웃 칸 안쪽 모서리 사이
      const A = cellCorners(0, -L.mid, -Math.PI / 2, L.cellW, L.cellH);
      const t = -Math.PI / 2 + L.step;
      const B = cellCorners(Math.cos(t) * L.mid, Math.sin(t) * L.mid, t, L.cellW, L.cellH);
      assert.ok(polyDistance(A, B) >= opt.apart - 1e-6, `${label}: 이웃 칸 ${polyDistance(A, B)}`);
    }
  }
  // 띠가 넓으면 칸 높이는 hMax 까지
  assert.ok(close(ringLayout(3, { inner: 500, outer: 1000, gapIn: 10, hMax: 50 }).cellH, 50));
});

test('barEnd · nearestAbsX · cellCorners · rimStars · underStarPlan · erosionFor', () => {
  // 가로선 끝 모서리가 반지름 inner - gap 안에, x1 을 넘지 않게
  const x = barEnd(120, 11, 6, 200);
  assert.ok(close(Math.hypot(x, 3), 109));
  assert.equal(barEnd(120, 11, 6, 90), 90);
  // 가로 띠에 걸친 다각형 부분의 가장 작은 |x|
  const sq = [[30, 0], [50, 0], [50, 20], [30, 20]];
  assert.equal(nearestAbsX([sq], 5, 10), 30);
  assert.equal(nearestAbsX([sq], 30, 40), Infinity);
  const tilted = [[30, 0], [50, -10], [60, 20], [40, 30]];
  assert.ok(close(nearestAbsX([tilted], 20, 40), 30 + (40 - 30) * (2 / 3)), '변을 띠 안으로 잘라 잰다');
  assert.equal(nearestAbsX([[[-10, 0], [10, 0], [10, 5], [-10, 5]]], 0, 5), 0, '세로축을 가로지르면 0');
  assert.equal(nearestAbsX([sq.map(([a, b]) => [-a, b])], 0, 20), 30, '왼쪽도 |x|');
  // 맨 위 칸(바깥 법선이 위)은 축에 나란한 상자
  const top = cellCorners(0, -100, -Math.PI / 2, 20, 10);
  assert.deepEqual(top.map(([a, b]) => [Math.round(a), Math.round(b)]).sort((p, q) => p[0] - q[0] || p[1] - q[1]), [[-10, -105], [-10, -95], [10, -105], [10, -95]]);
  // 별띠 테의 별: 바깥을 향한 별의 꼭짓점과 아래 두 꼭짓점이 띠 가장자리에서 ink 떨어진다
  const st = rimStars(200, 28, 4);
  assert.ok(close(st.at + st.r, 196) && close(st.at - st.r * Math.cos(Math.PI / 5), 200 - 28 + 4));
  // 별 아래 글자: 칸의 짧은 변이 더 긴 쪽 (같으면 한 줄)
  const lines = { line1: { y: 95, h: 40 }, line2: { y: [82, 124], h: 34 } };
  const wide = underStarPlan(4, () => 80, lines);
  assert.equal(wide.rows.length, 1, '네 자는 한 줄이 크다');
  const five = underStarPlan(5, () => 64, lines);
  assert.deepEqual(five.rows.map((r) => r.n), [3, 2], '다섯 자는 두 줄 (윗줄에 반 올림)');
  assert.ok(Math.min(five.cw, five.ch) > Math.min(64 * 2 / 5, 40), '두 줄 칸이 한 줄 칸보다 크다');
  assert.deepEqual(underStarPlan(14, () => 64, lines).rows.map((r) => r.n), [7, 7]);
  assert.equal(underStarPlan(2, () => 64, lines).rows.length, 1);
  // 흰 글자 깎기: 띠의 target 이하면 0, 넘친 넓이 / 둘레 길이, max 까지
  assert.equal(erosionFor(100, 50, 1000, 0.27, 5), 0);
  assert.ok(close(erosionFor(300, 15, 1000, 0.27, 5), 2));
  assert.equal(erosionFor(900, 10, 1000, 0.27, 5), 5);
});

// ───────────── 가짜 canvas 로 그려 보기 ─────────────
// Node 에는 canvas 가 없어서, 변환 행렬만 따라가며 무엇을 어디에 그렸는지 기록하는 가짜 2D 문맥을 쓴다 (ring-extra.test.js 와 같은 방식).
// 글자는 drawFittedGlyph 가 경계 상자를 칸에 꽉 채우므로, 가짜 글자 상자가 곧 잉크가 닿을 수 있는 가장 큰 범위다.
// 여기서는 겹침뿐 아니라 여백(글자와 테·선·점·별 사이 gap)까지 잰다.

class FakeCtx {
  constructor(canvas) {
    this.canvas = canvas;
    this.m = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.font = '10px sans-serif';
    this.lineWidth = 1;
    this.textAlign = 'start';
    this.textBaseline = 'alphabetic';
    this.globalCompositeOperation = 'source-over';
    this.globalAlpha = 1;
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.lineJoin = 'miter';
    this.marks = [];
    this.path = [];
  }
  get out() { return this.globalCompositeOperation === 'destination-out'; }
  save() { this.stack.push([[...this.m], this.font, this.lineWidth, this.textAlign, this.globalCompositeOperation, this.fillStyle, this.strokeStyle]); }
  restore() { [this.m, this.font, this.lineWidth, this.textAlign, this.globalCompositeOperation, this.fillStyle, this.strokeStyle] = this.stack.pop(); }
  translate(x, y) { const [a, b, c, d, e, f] = this.m; this.m = [a, b, c, d, a * x + c * y + e, b * x + d * y + f]; }
  rotate(t) { const [a, b, c, d, e, f] = this.m; const cs = Math.cos(t); const sn = Math.sin(t); this.m = [a * cs + c * sn, b * cs + d * sn, c * cs - a * sn, d * cs - b * sn, e, f]; }
  scale(x, y) { const [a, b, c, d, e, f] = this.m; this.m = [a * x, b * x, c * y, d * y, e, f]; }
  pt(x, y) { const [a, b, c, d, e, f] = this.m; return [a * x + c * y + e, b * x + d * y + f]; }
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
    this.marks.push({ type: 'glyph', text: t, pts: box.map(([px, py]) => this.pt(px, py)), out: this.out });
  }
  beginPath() { this.path = []; }
  closePath() {}
  moveTo(x, y) { this.path.push({ p: this.pt(x, y) }); }
  lineTo(x, y) { this.path.push({ p: this.pt(x, y) }); }
  rect(x, y, w, h) { for (const [px, py] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) this.path.push({ p: this.pt(px, py) }); }
  arc(x, y, r, a0, a1) {
    const k = Math.hypot(this.m[0], this.m[1]);
    const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-9;
    const c = this.pt(x, y);
    this.path.push({ circle: full ? { c, r: r * k } : null, p: c, r: r * k });
  }
  ellipse(x, y, a, b) { const k = Math.hypot(this.m[0], this.m[1]); this.path.push({ p: this.pt(x, y), rx: a * k, ry: b * k }); }
  fill() {
    const circles = this.path.filter((s) => s.circle);
    if (circles.length === 1 && this.path.length === 1) this.marks.push({ type: 'disc', ...circles[0].circle, out: this.out });
    // 꺾은선으로 채운 별·가로선은 볼록 껍질로 본다
    if (this.path.length >= 3 && this.path.every((s) => s.r == null && !s.rx)) this.marks.push({ type: 'poly', pts: hull(this.path.map((s) => s.p)), out: this.out });
    this.marks.push({ type: 'extent', path: this.path, lw: 0 });
  }
  stroke() {
    for (const s of this.path) if (s.circle) this.marks.push({ type: 'ring', ...s.circle, lw: this.lineWidth, out: this.out });
    this.marks.push({ type: 'extent', path: this.path, lw: this.lineWidth });
  }
  setLineDash() {}
  fillRect() {}
  clearRect() { this.marks.push({ type: 'clear' }); }
  // 가림판(흰 글자를 따로 그린 캔버스)을 지우기로 붙이면 그 위의 글자도 지운 것으로 옮겨 적는다. 번짐 사본은 옮기지 않는다
  drawImage(img) {
    this.marks.push({ type: 'image', out: this.out });
    if (this.out && img?.ctx && img.ctx !== this) for (const m of img.ctx.marks) if (m.type !== 'image') this.marks.push({ ...m, out: true });
  }
  createRadialGradient() { return { addColorStop() {} }; }
}

globalThis.document = {
  createElement: () => {
    const canvas = { width: 300, height: 150 };
    canvas.getContext = () => (canvas.ctx ??= new FakeCtx(canvas));
    return canvas;
  },
};

/** 볼록 껍질 (단조 사슬) */
function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out.at(-2), out.at(-1), q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

/** 볼록 다각형 둘이 겹치는지 (분리축) */
function polysOverlap(A, B) {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const [x1, y1] = P[i];
      const [x2, y2] = P[(i + 1) % P.length];
      const nx = y1 - y2;
      const ny = x2 - x1;
      const a = A.map(([x, y]) => x * nx + y * ny);
      const b = B.map(([x, y]) => x * nx + y * ny);
      if (Math.max(...a) <= Math.min(...b) || Math.max(...b) <= Math.min(...a)) return false;
    }
  }
  return true;
}
function segDist(p, a, b) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
}
/** 볼록 다각형 사이 거리 (겹치면 0) */
function polyDistance(A, B) {
  if (polysOverlap(A, B)) return 0;
  let d = Infinity;
  for (const [P, Q] of [[A, B], [B, A]]) {
    for (const p of P) for (let i = 0; i < Q.length; i++) d = Math.min(d, segDist(p, Q[i], Q[(i + 1) % Q.length]));
  }
  return d;
}
/** 다각형 점들의 원 중심 c 에서 [가장 가까운, 가장 먼] 거리 */
function distRange(pts, c) {
  const inside = [1, -1].some((sg) => pts.every((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return sg * ((q[0] - p[0]) * (c[1] - p[1]) - (q[1] - p[1]) * (c[0] - p[0])) >= 0;
  }));
  let lo = inside ? 0 : Infinity;
  for (let i = 0; i < pts.length; i++) lo = Math.min(lo, segDist(c, pts[i], pts[(i + 1) % pts.length]));
  return [lo, Math.max(...pts.map(([x, y]) => Math.hypot(x - c[0], y - c[1])))];
}

/**
 * 그린 결과를 검사: 캔버스 안에 들어가는지, 글자끼리 겹치지 않는지, 글자와 테·선·점·별 사이에 gap 이 있는지.
 * 음각 직인은 잉크 원(바탕) 안에서 가장자리와 edge 만큼 떨어져야 한다
 */
function inspect(canvas, label, { S, gap, edge = gap }) {
  const ctx = canvas.ctx;
  assert.ok(canvas.width > 0 && canvas.height > 0 && ctx, `${label}: 빈 캔버스`);
  const glyphs = ctx.marks.filter((m) => m.type === 'glyph');
  assert.ok(glyphs.length > 0, `${label}: 글자 없음`);
  const tol = 0.5;
  const inCanvas = ([x, y]) => x >= -tol && y >= -tol && x <= canvas.width + tol && y <= canvas.height + tol;
  for (const g of glyphs) assert.ok(g.pts.every(inCanvas), `${label}: 글자 '${g.text}' 가 캔버스 밖`);
  for (const m of ctx.marks.filter((x) => x.type === 'extent')) {
    for (const s of m.path) {
      const px = (s.rx ?? s.r ?? 0) + m.lw / 2;
      const py = (s.ry ?? s.r ?? 0) + m.lw / 2;
      assert.ok(inCanvas([s.p[0] - px, s.p[1] - py]) && inCanvas([s.p[0] + px, s.p[1] + py]), `${label}: 선·면이 캔버스 밖`);
    }
  }
  const need = gap * (1 - 1e-6);
  const ground = ctx.marks.find((m) => m.type === 'disc' && !m.out && m.r >= S * 0.45); // 음각 직인의 잉크 바탕
  let minGap = Infinity;
  const note = (d) => { minGap = Math.min(minGap, d); return d; };
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    for (let j = i + 1; j < glyphs.length; j++) {
      assert.ok(!polysOverlap(g.pts, glyphs[j].pts), `${label}: 글자 '${g.text}'(${i}) 와 '${glyphs[j].text}'(${j}) 가 겹침`);
    }
    for (const r of ctx.marks.filter((m) => m.type === 'ring')) {
      const [lo, hi] = distRange(g.pts, r.c);
      const d = Math.max(r.r - r.lw / 2 - hi, lo - r.r - r.lw / 2);
      assert.ok(note(d) >= need, `${label}: 글자 '${g.text}' 와 원 선(r=${r.r.toFixed(1)}) 사이 ${d.toFixed(2)} < ${gap.toFixed(2)}`);
    }
    for (const dk of ctx.marks.filter((m) => m.type === 'disc' && m !== ground)) {
      const d = distRange(g.pts, dk.c)[0] - dk.r;
      assert.ok(note(d) >= need, `${label}: 글자 '${g.text}' 와 점(r=${dk.r.toFixed(1)}) 사이 ${d.toFixed(2)}`);
    }
    for (const q of ctx.marks.filter((m) => m.type === 'poly')) {
      const d = polyDistance(g.pts, q.pts);
      assert.ok(note(d) >= need, `${label}: 글자 '${g.text}' 와 별·선 사이 ${d.toFixed(2)}`);
    }
    if (ground) {
      assert.ok(g.out, `${label}: 음각인데 글자 '${g.text}' 를 잉크로 그림`);
      const d = ground.r - distRange(g.pts, ground.c)[1];
      assert.ok(d >= edge * (1 - 1e-6), `${label}: 흰 글자 '${g.text}' 와 원 가장자리 사이 ${d.toFixed(2)} < ${edge.toFixed(2)}`);
    }
  }
  return { glyphs, minGap };
}

const KO_FONT = { family: 'Nanum Myeongjo', weight: 800, label: '나눔명조' };
const EN_FONT = { family: 'Cinzel', weight: 700, label: 'Cinzel' };
const NAMES = [
  ['ko', '이'], ['ko', '김지'], ['ko', '홍길동'], ['ko', '회사이름'], ['ko', '한국무역협회'], ['ko', '주식회사지혜행정'],
  ['ko', '가나다라마바사아자차카타파하'], ['ko', '홍길동ABC'],
  ['en', 'A'], ['en', 'Lee'], ['en', 'Jane Doe'], ['en', 'Acme Holdings Inc'], ['en', 'Abcdefg Hijklm'],
];

function render(shape, lang, name, extra = {}) {
  const chars = stampChars(name, { addIn: extra.addIn ?? false, lang });
  const baseChars = stampChars(name, { addIn: false, lang });
  return renderStamp({
    lang, chars, baseChars, text: name, shape, font: lang === 'ko' ? KO_FONT : EN_FONT, order: 'horizontal', ink: '#c8102e',
    date: '2026.11.22', dateLabel: '', sealCenter: 'daepyo-hanja', mult: 1, ...extra,
  });
}

const sizes = (shape, mult = 1) => {
  const S = 400 * mult;
  return { S, gap: S * RING_DECO.gap, edge: shape.id === 'ring-inverted-full' ? S * RING_DECO.inverted.edge : S * RING_DECO.gap };
};

test('검사 도구: 겹친 글자, 선·점·별에 너무 가까운 글자, 음각 가장자리에 붙은 글자를 잡아낸다', () => {
  const make = (draw) => {
    const c = document.createElement('canvas');
    c.width = 100;
    c.height = 100;
    const ctx = c.getContext('2d');
    ctx.font = '20px x';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(50, 50, 40, 0, Math.PI * 2);
    ctx.stroke();
    draw(ctx);
    return c;
  };
  const opt = { S: 100, gap: 5 };
  assert.doesNotThrow(() => inspect(make((ctx) => { ctx.fillText('가', 30, 50); ctx.fillText('나', 52, 50); }), 'ok', opt));
  assert.throws(() => inspect(make((ctx) => { ctx.fillText('가', 30, 50); ctx.fillText('나', 40, 52); }), 'x', opt), /겹침/);
  assert.throws(() => inspect(make((ctx) => ctx.fillText('가', 66, 50)), 'x', opt), /원 선/, '선에 닿지 않아도 gap 보다 가까우면');
  assert.throws(() => inspect(make((ctx) => { ctx.fillText('가', 40, 50); ctx.beginPath(); ctx.arc(64, 44, 2, 0, Math.PI * 2); ctx.fill(); }), 'x', opt), /점/);
  const bar = (ctx, x) => { ctx.beginPath(); ctx.rect(x, 40, 6, 3); ctx.fill(); };
  assert.doesNotThrow(() => inspect(make((ctx) => { ctx.fillText('가', 30, 50); bar(ctx, 56); }), 'ok', opt));
  assert.throws(() => inspect(make((ctx) => { ctx.fillText('가', 30, 50); bar(ctx, 52); }), 'x', opt), /별·선/);
  const knock = (x) => (ctx) => {
    ctx.beginPath(); ctx.arc(50, 50, 48, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillText('가', x, 55);
  };
  assert.doesNotThrow(() => inspect(make(knock(40)), 'ok', { ...opt, gap: 1, edge: 5 }));
  assert.throws(() => inspect(make(knock(75)), 'x', { ...opt, gap: 1, edge: 5 }), /가장자리|원 선|캔버스/);
});

test('4종 모두: 이름·인·가운데 선택지·읽는 순서마다 캔버스 안에, 글자끼리 겹치지 않고 테·선·점·별과 gap 을 둔다', () => {
  let n = 0;
  let worst = Infinity;
  for (const shape of RING_DECO_SHAPES) {
    const opt = sizes(shape);
    for (const [lang, name] of NAMES) {
      for (const sealCenter of SEAL_CENTERS.map((c) => c.id)) {
        for (const order of ['horizontal', 'vertical']) {
          for (const addIn of lang === 'ko' ? [false, true] : [false]) {
            const label = `${shape.id} ${name} ${sealCenter} ${order}${addIn ? ' +인' : ''}`;
            const { glyphs, minGap } = inspect(render(shape, lang, name, { sealCenter, order, addIn }), label, opt);
            worst = Math.min(worst, minGap / opt.S);
            n++;
            // 둘레에는 이름 글자가 모두 있다 ('인'은 가운데 '이름' 선택지일 때만 더해진다)
            const drawn = glyphs.map((g) => g.text).join('');
            for (const ch of ringName(lang, [], stampChars(name, { lang }), name).filter(Boolean)) assert.ok(drawn.includes(ch), `${label}: '${ch}' 없음`);
          }
        }
      }
    }
  }
  assert.ok(n > 1000, String(n));
  assert.ok(worst >= RING_DECO.gap * (1 - 1e-6), `가장 좁은 여백 ${worst}S`);
});

test('4종 모두: 배율 2.5 는 같은 배치를 2.5배로, 질감·번짐·회전도 오류 없이', () => {
  for (const shape of RING_DECO_SHAPES) {
    for (const [lang, name] of NAMES) {
      const a = render(shape, lang, name);
      const b = render(shape, lang, name, { mult: 2.5 });
      inspect(b, `${shape.id} ${name} x2.5`, sizes(shape, 2.5));
      assert.equal(a.width, a.height, shape.id);
      assert.ok(Math.abs(b.width / a.width - 2.5) < 0.02, `${shape.id}: ${a.width}→${b.width}`);
      const ga = a.ctx.marks.filter((m) => m.type === 'glyph');
      const gb = b.ctx.marks.filter((m) => m.type === 'glyph');
      assert.equal(ga.length, gb.length, `${shape.id} ${name}: 배율에 따라 글자 수가 바뀜`);
      // 글자 상자도 캔버스 가운데를 기준으로 2.5배
      const [ca, cb] = [a.width / 2, b.width / 2];
      ga.forEach((g, i) => g.pts.forEach(([x, y], k) => {
        const [X, Y] = gb[i].pts[k];
        assert.ok(Math.abs((x - ca) * 2.5 - (X - cb)) < 0.05 && Math.abs((y - ca) * 2.5 - (Y - cb)) < 0.05, `${shape.id} ${name}: 글자 ${i} 위치`);
      }));
      for (const ink of ['#1f3a93', '#111111']) {
        const fx = render(shape, lang, name, { texture: true, bleed: true, rotation: -8, ink });
        assert.ok(fx.width > a.width && fx.height > a.height, `${shape.id}: 회전한 캔버스가 커지지 않음`);
      }
    }
  }
});

test('별 양옆선: 위로 두른 이름이 240° 이상, 별(0.13S) 양옆 굵은 가로선(0.024S), 별을 고르면 별 아래 글자 없음', () => {
  const shape = byId('ring-star-bars');
  for (const [lang, name] of NAMES) {
    const c = render(shape, lang, name, { sealCenter: 'jikin' });
    const S = 400;
    const [cx, cy] = [c.width / 2, c.height / 2];
    const arc = c.ctx.marks.filter((m) => m.type === 'glyph' && m.pts.every(([x, y]) => Math.hypot(x - cx, y - cy) > S * 0.28));
    // 맨 위에서 시계 방향 각도 (왼쪽은 음수)
    const angles = arc.flatMap((g) => g.pts.map(([x, y]) => Math.atan2(x - cx, cy - y)));
    const cover = (Math.max(...angles) - Math.min(...angles)) * (180 / Math.PI);
    assert.ok(cover >= 240, `${name}: ${cover.toFixed(1)}°`);
    assert.ok(Math.abs(Math.max(...angles) + Math.min(...angles)) < 0.02, `${name}: 위 가운데에 맞춤`);
    // 가운데 큰 별 (외접 반지름 0.13S)
    const big = c.ctx.marks.filter((m) => m.type === 'poly' && m.pts.length === 5 && distRange(m.pts, [cx, cy])[0] === 0);
    assert.equal(big.length, 1, name);
    assert.ok(close(distRange(big[0].pts, [cx, cy])[1], S * RING_DECO.starBars.star, 1e-6) && RING_DECO.starBars.star === 0.13, `${name}: 별 크기`);
    // 가로선 두 개 (y = 0, 별 양옆): 카드 크기(약 120px)에서도 선으로 보이게 굵기 0.024S, 길이 0.11S 이상
    const bars = c.ctx.marks.filter((m) => m.type === 'poly' && m.pts.length === 4);
    assert.equal(bars.length, 2, name);
    for (const b of bars) {
      const ys = b.pts.map((p) => p[1] - cy);
      const xs = b.pts.map((p) => Math.abs(p[0] - cx));
      assert.ok(close(Math.max(...ys) + Math.min(...ys), 0, 1e-6), `${name}: 가로선이 가운데 높이`);
      assert.ok(close(Math.max(...ys) - Math.min(...ys), S * 0.024, 1e-6), `${name}: 가로선 굵기`);
      assert.ok(close(Math.min(...xs), S * 0.14, 1e-6) && Math.max(...xs) <= S * 0.285 + 1e-9, `${name}: 가로선 ${xs}`);
      assert.ok(Math.max(...xs) - Math.min(...xs) >= S * 0.11, `${name}: 가로선 길이 ${(Math.max(...xs) - Math.min(...xs)) / S}`);
      // 별과 떨어져 있다. 가짜 canvas 는 별을 볼록 껍질(오각형)로 기록하므로 실제 틈(팔 끝까지 약 0.033S)보다 작게 잰다
      assert.ok(polyDistance(b.pts, big[0].pts) >= S * 0.02, `${name}: 별과 가로선 사이`);
    }
    // 별 아래 한 줄: 직인
    const below = c.ctx.marks.filter((m) => m.type === 'glyph' && !arc.includes(m));
    const initials = name.toUpperCase().split(/\s+/).map((w) => w[0]).join('').slice(0, 3);
    assert.equal(below.map((g) => g.text).join(''), lang === 'ko' ? '직인' : initials, name);
    assert.ok(below.every((g) => g.pts.every(([, y]) => y > cy + S * 0.15)), `${name}: 별 아래`);
    const star = render(shape, lang, name, { sealCenter: 'star' });
    assert.equal(star.ctx.marks.filter((m) => m.type === 'glyph').length, arc.length, `${name}: 별을 고르면 둘레 글자만`);
  }
});

test('점선 둘레: 굵은 점 한 줄(60~72개) 안쪽에 가는 실선, 가운데 원', () => {
  const c = render(byId('ring-dotted-single'), 'ko', '홍길동', { sealCenter: 'jikin' });
  const S = 400;
  const beads = c.ctx.marks.filter((m) => m.type === 'disc' && m.r >= S * 0.012);
  assert.ok(beads.length >= 60 && beads.length <= 72, String(beads.length));
  const R = Math.hypot(beads[0].c[0] - c.width / 2, beads[0].c[1] - c.height / 2);
  assert.ok(beads.every((b) => close(Math.hypot(b.c[0] - c.width / 2, b.c[1] - c.height / 2), R, 1e-6)), '한 줄');
  const rings = c.ctx.marks.filter((m) => m.type === 'ring').sort((a, b) => b.r - a.r);
  assert.equal(rings.length, 2);
  assert.ok(rings[0].r + rings[0].lw / 2 < R - beads[0].r, '실선은 점 안쪽');
});

test('음각 직인: 원 전체를 칠하고 이름·가운데 원 선·가운데 글자를 지운다. 번짐은 지우기 전에 한 번만', () => {
  const shape = byId('ring-inverted-full');
  for (const sealCenter of SEAL_CENTERS.map((x) => x.id)) {
    const c = render(shape, 'ko', '홍길동', { bleed: true, sealCenter });
    const marks = c.ctx.marks;
    const glyphs = marks.filter((m) => m.type === 'glyph');
    assert.ok(glyphs.every((g) => g.out), `${sealCenter}: 모든 글자를 지워서 쓴다`);
    for (const ch of '홍길동') assert.ok(glyphs.some((g) => g.text === ch), ch);
    assert.ok(marks.filter((m) => m.type === 'ring').every((r) => r.out), '흰 선');
    const ground = marks.findIndex((m) => m.type === 'disc' && !m.out);
    const images = marks.flatMap((m, i) => (m.type === 'image' && !m.out ? [i] : []));
    assert.equal(images.length, 1, '번진 그림을 한 번 붙인다');
    const firstOut = marks.findIndex((m) => m.out);
    assert.ok(ground < images[0] && images[0] < firstOut, '칠하고 → 번지고 → 지운다');
    if (sealCenter === 'star') assert.ok(marks.some((m) => m.type === 'poly' && m.out && m.pts.every(([x, y]) => Math.hypot(x - c.width / 2, y - c.height / 2) < 400 * 0.25)), '가운데 별도 흰색');
  }
  const plain = render(shape, 'ko', '홍길동', { bleed: false });
  assert.equal(plain.ctx.marks.filter((m) => m.type === 'image' && !m.out).length, 0);
});

test('별띠 둘레: 굵은 잉크 테에 흰 별 12개를 지워 낸다 (번진 뒤에), 테 안쪽과 바깥쪽에 잉크가 남는다. 가운데 원 선은 없다', () => {
  const S = 400;
  const K = RING_DECO.starBand;
  for (const bleed of [false, true]) {
    const c = render(byId('ring-star-band'), 'ko', '주식회사지혜행정', { sealCenter: 'jikin', bleed });
    const [cx, cy] = [c.width / 2, c.height / 2];
    const marks = c.ctx.marks;
    const rings = marks.filter((m) => m.type === 'ring');
    assert.equal(rings.length, 1, '테 하나 (별띠를 따로 두지 않는다)');
    const [rim] = rings;
    assert.ok(close(rim.lw, S * K.band, 1e-6) && close(rim.r + rim.lw / 2, S / 2, 1e-6) && !rim.out, '바깥 끝이 S/2 인 굵은 잉크 테');
    assert.ok(K.band >= 0.06 && K.band <= 0.07);
    const stars = marks.filter((m) => m.type === 'poly' && m.out);
    assert.equal(stars.length, 12);
    const st = rimStars(S / 2, S * K.band, S * K.ink);
    for (const q of stars) {
      const [, hi] = distRange(q.pts, [cx, cy]);
      const lo = Math.min(...q.pts.map(([x, y]) => Math.hypot(x - cx, y - cy)));
      assert.ok(hi <= S / 2 - S * K.ink + 1e-6 && lo >= S / 2 - S * K.band + S * K.ink - 1e-6, `흰 별이 테 안에, 양쪽에 잉크 ${S * K.ink}`);
      const mid = [q.pts.reduce((t, p) => t + p[0], 0) / 5, q.pts.reduce((t, p) => t + p[1], 0) / 5];
      assert.ok(close(distRange(q.pts, mid)[1], st.r, 1e-6) && st.r >= S * 0.03, '별 크기 (카드 크기에서도 별로 보이게)');
    }
    // 별은 번짐 뒤에 지운다
    const firstStar = marks.findIndex((m) => m.type === 'poly' && m.out);
    const bleedAt = marks.findIndex((m) => m.type === 'image' && !m.out);
    if (bleed) assert.ok(bleedAt >= 0 && bleedAt < firstStar, '번지고 → 지운다');
    else assert.equal(bleedAt, -1);
    // 글자는 잉크(지우지 않는다). 이름은 띠에, 가운데 글자와 이름 사이도 gap
    const glyphs = marks.filter((m) => m.type === 'glyph');
    assert.ok(glyphs.every((g) => !g.out));
    const centre = glyphs.filter((g) => g.pts.every(([x, y]) => Math.hypot(x - cx, y - cy) <= S * K.centre + 1e-6));
    const ring = glyphs.filter((g) => !centre.includes(g));
    assert.equal(centre.map((g) => g.text).join(''), '직인');
    assert.equal(ring.map((g) => g.text).join(''), '주식회사지혜행정');
    for (const a of centre) for (const b of ring) assert.ok(polyDistance(a.pts, b.pts) >= S * RING_DECO.gap - 1e-6, '가운데 글자와 이름 사이');
  }
});

test('둘레 글자 높이: 긴 이름도 높이를 지키고 폭을 줄인다 (14자 0.17S, 영문 17자 이상 0.15S)', () => {
  const S = 400;
  const ringShape = STAMP_SHAPES.find((s) => s.id === 'ring');
  const SHORT = { 'ring-star-bars': 0.15, 'ring-dotted-single': 0.175, 'ring-inverted-full': 0.175, 'ring-star-band': 0.175 };
  const LONG = { 'ring-star-bars': 0.15, 'ring-dotted-single': 0.17, 'ring-inverted-full': 0.17, 'ring-star-band': 0.17 };
  // 가운데를 별로 고르면 가운데 글자가 없어 둘레 글자만 남는다
  const ringGlyphH = (c) => {
    const [cx, cy] = [c.width / 2, c.height / 2];
    const mid = (g) => [g.pts.reduce((t, p) => t + p[0], 0) / 4, g.pts.reduce((t, p) => t + p[1], 0) / 4];
    const ring = c.ctx.marks.filter((m) => m.type === 'glyph');
    assert.ok(ring.length > 0 && ring.every((g) => Math.hypot(mid(g)[0] - cx, mid(g)[1] - cy) > S * 0.26));
    return Math.min(...ring.map((g) => Math.hypot(g.pts[0][0] - g.pts[3][0], g.pts[0][1] - g.pts[3][1]))) / S;
  };
  for (const [lang, name] of [['ko', '이'], ['ko', '김지'], ['ko', '홍길동'], ['ko', '회사이름'], ['ko', '한국무역협회'], ['ko', '주식회사지혜행정'], ['en', 'Lee'], ['en', 'Jane Doe']]) {
    const ref = ringGlyphH(render(ringShape, lang, name, { sealCenter: 'star' }));
    assert.ok(close(ref, 0.179, 0.001), `ring ${name}: ${ref}`);
    for (const shape of RING_DECO_SHAPES) {
      const h = ringGlyphH(render(shape, lang, name, { sealCenter: 'star' }));
      assert.ok(h >= SHORT[shape.id] - 1e-3, `${shape.id} ${name}: 둘레 글자 높이 ${h.toFixed(3)}S < ${SHORT[shape.id]}S`);
    }
  }
  for (const shape of RING_DECO_SHAPES) {
    for (const name of ['가나다라마바사아자차카', '가나다라마바사아자차카타파', '가나다라마바사아자차카타파하']) {
      const h = ringGlyphH(render(shape, 'ko', name, { sealCenter: 'star' }));
      assert.ok(h >= LONG[shape.id] - 1e-3, `${shape.id} ${Array.from(name).length}자: ${h.toFixed(3)}S`);
    }
    for (const name of ['Acme Holdings Inc', 'Abcdefghij Klmnopq', 'Abcdefghijklmnopqrs']) {
      const h = ringGlyphH(render(shape, 'en', name, { sealCenter: 'star' }));
      assert.ok(h >= 0.15 - 1e-3, `${shape.id} ${name}: ${h.toFixed(3)}S`);
    }
  }
  // 음각 직인은 좁은 칸에서도 이웃 흰 글자 사이 잉크(apart)를 넓게 둔다
  const inv = render(byId('ring-inverted-full'), 'ko', '가나다라마바사아자차카타파하', { sealCenter: 'star' }).ctx.marks.filter((m) => m.type === 'glyph');
  for (let i = 0; i + 1 < inv.length; i++) assert.ok(polyDistance(inv[i].pts, inv[i + 1].pts) >= S * RING_DECO.inverted.apart - 1e-6, `음각 직인 14자: 글자 ${i} 사이 잉크`);
});

test('centerExtent: drawSealCenter 가 그리는 가운데 내용의 가장 바깥 (r 배수)', () => {
  const r = 100;
  for (const sc of SEAL_CENTERS.map((c) => c.id)) {
    for (const order of ['horizontal', 'vertical']) {
      for (const [lang, name] of [['ko', '이'], ['ko', '홍길동'], ['ko', '김지혜인'], ['ko', '한국무역협회'], ['ko', '가나다라마바사아자차카타파하'], ['en', 'Jane Doe']]) {
        const c = document.createElement('canvas');
        c.width = 400;
        c.height = 400;
        const ctx = c.getContext('2d');
        const chars = stampChars(name, { lang });
        drawSealCenter(ctx, { lang, chars, text: name, font: { family: 'x', weight: 400 }, order, sealCenter: sc, cx: 200, cy: 200, r });
        const pts = ctx.marks.flatMap((m) => (m.type === 'glyph' || m.type === 'poly' ? m.pts : []));
        const far = Math.max(...pts.map(([x, y]) => Math.hypot(x - 200, y - 200))) / r;
        const k = centerExtent(lang, chars, sc, order);
        assert.ok(far <= k + 1e-6, `${sc} ${order} ${name}: ${far} > ${k}`);
        assert.ok(far >= k - 0.03, `${sc} ${order} ${name}: ${far} 이 ${k} 보다 훨씬 작다`);
      }
    }
  }
});

test('가운데 글자: 점선 둘레·음각 직인·별띠 둘레는 둘레글자 원보다 작지 않다', () => {
  const S = 400;
  const ringShape = STAMP_SHAPES.find((s) => s.id === 'ring');
  // 가운데 글자는 둘레 글자 뒤에 그린다: 별(가운데 없음)로 그린 글자 수만큼 건너뛴다
  const centreH = (shape, lang, name, sealCenter, addIn) => {
    const n = render(shape, lang, name, { sealCenter: 'star', addIn }).ctx.marks.filter((m) => m.type === 'glyph').length;
    const canvas = render(shape, lang, name, { sealCenter, addIn });
    const marks = canvas.ctx.marks;
    const gl = marks.filter((m) => m.type === 'glyph').slice(n);
    if (gl.length) return Math.min(...gl.map((g) => Math.hypot(g.pts[0][0] - g.pts[3][0], g.pts[0][1] - g.pts[3][1]))) / S;
    // 별을 고르면 가운데 별 (도장 가운데에 놓인 별) 의 외접 반지름
    const mid = (q) => [q.pts.reduce((t, p) => t + p[0], 0) / q.pts.length, q.pts.reduce((t, p) => t + p[1], 0) / q.pts.length];
    const c0 = [canvas.width / 2, canvas.height / 2];
    const star = marks.filter((m) => m.type === 'poly').sort((p, q) => Math.hypot(mid(p)[0] - c0[0], mid(p)[1] - c0[1]) - Math.hypot(mid(q)[0] - c0[0], mid(q)[1] - c0[1]))[0];
    return Math.max(...star.pts.map(([x, y]) => Math.hypot(x - mid(star)[0], y - mid(star)[1]))) / S;
  };
  for (const sc of SEAL_CENTERS.map((c) => c.id)) {
    for (const [lang, name, addIn] of [['ko', '홍길동', false], ['ko', '김지혜', true], ['ko', '가나다라마바사아자차카타파하', false], ['en', 'Jane Doe', false]]) {
      const ref = centreH(ringShape, lang, name, sc, addIn);
      for (const id of ['ring-dotted-single', 'ring-inverted-full', 'ring-star-band']) {
        const h = centreH(byId(id), lang, name, sc, addIn);
        assert.ok(h >= ref - 1e-4, `${id} ${sc} ${name}: 가운데 ${h.toFixed(4)} < ring ${ref.toFixed(4)}`);
      }
    }
  }
  assert.ok(close(centreH(ringShape, 'ko', '홍길동', 'daepyo-hanja'), 0.124, 0.001));
});

test('별 양옆선: 별 아래 글자는 길면 두 줄로 (대표이사인, 긴 이름), 짧으면 한 줄', () => {
  const S = 400;
  const shape = byId('ring-star-bars');
  const below = (name, sealCenter, addIn = false) => {
    const n = render(shape, 'ko', name, { sealCenter: 'star', addIn }).ctx.marks.filter((m) => m.type === 'glyph').length;
    const c = render(shape, 'ko', name, { sealCenter, addIn });
    const gl = c.ctx.marks.filter((m) => m.type === 'glyph').slice(n);
    const ys = [...new Set(gl.map((g) => Math.round((g.pts[0][1] + g.pts[2][1]) / 2)))];
    const h = Math.min(...gl.map((g) => Math.hypot(g.pts[0][0] - g.pts[3][0], g.pts[0][1] - g.pts[3][1]))) / S;
    const w = Math.min(...gl.map((g) => Math.hypot(g.pts[0][0] - g.pts[1][0], g.pts[0][1] - g.pts[1][1]))) / S;
    assert.ok(gl.every((g) => g.pts.every(([, y]) => y > c.height / 2 + S * RING_DECO.starBars.star * Math.sin((54 * Math.PI) / 180) + S * 0.04)), `${name} ${sealCenter}: 별 아래`);
    return { text: gl.map((g) => g.text).join(''), lines: ys.length, h, w };
  };
  assert.deepEqual([below('홍길동', 'daepyo-hanja').lines, below('홍길동', 'jikin').lines], [1, 1]);
  const ceo = below('홍길동', 'daepyo-in');
  assert.equal(ceo.text, '대표이사인');
  assert.equal(ceo.lines, 2);
  assert.ok(Math.min(ceo.h, ceo.w) >= 0.075, JSON.stringify(ceo));
  const long = below('가나다라마바사아자차카타파하', 'name');
  assert.equal(long.lines, 2);
  assert.ok(Math.min(long.h, long.w) >= 0.045, `14자 이름: ${JSON.stringify(long)} (한 줄이면 0.028S)`);
});
