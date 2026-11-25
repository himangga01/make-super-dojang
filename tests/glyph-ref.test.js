import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sealGlyph, SEAL_VARIANTS, decomposeSyllable } from '../js/core/seal-glyph.js';

// 참고 인장체 꼴(variant: ref1 · ref2 · ref3) 검사. 둥근 인장체 6종과 인장체 직인 6종이 쓴다

const SYLLABLES = Array.from({ length: 0xd7a3 - 0xac00 + 1 }, (_, i) => String.fromCharCode(0xac00 + i));
const LATIN = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
const EPS = 1e-9;
const inUnit = (v) => Number.isFinite(v) && v >= -EPS && v <= 1 + EPS;
const axis = (a, b) => Math.abs(a[0] - b[0]) < EPS || Math.abs(a[1] - b[1]) < EPS;

test('SEAL_VARIANTS: ref1 · ref2 · ref3', () => {
  assert.deepEqual(SEAL_VARIANTS, ['ref1', 'ref2', 'ref3']);
});

// ───────────── 기본 출력은 그대로 ─────────────

// variant 를 넣기 전 seal-glyph.js 로 잰 값: 한글 11,172자 + 영문·숫자 36자의 sealGlyph 결과(JSON)를 이어 붙인 SHA-256 앞 32자리
const GOLDEN = [
  [{}, '029434b76eef32ece49d26a8fbb97f27'],
  [{ style: 'folded' }, 'cee005e1a70fd43391ef4f9f8c82b7c5'],
  [{ style: 'folded', folds: 1, ringFolds: 0, flatTick: true }, '2be5c7f48dcf114301f7ffe8575adcfc'],
  [{ stroke: { x: 0.05, y: 0.09 }, flatTick: true }, 'e5b4993c0cff32681b346a01689e37b5'],
];

test('variant 를 주지 않으면 예전 출력과 똑같다 (11,208자 해시)', () => {
  for (const [o, want] of GOLDEN) {
    const h = createHash('sha256');
    for (const ch of [...SYLLABLES, ...LATIN]) h.update(JSON.stringify(sealGlyph(ch, o)));
    assert.equal(h.digest('hex').slice(0, 32), want, JSON.stringify(o));
  }
});

test('모르는 variant · null · 빈 값은 기본 배치, 영문·숫자는 variant 와 상관없다', () => {
  const stroke = 0.07;
  for (const ch of ['회', '사', '이', '름', '뷁', '홍', '값']) {
    const base = sealGlyph(ch, { stroke });
    for (const variant of [undefined, null, '', 'ref4', 'REF1', 'constructor', 'toString']) {
      assert.deepEqual(sealGlyph(ch, { stroke, variant }), base, `${ch} ${variant}`);
    }
  }
  for (const variant of SEAL_VARIANTS) {
    for (const ch of LATIN) assert.deepEqual(sealGlyph(ch, { variant }), sealGlyph(ch), `${variant} ${ch}`);
    assert.equal(sealGlyph('·', { variant }), null);
  }
});

// ───────────── 모든 음절이 [0,1] 안 ─────────────

test('참고 꼴 세 가지: 11,172 음절 모두 획·ㅇ 이 [0,1] 안이고 NaN 이 없다 (획 굵기 여러 가지)', () => {
  const strokes = [0.03, 0.07, 0.12, 0.2, { x: 0.05, y: 0.11 }, { x: 0.12, y: 0.06 }];
  for (const variant of SEAL_VARIANTS) {
    for (const stroke of strokes) {
      for (const ch of SYLLABLES) {
        const g = sealGlyph(ch, { variant, stroke, ringFolds: 0, flatTick: true });
        const label = `${variant} ${JSON.stringify(stroke)} ${ch}`;
        assert.ok(g && g.aspect === 1, label);
        assert.ok(g.fit > 0 && g.fit <= 1, `${label}: fit ${g.fit}`);
        assert.ok(g.paths.length > 0, `${label}: 획 없음`);
        for (const p of g.paths) {
          assert.ok(p.length >= 2, `${label}: 점 하나뿐인 획`);
          for (const [x, y] of p) assert.ok(inUnit(x) && inUnit(y), `${label}: (${x}, ${y})`);
        }
        for (const s of g.shapes) {
          assert.equal(s.type, 'rrect', label);
          // 획이 아주 굵으면(0.2) 자리가 없어 ㅇ 이 납작해질 수 있다 (기본 배치와 같다). 그리는 쪽은 fit 으로 미리 가늘게 한다
          assert.ok(inUnit(s.x) && inUnit(s.y) && inUnit(s.x + s.w) && inUnit(s.y + s.h) && s.w >= 0 && s.h >= 0, `${label}: ㅇ ${JSON.stringify(s)}`);
        }
      }
    }
  }
});

