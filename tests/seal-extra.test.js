import { test } from 'node:test';
import assert from 'node:assert/strict';
// stamp-gen.js 를 먼저 읽어야 한다: stamp-seal-extra.js 와 서로 가져오므로, 이쪽을 먼저 읽으면
// stamp-gen.js 가 아직 만들어지지 않은 SEAL_EXTRA_SHAPES 를 펼치려다 멈춘다
import { STAMP_SHAPES } from '../js/stamp-gen.js';
import { SEAL_EXTRA_SHAPES, SEAL_EXTRA_DRAW, filletPoints, radialLayout, ovalContent } from '../js/stamp-seal-extra.js';
import { sealGlyph } from '../js/core/seal-glyph.js';

const IDS = [
  'seal-white', 'seal-mixed', 'seal-thick', 'seal-double', 'seal-interlock', 'seal-cross',
  'seal-oval', 'seal-fine', 'seal-curve', 'seal-fold3', 'seal-radial', 'seal-royal',
];

test('인장체 추가 12종: id·분류·이름표·그리기 함수', () => {
  // 조사 기반 12종이 앞에, 참고 도장 재현(인감체 2·삼첩 원·둥근 인장체 6)이 뒤에 붙는다
  assert.deepEqual(SEAL_EXTRA_SHAPES.slice(0, 12).map((s) => s.id), IDS);
  assert.equal(SEAL_EXTRA_SHAPES.length, 21);
  assert.equal(new Set(SEAL_EXTRA_SHAPES.map((s) => s.id)).size, 21, 'id 중복');
  assert.equal(new Set(SEAL_EXTRA_SHAPES.map((s) => s.label)).size, 21, '이름 중복');
  for (const s of SEAL_EXTRA_SHAPES) {
    assert.equal(s.cat, 'seal', s.id);
    assert.ok(['인장체', '인감체'].includes(s.fontLabel), s.id);
    assert.ok(s.label.length > 0 && Array.from(s.label).length <= 8, `${s.id}: 이름 길이 ${s.label}`);
    assert.equal(typeof SEAL_EXTRA_DRAW[s.special], 'function', `${s.id}: 그리기 함수 ${s.special}`);
  }
  // 흰 글자를 지워 내는 두 모양만 번짐을 스스로 준다
  assert.deepEqual(SEAL_EXTRA_SHAPES.filter((s) => s.selfBleed).map((s) => s.id), ['seal-white', 'seal-mixed']);
});

test('인장체 추가 12종: 전체 목록 끝에 붙고 기존 인장체 4종과 id 가 겹치지 않는다', () => {
  const seal = STAMP_SHAPES.filter((s) => s.cat === 'seal');
  assert.deepEqual(seal.map((s) => s.id).slice(0, 16), ['seal-square', 'seal-circle', 'seal-folded-square', 'seal-folded-circle', ...IDS]);
  // 인장체 추가 21종은 목록에 순서대로 들어 있다 (뒤에 둘레글자 추가 모양이 더 붙는다)
  const sealIds = new Set(SEAL_EXTRA_SHAPES.map((s) => s.id));
  assert.deepEqual(STAMP_SHAPES.filter((s) => sealIds.has(s.id)).map((s) => s.id), SEAL_EXTRA_SHAPES.map((s) => s.id));
  assert.equal(new Set(STAMP_SHAPES.map((s) => s.id)).size, STAMP_SHAPES.length, '전체 id 중복');
  // 기존 모양의 special 을 가로채지 않는다
  const old = new Set(STAMP_SHAPES.filter((s) => !sealIds.has(s.id)).map((s) => s.special).filter(Boolean));
  for (const s of SEAL_EXTRA_SHAPES) assert.ok(!old.has(s.special), s.special);
});

test('삼첩(folds: 1): 11,172 음절 모두 비지 않은 직각 획, 좌표는 [0,1] 안', () => {
  for (const stroke of [0.07, 0.085, { x: 0.06, y: 0.1 }]) {
    for (let i = 0; i < 11172; i += stroke === 0.07 ? 1 : 5) {
      const ch = String.fromCharCode(0xac00 + i);
      const g = sealGlyph(ch, { style: 'folded', folds: 1, stroke });
      assert.ok(g && g.paths.length + g.shapes.length > 0, ch);
      assert.ok(g.fit > 0 && g.fit <= 1, `${ch} fit`);
      for (const p of g.paths) {
        for (let k = 0; k < p.length; k++) {
          const [x, y] = p[k];
          assert.ok(Number.isFinite(x) && Number.isFinite(y) && x >= -1e-9 && x <= 1 + 1e-9 && y >= -1e-9 && y <= 1 + 1e-9, `${ch} (${x}, ${y})`);
          if (k) assert.ok(Math.abs(x - p[k - 1][0]) < 1e-9 || Math.abs(y - p[k - 1][1]) < 1e-9, `${ch}: 비스듬한 마디`);
        }
      }
    }
  }
});

