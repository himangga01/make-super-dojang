import { test } from 'node:test';
import assert from 'node:assert/strict';
// stamp-gen.js 를 먼저 읽어야 한다 (확장 모듈과 서로 가져온다)
import { STAMP_SHAPES, STAMP_CATEGORIES } from '../js/stamp-gen.js';
import { RING_EXTRA_SHAPES, RING_EXTRA_DRAW, SEAL_RING, sealRingSlots, ringCellMaxW } from '../js/stamp-ring-extra.js';
import { SEAL_EXTRA_SHAPES, SEAL_EXTRA_DRAW, ROUND_SEAL, roundGlyphInfo } from '../js/stamp-seal-extra.js';
import { sealGlyph } from '../js/core/seal-glyph.js';

const RING_IDS = ['ring-seal-dot', 'ring-seal-star', 'ring-fold3-dot', 'ring-fold3-star', 'ring-folded-dot', 'ring-folded-star'];
const SEAL_IDS = [
  'seal-fold3-circle',
  'seal-round-plain-square', 'seal-round-fold3-square', 'seal-round-folded-square',
  'seal-round-plain-circle', 'seal-round-fold3-circle', 'seal-round-folded-circle',
];
const DEG = Math.PI / 180;
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ───────────── 모양 목록 ─────────────

test('참고 그림 13종: id 가 전체 목록에서 겹치지 않고, 각 확장 목록에 순서대로 들어 있다', () => {
  const ids = STAMP_SHAPES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, '전체 id 중복');
  for (const id of [...RING_IDS, ...SEAL_IDS]) assert.ok(ids.includes(id), `${id} 없음`);
  // 인감체 모양도 같은 확장 목록에 붙으므로 끝 자리 대신 순서만 본다
  const inOrder = (list, want) => list.map((s) => s.id).filter((id) => want.includes(id));
  assert.deepEqual(inOrder(RING_EXTRA_SHAPES, RING_IDS), RING_IDS);
  assert.deepEqual(inOrder(SEAL_EXTRA_SHAPES, SEAL_IDS), SEAL_IDS);
  // 기존 모양의 special 을 가로채지 않는다
  const fresh = new Set([...RING_IDS, ...SEAL_IDS]);
  const old = new Set(STAMP_SHAPES.filter((s) => !fresh.has(s.id)).map((s) => s.special).filter(Boolean));
  for (const s of STAMP_SHAPES.filter((x) => fresh.has(x.id))) assert.ok(!old.has(s.special), s.special);
});

test('인장체 직인 6종: 둘레글자 분류, 직인 가운데 글자 선택지를 쓰고, 이름표 아래에 인장체', () => {
  const list = RING_IDS.map((id) => STAMP_SHAPES.find((s) => s.id === id));
  for (const s of list) {
    assert.equal(s.cat, 'ring', s.id);
    assert.ok(STAMP_CATEGORIES.some((c) => c.id === s.cat));
    assert.equal(s.sealCenter, true, `${s.id}: sealCenter (한자 글꼴을 미리 받는다)`);
    assert.equal(s.fontLabel, '인장체', s.id);
    assert.ok(!s.selfBleed, `${s.id}: 번짐은 renderStamp 가 준다`);
    assert.ok(s.label && Array.from(s.label).length <= 8, `${s.id}: ${s.label}`);
    assert.equal(typeof RING_EXTRA_DRAW[s.special], 'function', `${s.id}: 그리기 함수`);
  }
  assert.equal(new Set(list.map((s) => s.label)).size, list.length, '이름표 중복');
});

test('삼첩 원 · 둥근 인장체 6종: 인장체 분류, 이름표 아래에 인장체', () => {
  const list = SEAL_IDS.map((id) => STAMP_SHAPES.find((s) => s.id === id));
  for (const s of list) {
    assert.equal(s.cat, 'seal', s.id);
    assert.equal(s.fontLabel, '인장체', s.id);
    assert.ok(!s.sealCenter && !s.selfBleed, s.id);
    assert.ok(s.label && Array.from(s.label).length <= 8, `${s.id}: ${s.label}`);
    assert.equal(typeof SEAL_EXTRA_DRAW[s.special], 'function', `${s.id}: 그리기 함수`);
  }
  const labels = STAMP_SHAPES.map((s) => s.label);
  for (const s of list) assert.equal(labels.filter((l) => l === s.label).length, 1, `${s.label} 이름표 중복`);
});

