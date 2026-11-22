import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, createZip, uniqueNames } from '../js/core/zip.js';
import { pointInConvex, largestRectInPolygon, polygonPoints } from '../js/core/geometry.js';
import { otsuThreshold, inkAlpha, removeSpecks, maskBounds, normalizeIllumination, extractSignatureMask } from '../js/core/image.js';
import { SIGNATURE_STYLES } from '../js/signature-styles.js';
import { SIGNATURE_FONTS, STAMP_FONTS } from '../js/fonts.js';

test('CRC32 표준값', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test('ZIP: 한글 파일 이름과 내용이 그대로 풀린다', (t) => {
  const files = [
    { name: '01_원형_나눔명조.png', data: new Uint8Array([1, 2, 3, 4]) },
    { name: 'b.txt', data: new TextEncoder().encode('hello') },
  ];
  const zip = createZip(files, new Date(2026, 10, 17, 12, 30, 10));
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(zip.length - 22 + 10, true), 2);

  let hasUnzip = true;
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { hasUnzip = false; }
  if (!hasUnzip) return t.skip('unzip 없음');
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const path = join(dir, 'a.zip');
  writeFileSync(path, zip);
  execFileSync('unzip', ['-tq', path]); // CRC 검사 실패 시 예외
  assert.equal(execFileSync('unzip', ['-p', path, 'b.txt']).toString(), 'hello');
  assert.match(execFileSync('unzip', ['-Z1', path]).toString(), /01_원형_나눔명조\.png/);
});

test('중복 파일 이름 정리', () => {
  assert.deepEqual(uniqueNames(['a.png', 'a.png', 'b', 'a.png', 'b']), ['a.png', 'a (2).png', 'b', 'a (3).png', 'b (2)']);
});

test('볼록 다각형 포함 판정과 최대 내접 사각형', () => {
  const sq = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];
  assert.ok(pointInConvex({ x: 0, y: 0 }, sq));
  assert.ok(pointInConvex({ x: 1, y: 1 }, sq));
  assert.ok(!pointInConvex({ x: 1.01, y: 0 }, sq));
  // 정사각형 안의 정사각형은 자기 자신
  const r = largestRectInPolygon(sq, 1);
  assert.ok(Math.abs(r.width - 2) < 1e-6 && Math.abs(r.height - 2) < 1e-6);
  // 마름모(반대각선 1) 안의 정사각형: 한 변 1
  const diamond = polygonPoints(4, 1, 1, 0);
  const d = largestRectInPolygon(diamond, 1);
  assert.ok(Math.abs(d.width - 1) < 1e-6);
  // 원(다각형 근사) 안의 정사각형 ≈ √2
  const c = largestRectInPolygon(polygonPoints(360, 1, 1), 1);
  assert.ok(Math.abs(c.width - Math.SQRT2) < 0.01);
});

test('오츠 경계값은 두 무리 사이에 있다', () => {
  const g = new Uint8ClampedArray([...Array(500).fill(30), ...Array(1500).fill(220)]);
  const t = otsuThreshold(g);
  assert.ok(t >= 30 && t < 220, `t=${t}`);
});

test('밝기 → 알파', () => {
  const a = inkAlpha(new Uint8ClampedArray([0, 100, 255]), 100, 10);
  assert.equal(a[0], 255);
  assert.equal(a[2], 0);
  assert.ok(Math.abs(a[1] - 127.5) <= 1);
});

test('작은 점은 지우고 큰 획은 남긴다', () => {
  const w = 20;
  const h = 10;
  const a = new Uint8ClampedArray(w * h);
  a[2 * w + 2] = 255; // 점 하나
  for (let x = 5; x < 18; x++) a[5 * w + x] = 255; // 획
  removeSpecks(a, w, h, 5);
  assert.equal(a[2 * w + 2], 0);
  assert.equal(a[5 * w + 10], 255);
  assert.deepEqual(maskBounds(a, w, h), { x: 5, y: 5, w: 13, h: 1 });
  assert.equal(maskBounds(new Uint8ClampedArray(4), 2, 2), null);
});

test('조명 보정: 그늘진 종이도 흰색에 가깝게 맞춘다', () => {
  const w = 128;
  const h = 64;
  const g = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = 120 + Math.round((x / w) * 120); // 왼쪽이 어둡다
  const n = normalizeIllumination(g, w, h, 16);
  assert.ok(n[32 * w + 2] > 230 && n[32 * w + 125] > 230);
});

