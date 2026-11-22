import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// stamp-gen.js 를 먼저 불러야 한다 (확장 모듈과 서로 가져오므로, 반대 순서면 STAMP_SHAPES 를 만들 때 확장 목록이 아직 없다)
import {
  STAMP_SHAPES, STAMP_CATEGORIES, SEAL_CENTER_FONT, renderStamp, koContent, stampFont, usesSealCenter, sealCenterFont, sealCenterFonts,
} from '../js/stamp-gen.js';
import { RING_EXTRA_SHAPES, RING_EXTRA_DRAW } from '../js/stamp-ring-extra.js';
import { SEAL_EXTRA_SHAPES, SEAL_EXTRA_DRAW, ingamAspect, ingamCells } from '../js/stamp-seal-extra.js';
import { STAMP_FONTS, EXTRA_FONTS, INGAM_FONT, INGAM_CENTER_FONT } from '../js/fonts.js';
import { fontsCssUrl } from '../scripts/fonts-link.mjs';
import { stampChars } from '../js/core/text.js';

const SEAL_IDS = ['seal-thin-square', 'seal-thin-circle'];
const RING_IDS = ['ring-thin-dot', 'ring-thin-star'];
const IDS = [...SEAL_IDS, ...RING_IDS];
const byId = (id) => STAMP_SHAPES.find((s) => s.id === id);

// ───────────── 모양 목록 ─────────────

test('인감체 4종: id·이름표·분류·글꼴·그리기 함수', () => {
  assert.deepEqual(IDS.map((id) => byId(id)?.label), ['인감체 사각', '인감체 원', '인감체 직인', '인감체 별 직인']);
  assert.equal(new Set(STAMP_SHAPES.map((s) => s.id)).size, STAMP_SHAPES.length, '전체 id 중복');
  // 그리기 함수(special)는 4종이 각자 따로 쓴다 (다른 모양의 special 을 가로채지 않는다)
  for (const id of IDS) assert.deepEqual(STAMP_SHAPES.filter((s) => s.special === byId(id).special).map((s) => s.id), [id]);
  for (const id of IDS) {
    const s = byId(id);
    assert.ok(STAMP_CATEGORIES.some((c) => c.id === s.cat), id);
    assert.ok(Array.from(s.label).length <= 8, `${id}: 이름표 8자 이하`);
    assert.equal(s.font, INGAM_FONT, `${id}: 글꼴을 정해 둔다`);
  }
  for (const id of SEAL_IDS) {
    const s = byId(id);
    assert.equal(s.cat, 'seal');
    assert.equal(s.fontLabel, '인감체');
    assert.ok(SEAL_EXTRA_SHAPES.includes(s));
    assert.equal(typeof SEAL_EXTRA_DRAW[s.special], 'function');
    assert.ok(!usesSealCenter(s));
  }
  for (const id of RING_IDS) {
    const s = byId(id);
    assert.equal(s.cat, 'ring');
    assert.equal(s.sealCenter, true, `${id}: 직인 가운데 선택지를 따른다`);
    assert.equal(s.centerFont, INGAM_CENTER_FONT);
    assert.ok(RING_EXTRA_SHAPES.includes(s));
    assert.equal(typeof RING_EXTRA_DRAW[s.special], 'function');
    assert.ok(!s.selfBleed);
  }
  // 인장체 분류의 기존 순서는 그대로, 인감체 사각·원은 그 뒤
  const seal = STAMP_SHAPES.filter((s) => s.cat === 'seal').map((s) => s.id);
  assert.deepEqual(seal.slice(0, 4), ['seal-square', 'seal-circle', 'seal-folded-square', 'seal-folded-circle']);
  assert.ok(seal.indexOf('seal-thin-square') > seal.indexOf('seal-royal'));
});

