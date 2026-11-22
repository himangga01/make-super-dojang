// 인장체: 한글 음절을 자모로 나눠 도장용 전서풍 글자(굵기가 고른 직각 획)를 만든다 (DOM 없음)
//
// 좌표는 단위 정사각형 [0,1]×[0,1], y 는 아래로. 획은 가운데선으로 주고 굵기는 그리는 쪽이 정한다.
// 바깥 획의 가운데선이 0 과 1 에 닿으므로, 그리는 쪽은 칸을 획 굵기의 절반만큼 들여 [0,1] 을 맞추고
// 선 끝을 square 로 그린다. 그러면 획 바깥 가장자리가 칸 끝에 꼭 맞는다.
//
// 결과 { paths, shapes, aspect }
//   paths  [[x, y], ...] 꺾은선 목록. 첫 점과 끝 점이 같으면 닫힌 선
//   shapes [{ type: 'rrect', x, y, w, h, r }] 둥근 사각(ㅇ). r 은 짧은 변에 대한 모서리 반지름 비율
//   aspect 글자 본래의 가로:세로 비율 (한글 1, 영문·숫자는 글자마다). 그리는 쪽은 칸에 맞춰 늘려도 된다
//   fit    주어진 획 굵기로 자모 간격을 다 지킬 수 있으면 1, 모자라면 굵기에 곱할 값(<1). 획이 많은 음절(뷁·읗 등)에서
//          그리는 쪽이 도장 전체 획을 이만큼 가늘게 하면 획끼리 붙지 않는다
//
// 모양 두 가지
//   plain  자모를 칸에 꽉 차게 늘린 기본형
//   folded 구첩전처럼, 빈 곳이 넓은 자음 획을 안쪽으로 되접어(ㄱ·ㄴ·ㄷ·ㅅ 겹 꺾기, ㄹ 굽이 늘리기,
//          ㅁ 소용돌이, ㅇ 겹 테) 빈 곳을 메운다. 모음은 획 수가 곧 글자 구별이라 접지 않는다

export const INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
export const MEDIALS = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
export const FINALS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
export const SEAL_STYLES = ['plain', 'folded'];

const FIRST = 0xac00;
const LAST = 0xd7a3;

/** 한글 음절 → 초성·중성·종성 번호와 자모. 음절이 아니면 null */
export function decomposeSyllable(ch) {
  if (typeof ch !== 'string' || ch.length !== 1) return null;
  const code = ch.charCodeAt(0);
  if (code < FIRST || code > LAST) return null;
  const idx = code - FIRST;
  const l = Math.floor(idx / 588);
  const v = Math.floor((idx % 588) / 28);
  const t = idx % 28;
  return { l, v, t, initial: INITIALS[l], medial: MEDIALS[v], final: FINALS[t] };
}

// 쌍자음·겹받침은 좁은 글자 두 개를 나란히 놓는다
const PAIRS = {
  'ㄲ': ['ㄱ', 'ㄱ'], 'ㄸ': ['ㄷ', 'ㄷ'], 'ㅃ': ['ㅂ', 'ㅂ'], 'ㅆ': ['ㅅ', 'ㅅ'], 'ㅉ': ['ㅈ', 'ㅈ'],
  'ㄳ': ['ㄱ', 'ㅅ'], 'ㄵ': ['ㄴ', 'ㅈ'], 'ㄶ': ['ㄴ', 'ㅎ'], 'ㄺ': ['ㄹ', 'ㄱ'], 'ㄻ': ['ㄹ', 'ㅁ'], 'ㄼ': ['ㄹ', 'ㅂ'],
  'ㄽ': ['ㄹ', 'ㅅ'], 'ㄾ': ['ㄹ', 'ㅌ'], 'ㄿ': ['ㄹ', 'ㅍ'], 'ㅀ': ['ㄹ', 'ㅎ'], 'ㅄ': ['ㅂ', 'ㅅ'],
};