// ───────────── 둘레 칸 ─────────────

test('sealRingSlots: 네 자는 맨 위 표시 자리를 조금 넓혀 고르게 (참고 그림처럼 약 ±59°, ±140°)', () => {
  const { step, angles, markerW } = sealRingSlots(4);
  assert.equal(markerW, SEAL_RING.marker);
  assert.ok(close(step, (Math.PI * 2) / (4 + SEAL_RING.marker)));
  assert.ok(Math.abs(angles[0] / DEG - 58.7) < 0.5, `첫 글자 ${angles[0] / DEG}°`);
  assert.ok(Math.abs(angles[1] / DEG - 139.6) < 0.5, `둘째 글자 ${angles[1] / DEG}°`);
  // 위아래로 대칭이고, 맨 위를 사이에 둔 두 글자 사이가 다른 글자 사이보다 넓다
  for (let i = 0; i < 4; i++) assert.ok(close(angles[i] + angles[3 - i], Math.PI * 2), `대칭 ${i}`);
  for (let i = 1; i < 4; i++) assert.ok(close(angles[i] - angles[i - 1], step));
  assert.ok(Math.PI * 2 - angles[3] + angles[0] > step);
});

test('sealRingSlots: 다섯 자부터는 맨 위 표시가 한 칸을 차지한다 (둘레글자 원과 같은 규칙)', () => {
  for (const n of [5, 6, 8, 12]) {
    const { step, angles, markerW } = sealRingSlots(n);
    assert.equal(markerW, 1);
    assert.ok(close(step, (Math.PI * 2) / (n + 1)), `n=${n}`);
    assert.ok(close(angles[0], step), `n=${n} 첫 칸`);
    assert.ok(close(angles[n - 1], Math.PI * 2 - step), `n=${n} 끝 칸`);
  }
  // 짧은 이름은 ringUnits 가 되풀이해 늘 네 칸 이상이다. 세 자도 고르고 위아래 대칭
  const three = sealRingSlots(3);
  assert.ok(close(three.angles[1], Math.PI), '세 자의 가운데 글자는 맨 아래');
});

test('ringCellMaxW: 그 폭이면 안쪽 모서리가 이웃 칸과의 경계(이등분선)에서 gap/2 떨어진다', () => {
  for (const n of [4, 7, 9, 13]) {
    const { step } = sealRingSlots(n);
    const r = 150;
    const h = 60;
    const gap = 8;
    const w = ringCellMaxW(r, h, step, gap);
    assert.ok(w > 0, `n=${n}`);
    // 칸 축이 각도 0 일 때 안쪽 모서리 (w/2, r - h/2) 와 각도 step/2 의 이등분선 사이 거리
    const dist = (r - h / 2) * Math.sin(step / 2) - (w / 2) * Math.cos(step / 2);
    assert.ok(close(dist, gap / 2, 1e-6), `n=${n}: ${dist}`);
  }
  // 칸이 많을수록 좁아지고, 자리가 없으면 0
  assert.ok(ringCellMaxW(150, 60, sealRingSlots(5).step, 8) > ringCellMaxW(150, 60, sealRingSlots(12).step, 8));
  assert.equal(ringCellMaxW(10, 60, 0.1, 50), 0);
});

// ───────────── 둥근 인장체 ─────────────