test('글꼴: 인감체 글꼴과 가운데 한자 글꼴 (특정 모양 전용 목록)', () => {
  assert.deepEqual(EXTRA_FONTS, [INGAM_FONT, INGAM_CENTER_FONT]);
  for (const f of EXTRA_FONTS) assert.ok(f.family && f.weight && f.label, JSON.stringify(f));
  assert.deepEqual([INGAM_CENTER_FONT.family, INGAM_CENTER_FONT.weight], ['Noto Serif KR', 500]);
  assert.ok(INGAM_CENTER_FONT.weight < SEAL_CENTER_FONT.weight, '기본 직인보다 가는 한자');
  assert.ok(INGAM_FONT.stem > 0.02 && INGAM_FONT.stem < 0.12, '획 굵기(글꼴 크기 대비)');
  // 인감체 글꼴은 글꼴 선택 목록에 없다 (선택과 상관없이 모양이 쓴다)
  for (const list of Object.values(STAMP_FONTS)) assert.ok(!list.includes(INGAM_FONT));
});

// ───────────── 글꼴 고르기 (app.js · MCP 공통) ─────────────

test('stampFont: 모양이 정한 글꼴이 글꼴 선택보다 먼저, 그 밖은 예전과 같다', () => {
  for (const lang of ['ko', 'en']) {
    const fonts = STAMP_FONTS[lang];
    for (const chosen of [undefined, null, fonts[3]]) {
      for (const shape of STAMP_SHAPES) {
        const got = stampFont(shape, fonts, chosen);
        if (IDS.includes(shape.id)) assert.equal(got, INGAM_FONT, `${shape.id} ${lang}`);
        else assert.equal(got, chosen ?? fonts[STAMP_SHAPES.indexOf(shape) % fonts.length], `${shape.id} ${lang}`);
      }
    }
  }
});

test('가운데 한자 글꼴: 기존 직인은 본명조 900, 인감체 직인은 500. 미리 받을 글꼴은 굵기마다 한 번', () => {
  assert.ok(usesSealCenter(byId('ring')) && usesSealCenter(byId('ring-star')) && !usesSealCenter(byId('ring-square')) && !usesSealCenter(null));
  assert.equal(sealCenterFont(byId('ring')), SEAL_CENTER_FONT);
  assert.equal(sealCenterFont(byId('ring-scallop')), SEAL_CENTER_FONT);
  assert.equal(sealCenterFont(byId('ring-thin-dot')), INGAM_CENTER_FONT);
  assert.deepEqual(sealCenterFonts(STAMP_SHAPES), [SEAL_CENTER_FONT, INGAM_CENTER_FONT]);
  assert.deepEqual(sealCenterFonts(STAMP_SHAPES.filter((s) => s.cat === 'square')), []);
  assert.deepEqual(sealCenterFonts([byId('ring-thin-star')]), [INGAM_CENTER_FONT]);
  assert.deepEqual(sealCenterFonts([byId('ring'), byId('ring-star')]), [SEAL_CENTER_FONT]);
});

// ───────────── 글꼴 링크 ─────────────

test('fonts-link: 인감체 글꼴이 링크에 있고, 같은 글꼴의 여러 굵기는 한 항목(본명조 500;900)', () => {
  const { url, count } = fontsCssUrl();
  const families = url.split('?')[1].split('&').filter((p) => p.startsWith('family=')).map((p) => p.slice(7).split(':')[0]);
  assert.equal(families.length, count);
  assert.equal(new Set(families).size, families.length, '글꼴이 두 번 나오면 안 된다');
  assert.ok(url.includes('family=Noto+Serif+KR:wght@500;900&'), url);
  assert.ok(url.includes(`family=${INGAM_FONT.family.replace(/ /g, '+')}&`) || url.includes(`family=${INGAM_FONT.family.replace(/ /g, '+')}:wght@`), url);
  // index.html 은 다시 만든 링크를 쓴다 (node scripts/fonts-link.mjs)
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(/<link id="font-css" rel="stylesheet" href="([^"]*)"/.exec(html)?.[1], url);
});

// ───────────── 칸 배치 ─────────────