// 기본 자음 14자: rows 가로로 놓인 획 층 수, cols 세로로 놓인 획 줄 수 (자리를 나눌 때 획이 촘촘한 쪽에 더 준다)
const CONS = {
  'ㄱ': { rows: 2, cols: 2 }, 'ㄴ': { rows: 2, cols: 2 }, 'ㄷ': { rows: 2, cols: 2 }, 'ㄹ': { rows: 3, cols: 2 },
  'ㅁ': { rows: 2, cols: 2 }, 'ㅂ': { rows: 3, cols: 2 }, 'ㅅ': { rows: 2.5, cols: 2.6 }, 'ㅇ': { rows: 2, cols: 2 },
  'ㅈ': { rows: 3, cols: 2.6 }, 'ㅊ': { rows: 3.2, cols: 2.6 }, 'ㅋ': { rows: 3, cols: 2 }, 'ㅌ': { rows: 3, cols: 2 },
  'ㅍ': { rows: 2.2, cols: 3.2 }, 'ㅎ': { rows: 3.2, cols: 2.4 },
};

// 중성: v 세로 부분(오른쪽), h 가로 부분(아래). 섞인 모음은 둘 다
const VOWELS = {
  'ㅏ': { v: 'ㅏ' }, 'ㅐ': { v: 'ㅐ' }, 'ㅑ': { v: 'ㅑ' }, 'ㅒ': { v: 'ㅒ' }, 'ㅓ': { v: 'ㅓ' }, 'ㅔ': { v: 'ㅔ' },
  'ㅕ': { v: 'ㅕ' }, 'ㅖ': { v: 'ㅖ' }, 'ㅣ': { v: 'ㅣ' },
  'ㅗ': { h: 'ㅗ' }, 'ㅛ': { h: 'ㅛ' }, 'ㅜ': { h: 'ㅜ' }, 'ㅠ': { h: 'ㅠ' }, 'ㅡ': { h: 'ㅡ' },
  'ㅘ': { h: 'ㅗ', v: 'ㅏ' }, 'ㅙ': { h: 'ㅗ', v: 'ㅐ' }, 'ㅚ': { h: 'ㅗ', v: 'ㅣ' },
  'ㅝ': { h: 'ㅜ', v: 'ㅓ' }, 'ㅞ': { h: 'ㅜ', v: 'ㅔ' }, 'ㅟ': { h: 'ㅜ', v: 'ㅣ' }, 'ㅢ': { h: 'ㅡ', v: 'ㅣ' },
};
// 세로 모음 부분: w 폭 비중, min 최소 폭(획 간격 단위), ticks 곁획 수
const VPART = {
  'ㅣ': { w: 0, min: 0, ticks: 0 }, 'ㅏ': { w: 1, min: 1, ticks: 1 }, 'ㅓ': { w: 1, min: 1, ticks: 1 },
  'ㅑ': { w: 1, min: 1, ticks: 2 }, 'ㅕ': { w: 1, min: 1, ticks: 2 }, 'ㅐ': { w: 1.25, min: 1.2, ticks: 1 },
  'ㅒ': { w: 1.25, min: 1.2, ticks: 2 }, 'ㅔ': { w: 1.7, min: 2, ticks: 1 }, 'ㅖ': { w: 1.7, min: 2, ticks: 2 },
};
// 가로 모음 부분: w 높이 비중, min 최소 높이(획 간격 단위). ㅡ 는 높이 없이 가로획 하나
const HPART = { 'ㅡ': { w: 0, min: 0 }, 'ㅗ': { w: 1, min: 1 }, 'ㅛ': { w: 1, min: 1 }, 'ㅜ': { w: 1, min: 1 }, 'ㅠ': { w: 1, min: 1 } };

const GAP = 2.2; // 자모 사이 간격 (획 굵기 배수, 가운데선 기준. 흰 틈은 1.2배)
const PITCH = 1.7; // 한 자모 안 나란한 획 사이 최소 간격 (획 굵기 배수. 흰 틈은 0.7배)
const FOLD_MIN = 2.0; // 되접은 겹 사이 간격 범위 (획 굵기 배수)
const FOLD_MAX = 2.8;
const BIAS = 0.7; // 자리 비중에 더하는 기본값 (획이 적은 자모도 너무 작아지지 않게)

/**
 * 글자 하나의 인장체 획. 한글 음절(가~힣), 영문 대문자, 숫자만 만들고 그 밖은 null.
 * @param {string} ch
 * @param {object} [o]
 * @param {'plain'|'folded'} [o.style]
 * @param {number|{x:number,y:number}} [o.stroke] 획 굵기 (단위 좌표, 가로·세로 따로 줄 수 있다). 자모 간격을 정한다
 * @param {number} [o.folds] folded 에서 되접는 최대 겹 수 (기본 3)
 */