test('ROUND_SEAL: 단계마다 참고 꼴(ref1 · ref2 · ref3), 긋는 굵기는 단계와 상관없이 거의 같고 간격용 굵기보다 가늘다', () => {
  const { plain, fold3, folded } = ROUND_SEAL.levels;
  assert.deepEqual([plain.variant, fold3.variant, folded.variant], ['ref1', 'ref2', 'ref3']);
  assert.ok(ROUND_SEAL.draw > 0 && ROUND_SEAL.draw < 1);
  // 참고 도장은 세 단계 모두 글자 획이 도장의 약 2.9% (도장 77px 에서 2.1~2.3px)
  const drawn = [plain, fold3, folded].map((L) => L.k * ROUND_SEAL.draw);
  assert.ok(Math.max(...drawn) / Math.min(...drawn) < 1.05, drawn.join());
  assert.ok(plain.k >= fold3.k && fold3.k >= folded.k, '획이 많은 단계일수록 간격용 굵기는 같거나 작다');
  for (const L of [plain, fold3, folded]) assert.ok(L.ring > 0 && L.ring < 0.2, `둘레 글자 k ${L.ring}`);
  assert.ok(ROUND_SEAL.clear.square >= 2 && ROUND_SEAL.clear.circle >= ROUND_SEAL.clear.square, '테와 글자 사이 흰 틈은 획 둘 넘게');
});

test('roundGlyphInfo: 단계의 참고 꼴로 긋고, ㅇ 은 알약 하나 (ㅎ 안의 ㅇ 포함)', () => {
  const sw = 6;
  for (const level of ['plain', 'fold3', 'folded']) {
    // ㅇ(ㅎ 안의 ㅇ 포함) 하나에 테 하나: 이 1, 응 2, 홍 2
    for (const [ch, n] of [['이', 1], ['응', 2], ['홍', 2]]) {
      const g = roundGlyphInfo(ch, level, sw, 120, 120);
      assert.equal(g.shapes.length, n, `${level} ${ch}: ㅇ 테 ${g.shapes.length}`);
    }
    const L = ROUND_SEAL.levels[level];
    const a = roundGlyphInfo('름', level, sw, 120, 100);
    const b = sealGlyph('름', { style: L.style, folds: L.folds, ringFolds: L.ringFolds, flatTick: true, variant: L.variant, stroke: { x: sw / 120, y: sw / 100 } });
    assert.deepEqual(a, b, level);
    assert.notDeepEqual(a, sealGlyph('름', { stroke: { x: sw / 120, y: sw / 100 } }), `${level}: 기본 인장체와 다르다`);
  }
  // 인장체가 없는 글자는 null (그리는 쪽이 글꼴로 그린다), 영문 소문자는 대문자로
  assert.equal(roundGlyphInfo('·', 'plain', sw, 100, 100), null);
  assert.deepEqual(roundGlyphInfo('j', 'plain', sw, 100, 100), roundGlyphInfo('J', 'plain', sw, 100, 100));
});

test('sealGlyph ringFolds: 주지 않으면 예전과 같고(folds 를 따른다), 0 이면 ㅇ 겹 테만 없앤다', () => {
  const stroke = 0.05;
  for (const ch of ['이', '응', '홍', '동', '름', '앙']) {
    for (const folds of [undefined, 1, 3]) {
      const base = sealGlyph(ch, { style: 'folded', folds, stroke });
      assert.deepEqual(sealGlyph(ch, { style: 'folded', folds, ringFolds: folds ?? 3, stroke }), base, `${ch} folds ${folds}`);
      const flat = sealGlyph(ch, { style: 'folded', folds, ringFolds: 0, stroke });
      assert.deepEqual(flat.paths, base.paths, `${ch}: 획은 그대로`);
      assert.equal(flat.fit, base.fit);
      const outer = (g) => g.shapes.filter((s, i) => i === 0 || g.shapes[i - 1].x >= s.x); // 겹 테는 바로 앞 테보다 안쪽
      assert.equal(flat.shapes.length, outer(flat).length);
      assert.ok(flat.shapes.length <= base.shapes.length);
    }
  }
  assert.ok(sealGlyph('이', { style: 'folded', stroke }).shapes.length > 1, '기본 구첩 ㅇ 은 겹 테');
  // 기본형은 ringFolds 와 상관없다
  assert.deepEqual(sealGlyph('응', { stroke, ringFolds: 3 }), sealGlyph('응', { stroke }));
});