test('ingamCells: 글자 수·읽는 순서·영문마다 칸이 영역 안에서 겹치지 않고, 칸 사이는 가로가 넓다', () => {
  const w = 300;
  const h = 300;
  const inside = (c) => c.cx - c.w / 2 >= -w / 2 - 1e-9 && c.cx + c.w / 2 <= w / 2 + 1e-9 && c.cy - c.h / 2 >= -h / 2 - 1e-9 && c.cy + c.h / 2 <= h / 2 + 1e-9;
  const apart = (a, b) => a.cx + a.w / 2 <= b.cx - b.w / 2 + 1e-9 || b.cx + b.w / 2 <= a.cx - a.w / 2 + 1e-9 || a.cy + a.h / 2 <= b.cy - b.h / 2 + 1e-9 || b.cy + b.h / 2 <= a.cy - a.h / 2 + 1e-9;
  for (const name of ['이', '김지', '홍길동', '회사이름', '김지혜인', '한국무역협회', '주식회사지혜행정', '가나다라마바사아자차카타파하']) {
    for (const order of ['horizontal', 'vertical']) {
      const chars = stampChars(name);
      const cells = ingamCells({ ko: true, chars, content: koContent(chars, 'grid', null), order, w, h });
      assert.equal(cells.map((c) => c.ch).sort().join(''), [...chars].sort().join(''), `${name} ${order}: 글자가 모두 한 번씩`);
      for (const c of cells) assert.ok(inside(c), `${name} ${order}: '${c.ch}' 칸이 영역 밖`);
      for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) assert.ok(apart(cells[i], cells[j]), `${name} ${order}: 칸 겹침`);
    }
  }
  // 4자 2×2: 영역을 다 쓰고, 칸 사이 가로 18%·세로 8%
  const four = ingamCells({ ko: true, chars: stampChars('회사이름'), content: koContent(stampChars('회사이름'), 'grid', null), w, h });
  const [a, b, c] = four;
  assert.ok(Math.abs(a.cx - a.w / 2 + w / 2) < 1e-9 && Math.abs(b.cx + b.w / 2 - w / 2) < 1e-9);
  assert.ok(Math.abs((b.cx - b.w / 2) - (a.cx + a.w / 2) - a.w * 0.18) < 1e-9);
  assert.ok(Math.abs((c.cy - c.h / 2) - (a.cy + a.h / 2) - a.h * 0.08) < 1e-9);
  // 3자 세로 읽기: 오른쪽 열에 성을 길게
  const three = ingamCells({ ko: true, chars: ['홍', '길', '동'], content: koContent(['홍', '길', '동'], 'grid', null), order: 'vertical', w, h });
  assert.ok(three[0].cx > 0 && three[0].h === h && three[1].cx < 0 && three[1].cy < three[2].cy);
  // 5자: 끝 줄 두 자는 줄 폭을 나눠 채운다
  const five = ingamCells({ ko: true, chars: stampChars('한국무역협'), content: koContent(stampChars('한국무역협'), 'grid', null), w, h });
  assert.ok(five[3].w > five[0].w * 1.3);
  // 영문: 줄마다 한 칸, 폭 전체
  const en = ingamCells({ ko: false, lines: ['JANE', 'DOE'], w, h });
  assert.deepEqual(en.map((x) => [x.ch, x.w]), [['JANE', w], ['DOE', w]]);
  // 비율 범위: 한글·한자·여러 글자는 넓게, 영문 한 자는 좁게
  assert.deepEqual(ingamAspect('회'), [0.3, 3]);
  assert.deepEqual(ingamAspect('代'), [0.3, 3]);
  assert.deepEqual(ingamAspect('JANE'), [0.3, 3]);
  assert.deepEqual(ingamAspect('I'), [0.55, 1.6]);
});

// ───────────── 가짜 canvas 로 그려 보기 ─────────────
// 변환 행렬을 따라가며 글자 상자(그때의 글꼴 포함)와 원 선을 기록한다

