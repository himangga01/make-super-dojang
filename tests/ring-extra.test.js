import { test } from 'node:test';
import assert from 'node:assert/strict';
// stamp-gen.js 를 먼저 불러야 한다: stamp-ring-extra.js 와 서로 가져오므로, 반대 순서면
// STAMP_SHAPES 를 만들 때 RING_EXTRA_SHAPES 가 아직 준비되지 않는다
import { STAMP_SHAPES, STAMP_CATEGORIES, SEAL_CENTERS, renderStamp } from '../js/stamp-gen.js';
import {
  RING_EXTRA_SHAPES, RING_EXTRA_DRAW, ringName, runWeight, planRun, runCell, ringYearText,
  centerGrid, centerContent, ellipseTable, circlePath, ellipsePath, scallopGeometry,
} from '../js/stamp-ring-extra.js';
import { stampChars } from '../js/core/text.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ───────────── 모양 목록 ─────────────

test('둘레글자 추가 12종: id·special 이 겹치지 않고, 분류는 ring, 이름표는 8자 이하', () => {
  assert.equal(RING_EXTRA_SHAPES.length, 12);
  const ids = RING_EXTRA_SHAPES.map((s) => s.id);
  assert.equal(new Set(ids).size, 12);
  assert.equal(new Set(STAMP_SHAPES.map((s) => s.id)).size, STAMP_SHAPES.length, '전체 목록에서 id 중복');
  const oldSpecials = new Set(STAMP_SHAPES.filter((s) => !RING_EXTRA_SHAPES.includes(s)).map((s) => s.special).filter(Boolean));
  for (const s of RING_EXTRA_SHAPES) {
    assert.equal(s.cat, 'ring', s.id);
    assert.ok(STAMP_CATEGORIES.some((c) => c.id === s.cat));
    assert.ok(s.label && Array.from(s.label).length <= 8, `${s.id}: ${s.label}`);
    assert.equal(typeof RING_EXTRA_DRAW[s.special], 'function', `${s.id}: 그리기 함수`);
    assert.ok(!oldSpecials.has(s.special), `${s.id}: 기존 special 과 겹침`);
    assert.ok(STAMP_SHAPES.includes(s), `${s.id}: STAMP_SHAPES 에 없음`);
  }
  assert.equal(new Set(RING_EXTRA_SHAPES.map((s) => s.special)).size, 12);
  assert.equal(new Set(RING_EXTRA_SHAPES.map((s) => s.label)).size, 12, '이름표 중복');
  // 둘레글자 분류는 기존 3종이 앞에 온다
  assert.deepEqual(STAMP_SHAPES.filter((s) => s.cat === 'ring').map((s) => s.id).slice(0, 3), ['ring', 'ring-star', 'ring-square']);
  // 가운데 글자 선택지를 쓰는 모양은 sealCenter 표시가 있다 (app.js 가 한자 글꼴을 미리 받는다). 공장 별은 늘 큰 별
  assert.deepEqual(RING_EXTRA_SHAPES.filter((s) => !s.sealCenter).map((s) => s.id), ['ring-gongjang']);
  // 흰 글자를 지우는 음각 띠는 번짐을 스스로 처리한다
  assert.deepEqual(RING_EXTRA_SHAPES.filter((s) => s.selfBleed).map((s) => s.id), ['ring-inverted']);
});

// ───────────── 계산 ─────────────

test('ringName: 한글은 인 없는 이름, 영문은 대문자와 띄어쓰기 자리(null)', () => {
  assert.deepEqual(ringName('ko', ['김', '지', '혜', '인'], ['김', '지', '혜'], '김지혜'), ['김', '지', '혜']);
  assert.deepEqual(ringName('ko', ['홍', '길', '동'], undefined, '홍길동'), ['홍', '길', '동']);
  assert.deepEqual(ringName('en', [], [], 'Jane  Doe '), ['J', 'A', 'N', 'E', null, 'D', 'O', 'E']);
  assert.deepEqual(ringName('ko', [], [], ''), ['A']);
  assert.equal(runWeight(['J', null, 'D']), 2.5);
  assert.equal(runWeight(['J', null, 'D'], 0.6), 2.6);
});