test('sealGlyph flatTick: 주지 않으면 예전과 같고, 켜면 ㅊ·ㅎ 꼭지만 짧은 가로획 (직각 획, [0,1] 안)', () => {
  const stroke = 0.06;
  const vertical = (p) => p.length === 2 && Math.abs(p[0][0] - p[1][0]) < 1e-12;
  const horizontal = (p) => p.length === 2 && Math.abs(p[0][1] - p[1][1]) < 1e-12;
  for (const style of ['plain', 'folded']) {
    for (const ch of ['회', '홍', '최', '참', '힣', '가', '름']) {
      const base = sealGlyph(ch, { style, stroke });
      assert.deepEqual(sealGlyph(ch, { style, stroke, flatTick: false }), base, `${style} ${ch}`);
      const flat = sealGlyph(ch, { style, stroke, flatTick: true });
      assert.equal(flat.fit, base.fit, `${ch}: 획 간격 여유는 그대로`);
      if (!/[회홍최참힣]/.test(ch)) {
        assert.deepEqual(flat, base, `${ch}: ㅊ·ㅎ 이 없으면 그대로`);
        continue;
      }
      // 맨 위(y 가 가장 작은) 획: 기본은 세로 꼭지, flatTick 은 가로 꼭지
      const top = (g) => g.paths.reduce((a, p) => (Math.min(...p.map((q) => q[1])) < Math.min(...a.map((q) => q[1])) ? p : a));
      if (ch !== '참') assert.ok(vertical(top(base)), `${style} ${ch}: 기본 꼭지는 세로`);
      const t = top(flat);
      assert.ok(horizontal(t), `${style} ${ch}: flatTick 꼭지는 가로`);
      assert.ok(Math.abs(t[0][0] + t[1][0] - 1) < 0.5 && Math.abs(t[1][0] - t[0][0]) < 0.8, `${ch}: 짧고 가운데`);
      for (const p of flat.paths) {
        for (let k = 0; k < p.length; k++) {
          const [x, y] = p[k];
          assert.ok(x >= -1e-9 && x <= 1 + 1e-9 && y >= -1e-9 && y <= 1 + 1e-9, `${ch} (${x}, ${y})`);
          if (k) assert.ok(Math.abs(x - p[k - 1][0]) < 1e-9 || Math.abs(y - p[k - 1][1]) < 1e-9, `${ch}: 비스듬한 마디`);
        }
      }
    }
  }
});

// ───────────── 가짜 canvas 로 그려 보기 ─────────────
// Node 에는 canvas 가 없어서, 변환 행렬만 따라가며 선·면·글자를 어디에 그렸는지 기록한다.
// 둘레 글자는 글자마다 save → translate → rotate 로 그리므로, 같은 변환 행렬로 그은 선을 글자 하나로 묶는다.
// arcTo 는 조절점(모서리)을 그대로 기록하므로 둥근 사각은 경계 상자로 넉넉하게 잰다

