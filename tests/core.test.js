import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLang, resolveLang, validateName, stampChars, sanitizeFilePart, buildFileName, isHexColor, MAX_NAME_LENGTH,
} from '../js/core/text.js';
import { gridFor, cellOrder, rectInEllipse, fitRatio, fillScale } from '../js/core/geometry.js';
import { createRandom, hashString } from '../js/core/random.js';

test('언어 감지', () => {
  assert.equal(detectLang('홍길동'), 'ko');
  assert.equal(detectLang('Hong Gildong'), 'en');
  assert.equal(detectLang('ㅎㄱㄷ'), 'ko');
  assert.equal(detectLang('Kim 민수'), 'ko');
  assert.equal(resolveLang('auto', 'abc'), 'en');
  assert.equal(resolveLang('ko', 'abc'), 'ko');
});

test('이름 검증', () => {
  assert.equal(validateName('', 'ko').ok, false);
  assert.equal(validateName('   ', 'ko').ok, false);
  assert.deepEqual(validateName('  홍  길동 ', 'ko'), { ok: true, value: '홍 길동' });
  assert.equal(validateName('가'.repeat(MAX_NAME_LENGTH), 'ko').ok, true);
  assert.equal(validateName('가'.repeat(MAX_NAME_LENGTH + 1), 'ko').ok, false);
  assert.equal(validateName('홍길동', 'en').ok, false);
  assert.equal(validateName('John', 'en').ok, true);
});

test('도장 글자 목록', () => {
  assert.deepEqual(stampChars('홍길동', { addIn: true, lang: 'ko' }), ['홍', '길', '동', '인']);
  assert.deepEqual(stampChars('홍 길동', { addIn: false, lang: 'ko' }), ['홍', '길', '동']);
  assert.deepEqual(stampChars('김인', { addIn: true, lang: 'ko' }), ['김', '인']);
  assert.deepEqual(stampChars('Kim', { addIn: true, lang: 'en' }), ['K', 'i', 'm']);
});

test('파일 이름', () => {
  assert.equal(sanitizeFilePart('a/b:c*?"<>|d'), 'abcd');
  assert.equal(sanitizeFilePart('John Smith'), 'John_Smith');
  assert.equal(sanitizeFilePart('..secret'), 'secret');
  const d = new Date(2026, 10, 7);
  assert.equal(buildFileName('stamp', '홍길동', d), '도장_홍길동_20261107.png');
  assert.equal(buildFileName('signature', 'John Smith', d), '서명_John_Smith_20261107.png');
  assert.equal(buildFileName('drawing', '', d), '서명_20261107.png');
});

test('색 형식', () => {
  assert.ok(isHexColor('#fff'));
  assert.ok(isHexColor('#D0201F'));
  assert.ok(!isHexColor('red'));
  assert.ok(!isHexColor('#12345'));
});

test('격자 계산', () => {
  assert.deepEqual(gridFor(3, 'column'), { cols: 1, rows: 3 });
  assert.deepEqual(gridFor(6, 'column'), { cols: 2, rows: 3 });
  assert.deepEqual(gridFor(4, 'grid'), { cols: 2, rows: 2 });
  assert.deepEqual(gridFor(5, 'grid'), { cols: 3, rows: 2 });
  assert.deepEqual(gridFor(9, 'grid'), { cols: 3, rows: 3 });
  assert.deepEqual(gridFor(4, 'row'), { cols: 4, rows: 1 });
  assert.deepEqual(gridFor(0, 'grid'), { cols: 1, rows: 1 });
});

test('칸 순서: 가로와 전통 세로', () => {
  assert.deepEqual(cellOrder(4, 2, 2, 'horizontal'), [
    { col: 0, row: 0 }, { col: 1, row: 0 }, { col: 0, row: 1 }, { col: 1, row: 1 },
  ]);
  // 오른쪽 열부터 위→아래: 홍길동인 → 오른쪽 열 '홍길', 왼쪽 열 '동인'
  assert.deepEqual(cellOrder(4, 2, 2, 'vertical'), [
    { col: 1, row: 0 }, { col: 1, row: 1 }, { col: 0, row: 0 }, { col: 0, row: 1 },
  ]);
});

test('타원 내접 사각형', () => {
  // 원에서 정사각형: 한 변 = r·√2
  const sq = rectInEllipse(100, 100, 1);
  assert.ok(Math.abs(sq.width - 100 * Math.SQRT2) < 1e-9);
  assert.ok(Math.abs(sq.height - sq.width) < 1e-9);
  // 비율이 지켜지고 꼭짓점이 타원 위에 있다
  const r = rectInEllipse(60, 100, 1 / 3);
  assert.ok(Math.abs(r.width / r.height - 1 / 3) < 1e-9);
  const onEllipse = (r.width / 2 / 60) ** 2 + (r.height / 2 / 100) ** 2;
  assert.ok(Math.abs(onEllipse - 1) < 1e-9);
});

test('비율 맞추기와 채우기 배율', () => {
  assert.deepEqual(fitRatio(200, 100, 1), { width: 100, height: 100 });
  assert.deepEqual(fitRatio(100, 200, 2), { width: 100, height: 50 });
  // 칸을 넘지 않는다
  for (const [gw, gh, cw, ch] of [[50, 100, 100, 100], [200, 20, 100, 100], [10, 10, 30, 90]]) {
    const { sx, sy } = fillScale(gw, gh, cw, ch);
    assert.ok(gw * sx <= cw + 1e-9 && gh * sy <= ch + 1e-9);
    const aspect = sx / sy;
    assert.ok(aspect >= 0.6 - 1e-9 && aspect <= 1.6 + 1e-9);
  }
});

test('시드 난수 재현성', () => {
  const a = createRandom(hashString('홍길동'));
  const b = createRandom(hashString('홍길동'));
  const seqA = Array.from({ length: 5 }, a);
  const seqB = Array.from({ length: 5 }, b);
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((x) => x >= 0 && x < 1));
  assert.notEqual(hashString('a'), hashString('b'));
});