test('planRun: 짧은 이름은 되풀이하고, 칸은 stepMax 를 넘지 않으며 위치는 겹치지 않는다', () => {
  const opt = { minSpan: 240, maxSpan: 290, stepMax: 25, spread: 1.4 };
  // 한 자: 점을 끼워 240 이상이 될 때까지
  const one = planRun(['이'], opt);
  assert.ok(one.reps > 1 && one.span >= 240 && one.span <= 290, JSON.stringify(one));
  assert.equal(one.units.filter((u) => u === '이').length, one.reps);
  assert.equal(one.units.filter((u) => u === null).length, one.reps - 1, '열린 호는 끝에 점이 없다');
  // 긴 이름: 한 번만, maxSpan 에 맞게 칸이 줄어든다
  const long = planRun(Array.from('가나다라마바사아자차카타'), opt);
  assert.equal(long.reps, 1);
  assert.ok(close(long.span, 290) && long.step < 25);
  // 되풀이하지 않으면 사이만 spread 배까지 벌린다
  const solo = planRun(['홍', '길', '동'], { ...opt, repeat: false });
  assert.equal(solo.reps, 1);
  assert.ok(close(solo.span, 3 * 25 * 1.4) && close(solo.step, 25 * 1.4));
  for (const p of [one, long, solo]) {
    assert.equal(p.at.length, p.units.length);
    assert.ok(close(p.at[0] - p.step * runWeight([p.units[0]]) / 2, -p.span / 2), '열린 호는 가운데가 0');
    for (let i = 1; i < p.at.length; i++) assert.ok(p.at[i] > p.at[i - 1]);
  }
  // 닫힌 고리: 둘레를 꼭 채우고 끝에도 점, 첫 칸 앞 끝이 0
  const ring = planRun(['홍', '길', '동'], { minSpan: 600, maxSpan: 600, stepMax: 30, spread: 1.5, closed: true, sepW: 0.6 });
  assert.equal(ring.units.at(-1), null);
  assert.ok(close(ring.at.at(-1) + (0.6 * ring.step) / 2, 600));
  assert.ok(ring.step <= 30 * 1.5 + 1e-9);
  assert.ok(close(ring.head, 3 * ring.step));
  // 되풀이 횟수를 정하면 그대로, star 면 되풀이 사이가 별 자리
  const fixed = planRun(['홍', '길'], { minSpan: 100, maxSpan: 100, stepMax: 10, closed: true, reps: 3, star: true, starW: 0.8 });
  assert.equal(fixed.reps, 3);
  assert.equal(fixed.units.filter((u) => u && typeof u === 'object').length, 3);
  assert.ok(close(fixed.step, 100 / (3 * 2.8)));
  // 칸이 좁아지면 세로도 줄인다
  const cell = runCell({ step: 10 }, 20, 30, 0.6);
  assert.ok(close(cell.cellW, 8.6) && close(cell.cellH, 8.6 / 0.6));
  assert.deepEqual(runCell({ step: 30 }, 20, 15), { cellW: 20 * 0.86, cellH: 15 });
});

test('ringYearText: 고른 문구 > 연도 (영문은 EST.)', () => {
  assert.equal(ringYearText('ko', '2026.11.22', ''), '2026');
  assert.equal(ringYearText('en', '2026.11.22', ''), 'EST. 2026');
  assert.equal(ringYearText('ko', '2026.11.22', '확인'), '확인');
  assert.equal(ringYearText('en', '1999.01.01', 'PAID'), 'PAID');
  assert.match(ringYearText('ko', undefined, ''), /^\d{4}$/);
});