class FakeCtx {
  constructor(canvas) {
    Object.assign(this, { canvas, m: [1, 0, 0, 1, 0, 0], stack: [], font: '10px x', lineWidth: 1, textAlign: 'start', textBaseline: 'alphabetic', globalCompositeOperation: 'source-over', globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', marks: [], path: [] });
  }
  save() { this.stack.push([[...this.m], this.font, this.lineWidth, this.globalCompositeOperation]); }
  restore() { [this.m, this.font, this.lineWidth, this.globalCompositeOperation] = this.stack.pop(); }
  translate(x, y) { const [a, b, c, d, e, f] = this.m; this.m = [a, b, c, d, a * x + c * y + e, b * x + d * y + f]; }
  rotate(t) { const [a, b, c, d, e, f] = this.m; const cs = Math.cos(t); const sn = Math.sin(t); this.m = [a * cs + c * sn, b * cs + d * sn, c * cs - a * sn, d * cs - b * sn, e, f]; }
  scale(x, y) { const [a, b, c, d, e, f] = this.m; this.m = [a * x, b * x, c * y, d * y, e, f]; }
  pt(x, y) { const [a, b, c, d, e, f] = this.m; return [a * x + c * y + e, b * x + d * y + f]; }
  measureText(t) {
    const px = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 10);
    const w = Array.from(t).reduce((s, ch) => s + px * (/[가-힣一-鿿]/.test(ch) ? 0.95 : /[A-Z0-9]/.test(ch) ? 0.68 : 0.36), 0);
    return { width: w, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w * 0.96, actualBoundingBoxAscent: px * 0.8, actualBoundingBoxDescent: px * 0.08 };
  }
  fillText(t, x, y) {
    const m = this.measureText(t);
    const box = [[x, y - m.actualBoundingBoxAscent], [x + m.actualBoundingBoxRight, y - m.actualBoundingBoxAscent], [x + m.actualBoundingBoxRight, y + m.actualBoundingBoxDescent], [x, y + m.actualBoundingBoxDescent]];
    this.marks.push({ type: 'glyph', text: t, font: this.font, pts: box.map(([px, py]) => this.pt(px, py)) });
  }
  beginPath() { this.path = []; }
  closePath() {}
  moveTo(x, y) { this.path.push({ p: this.pt(x, y) }); }
  lineTo(x, y) { this.path.push({ p: this.pt(x, y) }); }
  arcTo(x1, y1, x2, y2) { this.path.push({ p: this.pt(x1, y1) }, { p: this.pt(x2, y2) }); }
  rect(x, y, w, h) { for (const [px, py] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) this.path.push({ p: this.pt(px, py) }); }
  arc(x, y, r, a0, a1) { const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-9; this.path.push({ p: this.pt(x, y), r: r * Math.hypot(this.m[0], this.m[1]), full }); }
  ellipse(x, y, a, b) { this.path.push({ p: this.pt(x, y), r: a * Math.hypot(this.m[0], this.m[1]), full: a === b }); }
  fill() { this.marks.push({ type: 'fill', path: this.path }); }
  stroke() { this.marks.push({ type: 'stroke', path: this.path, lw: this.lineWidth }); }
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

const NAMES = [['ko', '이'], ['ko', '김지'], ['ko', '홍길동'], ['ko', '회사이름'], ['ko', '주식회사지혜행정'], ['ko', '가나다라마바사아자차카타파하'], ['ko', '홍길동ABC'], ['en', 'A'], ['en', 'Jane Doe'], ['en', 'Acme Holdings Inc']];

function render(id, lang, name, extra = {}) {
  const shape = byId(id);
  return renderStamp({
    lang, chars: stampChars(name, { addIn: extra.addIn ?? false, lang }), baseChars: stampChars(name, { lang }), text: name, shape,
    font: stampFont(shape, STAMP_FONTS[lang], null), ink: '#c8102e', order: 'horizontal', date: '2026.11.22', dateLabel: '', sealCenter: 'daepyo-hanja', mult: 1, ...extra,
  });
}
const glyphs = (canvas) => canvas.ctx.marks.filter((m) => m.type === 'glyph');
const center = (g) => g.pts.reduce((t, p) => [t[0] + p[0] / 4, t[1] + p[1] / 4], [0, 0]);

test('인감체 사각·원: 글자를 모두 테 안에, 인감체 글꼴로. 배율 2.5 는 같은 배치를 2.5배로', () => {
  for (const id of SEAL_IDS) {
    for (const [lang, name] of NAMES) {
      for (const order of ['horizontal', 'vertical']) {
        for (const addIn of lang === 'ko' ? [false, true] : [false]) {
          const label = `${id} ${name} ${order}${addIn ? ' +인' : ''}`;
          const c = render(id, lang, name, { order, addIn });
          assert.equal(c.width, c.height, label);
          const g = glyphs(c);
          const want = lang === 'ko' ? stampChars(name, { addIn, lang }).join('') : null;
          if (want) assert.equal(g.map((x) => x.text).sort().join(''), Array.from(want).sort().join(''), `${label}: 글자`);
          else assert.equal(g.map((x) => x.text).join('').replace(/\s/g, ''), name.toUpperCase().replace(/\s/g, ''), `${label}: 영문 줄`);
          for (const x of g) assert.ok(x.font.includes(`"${INGAM_FONT.family}"`), `${label}: ${x.font}`);
          // 테(캔버스 가장자리에서 S·0.04 + 테 굵기) 안쪽
          const S = c.width / 1.08;
          const m = S * 0.04;
          for (const x of g) for (const [px, py] of x.pts) assert.ok(px > m && py > m && px < c.width - m && py < c.height - m, `${label}: '${x.text}' 가 테 밖`);
          if (id === 'seal-thin-circle') {
            for (const x of g) for (const [px, py] of x.pts) assert.ok(Math.hypot(px - c.width / 2, py - c.height / 2) < S / 2 - S * 0.012, `${label}: '${x.text}' 가 원 밖`);
          }
        }
      }
      const a = render(id, lang, name);
      const b = render(id, lang, name, { mult: 2.5 });
      assert.ok(Math.abs(b.width / a.width - 2.5) < 0.01, `${id} ${name}: ${a.width}→${b.width}`);
      glyphs(a).forEach((x, i) => {
        const [ax, ay] = center(x);
        const [bx, by] = center(glyphs(b)[i]);
        assert.ok(Math.abs(bx - ax * 2.5) < 1.5 && Math.abs(by - ay * 2.5) < 1.5, `${id} ${name}: 배율 2.5 배치`);
      });
      const fx = render(id, lang, name, { texture: true, bleed: true, rotation: -8, ink: '#1f3fa8' });
      assert.ok(fx.width > a.width, `${id}: 회전한 캔버스가 커진다`);
    }
  }
});

test('인감체 직인: 4자는 맨 위를 비우고 참고 이미지 각도(58.5°·138°·221.5°·301.5°, ±2°)에, 머리가 바깥. 맨 위 점·별, 가운데 한자는 본명조 500', () => {
  for (const id of RING_IDS) {
    const c = render(id, 'ko', '회사이름');
    const cx = c.width / 2;
    const cy = c.height / 2;
    const g = glyphs(c);
    const ring = g.filter((x) => '회사이름'.includes(x.text));
    assert.deepEqual(ring.map((x) => x.text), ['회', '사', '이', '름']);
    const angles = ring.map((x) => {
      const [px, py] = center(x);
      return ((Math.atan2(px - cx, -(py - cy)) * 180) / Math.PI + 360) % 360; // 맨 위 0°, 시계 방향
    });
    [58.5, 138, 221.5, 301.5].forEach((want, i) => assert.ok(Math.abs(angles[i] - want) < 2, `${id}: ${angles.map((a) => a.toFixed(1))}`));
    // 글자 머리(상자 윗변 가운데)가 바깥쪽
    for (const x of ring) {
      const top = [(x.pts[0][0] + x.pts[1][0]) / 2, (x.pts[0][1] + x.pts[1][1]) / 2];
      const bottom = [(x.pts[2][0] + x.pts[3][0]) / 2, (x.pts[2][1] + x.pts[3][1]) / 2];
      assert.ok(Math.hypot(top[0] - cx, top[1] - cy) > Math.hypot(bottom[0] - cx, bottom[1] - cy), `${id}: '${x.text}' 머리가 안쪽`);
    }
    const hanja = g.filter((x) => '代表理事'.includes(x.text));
    assert.equal(hanja.length, 4);
    for (const x of hanja) assert.ok(x.font.startsWith(`${INGAM_CENTER_FONT.weight} `) && x.font.includes(`"${INGAM_CENTER_FONT.family}"`), x.font);
    for (const x of ring) assert.ok(x.font.includes(`"${INGAM_FONT.family}"`), x.font);
    // 원 선 셋(테·가운데 원)과 맨 위 표시
    const circles = c.ctx.marks.filter((m) => m.type === 'stroke' && m.path.length === 1 && m.path[0].full);
    assert.equal(circles.length, 2, `${id}: 테와 가운데 원`);
    const [rim, inner] = circles.map((m) => m.path[0].r).sort((p, q) => q - p);
    const S = rim * 2 + circles.find((m) => m.path[0].r === rim).lw;
    assert.ok(Math.abs(inner / (S / 2) - 0.53) < 0.01, `가운데 원 반지름 ${inner / (S / 2)}`);
    const fills = c.ctx.marks.filter((m) => m.type === 'fill');
    const topMark = fills.find((m) => m.path.every((p) => Math.abs(p.p[0] - cx) < S * 0.06 && p.p[1] < cy - S * 0.3));
    assert.ok(topMark, `${id}: 맨 위 표시`);
    assert.equal(topMark.path.length === 1, id === 'ring-thin-dot', `${id}: 점(원 하나) 또는 별(꺾은선)`);
  }
});

test('가운데 한자 글꼴: 기존 둘레글자 원은 그대로 본명조 900 (drawSealCenter 기본값)', () => {
  for (const id of ['ring', 'ring-star', 'ring-scallop']) {
    const g = glyphs(render(id, 'ko', '회사이름')).filter((x) => '代表理事'.includes(x.text));
    assert.equal(g.length, 4, id);
    for (const x of g) assert.ok(x.font.startsWith('900 ') && x.font.includes('"Noto Serif KR"'), `${id}: ${x.font}`);
  }
});

test('인감체 직인: 이름·가운데 선택지·읽는 순서·배율·효과마다 그린다', () => {
  for (const id of RING_IDS) {
    for (const [lang, name] of NAMES) {
      for (const sealCenter of ['daepyo-hanja', 'daepyo', 'daepyo-in', 'jikin', 'in-hanja', 'name', 'star']) {
        for (const order of ['horizontal', 'vertical']) {
          const c = render(id, lang, name, { sealCenter, order, addIn: lang === 'ko' });
          const drawn = glyphs(c).map((x) => x.text).join('');
          const base = lang === 'ko' ? stampChars(name, { lang }) : Array.from(name.toUpperCase()).filter((ch) => ch.trim());
          for (const ch of base) assert.ok(drawn.includes(ch), `${id} ${name} ${sealCenter} ${order}: '${ch}' 없음`);
          for (const x of glyphs(c)) for (const [px, py] of x.pts) assert.ok(px >= 0 && py >= 0 && px <= c.width && py <= c.height, `${id} ${name}: 캔버스 밖`);
        }
      }
      const a = render(id, lang, name);
      const b = render(id, lang, name, { mult: 2.5, texture: true, bleed: true, rotation: 12 });
      assert.ok(b.width > a.width * 2.5, `${id} ${name}: 배율 2.5 + 회전`);
    }
  }
});