test('참고 꼴은 folded · folds 와 함께 줘도 [0,1] 안 (ㄱ·ㄴ·ㄷ·ㄹ·ㅁ 은 기본 자음을 쓴다)', () => {
  for (const variant of SEAL_VARIANTS) {
    for (const ch of SYLLABLES.filter((_, i) => i % 13 === 0)) {
      const g = sealGlyph(ch, { variant, style: 'folded', folds: 2, stroke: 0.06 });
      for (const p of g.paths) for (const [x, y] of p) assert.ok(inUnit(x) && inUnit(y), `${variant} ${ch}`);
      for (const s of g.shapes) assert.ok(inUnit(s.x) && inUnit(s.x + s.w) && inUnit(s.y) && inUnit(s.y + s.h), `${variant} ${ch}`);
    }
  }
});

// ───────────── 단계마다 참고 그림의 꼴 ─────────────

const g = (ch, variant, stroke = 0.08) => sealGlyph(ch, { variant, stroke, ringFolds: 0, flatTick: true });
const same = (p, q) => p.length === q.length && p.every((a, i) => Math.abs(a[0] - q[i][0]) < 1e-9 && Math.abs(a[1] - q[i][1]) < 1e-9);

test('사: ㅅ 은 갓머리 Г, ref1 은 휜 다리 · ref2 는 사선 다리 · ref3 는 직각(∏∏), ㅏ 는 갓을 쓰고 곁획이 오른쪽 끝에서 내려간다', () => {
  for (const variant of SEAL_VARIANTS) {
    const { paths } = g('사', variant);
    // 갓머리 Г: 오른쪽 위에서 왼쪽 위로, 거기서 아래로
    const caps = paths.filter((p) => p.length === 3 && p[0][1] === 0 && p[1][1] === 0 && p[0][0] > p[1][0] && p[2][0] === p[1][0]);
    assert.ok(caps.length >= 2 || (caps.length === 1 && variant !== 'ref3'), `${variant}: ㅅ·ㅏ 갓 ${caps.length}`);
    const diagonal = paths.some((p) => p.some((a, i) => i && !axis(p[i - 1], a)));
    assert.equal(diagonal, variant !== 'ref3', `${variant}: 비스듬한 다리`);
    // ㅏ 곁획: 오른쪽 끝(x=1)까지 갔다가 아래로
    assert.ok(paths.some((p) => p.length === 3 && p[1][0] === 1 && p[2][0] === 1 && p[2][1] > p[1][1] && p[0][1] === p[1][1]), `${variant}: ㅏ 곁획`);
  }
  // ref1 의 다리는 둥근 고리와 휜 다리 (점이 많다), ref2 는 꺾은선
  const legPts = (variant) => Math.max(...g('사', variant).paths.map((p) => p.length));
  assert.ok(legPts('ref1') > 10 && legPts('ref2') <= 6, `${legPts('ref1')} ${legPts('ref2')}`);
  // ref1 · ref2 는 ㅏ 기둥이 ㅅ 밑으로 꺾여 받친다 (x=0 까지), ref3 는 받치지 않는다
  for (const [variant, want] of [['ref1', true], ['ref2', true], ['ref3', false]]) {
    const hooked = g('사', variant).paths.some((p) => p.length >= 4 && p.at(-1)[0] === 0 && p.at(-1)[1] === 1);
    assert.equal(hooked, want, variant);
  }
});

test('이: ref1 · ref2 는 ㅣ 가 ㅇ 을 위아래로 감싸고, ref3 는 ㅇ 이 긴 알약 · ㅣ 는 꺾쇠(⊐)', () => {
  for (const variant of ['ref1', 'ref2']) {
    const { paths, shapes } = g('이', variant);
    assert.equal(shapes.length, 1);
    const wrap = paths.find((p) => p.length === 6);
    assert.ok(wrap, variant);
    assert.deepEqual([wrap[0], wrap[1], wrap[4], wrap[5]], [[1, 0], [0, 0], [1, 1], [0, 1]], variant);
    const o = shapes[0];
    assert.ok(o.y > wrap[2][1] && o.y + o.h < 1, `${variant}: ㅇ 이 두 줄 아래 · 밑줄 위`);
  }
  const { paths, shapes } = g('이', 'ref3');
  assert.equal(shapes.length, 1);
  assert.ok(shapes[0].h > shapes[0].w * 1.4, `ref3 ㅇ 은 세로로 긴 알약 ${shapes[0].w} × ${shapes[0].h}`);
  const br = paths.find((p) => p.length === 6);
  assert.ok(br && br[1][1] === 0 && br[3][1] === 1 && br[2][0] === 1 && br[0][0] === br[5][0], 'ref3 꺾쇠');
});