test('centerGrid: 가로 한두 줄, 세로쓰기는 오른쪽 열부터 두 자씩', () => {
  assert.deepEqual(centerGrid(2, { maxLines: 2 }), { cols: 2, rows: 1, cells: [{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }] });
  const five = centerGrid(5, { maxLines: 2 });
  assert.deepEqual([five.cols, five.rows], [3, 2]);
  assert.deepEqual(five.cells.slice(3), [{ x: 1, y: 1.5 }, { x: 2, y: 1.5 }], '마지막 줄은 가운데로');
  assert.deepEqual(centerGrid(5, { maxLines: 1 }).rows, 1);
  // 한 줄 모양은 세로 읽기여도 가로 한 줄
  assert.deepEqual(centerGrid(4, { maxLines: 1, vertical: true }).cells.map((c) => c.x), [0.5, 1.5, 2.5, 3.5]);
  // 代表理事 세로쓰기: 오른쪽 열 위→아래, 다음 열
  assert.deepEqual(centerGrid(4, { maxLines: 2, vertical: true }).cells, [{ x: 1.5, y: 0.5 }, { x: 1.5, y: 1.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 1.5 }]);
  assert.deepEqual(centerGrid(3, { maxLines: 2, vertical: true }).cells.at(-1), { x: 0.5, y: 1 }, '덜 찬 열은 가운데로');
  assert.deepEqual(centerGrid(1, { vertical: true }).cells, [{ x: 0.5, y: 0.5 }]);
  assert.deepEqual(centerGrid(0).cells, []);
});

test('centerContent: 선택지마다 별·머리글자·글자 목록', () => {
  assert.deepEqual(centerContent('ko', ['홍'], '홍', 'star'), { star: true });
  assert.deepEqual(centerContent('en', [], 'Jane Doe', 'daepyo-hanja'), { initials: 'JD' });
  assert.deepEqual(centerContent('en', [], 'Jane Doe', 'star'), { star: true });
  assert.deepEqual(centerContent('ko', ['김', '지', '혜', '인'], '김지혜', 'name'), { glyphs: ['김', '지', '혜', '인'], hanja: false });
  assert.deepEqual(centerContent('ko', ['홍'], '홍', 'daepyo-hanja'), { glyphs: ['代', '表', '理', '事'], hanja: true });
  assert.deepEqual(centerContent('ko', ['홍'], '홍', 'nope').glyphs, ['代', '表', '理', '事'], '모르는 값은 첫 선택지');
  for (const c of SEAL_CENTERS) assert.ok(centerContent('ko', ['홍', '길', '동'], '홍길동', c.id));
});

test('ellipseTable·길: 둘레 길이와 호 길이 → 위치', () => {
  const circle = ellipseTable(10, 10);
  assert.ok(Math.abs(circle.length - 2 * Math.PI * 10) < 0.01);
  assert.ok(close(circle.theta(0), -Math.PI / 2, 1e-9));
  assert.ok(Math.abs(circle.theta(circle.length / 4) - 0) < 1e-3, '4분의 1 바퀴면 오른쪽');
  assert.ok(Math.abs(circle.theta(-circle.length / 4) - Math.PI) < 1e-3, '음수는 감아서');
  // 타원 둘레: 라마누잔 근사와 비교
  const [a, b] = [200, 133];
  const ram = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  assert.ok(Math.abs(ellipseTable(a, b).length - ram) / ram < 1e-4);
  const p = ellipsePath(0, 0, a, b, 20);
  const bottom = p.place(p.length / 2);
  assert.ok(Math.abs(bottom.x) < 1e-6 && close(bottom.y, b, 1e-6) && close(bottom.n, Math.PI / 2, 1e-6), JSON.stringify(bottom));
  const right = p.place(p.length / 4);
  assert.ok(close(right.x, a, 1e-3) && Math.abs(right.n) < 1e-3);
  const top = circlePath(5, 5, 10).place(0);
  assert.ok(close(top.x, 5) && close(top.y, -5) && close(top.n, -Math.PI / 2));
  // 꽃테: 바깥 끝이 정확히 outer
  const sc = scallopGeometry(100, 28);
  assert.ok(close(sc.rc * Math.cos(Math.PI / 28) + sc.br, 100));
});