export function sealGlyph(ch, { style = 'plain', stroke = 0.07, folds = 3 } = {}) {
  if (typeof ch !== 'string') return null;
  const sx = clampStroke(typeof stroke === 'number' ? stroke : stroke?.x);
  const sy = clampStroke(typeof stroke === 'number' ? stroke : stroke?.y);
  const env = {
    sx, sy, px: sx * PITCH, py: sy * PITCH, gx: sx * GAP, gy: sy * GAP,
    folded: style === 'folded', folds: style === 'folded' ? Math.max(0, Math.floor(folds)) : 0,
    crowd: 1, // 최소 간격 합 / 쓸 수 있는 길이 의 최댓값
  };
  const d = decomposeSyllable(ch);
  if (d) return syllable(d, env);
  const latin = Object.hasOwn(LATIN, ch) ? LATIN[ch] : null;
  if (latin) return { paths: latin.paths.map((p) => p.map(([x, y]) => [x, y])), shapes: latin.shapes.map((s) => ({ ...s })), aspect: latin.aspect, fit: 1 };
  return null;
}

export function hasSealGlyph(ch) {
  return Boolean(decomposeSyllable(ch) || (typeof ch === 'string' && Object.hasOwn(LATIN, ch)));
}

function clampStroke(v) {
  return Number.isFinite(v) && v > 0 ? Math.min(v, 0.2) : 0.07;
}

// ───────────── 음절 배치 ─────────────

function syllable({ initial, medial, final }, env) {
  const out = { paths: [], shapes: [] };
  const vow = VOWELS[medial];
  const { gx, gy, px, py } = env;
  // 구첩은 모음 자리를 줄이고 그만큼 자음을 넓혀 되접을 자리를 만든다
  const vk = env.folded ? 0.6 : 1;
  const L = metrics(initial);
  const T = final ? metrics(final) : null;
  const rowItem = (m) => ({ w: m.rows - 1 + BIAS, min: (m.rows - 1) * py });
  const colItem = (m) => ({ w: m.cols - 1 + BIAS, min: (m.cols - 1) * px });

  if (vow.v && !vow.h) {
    // 세로 모음: 초성 | 모음 (받침은 아래 전체 폭)
    const vp = VPART[vow.v];
    const [wl, wv] = split(1 - gx, [colItem(L), { w: vp.w * vk, min: vp.min * px }], env);
    let top = 1;
    if (T) {
      const need = Math.max(L.rows - 1, vp.ticks === 2 ? 2 : 1);
      [top] = split(1 - gy, [{ w: need + BIAS, min: need * py }, rowItem(T)], env);
      consonant(final, { x0: 0, y0: top + gy, x1: 1, y1: 1 }, env, out);
    }
    consonant(initial, { x0: 0, y0: 0, x1: wl, y1: top }, env, out);
    vowelV(vow.v, { x0: 1 - wv, y0: 0, x1: 1, y1: top }, top / 2, env, out);
  } else if (vow.h && !vow.v) {
    // 가로 모음: 초성 / 모음 / 받침
    const hp = HPART[vow.h];
    const items = [rowItem(L), { w: hp.w * vk, min: hp.min * py }];
    if (T) items.push(rowItem(T));
    const hs = split(1 - gy * (items.length - 1), items, env);
    const yv = hs[0] + gy;
    consonant(initial, { x0: 0, y0: 0, x1: 1, y1: hs[0] }, env, out);
    vowelH(vow.h, { x0: 0, y0: yv, x1: 1, y1: yv + hs[1] }, env, out);
    if (T) consonant(final, { x0: 0, y0: 1 - hs[2], x1: 1, y1: 1 }, env, out);
  } else {
    // 섞인 모음: 왼쪽 위 초성, 그 아래 가로 부분, 오른쪽에 세로 부분 (받침은 아래 전체 폭)
    const vp = VPART[vow.v];
    const hp = HPART[vow.h];
    const [wl, wv] = split(1 - gx, [colItem(L), { w: vp.w * vk, min: vp.min * px }], env);
    let top = 1;
    if (T) {
      const need = L.rows - 1 + (hp.w ? 1 : 0) + 1;
      [top] = split(1 - gy, [{ w: need + BIAS, min: need * py }, rowItem(T)], env);
      consonant(final, { x0: 0, y0: top + gy, x1: 1, y1: 1 }, env, out);
    }
    const [hl, hh] = split(top - gy, [rowItem(L), { w: hp.w * vk, min: hp.min * py }], env);
    consonant(initial, { x0: 0, y0: 0, x1: wl, y1: hl }, env, out);
    const low = { x0: 0, y0: top - hh, x1: wl, y1: top };
    vowelH(vow.h, low, env, out);
    // 왼쪽으로 뻗는 곁획(ㅝ·ㅞ)은 가로 부분의 가로획과 높이를 달리해 이어진 것처럼 보이지 않게 한다
    const left = vow.v === 'ㅓ' || vow.v === 'ㅔ';
    const ty = left && hh > 0 ? Math.min(top - py * 0.6, low.y0 + Math.max(hh / 2, py)) : top / 2;
    vowelV(vow.v, { x0: 1 - wv, y0: 0, x1: 1, y1: top }, ty, env, out);
  }
  return { paths: out.paths, shapes: out.shapes, aspect: 1, fit: Math.min(1, 1 / env.crowd) };
}