class FakeCtx {
  constructor(canvas) {
    Object.assign(this, { canvas, m: [1, 0, 0, 1, 0, 0], stack: [], lineWidth: 1, font: '10px x', textAlign: 'start', textBaseline: 'alphabetic' });
    Object.assign(this, { globalCompositeOperation: 'source-over', globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', marks: [], path: [] });
  }
  save() { this.stack.push([[...this.m], this.lineWidth, this.font, this.globalCompositeOperation]); }
  restore() { [this.m, this.lineWidth, this.font, this.globalCompositeOperation] = this.stack.pop(); }
  translate(x, y) { const [a, b, c, d, e, f] = this.m; this.m = [a, b, c, d, a * x + c * y + e, b * x + d * y + f]; }
  rotate(t) { const [a, b, c, d, e, f] = this.m; const cs = Math.cos(t); const sn = Math.sin(t); this.m = [a * cs + c * sn, b * cs + d * sn, c * cs - a * sn, d * cs - b * sn, e, f]; }
  scale(x, y) { const [a, b, c, d, e, f] = this.m; this.m = [a * x, b * x, c * y, d * y, e, f]; }
  k() { return Math.hypot(this.m[0], this.m[1]); }
  pt(x, y) { const [a, b, c, d, e, f] = this.m; return [a * x + c * y + e, b * x + d * y + f]; }
  measureText(t) {
    const px = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 10);
    const w = Array.from(t).length * px * 0.9;
    return { width: w, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w, actualBoundingBoxAscent: px * 0.8, actualBoundingBoxDescent: px * 0.1 };
  }
  fillText(t, x, y) { this.marks.push({ type: 'text', text: t, key: this.m.slice(0, 4).join(), p: this.pt(x, y) }); }
  beginPath() { this.path = []; }
  closePath() {}
  moveTo(x, y) { this.path.push({ p: this.pt(x, y) }); }
  lineTo(x, y) { this.path.push({ p: this.pt(x, y) }); }
  arcTo(x1, y1, x2, y2) { this.path.push({ p: this.pt(x1, y1) }, { p: this.pt(x2, y2) }); }
  rect(x, y, w, h) { for (const [px, py] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) this.path.push({ p: this.pt(px, py) }); }
  arc(x, y, r) { this.path.push({ c: this.pt(x, y), r: r * this.k() }); }
  ellipse(x, y, a, b) { this.path.push({ c: this.pt(x, y), r: Math.max(a, b) * this.k() }); }
  stroke() { this.marks.push({ type: 'stroke', path: this.path, lw: this.lineWidth * this.k(), key: this.m.join() }); }
  fill() { this.marks.push({ type: 'fill', path: this.path }); }
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

const { renderStamp, SEAL_CENTERS } = await import('../js/stamp-gen.js');
const { stampChars } = await import('../js/core/text.js');
const { ringUnits } = await import('../js/stamp-gen.js');

function render(id, lang, name, extra = {}) {
  const shape = STAMP_SHAPES.find((s) => s.id === id);
  const chars = stampChars(name, { addIn: extra.addIn ?? false, lang });
  const baseChars = stampChars(name, { addIn: false, lang });
  const font = lang === 'ko' ? { family: 'Nanum Myeongjo', weight: 800 } : { family: 'Cinzel', weight: 700 };
  return renderStamp({ lang, chars, baseChars, text: name, shape, font, order: 'horizontal', ink: '#c8102e', sealCenter: 'daepyo-hanja', mult: 1, ...extra });
}

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

/** 볼록 다각형 둘 사이 거리가 d 보다 먼지 (분리축 위 투영 간격으로 잰다) */
function apart(A, B, d) {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const [x1, y1] = P[i];
      const [x2, y2] = P[(i + 1) % P.length];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const nx = (y1 - y2) / len;
      const ny = (x2 - x1) / len;
      const a = A.map(([x, y]) => x * nx + y * ny);
      const b = B.map(([x, y]) => x * nx + y * ny);
      if (Math.min(...b) - Math.max(...a) >= d || Math.min(...a) - Math.max(...b) >= d) return true;
    }
  }
  return false;
}

/**
 * 인장체 직인 검사: 둘레 글자 획이 바깥 테와 가운데 원 사이 띠 안에 있고, 글자끼리·맨 위 표시·점과 떨어져 있고,
 * 이름 글자 수만큼 그렸는지. 돌려 준 값은 둘레 글자 묶음
 */