// ───────────── 가짜 canvas 로 그려 보기 ─────────────
// Node 에는 canvas 가 없어서, 변환 행렬만 따라가며 무엇을 어디에 그렸는지 기록하는 가짜 2D 문맥을 쓴다.
// 글자는 drawFittedGlyph 가 경계 상자를 칸에 꽉 채우므로, 가짜 글자 크기로도 칸 배치를 그대로 잴 수 있다.

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
    this.marks = [];
    this.path = [];
  }
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
    this.marks.push({ type: 'glyph', text: t, pts: box.map(([px, py]) => this.pt(px, py)), out: this.globalCompositeOperation === 'destination-out' });
  }
  beginPath() { this.path = []; }
  closePath() {}
  moveTo(x, y) { this.path.push({ p: this.pt(x, y) }); }
  lineTo(x, y) { this.path.push({ p: this.pt(x, y) }); }
  arcTo(x1, y1, x2, y2) { this.path.push({ p: this.pt(x1, y1) }, { p: this.pt(x2, y2) }); }
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
    if (circles.length === 1 && this.path.length === 1) this.marks.push({ type: 'disc', ...circles[0].circle, out: this.globalCompositeOperation === 'destination-out' });
    // 꺾은선으로 채운 별·마름모는 볼록 껍질로 본다
    if (this.path.length >= 3 && this.path.every((s) => s.r == null && !s.rx)) this.marks.push({ type: 'poly', pts: hull(this.path.map((s) => s.p)) });
    this.marks.push({ type: 'extent', path: this.path, lw: 0 });
  }
  stroke() {
    for (const s of this.path) if (s.circle) this.marks.push({ type: 'ring', ...s.circle, lw: this.lineWidth });
    this.marks.push({ type: 'extent', path: this.path, lw: this.lineWidth });
  }
  setLineDash() {}
  fillRect() {}
  clearRect() {}
  drawImage() { this.marks.push({ type: 'image' }); }
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

/** 상자를 가운데로 k 배 줄인다. 돌려 놓은 글자 칸의 모서리까지 잉크가 차는 일은 드물어 0.9 배로 본다 */
function shrink(pts, k) {
  const cx = pts.reduce((t, p) => t + p[0], 0) / pts.length;
  const cy = pts.reduce((t, p) => t + p[1], 0) / pts.length;
  return pts.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}
