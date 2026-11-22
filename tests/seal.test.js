import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decomposeSyllable, sealGlyph, hasSealGlyph, INITIALS, MEDIALS, FINALS } from '../js/core/seal-glyph.js';

const syllable = (l, v, t) => String.fromCharCode(0xac00 + l * 588 + v * 28 + t);

/** 글자 하나의 좌표가 모두 [0,1] 안의 유한한 수인지, 획이 비어 있지 않은지 */
function checkGlyph(g, label, { axisAligned = false, positive = true } = {}) {
  assert.ok(g, `${label}: null`);
  assert.ok(g.paths.length + g.shapes.length > 0, `${label}: 빈 글자`);
  const inUnit = (v) => Number.isFinite(v) && v >= -1e-9 && v <= 1 + 1e-9;
  for (const p of g.paths) {
    assert.ok(p.length >= 2, `${label}: 점이 하나뿐인 선`);
    for (const [x, y] of p) assert.ok(inUnit(x) && inUnit(y), `${label}: 범위 밖 (${x}, ${y})`);
    if (axisAligned) {
      for (let i = 1; i < p.length; i++) {
        const dx = Math.abs(p[i][0] - p[i - 1][0]);
        const dy = Math.abs(p[i][1] - p[i - 1][1]);
        assert.ok(dx < 1e-9 || dy < 1e-9, `${label}: 비스듬한 마디`);
      }
    }
  }
  for (const s of g.shapes) {
    assert.equal(s.type, 'rrect');
    for (const v of [s.x, s.y, s.x + s.w, s.y + s.h]) assert.ok(inUnit(v), `${label}: 둥근 사각 범위 밖`);
    // 획 굵기를 터무니없이 크게 주면 자모가 납작해질 수는 있지만 음수가 되지는 않는다
    assert.ok((positive ? s.w > 0 && s.h > 0 : s.w >= 0 && s.h >= 0) && s.r >= 0 && s.r <= 0.5, `${label}: 둥근 사각 크기`);
  }
  assert.ok(Number.isFinite(g.aspect) && g.aspect > 0, `${label}: aspect`);
  assert.ok(g.fit > 0 && g.fit <= 1, `${label}: fit ${g.fit}`);
}

test('인장체: 음절을 초성·중성·종성으로 나눈다', () => {
  assert.deepEqual(decomposeSyllable('가'), { l: 0, v: 0, t: 0, initial: 'ㄱ', medial: 'ㅏ', final: '' });
  assert.deepEqual(decomposeSyllable('힣'), { l: 18, v: 20, t: 27, initial: 'ㅎ', medial: 'ㅣ', final: 'ㅎ' });
  assert.deepEqual(decomposeSyllable('닭'), { l: 3, v: 0, t: 9, initial: 'ㄷ', medial: 'ㅏ', final: 'ㄺ' });
  assert.deepEqual(decomposeSyllable('꿍'), { l: 1, v: 13, t: 21, initial: 'ㄲ', medial: 'ㅜ', final: 'ㅇ' });
  assert.deepEqual(decomposeSyllable('쀍'), { l: 8, v: 15, t: 9, initial: 'ㅃ', medial: 'ㅞ', final: 'ㄺ' });
  assert.deepEqual(decomposeSyllable('볿'), { l: 7, v: 8, t: 11, initial: 'ㅂ', medial: 'ㅗ', final: 'ㄼ' });
  assert.equal(INITIALS.length, 19);
  assert.equal(MEDIALS.length, 21);
  assert.equal(FINALS.length, 28); // 받침 없음 + 27
  for (const c of ['A', 'ㄱ', 'ㅏ', '', '가나', '꯿', '힤', null, 7]) assert.equal(decomposeSyllable(c), null, String(c));
  // 11,172자 모두 되돌려 조합하면 같은 글자
  for (let i = 0; i < 11172; i++) {
    const d = decomposeSyllable(String.fromCharCode(0xac00 + i));
    assert.equal(syllable(d.l, d.v, d.t).charCodeAt(0), 0xac00 + i);
  }
});

test('인장체: 11,172 음절 모두 비지 않은 획, 좌표는 [0,1] 안, 직각 획', () => {
  for (const style of ['plain', 'folded']) {
    for (let i = 0; i < 11172; i++) {
      const ch = String.fromCharCode(0xac00 + i);
      checkGlyph(sealGlyph(ch, { style }), `${style} ${ch}`, { axisAligned: true });
    }
  }
});