function inspectRing(canvas, units, label) {
  const ctx = canvas.ctx;
  assert.equal(canvas.width, canvas.height, `${label}: 정사각 캔버스`);
  const c = [canvas.width / 2, canvas.height / 2];
  const strokes = ctx.marks.filter((m) => m.type === 'stroke');
  const circles = strokes.filter((m) => m.path.length === 1 && m.path[0].r != null).map((m) => ({ r: m.path[0].r, lw: m.lw }));
  assert.equal(circles.length, 2, `${label}: 바깥 테와 가운데 원`);
  const [rim, inner] = circles.sort((a, b) => b.r - a.r);
  const lo = inner.r + inner.lw / 2;
  const hi = rim.r - rim.lw / 2;
  assert.ok(rim.r + rim.lw / 2 <= canvas.width / 2 + 0.5, `${label}: 테가 캔버스 밖`);
  // 둘레 글자: 돌린 문맥에서 그은 선(인장체)과 글자(인장체가 없는 글자)
  const groups = new Map();
  for (const m of strokes) {
    if (m.key === '1,0,0,1,0,0' || m.path.some((s) => s.r != null)) continue;
    const [, , , , x, y] = m.key.split(',').map(Number); // 글자 칸 가운데 (translate)
    const g = groups.get(m.key) ?? { pts: [], lw: m.lw, at: [x, y] };
    g.pts.push(...m.path.map((s) => s.p));
    groups.set(m.key, g);
  }
  // 인장체가 없어 글꼴로 쓴 둘레 글자 (가운데 글자는 가운데 원 안)
  const texts = ctx.marks.filter((m) => m.type === 'text' && Math.hypot(m.p[0] - c[0], m.p[1] - c[1]) > inner.r);
  assert.equal(groups.size + texts.length, units.filter((u) => u !== null).length, `${label}: 둘레 글자 수`);
  const list = [...groups.values()];
  for (const g of list) {
    const d = g.pts.map(([x, y]) => Math.hypot(x - c[0], y - c[1]));
    assert.ok(Math.min(...d) - g.lw / 2 >= lo - 0.01, `${label}: 글자가 가운데 원에 닿음 (${(Math.min(...d) - g.lw / 2).toFixed(2)} < ${lo.toFixed(2)})`);
    assert.ok(Math.max(...d) + g.lw / 2 <= hi + 0.01, `${label}: 글자가 바깥 테에 닿음 (${(Math.max(...d) + g.lw / 2).toFixed(2)} > ${hi.toFixed(2)})`);
    g.hull = hull(g.pts);
  }
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) assert.ok(apart(list[i].hull, list[j].hull, list[i].lw), `${label}: 둘레 글자 ${i}·${j} 가 겹침`);
  }
  // 맨 위 표시(● 또는 ★)와 되풀이 사이 점: 가운데 원 밖에 채운 것
  const fills = ctx.marks.filter((m) => m.type === 'fill').map((m) => {
    if (m.path.length === 1 && m.path[0].r != null) {
      const { c: p, r } = m.path[0];
      return { pts: Array.from({ length: 12 }, (_, i) => [p[0] + r * Math.cos((i * Math.PI) / 6), p[1] + r * Math.sin((i * Math.PI) / 6)]), at: p };
    }
    const pts = m.path.map((s) => s.p);
    return { pts: hull(pts), at: [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length] };
  }).filter((f) => Math.hypot(f.at[0] - c[0], f.at[1] - c[1]) > lo);
  const top = fills.filter((f) => Math.abs(f.at[0] - c[0]) < 0.5 && f.at[1] < c[1]);
  assert.equal(top.length, 1, `${label}: 맨 위 표시`);
  assert.equal(fills.length, 1 + units.filter((u) => u === null).length, `${label}: 점 수`);
  for (const f of fills) for (const g of list) assert.ok(apart(f.pts, g.hull, g.lw / 2), `${label}: 글자가 점·별에 닿음`);
  return list;
}

const NAMES = [
  ['ko', '이'], ['ko', '김지'], ['ko', '홍길동'], ['ko', '회사이름'], ['ko', '남궁민수'], ['ko', '주식회사지혜행정'],
  ['ko', '가나다라마바사아자차카타파하'], ['ko', '홍길동ABC'], ['ko', '뷁쀍'],
  ['en', 'A'], ['en', 'Lee'], ['en', 'Jane Doe'], ['en', 'Acme Holdings Inc'],
];

test('인장체 직인 6종: 이름·인·가운데 선택지·읽는 순서마다 둘레 글자가 띠 안에 겹치지 않게', () => {
  let n = 0;
  for (const id of RING_IDS) {
    for (const [lang, name] of NAMES) {
      const units = ringUnits(lang, stampChars(name, { lang }), stampChars(name, { lang }), name);
      for (const sealCenter of SEAL_CENTERS.map((x) => x.id)) {
        for (const order of ['horizontal', 'vertical']) {
          for (const addIn of lang === 'ko' ? [false, true] : [false]) {
            const label = `${id} ${name} ${sealCenter} ${order}${addIn ? ' +인' : ''}`;
            inspectRing(render(id, lang, name, { sealCenter, order, addIn }), units, label);
            n++;
          }
        }
      }
    }
  }
  assert.ok(n > 1000, String(n));
});