function metrics(name) {
  const pair = PAIRS[name];
  if (!pair) return CONS[name];
  const [a, b] = pair.map((p) => CONS[p]);
  return { rows: Math.max(a.rows, b.rows), cols: a.cols + b.cols + 0.4 };
}

/** 길이 total 을 비중(w)대로 나누되 몫마다 최소값(min)을 지킨다. 최소값의 합이 넘치면 최소값 비율로 줄인다 */
function split(total, items, env) {
  if (!(total > 0)) return items.map(() => 0); // 획이 아주 굵어 자리가 없을 때
  const minSum = items.reduce((t, it) => t + it.min, 0);
  if (env && total > 0) env.crowd = Math.max(env.crowd, minSum / total);
  if (minSum >= total) {
    return items.map((it) => (minSum > 0 ? (it.min / minSum) * total : total / items.length));
  }
  const fixed = new Set();
  let sizes = items.map((it) => it.min);
  for (let iter = 0; iter <= items.length; iter++) {
    const rest = total - [...fixed].reduce((t, i) => t + items[i].min, 0);
    const free = items.map((_, i) => i).filter((i) => !fixed.has(i));
    const wSum = free.reduce((t, i) => t + items[i].w, 0);
    sizes = items.map((it, i) => {
      if (fixed.has(i)) return it.min;
      return wSum > 0 ? (rest * it.w) / wSum : rest / free.length;
    });
    const low = free.filter((i) => sizes[i] < items[i].min - 1e-12);
    if (!low.length) break;
    low.forEach((i) => fixed.add(i));
  }
  return sizes;
}

// ───────────── 모음 ─────────────

function vowelV(name, { x0, y0, x1, y1 }, ty, env, out) {
  const P = out.paths;
  const stem = (x) => P.push([[x, y0], [x, y1]]);
  const vp = VPART[name];
  const ys = tickYs(vp.ticks, ty, y0, y1, env.py);
  const ticks = (xa, xb) => ys.forEach((y) => P.push([[xa, y], [xb, y]]));
  const xm = x0 + (x1 - x0) * 0.5;
  switch (name) {
    case 'ㅣ': stem(x1); break;
    case 'ㅏ': case 'ㅑ': stem(x0); ticks(x0, x1); break;
    case 'ㅓ': case 'ㅕ': stem(x1); ticks(x0, x1); break;
    case 'ㅐ': case 'ㅒ': stem(x0); stem(x1); ticks(x0, x1); break;
    case 'ㅔ': case 'ㅖ': stem(xm); stem(x1); ticks(x0, xm); break;
    default: break;
  }
}

/** 곁획 높이. 둘이면 가운데를 두고 벌린다 */
function tickYs(n, ty, y0, y1, py) {
  if (n === 0) return [];
  const h = y1 - y0;
  const lo = y0 + Math.min(py * 0.75, h / 4);
  const hi = y1 - Math.min(py * 0.75, h / 4);
  if (n === 1) return [clamp(ty, lo, hi)];
  const d = clamp(h * 0.3, py * 1.05, Math.max(py * 1.05, h * 0.6));
  const a = clamp(ty - d / 2, lo, hi);
  const b = clamp(a + d, lo, hi);
  return [Math.min(a, b - Math.min(d, hi - lo)), b];
}