/** 볼록 다각형 둘이 겹치는지 (분리축) */
function polysOverlap(A, B) {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const [x1, y1] = P[i];
      const [x2, y2] = P[(i + 1) % P.length];
      const nx = y1 - y2;
      const ny = x2 - x1;
      const proj = (Q) => Q.map(([x, y]) => x * nx + y * ny);
      const a = proj(A);
      const b = proj(B);
      if (Math.max(...a) <= Math.min(...b) || Math.max(...b) <= Math.min(...a)) return false;
    }
  }
  return true;
}
function distRange(pts, c) {
  const d = pts.map(([x, y]) => Math.hypot(x - c[0], y - c[1]));
  // 점이 다각형 안이면 가장 가까운 거리는 0
  const inside = !pts.some((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return (q[0] - p[0]) * (c[1] - p[1]) - (q[1] - p[1]) * (c[0] - p[0]) < 0;
  }) || !pts.some((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return (q[0] - p[0]) * (c[1] - p[1]) - (q[1] - p[1]) * (c[0] - p[0]) > 0;
  });
  let lo = inside ? 0 : Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const t = Math.max(0, Math.min(1, ((c[0] - ax) * (bx - ax) + (c[1] - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
    lo = Math.min(lo, Math.hypot(ax + (bx - ax) * t - c[0], ay + (by - ay) * t - c[1]));
  }
  return [lo, Math.max(...d)];
}

/** 그린 결과를 검사: 캔버스 안에 들어가는지, 글자끼리·글자와 선·점이 겹치지 않는지 */
function inspect(canvas, label) {
  const ctx = canvas.ctx;
  assert.ok(canvas.width > 0 && canvas.height > 0, `${label}: 빈 캔버스`);
  assert.ok(ctx, `${label}: 그리지 않음`);
  const glyphs = ctx.marks.filter((m) => m.type === 'glyph');
  assert.ok(glyphs.length > 0, `${label}: 글자 없음`);
  assert.ok(ctx.marks.some((m) => m.type === 'extent'), `${label}: 선·면 없음`);
  const tol = 0.5;
  const inCanvas = ([x, y], pad = 0) => x - pad >= -tol && y - pad >= -tol && x + pad <= canvas.width + tol && y + pad <= canvas.height + tol;
  for (const g of glyphs) assert.ok(g.pts.every((p) => inCanvas(p)), `${label}: 글자 '${g.text}' 가 캔버스 밖`);
  for (const m of ctx.marks.filter((x) => x.type === 'extent')) {
    for (const s of m.path) {
      const px = (s.rx ?? s.r ?? 0) + m.lw / 2;
      const py = (s.ry ?? s.r ?? 0) + m.lw / 2;
      assert.ok(inCanvas([s.p[0] - px, s.p[1] - py]) && inCanvas([s.p[0] + px, s.p[1] + py]), `${label}: 선·면이 캔버스 밖 ${JSON.stringify(s.p)} r=${s.r ?? [s.rx, s.ry]}`);
    }
  }
  const inks = glyphs.map((g) => shrink(g.pts, 0.9));
  for (let i = 0; i < inks.length; i++) {
    for (let j = i + 1; j < inks.length; j++) {
      assert.ok(!polysOverlap(inks[i], inks[j]), `${label}: 글자 '${glyphs[i].text}'(${i}) 와 '${glyphs[j].text}'(${j}) 가 겹침`);
    }
    for (const r of ctx.marks.filter((m) => m.type === 'ring')) {
      const [lo, hi] = distRange(inks[i], r.c);
      assert.ok(hi <= r.r - r.lw / 2 || lo >= r.r + r.lw / 2, `${label}: 글자 '${glyphs[i].text}' 가 원 선(r=${r.r.toFixed(1)})에 닿음`);
    }
    for (const d of ctx.marks.filter((m) => m.type === 'disc')) {
      assert.ok(distRange(inks[i], d.c)[0] >= d.r, `${label}: 글자 '${glyphs[i].text}' 가 점에 닿음`);
    }
    for (const q of ctx.marks.filter((m) => m.type === 'poly')) {
      assert.ok(!polysOverlap(inks[i], q.pts), `${label}: 글자 '${glyphs[i].text}' 가 별·마름모에 닿음`);
    }
  }
  return glyphs;
}

test('검사 도구: 겹친 글자, 선에 닿은 글자, 캔버스 밖을 잡아낸다', () => {
  const make = (draw) => {
    const c = document.createElement('canvas');
    c.width = 100;
    c.height = 100;
    const ctx = c.getContext('2d');
    ctx.font = '20px x';
    ctx.beginPath();
    ctx.arc(50, 50, 40, 0, Math.PI * 2);
    ctx.stroke();
    draw(ctx);
    return c;
  };
  assert.doesNotThrow(() => inspect(make((ctx) => { ctx.fillText('가', 30, 50); ctx.fillText('나', 52, 50); }), 'ok'));
  assert.throws(() => inspect(make((ctx) => { ctx.fillText('가', 30, 50); ctx.fillText('나', 40, 52); }), 'x'), /겹침/);
  assert.throws(() => inspect(make((ctx) => ctx.fillText('가', 80, 50)), 'x'), /원 선/);
  assert.throws(() => inspect(make((ctx) => ctx.fillText('가', 95, 50)), 'x'), /캔버스 밖/);
  assert.throws(() => inspect(make((ctx) => { ctx.fillText('가', 40, 50); ctx.beginPath(); ctx.arc(52, 44, 3, 0, Math.PI * 2); ctx.fill(); }), 'x'), /점에 닿음/);
  const tri = (ctx, x) => { ctx.beginPath(); ctx.moveTo(x, 40); ctx.lineTo(x + 8, 52); ctx.lineTo(x - 8, 52); ctx.closePath(); ctx.fill(); };
  assert.doesNotThrow(() => inspect(make((ctx) => { ctx.fillText('가', 30, 50); tri(ctx, 60); }), 'ok'));
  assert.throws(() => inspect(make((ctx) => { ctx.fillText('가', 30, 50); tri(ctx, 45); }), 'x'), /별·마름모/);
});

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

test('12종 모두: 이름·인·가운데 선택지·읽는 순서·배율마다 캔버스 안에 겹치지 않게 그린다', () => {
  let n = 0;
  for (const shape of RING_EXTRA_SHAPES) {
    for (const [lang, name] of NAMES) {
      for (const sealCenter of SEAL_CENTERS.map((c) => c.id)) {
        for (const order of ['horizontal', 'vertical']) {
          for (const addIn of lang === 'ko' ? [false, true] : [false]) {
            const label = `${shape.id} ${name} ${sealCenter} ${order}${addIn ? ' +인' : ''}`;
            const glyphs = inspect(render(shape, lang, name, { sealCenter, order, addIn }), label);
            n++;
            // 둘레에는 이름 글자가 모두 있다. '인'은 가운데 '이름' 선택지일 때만 더해진다
            const drawn = glyphs.map((g) => g.text).join('');
            for (const ch of ringName(lang, [], stampChars(name, { lang }), name).filter(Boolean)) assert.ok(drawn.includes(ch), `${label}: '${ch}' 없음`);
          }
        }
      }
    }
  }
  assert.ok(n > 1000);
});

test('12종 모두: 배율 2.5 는 같은 배치를 2.5배로, 질감·번짐·회전도 오류 없이', () => {
  for (const shape of RING_EXTRA_SHAPES) {
    for (const [lang, name] of NAMES) {
      const a = render(shape, lang, name);
      const b = render(shape, lang, name, { mult: 2.5 });
      inspect(b, `${shape.id} ${name} x2.5`);
      assert.ok(Math.abs(b.width / a.width - 2.5) < 0.02 && Math.abs(b.height / a.height - 2.5) < 0.02, `${shape.id}: ${a.width}→${b.width}`);
      const ga = a.ctx.marks.filter((m) => m.type === 'glyph');
      const gb = b.ctx.marks.filter((m) => m.type === 'glyph');
      assert.equal(ga.length, gb.length, `${shape.id} ${name}: 배율에 따라 글자 수가 바뀜`);
      const fx = render(shape, lang, name, { texture: true, bleed: true, rotation: -8 });
      assert.ok(fx.width > a.width && fx.height > a.height, `${shape.id}: 회전한 캔버스가 커지지 않음`);
    }
  }
});

test('타원 2종은 가로로 긴 캔버스, 나머지는 정사각', () => {
  for (const shape of RING_EXTRA_SHAPES) {
    const c = render(shape, 'ko', '홍길동');
    if (shape.id.startsWith('ring-oval')) assert.ok(c.height / c.width < 0.72 && c.height / c.width > 0.62, `${shape.id}: ${c.width}x${c.height}`);
    else assert.equal(c.width, c.height, shape.id);
  }
});

test('음각 띠: 둘레 이름은 지워서(흰 글자) 쓰고, 번짐은 지우기 전에 한 번만', () => {
  const shape = RING_EXTRA_SHAPES.find((s) => s.id === 'ring-inverted');
  const c = render(shape, 'ko', '홍길동', { bleed: true, sealCenter: 'jikin' });
  const glyphs = c.ctx.marks.filter((m) => m.type === 'glyph');
  assert.deepEqual(glyphs.filter((g) => g.out).map((g) => g.text).join(''), '홍길동');
  assert.deepEqual(glyphs.filter((g) => !g.out).map((g) => g.text).join(''), '직인');
  // 번진 그림을 한 번 붙인 뒤에 흰 글자를 지운다. renderStamp 가 다시 번지게 했다면 글자 없는 새 캔버스가 돌아온다
  const images = c.ctx.marks.flatMap((m, i) => (m.type === 'image' ? [i] : []));
  assert.equal(images.length, 1);
  assert.ok(images[0] < c.ctx.marks.findIndex((m) => m.out), '지운 뒤에 번짐');
  const plain = render(shape, 'ko', '홍길동', { bleed: false });
  assert.equal(plain.ctx.marks.filter((m) => m.type === 'image').length, 0);
});

test('아래 호 글: 연도, 고른 문구, 영문 EST.', () => {
  const texts = (shape, lang, name, extra) => render(shape, lang, name, extra).ctx.marks.filter((m) => m.type === 'glyph').map((g) => g.text).join('');
  for (const id of ['ring-arcs', 'ring-oval-tier', 'ring-west']) {
    const shape = RING_EXTRA_SHAPES.find((s) => s.id === id);
    assert.ok(texts(shape, 'ko', '홍길동', {}).includes('2026'), id);
    assert.ok(texts(shape, 'ko', '홍길동', { dateLabel: '확인' }).includes('확인'), id);
    assert.ok(texts(shape, 'en', 'Jane Doe', {}).includes('EST.2026'), id); // 띄어쓰기는 글자로 그리지 않는다
  }
});