test('사진 서명 추출: 그늘이 있어도 획만 남는다', () => {
  const w = 200;
  const h = 100;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const paper = 150 + Math.round((x / w) * 90); // 그늘
      const ink = y >= 45 && y <= 52 && x >= 30 && x <= 170;
      const v = ink ? paper * 0.25 : paper;
      rgba.set([v, v, v, 255], (y * w + x) * 4);
    }
  }
  const { alpha } = extractSignatureMask(rgba, w, h);
  const b = maskBounds(alpha, w, h, 128);
  assert.ok(b && Math.abs(b.x - 30) <= 2 && Math.abs(b.y - 45) <= 2 && Math.abs(b.w - 141) <= 4, JSON.stringify(b));
  assert.equal(alpha[10 * w + 10], 0); // 그늘진 종이는 투명
});

test('서명 형태 20가지 이상, 글꼴이 모두 등록돼 있다', () => {
  for (const lang of ['ko', 'en']) {
    const list = SIGNATURE_STYLES[lang];
    assert.ok(list.length >= 20, `${lang}: ${list.length}`);
    assert.equal(new Set(list.map((s) => s.id)).size, list.length, 'id 중복');
    for (const s of list) assert.ok(SIGNATURE_FONTS[s.font], `${s.id}: ${s.font}`);
  }
  assert.ok(STAMP_FONTS.ko.length >= 5 && STAMP_FONTS.en.length >= 4);
});

test('도장 모양 80가지, 분류가 모두 유효하다', async () => {
  const { STAMP_SHAPES, STAMP_CATEGORIES } = await import('../js/stamp-gen.js');
  assert.equal(STAMP_SHAPES.length, 80);
  // 인장체: 처음 4종은 기본형·구첩, 웹 글꼴 대신 '인장체' 이름표
  const seal = STAMP_SHAPES.filter((s) => s.cat === 'seal');
  assert.deepEqual(seal.map((s) => s.id).slice(0, 4), ['seal-square', 'seal-circle', 'seal-folded-square', 'seal-folded-circle']);
  assert.ok(seal.every((s) => s.fontLabel === '인장체'));
  const catIds = STAMP_CATEGORIES.map((c) => c.id);
  assert.deepEqual(catIds.slice(-3), ['seal', 'ring', 'office']);
  // 둘레글자 분류는 기존 3종이 앞에 온다. 날짜·결재 분류 첫 카드는 날짜 도장 (e2e 가 이 카드를 고해상도로 받는다)
  assert.deepEqual(STAMP_SHAPES.filter((s) => s.cat === 'ring').map((s) => s.id).slice(0, 3), ['ring', 'ring-star', 'ring-square']);
  assert.deepEqual(STAMP_SHAPES.filter((s) => s.cat === 'office').map((s) => s.id), ['date', 'receipt', 'approval', 'confirm-h']);
  assert.equal(new Set(STAMP_SHAPES.map((s) => s.id)).size, STAMP_SHAPES.length, 'id 중복');
  const cats = new Set(STAMP_CATEGORIES.map((c) => c.id));
  for (const s of STAMP_SHAPES) assert.ok(cats.has(s.cat), `${s.id}: ${s.cat}`);
  for (const c of STAMP_CATEGORIES) if (c.id !== 'all') assert.ok(STAMP_SHAPES.some((s) => s.cat === c.id), `빈 분류 ${c.id}`);
});

test('검토 1차 회귀: 파일 이름의 방향 제어 문자 제거와 글자 단위 자르기', async () => {
  const { sanitizeFilePart, buildFileName } = await import('../js/core/text.js');
  assert.equal(buildFileName('stamp', 'a‮gpj.exe', new Date(2026, 0, 1)), '도장_agpj.exe_20260101.png');
  const cut = sanitizeFilePart('가'.repeat(39) + '😀😀');
  assert.equal(Array.from(cut).length, 40);
  assert.ok(!cut.includes('�') && /😀$/.test(cut));
});

test('검토 1차 회귀: 투명 PNG 는 흰 종이로 본다', async () => {
  const { toGray, extractSignatureMask, maskBounds } = await import('../js/core/image.js');
  assert.deepEqual(Array.from(toGray(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]), 2, 1)), [255, 0]);
  const w = 100;
  const h = 50;
  const rgba = new Uint8ClampedArray(w * h * 4); // 전부 투명
  for (let x = 20; x < 80; x++) rgba.set([0, 0, 0, 255], (25 * w + x) * 4); // 가로 획
  const { alpha } = extractSignatureMask(rgba, w, h);
  const b = maskBounds(alpha, w, h, 128);
  assert.ok(b && b.y === 25 && b.h === 1 && b.x === 20, JSON.stringify(b));
});

test('검토 1차 회귀: ZIP 조각을 이어 붙이면 createZip 과 같다', async () => {
  const { createZip, createZipParts } = await import('../js/core/zip.js');
  const files = [{ name: 'a.png', data: new Uint8Array([9, 8, 7]) }];
  const d = new Date(2026, 0, 1);
  const parts = createZipParts(files, d);
  const joined = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { joined.set(p, o); o += p.length; }
  assert.deepEqual(joined, createZip(files, d));
});