test('회: ref1 은 ⊔ 꼭지 · ㅗ 가 ㅣ 에 이어짐, ref2 는 ∩ 띠 · ㅗ 왼끝만 올림, ref3 는 ⅃ 가로획 둘 · ㅗ 는 ш · ∩ 띠', () => {
  const band = (paths) => paths.some((p) => p.length === 4 && p[1][1] === 0 && p[2][1] === 0 && p[2][0] === 1 && p[0][1] === p[3][1] && p[0][1] > 0.5);
  const r1 = g('회', 'ref1').paths;
  assert.ok(!band(r1), 'ref1: 띠 없음');
  assert.ok(r1.some((p) => p.length === 4 && p[0][1] === p[3][1] && p[1][1] === p[2][1] && p[1][1] > p[0][1]), 'ref1: ⊔');
  assert.ok(r1.some((p) => p.length === 3 && p.at(-1)[0] === 1 && p[0][0] === 0), 'ref1: ㅗ 가로획이 ㅣ 기둥까지');
  const r2 = g('회', 'ref2').paths;
  assert.ok(band(r2), 'ref2: ∩');
  assert.ok(r2.some((p) => p.length === 3 && p[0][0] === 0 && p[1][0] === 0 && p[1][1] > p[0][1] && p[2][1] === p[1][1]), 'ref2: ㅗ 왼끝 올림');
  const r3 = g('회', 'ref3').paths;
  assert.ok(band(r3), 'ref3: ∩');
  assert.ok(r3.some((p) => p.length === 3 && p[2][1] === 0 && p[1][1] === p[0][1] && p[1][0] === p[2][0]), 'ref3: ⅃');
  assert.ok(r3.some((p) => p.length === 4 && p[0][0] === 0 && p[1][1] === p[2][1] && p[0][1] === p[3][1] && p[1][1] > p[0][1]), 'ref3: ш');
});

test('받침 위 ㅡ · ㅗ · ㅛ 는 양끝을 내려 받침을 감싼다 (冂), ㅜ · ㅠ 는 감싸지 않는다', () => {
  const wraps = (ch, v) => g(ch, v).paths.some((p) => p.length === 4 && p[0][0] === 0 && p[3][0] === 1 && p[0][1] === 1 && p[3][1] === 1 && p[1][1] < 1);
  for (const variant of SEAL_VARIANTS) {
    for (const ch of ['름', '홍', '용', '은']) assert.ok(wraps(ch, variant), `${variant} ${ch}`);
    for (const ch of ['준', '듈', '르']) assert.ok(!wraps(ch, variant), `${variant} ${ch}`);
  }
});

test('홑모음 ㅣ 는 띠(∩)로 쓰지 않는다 (기 · 리 · 민 이 끼 · 림 처럼 읽히지 않게)', () => {
  for (const variant of SEAL_VARIANTS) {
    for (const ch of ['기', '리', '민', '김', '진', '빈']) {
      const top = g(ch, variant).paths.filter((p) => p.some((a, i) => i && a[1] === 0 && p[i - 1][1] === 0 && a[0] === 1));
      assert.ok(top.every((p) => !(p.length === 4 && p[0][0] < 1 && p[3][0] === 1)), `${variant} ${ch}`);
    }
  }
});

test('ㅅ · ㅈ · ㅊ 은 서로 다르다: ㅅ 은 갓머리 Г, ㅈ 은 따로 떨어진 윗가로획, ㅊ 은 그 위에 짧은 꼭지', () => {
  const capped = (paths) => paths.some((p) => p.length === 3 && same(p.slice(0, 2), [[1, 0], [0, 0]]));
  const bar = (paths, y) => paths.some((p) => p.length === 2 && p[0][1] === y && p[1][1] === y && p[0][0] === 0 && p[1][0] === 1);
  const tick = (paths) => paths.some((p) => p.length === 2 && p[0][1] === 0 && p[1][1] === 0 && p[0][0] > 0.1 && p[1][0] < 0.9);
  for (const variant of SEAL_VARIANTS) {
    const s = g('스', variant).paths;
    const j = g('즈', variant).paths;
    const c = g('츠', variant).paths;
    assert.ok(capped(s) && !bar(s, 0) && !tick(s), `${variant} 스`);
    assert.ok(!capped(j) && bar(j, 0) && !tick(j), `${variant} 즈`);
    assert.ok(!capped(c) && tick(c) && c.some((p) => p.length === 2 && p[0][1] > 0 && p[0][1] === p[1][1] && p[0][0] === 0 && p[1][0] === 1), `${variant} 츠`);
  }
});