test('인장체 직인 6종: 배율 2.5 는 같은 배치를 2.5배로, 질감·번짐·회전도 오류 없이', () => {
  for (const id of RING_IDS) {
    for (const [lang, name] of NAMES) {
      const units = ringUnits(lang, stampChars(name, { lang }), stampChars(name, { lang }), name);
      const a = render(id, lang, name);
      const b = render(id, lang, name, { mult: 2.5 });
      const ga = inspectRing(a, units, `${id} ${name}`);
      const gb = inspectRing(b, units, `${id} ${name} x2.5`);
      assert.ok(Math.abs(b.width / a.width - 2.5) < 0.02, `${id}: ${a.width}→${b.width}`);
      assert.equal(ga.length, gb.length);
      ga.forEach((g, i) => assert.ok(Math.abs(gb[i].lw / g.lw - 2.5) < 1e-6, `${id} ${name}: 획 굵기도 2.5배`));
      const fx = render(id, lang, name, { texture: true, bleed: true, rotation: -8, ink: '#1f3a93' });
      assert.ok(fx.width > a.width, `${id}: 회전한 캔버스가 커지지 않음`);
    }
  }
});

test('인장체 직인: 다섯 자 이상은 맨 위 한 칸을 비우고, 네 자 이하는 표시를 사이에 둔다', () => {
  const angle = (g, c) => ((Math.atan2(g.at[0] - c, -(g.at[1] - c)) / DEG) + 360) % 360; // 맨 위에서 시계 방향
  const four = render('ring-seal-dot', 'ko', '회사이름');
  const a4 = inspectRing(four, Array.from('회사이름'), '회사이름').map((g) => angle(g, four.width / 2)).sort((p, q) => p - q);
  a4.forEach((a, i) => assert.ok(Math.abs(a - sealRingSlots(4).angles[i] / DEG) < 3, `회사이름 ${i}: ${a}°`));
  const eight = render('ring-folded-star', 'ko', '주식회사지혜행정');
  const a8 = inspectRing(eight, Array.from('주식회사지혜행정'), '8자').map((g) => angle(g, eight.width / 2)).sort((p, q) => p - q);
  assert.ok(Math.abs(a8[0] - 40) < 3 && Math.abs(a8[7] - 320) < 3, a8.join());
});

test('둥근 인장체 6종 · 삼첩 원: 글자 획이 테 안쪽에 들어간다 (이름·인·읽는 순서·배율)', () => {
  for (const id of SEAL_IDS) {
    const round = id.endsWith('circle');
    for (const [lang, name] of NAMES) {
      for (const order of ['horizontal', 'vertical']) {
        for (const mult of [1, 2.5]) {
          const label = `${id} ${name} ${order} x${mult}`;
          const cv = render(id, lang, name, { order, mult, addIn: lang === 'ko' });
          const c = cv.width / 2;
          const [frame, ...glyphs] = cv.ctx.marks.filter((m) => m.type === 'stroke');
          assert.ok(glyphs.length > 0, `${label}: 글자 없음`);
          const half = 200 * mult - frame.lw; // 테 안쪽 (S/2 - 테 굵기)
          for (const g of glyphs) {
            for (const s of g.path) {
              const [x, y] = s.p;
              const d = round ? Math.hypot(x - c, y - cv.height / 2) : Math.max(Math.abs(x - c), Math.abs(y - cv.height / 2));
              assert.ok(d + g.lw / 2 <= half + 0.01, `${label}: 획이 테에 닿음 (${(d + g.lw / 2).toFixed(1)} > ${half.toFixed(1)})`);
            }
          }
        }
      }
    }
  }
});

// ───────────── 테 · 둘레와 글자 사이 흰 틈 ─────────────
// 글자 획 바깥 가장자리에서 테 안쪽 가장자리까지 흰 틈이 글자 긋는 굵기의 두 배 넘게 (이름 길이 · 배율 · 읽는 순서마다).
// 원은 격자를 원 안에 펴 넣어 칸 모서리가 테 쪽으로 밀려나므로 모서리(대각선 ±20°) 쪽을 따로 본다