test('인장체: 획 굵기가 달라도(가로·세로 따로 포함) 범위를 지킨다', () => {
  const strokes = [0.03, 0.12, { x: 0.035, y: 0.08 }, { x: 0.09, y: 0.04 }, 0.5, -1, Number.NaN];
  for (const stroke of strokes) {
    for (const style of ['plain', 'folded']) {
      for (let i = 0; i < 11172; i += 7) {
        const ch = String.fromCharCode(0xac00 + i);
        const positive = typeof stroke !== 'number' || stroke < 0.2 || !(stroke > 0);
        checkGlyph(sealGlyph(ch, { style, stroke }), `${style} ${ch} ${JSON.stringify(stroke)}`, { axisAligned: true, positive });
      }
    }
  }
});

test('인장체: 초성 19·중성 21·종성 27이 모두 서로 다른 모양', () => {
  const key = (g) => JSON.stringify([g.paths, g.shapes]);
  for (const style of ['plain', 'folded']) {
    const initials = new Set(INITIALS.map((_, l) => key(sealGlyph(syllable(l, 0, 0), { style }))));
    assert.equal(initials.size, 19, `${style} 초성`);
    const medials = new Set(MEDIALS.map((_, v) => key(sealGlyph(syllable(11, v, 0), { style }))));
    assert.equal(medials.size, 21, `${style} 중성`);
    const finals = new Set(FINALS.map((_, t) => key(sealGlyph(syllable(11, 0, t), { style }))));
    assert.equal(finals.size, 28, `${style} 종성 (받침 없음 포함)`);
  }
});

test('인장체: 같은 입력이면 같은 획, 구첩은 빈 곳을 되접는다', () => {
  assert.deepEqual(sealGlyph('홍', { style: 'folded' }), sealGlyph('홍', { style: 'folded' }));
  const count = (g) => g.paths.reduce((t, p) => t + p.length, 0) + g.shapes.length * 4;
  // 넓은 칸의 ㄱ·ㄴ·ㅁ·ㅇ 은 구첩에서 꺾임이 늘어난다
  for (const ch of ['가', '나', '마', '이']) {
    assert.ok(count(sealGlyph(ch, { style: 'folded', stroke: 0.05 })) > count(sealGlyph(ch, { stroke: 0.05 })), ch);
  }
  // 접는 겹 수를 0으로 주면 기본형과 같다 (자리 나눔만 다르다)
  const flat = sealGlyph('가', { style: 'folded', folds: 0, stroke: 0.05 });
  assert.equal(count(flat), count(sealGlyph('가', { stroke: 0.05 })));
});

test('인장체: 획이 아주 많은 음절은 fit 으로 굵기를 줄이라고 알려 준다', () => {
  assert.equal(sealGlyph('이', { stroke: 0.08 }).fit, 1);
  const heavy = sealGlyph('뷁', { stroke: 0.12 });
  assert.ok(heavy.fit < 1, `fit=${heavy.fit}`);
  // 알려 준 만큼 줄이면 (두어 번 되풀이) 간격을 지킬 수 있다
  let s = 0.12;
  for (let i = 0; i < 3; i++) s *= sealGlyph('뷁', { stroke: s }).fit * 0.99;
  assert.equal(sealGlyph('뷁', { stroke: s }).fit, 1);
});

test('인장체: 영문 대문자 A–Z와 숫자 0–9', () => {
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
    for (const style of ['plain', 'folded']) checkGlyph(sealGlyph(ch, { style }), `${style} ${ch}`);
    assert.ok(hasSealGlyph(ch));
  }
  assert.ok(sealGlyph('I').aspect < sealGlyph('M').aspect);
  const keys = new Set([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].map((c) => JSON.stringify(sealGlyph(c))));
  assert.equal(keys.size, 36, '모양이 겹치는 글자');
});

test('인장체: 지원하지 않는 글자는 null (부른 쪽이 글꼴로 대신 그린다)', () => {
  for (const ch of ['a', 'z', '!', '·', ' ', '漢', 'ㄱ', 'ㅏ', 'é', '😀', '', 'AB', '가나', 'constructor', '__proto__', 'toString', null, undefined, 5]) {
    assert.equal(sealGlyph(ch), null, String(ch));
    assert.equal(hasSealGlyph(ch), false, String(ch));
  }
  assert.ok(hasSealGlyph('똠'));
});