test('삼첩(folds: 1)은 기본형과 구첩(folds: 3) 사이: 꺾임 수가 그 사이에 있다', () => {
  const count = (g) => g.paths.reduce((t, p) => t + p.length, 0) + g.shapes.length * 4;
  let between = 0;
  for (const ch of ['가', '나', '마', '이', '홍', '동', '름', '궁']) {
    const plain = count(sealGlyph(ch, { stroke: 0.06 }));
    const one = count(sealGlyph(ch, { style: 'folded', folds: 1, stroke: 0.06 }));
    const three = count(sealGlyph(ch, { style: 'folded', stroke: 0.06 }));
    assert.ok(plain <= one && one <= three, `${ch}: ${plain} ≤ ${one} ≤ ${three}`);
    if (plain < one && one < three) between++;
  }
  assert.ok(between >= 3, `뚜렷하게 사이인 글자 ${between}`);
});

test('모서리 굴리기(소전 곡선): 끝점은 그대로, 점은 유한, 원래 선 근처에 머문다', () => {
  const L = [[0, 0], [100, 0], [100, 80]];
  const out = filletPoints(L, false, 12);
  assert.deepEqual(out[0], [0, 0]);
  assert.deepEqual(out[out.length - 1], [100, 80]);
  assert.ok(out.length > L.length);
  for (const [x, y] of out) assert.ok(Number.isFinite(x) && Number.isFinite(y));
  // 꺾인 곳 가까이 원호: 모서리 점(100, 0)에서 r(√2−1) 쯤 떨어진 곳을 지난다
  const d = Math.min(...out.map(([x, y]) => Math.hypot(x - 100, y)));
  assert.ok(Math.abs(d - 12 * (Math.SQRT2 - 1)) < 0.6, `모서리 거리 ${d}`);
  // 닫힌 사각형: 모든 점이 사각형 안
  const sq = filletPoints([[0, 0], [50, 0], [50, 50], [0, 50]], true, 10);
  for (const [x, y] of sq) assert.ok(x >= -1e-9 && x <= 50 + 1e-9 && y >= -1e-9 && y <= 50 + 1e-9);
  // 짧은 마디는 절반까지만 깎는다 (이웃 원호와 겹치지 않게), 날카로운 꺾임(N 의 대각선)도 유한
  for (const pts of [[[0, 0], [4, 0], [4, 40]], [[0, 100], [0, 0], [60, 100], [60, 0]]]) {
    const f = filletPoints(pts, false, 12);
    for (const [x, y] of f) assert.ok(Number.isFinite(x) && Number.isFinite(y));
    assert.ok(Math.max(...f.map(([x]) => x)) <= Math.max(...pts.map(([x]) => x)) + 1e-9);
  }
  // 반지름 0 이거나 점이 둘이면 그대로
  assert.deepEqual(filletPoints(L, false, 0), L);
  assert.deepEqual(filletPoints([[0, 0], [5, 5]], false, 3), [[0, 0], [5, 5]]);
});

test('방사 배치: 칸이 테 안쪽 원 안, 이웃과 가운데 점에서 떨어져 있다', () => {
  for (const n of [2, 3, 4, 5]) {
    const R = 160;
    const dot = 16;
    const gap = 9;
    const { w, h, rc } = radialLayout(n, R, dot, gap, n === 2 ? 1.25 : 1);
    assert.ok(w > 0 && h > 0 && Number.isFinite(rc), `n=${n}`);
    assert.ok(Math.hypot(rc + h / 2, w / 2) <= R + 1e-6, `n=${n}: 바깥 모서리가 원 밖`);
    assert.ok(rc - h / 2 >= dot + gap - 1e-6, `n=${n}: 가운데 점과 겹침`);
    if (n > 2) {
      // 이웃 칸의 안쪽 모서리 사이 거리가 gap 이상
      const corner = (a) => {
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        return [ux * (rc - h / 2) - uy * (w / 2), uy * (rc - h / 2) + ux * (w / 2)];
      };
      const p = corner(0);
      const a2 = (Math.PI * 2) / n;
      const q = [Math.cos(a2) * (rc - h / 2) + Math.sin(a2) * (w / 2), Math.sin(a2) * (rc - h / 2) - Math.cos(a2) * (w / 2)];
      assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) >= gap * 0.99, `n=${n}: 이웃 칸과 겹침`);
    }
    // 칸이 너무 작지 않다 (반지름의 40% 이상)
    assert.ok(Math.min(w, h) > R * 0.4, `n=${n}: 칸 ${Math.min(w, h)}`);
  }
});

test('타원 격자: 칸이 모자라지 않고 끝 줄이 비지 않으며, 세로로 길다', () => {
  for (let n = 1; n <= 15; n++) {
    const c = ovalContent(n);
    assert.equal(c.n, n);
    if (c.three) {
      assert.equal(n, 3);
      continue;
    }
    assert.ok(c.cols * c.rows >= n, `n=${n}`);
    assert.ok(c.cols * (c.rows - 1) < n, `n=${n}: 빈 줄`);
    assert.ok(c.rows >= c.cols, `n=${n}: 가로로 긴 격자 ${c.cols}×${c.rows}`);
  }
  assert.deepEqual(ovalContent(2), { cols: 1, rows: 2, n: 2 });
  assert.deepEqual(ovalContent(4), { cols: 2, rows: 2, n: 4 });
});