function vowelH(name, { x0, y0, x1, y1 }, env, out) {
  const P = out.paths;
  const w = x1 - x0;
  const xm = x0 + w / 2;
  const two = [x0 + w * 0.3, x1 - w * 0.3];
  if (two[1] - two[0] < env.px) {
    two[0] = xm - env.px / 2;
    two[1] = xm + env.px / 2;
  }
  switch (name) {
    case 'ㅡ': P.push([[x0, y1], [x1, y1]]); break;
    case 'ㅗ': P.push([[x0, y1], [x1, y1]], [[xm, y0], [xm, y1]]); break;
    case 'ㅛ': P.push([[x0, y1], [x1, y1]], ...two.map((x) => [[x, y0], [x, y1]])); break;
    case 'ㅜ': P.push([[x0, y0], [x1, y0]], [[xm, y0], [xm, y1]]); break;
    case 'ㅠ': P.push([[x0, y0], [x1, y0]], ...two.map((x) => [[x, y0], [x, y1]])); break;
    default: break;
  }
}

// ───────────── 자음 ─────────────

function consonant(name, box, env, out) {
  const pair = PAIRS[name];
  if (!pair) return single(name, box, env, out);
  const [a, b] = pair.map((p) => CONS[p]);
  const g = env.gx * 0.9;
  const [wa, wb] = split(box.x1 - box.x0 - g, [
    { w: a.cols - 1 + BIAS, min: (a.cols - 1) * env.px },
    { w: b.cols - 1 + BIAS, min: (b.cols - 1) * env.px },
  ], env);
  single(pair[0], { ...box, x1: box.x0 + wa }, env, out);
  single(pair[1], { ...box, x0: box.x1 - wb }, env, out);
}