// ───────────── 획이 붙지 않는다 ─────────────
// 그리는 쪽(stamp-seal-extra.js setup)처럼 4자 도장 칸(165px, 긋는 굵기 = 간격용 × 0.85)에서 fit 만큼 가늘게 한 뒤,
// 서로 다른 획(또는 한 획 안에서 획을 따라 멀리 떨어진 두 곳)의 가운데선 거리가 긋는 굵기의 1.5배 미만이면서
// 일부러 잇지 않은(0.15배 넘게 떨어진) 곳을 센다. 기본 배치는 같은 조건에서 980 음절이 걸린다

function segments(gl) {
  const out = [];
  gl.paths.forEach((p, pi) => {
    let L = 0;
    for (let i = 0; i < p.length - 1; i++) {
      const l = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
      out.push({ a: p[i], b: p[i + 1], path: pi, idx: i, s0: L, s1: L + l });
      L += l;
    }
  });
  gl.shapes.forEach((s, si) => {
    const r = Math.min(s.w, s.h) / 2;
    const pts = [];
    for (const [cx, cy, a0] of [[s.x + s.w - r, s.y + r, -Math.PI / 2], [s.x + s.w - r, s.y + s.h - r, 0], [s.x + r, s.y + s.h - r, Math.PI / 2], [s.x + r, s.y + r, Math.PI]]) {
      for (let k = 0; k <= 4; k++) pts.push([cx + Math.cos(a0 + (Math.PI / 8) * k) * r, cy + Math.sin(a0 + (Math.PI / 8) * k) * r]);
    }
    pts.forEach((a, i) => out.push({ a, b: pts[(i + 1) % pts.length], path: -1 - si }));
  });
  return out;
}

function segDist(p, q, r, s) {
  const pt = (a, b, c) => {
    const vx = c[0] - b[0];
    const vy = c[1] - b[1];
    const L = vx * vx + vy * vy;
    const t = L ? Math.max(0, Math.min(1, ((a[0] - b[0]) * vx + (a[1] - b[1]) * vy) / L)) : 0;
    return Math.hypot(a[0] - b[0] - t * vx, a[1] - b[1] - t * vy);
  };
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = cr(p, q, r);
  const d2 = cr(p, q, s);
  const d3 = cr(r, s, p);
  const d4 = cr(r, s, q);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(pt(p, r, s), pt(q, r, s), pt(r, p, q), pt(s, p, q));
}

function nearMisses(variant) {
  const CELL = 165;
  const DRAW = 0.85;
  const hits = [];
  for (const ch of SYLLABLES) {
    const sw0 = CELL * 0.09;
    let sw = sw0;
    let gl;
    for (let it = 0; it < 4; it++) {
      const iw = CELL - sw * DRAW;
      gl = sealGlyph(ch, { variant, ringFolds: 0, flatTick: true, stroke: { x: sw / iw, y: sw / iw } });
      if (gl.fit > 0.995 || sw <= sw0 * 0.6 || it === 3) break;
      sw = Math.max(sw0 * 0.6, sw * gl.fit * 0.97);
    }
    const drawn = (sw * DRAW) / (CELL - sw * DRAW);
    const S = segments(gl);
    let worst = Infinity;
    for (let i = 0; i < S.length; i++) {
      for (let j = i + 1; j < S.length; j++) {
        const A = S[i];
        const B = S[j];
        if (A.path === B.path) {
          if (A.path < 0 || Math.abs(A.idx - B.idx) <= 1) continue;
          if (Math.max(A.s0, B.s0) - Math.min(A.s1, B.s1) < drawn * 3) continue; // 한 획의 꺾임
        }
        const d = segDist(A.a, A.b, B.a, B.b);
        if (d > drawn * 0.15 && d < drawn * 1.5) worst = Math.min(worst, d / drawn);
      }
    }
    if (worst < Infinity) hits.push(`${ch}${worst.toFixed(2)}`);
  }
  return hits;
}

test('참고 꼴: 4자 도장 굵기에서 획끼리 거의 닿는 음절이 없다 (ref1 5자 이하 · ref2 · ref3 0자)', () => {
  const limit = { ref1: 5, ref2: 0, ref3: 0 };
  for (const variant of SEAL_VARIANTS) {
    const hits = nearMisses(variant);
    assert.ok(hits.length <= limit[variant], `${variant}: ${hits.length}자 ${hits.slice(0, 20).join(' ')}`);
  }
});

test('decomposeSyllable 과 같은 자모를 쓴다: 받침이 있으면 받침 자리 획이 아래쪽에 있다', () => {
  for (const variant of SEAL_VARIANTS) {
    for (const ch of ['각', '난', '닭', '많', '읽', '흙']) {
      assert.ok(decomposeSyllable(ch).final, ch);
      const lowest = Math.max(...g(ch, variant).paths.flatMap((p) => p.map((a) => a[1])));
      assert.ok(Math.abs(lowest - 1) < 1e-9, `${variant} ${ch}`);
    }
  }
});