const ROUND_IDS = SEAL_IDS.filter((id) => id.startsWith('seal-round-'));
const GAP_NAMES = [...NAMES, ['ko', '김'], ['ko', '김수'], ['ko', '가나다라마바사아자'], ['ko', '홍길동김지혜인']];

test('둥근 인장체 6종: 글자와 테 안쪽 사이 흰 틈이 글자 획 두 배 넘게 (원은 모서리 쪽도 따로)', () => {
  for (const id of ROUND_IDS) {
    const round = id.endsWith('circle');
    let cornerChecked = 0;
    for (const [lang, name] of GAP_NAMES) {
      for (const order of ['horizontal', 'vertical']) {
        for (const mult of [1, 2.5]) {
          for (const addIn of lang === 'ko' ? [false, true] : [false]) {
            const label = `${id} ${name} ${order} x${mult}${addIn ? ' +인' : ''}`;
            const cv = render(id, lang, name, { order, mult, addIn });
            const c = [cv.width / 2, cv.height / 2];
            const [frame, ...glyphs] = cv.ctx.marks.filter((m) => m.type === 'stroke');
            const inner = 200 * mult - frame.lw; // 테 안쪽 가장자리 (S/2 - 테 굵기)
            let white = Infinity;
            let cornerWhite = Infinity;
            for (const g of glyphs) {
              for (const s of g.path) {
                const dx = s.p[0] - c[0];
                const dy = s.p[1] - c[1];
                const d = round ? Math.hypot(dx, dy) : Math.max(Math.abs(dx), Math.abs(dy));
                const w = (inner - (d + g.lw / 2)) / g.lw;
                white = Math.min(white, w);
                const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 90; // 대각선은 45°
                if (round && Math.abs(a - 45) <= 20 && d > inner * 0.6) cornerWhite = Math.min(cornerWhite, w);
              }
            }
            assert.ok(white >= 2, `${label}: 흰 틈 ${white.toFixed(2)} 획`);
            if (round && cornerWhite < Infinity) {
              cornerChecked++;
              assert.ok(cornerWhite >= 2, `${label}: 모서리 흰 틈 ${cornerWhite.toFixed(2)} 획`);
            }
          }
        }
      }
    }
    if (round) assert.ok(cornerChecked > 50, `${id}: 모서리 쪽에 글자 획이 있는 경우 ${cornerChecked}`);
  }
});

test('인장체 직인 6종: 둘레 글자와 바깥 테 · 가운데 원 사이 흰 틈이 글자 획 두 배 넘게', () => {
  for (const id of RING_IDS) {
    for (const [lang, name] of GAP_NAMES) {
      for (const mult of [1, 2.5]) {
        for (const addIn of lang === 'ko' ? [false, true] : [false]) {
          const label = `${id} ${name} x${mult}${addIn ? ' +인' : ''}`;
          const cv = render(id, lang, name, { mult, addIn });
          const c = [cv.width / 2, cv.height / 2];
          const strokes = cv.ctx.marks.filter((m) => m.type === 'stroke');
          const circles = strokes.filter((m) => m.path.length === 1 && m.path[0].r != null).sort((a, b) => b.path[0].r - a.path[0].r);
          const [rim, center] = circles.map((m) => ({ r: m.path[0].r, lw: m.lw }));
          const hi = rim.r - rim.lw / 2;
          const lo = center.r + center.lw / 2;
          for (const m of strokes) {
            if (m.key === '1,0,0,1,0,0' || m.path.some((s) => s.r != null)) continue;
            const d = m.path.map((s) => Math.hypot(s.p[0] - c[0], s.p[1] - c[1]));
            const outer = (hi - (Math.max(...d) + m.lw / 2)) / m.lw;
            const inside = (Math.min(...d) - m.lw / 2 - lo) / m.lw;
            assert.ok(outer >= 2, `${label}: 바깥 테와 ${outer.toFixed(2)} 획`);
            assert.ok(inside >= 2, `${label}: 가운데 원과 ${inside.toFixed(2)} 획`);
          }
        }
      }
    }
  }
});