function single(name, { x0, y0, x1, y1 }, env, out) {
  const P = out.paths;
  const w = x1 - x0;
  const h = y1 - y0;
  const xm = x0 + w / 2;
  const ym = y0 + h / 2;
  const { py } = env;
  // 되접기: 꺾은선을 안쪽으로 겹겹이 (깊이 dx, dy 안에서)
  const fold = (path, side, dx, dy) => P.push(env.folds ? nest(path, side, dx, dy, env) : path);
  // ㅅ 계열의 가운데 줄기가 가로획(π)에 닿는 높이
  const pi = (top) => {
    const k = env.folded ? 0.34 : 0.42;
    return clamp(top + (y1 - top) * k, top + Math.min(py, (y1 - top) / 2), y1 - Math.min(py, (y1 - top) / 2));
  };
  const legs = (yk) => fold([[x0, y1], [x0, yk], [x1, yk], [x1, y1]], -1, w / 2, y1 - yk);

  switch (name) {
    case 'ㄱ':
      fold([[x0, y0], [x1, y0], [x1, y1]], -1, w, h);
      break;
    case 'ㄴ':
      fold([[x0, y0], [x0, y1], [x1, y1]], 1, w, h);
      break;
    case 'ㄷ':
      fold([[x1, y0], [x0, y0], [x0, y1], [x1, y1]], 1, w, h / 2);
      break;
    case 'ㄹ': {
      const runs = env.folds ? serpentineRuns(h, env) : 3;
      const pts = [];
      for (let i = 0; i < runs; i++) {
        const y = y0 + (h * i) / (runs - 1);
        if (i % 2) pts.push([x1, y], [x0, y]);
        else pts.push([x0, y], [x1, y]);
      }
      P.push(pts);
      break;
    }
    case 'ㅁ':
      P.push(env.folds ? spiral(x0, y0, x1, y1, env) : [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);
      break;
    case 'ㅂ':
      if (env.folds) {
        // 아래 칸을 ㅁ 처럼 소용돌이로 메우고 위로 두 귀를 세운다
        P.push([[x0, y0], [x0, ym]], [[x1, y0], [x1, ym]], spiral(x0, ym, x1, y1, env));
      } else {
        P.push([[x0, y0], [x0, y1], [x1, y1], [x1, y0]], [[x0, ym], [x1, ym]]);
      }
      break;
    case 'ㅅ': {
      const yk = pi(y0);
      P.push([[xm, y0], [xm, yk]]);
      legs(yk);
      break;
    }
    case 'ㅇ':
      rings(x0, y0, x1, y1, env, out);
      break;
    case 'ㅈ': {
      const yk = pi(y0 + Math.min(py, h / 3));
      P.push([[x0, y0], [x1, y0]], [[xm, y0], [xm, yk]]);
      legs(yk);
      break;
    }
    case 'ㅊ': {
      // 꼭지는 가로획 위로 솟은 짧은 세로획 (훈민정음 해례본의 ㅊ·ㅎ 처럼)
      const yb = y0 + clamp(h * 0.2, Math.min(py * 0.8, h / 4), h / 3);
      const yk = pi(yb + Math.min(py, (y1 - yb) / 3));
      P.push([[x0, yb], [x1, yb]], [[xm, y0], [xm, yk]]);
      legs(yk);
      break;
    }
    case 'ㅋ':
      P.push([[x0, y0], [x1, y0], [x1, ym]]);
      fold([[x0, ym], [x1, ym], [x1, y1]], -1, w, h / 2);
      break;
    case 'ㅌ':
      if (env.folds) {
        // ㄷ 두 개를 포갠 모양으로 보고 위·아래 칸을 따로 되접는다 (가운데 가로획은 둘이 함께 쓴다)
        fold([[x1, y0], [x0, y0], [x0, ym], [x1, ym]], 1, w, h / 4);
        fold([[x1, ym], [x0, ym], [x0, y1], [x1, y1]], 1, w, h / 4);
      } else {
        P.push([[x1, y0], [x0, y0], [x0, y1], [x1, y1]], [[x0, ym], [x1, ym]]);
      }
      break;
    case 'ㅍ': {
      const inset = Math.min(w * 0.26, Math.max(0, (w - env.px) / 2));
      P.push([[x0, y0], [x1, y0]], [[x0, y1], [x1, y1]]);
      // 구첩: 두 기둥 사이를 소용돌이로 메운다 (바깥 고리가 곧 두 기둥)
      if (env.folds) P.push(spiral(x0 + inset, y0, x1 - inset, y1, env));
      else P.push([[x0 + inset, y0], [x0 + inset, y1]], [[x1 - inset, y0], [x1 - inset, y1]]);
      break;
    }
    case 'ㅎ': {
      const yb = y0 + clamp(h * 0.2, Math.min(py * 0.8, h / 4), h / 3);
      const yo = yb + clamp((y1 - yb) * 0.24, Math.min(py, (y1 - yb) / 3), (y1 - yb) / 2);
      const ins = Math.min(w * 0.1, env.px * 0.6);
      P.push([[xm, y0], [xm, yb]], [[x0, yb], [x1, yb]]);
      rings(x0 + ins, yo, x1 - ins, y1, env, out);
      break;
    }
    default:
      break;
  }
}

/** ㅇ: 둥근 사각. 구첩은 안쪽에 겹 테를 더한다 */
function rings(x0, y0, x1, y1, env, out) {
  const w = x1 - x0;
  const h = y1 - y0;
  let k = 1;
  let m = 0;
  for (let n = env.folds + 1; n >= 2; n--) {
    m = Math.min(FOLD_MAX, Math.min(w / env.sx, h / env.sy) / (2 * n - 1));
    if (m >= FOLD_MIN) { k = n; break; }
  }
  for (let i = 0; i < k; i++) {
    const ox = i * m * env.sx;
    const oy = i * m * env.sy;
    out.shapes.push({ type: 'rrect', x: x0 + ox, y: y0 + oy, w: w - ox * 2, h: h - oy * 2, r: 0.42 });
  }
}

/** ㄹ 굽이 수 (홀수). 높이가 넉넉하면 3 → 5. 7 굽이부터는 작은 도장에서 ≡ 처럼 보여 5 에서 멈춘다 */
function serpentineRuns(h, env) {
  let runs = 3;
  for (let r = Math.min(5, 3 + 2 * env.folds); r > 3; r -= 2) {
    if (h / env.sy / (r - 1) >= FOLD_MIN) { runs = r; break; }
  }
  return runs;
}

/** ㅁ 소용돌이: 바깥 테를 돌고 안으로 한 겹씩 들어간다 */
function spiral(x0, y0, x1, y1, env) {
  const w = x1 - x0;
  const h = y1 - y0;
  let k = 1;
  let m = 0;
  for (let n = env.folds + 1; n >= 2; n--) {
    m = Math.min(FOLD_MAX, Math.min(w / env.sx, h / env.sy) / (2 * n - 1));
    if (m >= FOLD_MIN) { k = n; break; }
  }
  if (k === 1) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  const ox = m * env.sx;
  const oy = m * env.sy;
  const pts = [[x0, y0]];
  for (let i = 0; i < k; i++) {
    pts.push([x1 - i * ox, y0 + i * oy], [x1 - i * ox, y1 - i * oy], [x0 + i * ox, y1 - i * oy], [x0 + i * ox, y0 + (i + 1) * oy]);
  }
  return pts;
}

/**
 * 꺾은선 하나를 안쪽(side)으로 겹겹이 되접어 한 획으로 잇는다.
 * 겹 k 는 각 마디를 안쪽으로 k 칸 옮긴 선이고, 홀수 겹은 거꾸로 따라가 끝끼리 U 자로 이어진다.
 * side +1: 진행 방향 (dx, dy) 의 안쪽 법선이 (dy, -dx). dx, dy: 안쪽으로 들어갈 수 있는 깊이
 */
function nest(path, side, depthX, depthY, env) {
  const ratio = Math.min(depthX / env.sx, depthY / env.sy);
  for (let n = env.folds; n >= 1; n--) {
    const m = Math.min(FOLD_MAX, ratio / (n + 1));
    if (m < FOLD_MIN) continue;
    const ox = m * env.sx;
    const oy = m * env.sy;
    const layers = [];
    for (let k = 0; k <= n; k++) layers.push(offsetPath(path, side, k * ox, k * oy));
    if (!layers.every((l) => sameDirections(path, l, Math.min(ox, oy) * 0.5))) continue;
    const pts = [];
    layers.forEach((l, k) => pts.push(...(k % 2 ? l.slice().reverse() : l)));
    return pts;
  }
  return path;
}

function offsetPath(path, side, ox, oy) {
  const shifts = [];
  for (let i = 0; i < path.length - 1; i++) {
    const dx = Math.sign(path[i + 1][0] - path[i][0]);
    const dy = Math.sign(path[i + 1][1] - path[i][1]);
    shifts.push([side * dy * ox, -side * dx * oy]);
  }
  return path.map(([x, y], i) => {
    let sx = 0;
    let sy = 0;
    for (const s of [shifts[i - 1], shifts[i]]) {
      if (!s) continue;
      if (s[0]) sx = s[0];
      if (s[1]) sy = s[1];
    }
    return [x + sx, y + sy];
  });
}

/** 옮긴 선의 마디가 원래 방향을 유지하고 너무 짧아지지 않았는지 */
function sameDirections(a, b, minLen) {
  for (let i = 0; i < a.length - 1; i++) {
    const da = [a[i + 1][0] - a[i][0], a[i + 1][1] - a[i][1]];
    const db = [b[i + 1][0] - b[i][0], b[i + 1][1] - b[i][1]];
    if (Math.sign(da[0]) !== Math.sign(db[0]) || Math.sign(da[1]) !== Math.sign(db[1])) return false;
    if (Math.abs(db[0]) + Math.abs(db[1]) < minLen) return false;
  }
  return true;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// ───────────── 영문 대문자·숫자 ─────────────
// 같은 굵기의 직각 획. 대각선 없이는 알아보기 어려운 K·N·V·X·Y·Z·M·W 와 R·Q 의 다리만 비스듬히 긋는다

const glyph = (aspect, paths, shapes = []) => ({ aspect, paths, shapes });
const LATIN = {
  A: glyph(0.8, [[[0, 1], [0, 0], [1, 0], [1, 1]], [[0, 0.55], [1, 0.55]]]),
  B: glyph(0.8, [[[0, 0], [0, 1], [1, 1], [1, 0.5], [0, 0.5]], [[0, 0], [0.8, 0], [0.8, 0.5]]]),
  C: glyph(0.78, [[[1, 0], [0, 0], [0, 1], [1, 1]]]),
  D: glyph(0.8, [[[0, 0], [0.68, 0], [1, 0.3], [1, 0.7], [0.68, 1], [0, 1], [0, 0]]]),
  E: glyph(0.74, [[[1, 0], [0, 0], [0, 1], [1, 1]], [[0, 0.5], [0.86, 0.5]]]),
  F: glyph(0.74, [[[1, 0], [0, 0], [0, 1]], [[0, 0.5], [0.86, 0.5]]]),
  G: glyph(0.8, [[[1, 0], [0, 0], [0, 1], [1, 1], [1, 0.5], [0.5, 0.5]]]),
  H: glyph(0.8, [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0.5], [1, 0.5]]]),
  I: glyph(0.46, [[[0, 0], [1, 0]], [[0, 1], [1, 1]], [[0.5, 0], [0.5, 1]]]),
  J: glyph(0.72, [[[0.3, 0], [1, 0], [1, 1], [0, 1], [0, 0.6]]]),
  K: glyph(0.8, [[[0, 0], [0, 1]], [[1, 0], [0, 0.56]], [[0.36, 0.36], [1, 1]]]),
  L: glyph(0.72, [[[0, 0], [0, 1], [1, 1]]]),
  M: glyph(0.95, [[[0, 1], [0, 0], [0.5, 0.58], [1, 0], [1, 1]]]),
  N: glyph(0.82, [[[0, 1], [0, 0], [1, 1], [1, 0]]]),
  O: glyph(0.82, [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]),
  P: glyph(0.78, [[[0, 1], [0, 0], [1, 0], [1, 0.55], [0, 0.55]]]),
  Q: glyph(0.82, [[[1, 0.7], [1, 0], [0, 0], [0, 1], [0.7, 1]], [[0.5, 0.55], [1, 1]]]),
  R: glyph(0.8, [[[0, 1], [0, 0], [1, 0], [1, 0.5], [0, 0.5]], [[0.42, 0.5], [1, 1]]]),
  S: glyph(0.78, [[[1, 0.22], [1, 0], [0, 0], [0, 0.5], [1, 0.5], [1, 1], [0, 1], [0, 0.78]]]),
  T: glyph(0.8, [[[0, 0], [1, 0]], [[0.5, 0], [0.5, 1]]]),
  U: glyph(0.8, [[[0, 0], [0, 1], [1, 1], [1, 0]]]),
  V: glyph(0.82, [[[0, 0], [0, 0.5], [0.5, 1], [1, 0.5], [1, 0]]]),
  W: glyph(0.95, [[[0, 0], [0, 1], [0.5, 0.42], [1, 1], [1, 0]]]),
  X: glyph(0.82, [[[0, 0], [1, 1]], [[1, 0], [0, 1]]]),
  Y: glyph(0.82, [[[0, 0], [0.5, 0.5], [1, 0]], [[0.5, 0.5], [0.5, 1]]]),
  Z: glyph(0.8, [[[0, 0], [1, 0], [0, 1], [1, 1]]]),
  0: glyph(0.66, [], [{ type: 'rrect', x: 0, y: 0, w: 1, h: 1, r: 0.34 }]),
  1: glyph(0.5, [[[0.12, 0], [0.6, 0], [0.6, 1]], [[0.12, 1], [1, 1]]]),
  2: glyph(0.66, [[[0, 0], [1, 0], [1, 0.5], [0, 0.5], [0, 1], [1, 1]]]),
  3: glyph(0.66, [[[0, 0], [1, 0], [1, 1], [0, 1]], [[0.3, 0.5], [1, 0.5]]]),
  4: glyph(0.7, [[[0, 0], [0, 0.62], [1, 0.62]], [[0.72, 0.3], [0.72, 1]]]),
  5: glyph(0.66, [[[1, 0], [0, 0], [0, 0.48], [1, 0.48], [1, 1], [0, 1]]]),
  6: glyph(0.66, [[[1, 0], [0, 0], [0, 1], [1, 1], [1, 0.5], [0, 0.5]]]),
  7: glyph(0.66, [[[0, 0.22], [0, 0], [1, 0], [1, 1]]]),
  8: glyph(0.66, [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], [[0, 0.5], [1, 0.5]]]),
  9: glyph(0.66, [[[1, 0.5], [0, 0.5], [0, 0], [1, 0], [1, 1], [0, 1]]]),
};
