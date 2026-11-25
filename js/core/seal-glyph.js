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
//
// 참고 꼴(variant) 세 가지 — 주지 않으면 위 배치 그대로. 아래 '참고 인장체 꼴' 절 참고
//   ref1 · ref2 · ref3  다른 곳의 인장체 글꼴 세 단계를 본뜬 배치 (빈 곳을 감싸는 획, 두 줄 띠, 겹 획)

export const INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
export const MEDIALS = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
export const FINALS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
export const SEAL_STYLES = ['plain', 'folded'];
export const SEAL_VARIANTS = ['ref1', 'ref2', 'ref3'];

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
 * @param {number} [o.ringFolds] folded 에서 ㅇ 안쪽에 더하는 겹 테 최대 수 (기본은 folds 와 같다. 0 이면 ㅇ 은 테 하나)
 * @param {boolean} [o.flatTick] ㅊ·ㅎ 꼭지를 세로획 대신 짧은 가로획으로 (기본 false)
 * @param {'ref1'|'ref2'|'ref3'} [o.variant] 한글 음절을 참고 꼴로 (SEAL_VARIANTS). 주지 않으면 기본 배치.
 *   style·folds·ringFolds 는 참고 꼴에서도 ㄱ·ㄴ·ㄷ·ㄹ·ㅁ 등 참고 꼴이 따로 정하지 않은 자음에 그대로 쓴다
 */
export function sealGlyph(ch, { style = 'plain', stroke = 0.07, folds = 3, ringFolds = folds, flatTick = false, variant = null } = {}) {
  if (typeof ch !== 'string') return null;
  const sx = clampStroke(typeof stroke === 'number' ? stroke : stroke?.x);
  const sy = clampStroke(typeof stroke === 'number' ? stroke : stroke?.y);
  const folded = style === 'folded';
  const env = {
    sx, sy, px: sx * PITCH, py: sy * PITCH, gx: sx * GAP, gy: sy * GAP,
    folded, folds: folded ? Math.max(0, Math.floor(folds)) : 0,
    ringFolds: folded ? Math.max(0, Math.floor(ringFolds)) : 0,
    flatTick: Boolean(flatTick),
    crowd: 1, // 최소 간격 합 / 쓸 수 있는 길이 의 최댓값
  };
  const d = decomposeSyllable(ch);
  if (d && typeof variant === 'string' && Object.hasOwn(REF, variant)) return refSyllable(d, refEnv(env, REF[variant]));
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
      // 꼭지는 가로획 위로 솟은 짧은 세로획 (훈민정음 해례본의 ㅊ·ㅎ 처럼). flatTick 이면 짧은 가로획
      const yb = y0 + clamp(h * 0.2, Math.min(py * (env.flatTick ? 1 : 0.8), h / 4), h / 3);
      const yk = pi(yb + Math.min(py, (y1 - yb) / 3));
      if (env.flatTick) P.push([[x0, yb], [x1, yb]], flatTick(x0, x1, y0, h, env), [[xm, yb], [xm, yk]]);
      else P.push([[x0, yb], [x1, yb]], [[xm, y0], [xm, yk]]);
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
      const yb = y0 + clamp(h * 0.2, Math.min(py * (env.flatTick ? 1 : 0.8), h / 4), h / 3);
      const yo = yb + clamp((y1 - yb) * 0.24, Math.min(py, (y1 - yb) / 3), (y1 - yb) / 2);
      const ins = Math.min(w * 0.1, env.px * 0.6);
      P.push(env.flatTick ? flatTick(x0, x1, y0, h, env) : [[xm, y0], [xm, yb]], [[x0, yb], [x1, yb]]);
      rings(x0 + ins, yo, x1 - ins, y1, env, out);
      break;
    }
    default:
      break;
  }
}

/**
 * ㅊ·ㅎ 꼭지를 짧은 가로획으로 (flatTick): 가운데에 폭의 절반까지. 납작한 칸(가로로 넓은 성)에서
 * 아래 가로획과 겹줄처럼 보이지 않게 칸 높이 h 의 0.6 배를 넘지 않고, 획 사이 간격보다는 길게
 */
function flatTick(x0, x1, y, h, env) {
  const xm = (x0 + x1) / 2;
  const half = Math.min((x1 - x0) / 2, Math.max(env.px / 2, Math.min((x1 - x0) * 0.25, h * 0.3)));
  return [[xm - half, y], [xm + half, y]];
}

/** ㅇ: 둥근 사각. 구첩은 안쪽에 겹 테를 더한다 (ringFolds 겹까지) */
function rings(x0, y0, x1, y1, env, out) {
  const w = x1 - x0;
  const h = y1 - y0;
  let k = 1;
  let m = 0;
  for (let n = env.ringFolds + 1; n >= 2; n--) {
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

// ───────────── 참고 인장체 꼴 (variant) ─────────────
// 다른 곳의 인장체 글꼴 세 단계(기본·삼첩·구첩 자리)를 본뜬 배치. 공통으로
//   · ㅅ 은 갓머리 Г(윗가로획 + 왼 기둥)에 기둥 중간에서 갈라지는 오른 다리 (ㅅ 의 둘째 획이 첫 획 중간에서 나오는 것처럼)
//   · ㅏ 기둥은 위에서 오른쪽으로 꺾이고(갓), 곁획은 오른쪽 끝에서 아래로 꺾여 내려간다
//   · 받침 위 ㅡ·ㅗ·ㅛ 가로획은 양끝을 내려 받침을 감싼다 (冂)
//   · 받침 없는 '이' 는 ㅣ 가 ㅇ 을 위아래로 감싼다 (ref3 은 ㅇ 을 길게 세우고 ㅣ 를 꺾쇠 ⊐ 로)
// 단계마다 다른 것
//   ref1  둥근 꼴: ㅅ 다리는 둥근 고리와 휜 다리, ㅎ 가로획은 양끝을 올린 ⊔, ㅗ 가로획은 끝을 내리고 ㅣ 기둥에 잇는다
//   ref2  칸을 더 채운다: 섞인 모음의 ㅣ 는 두 줄 띠(∩), ㅅ 다리는 고리에 곧은 사선, ㅗ 는 끝을 세운다(섞인 모음은 왼끝만)
//   ref3  겹 획: ㅅ·ㅏ 는 Г 에 ㄱ 꺾임(∏∏), ㅎ 은 가로획 둘(⅃) 위에 긴 알약, ㅗ 는 ш
// 두 줄 띠는 홑모음 ㅣ 에 쓰지 않는다: 기·리·민 처럼 자음 옆에 서면 ∩ 가 자음 하나(ㄱ·ㅁ)로 읽혀 끼·림 처럼 보인다.
// ㅜ 양끝도 내리지 않는다(uEnds): 다리가 셋이 되어 ㅠ 와 헷갈린다
// gap·pitch 는 자모 사이·한 자모 안 획 간격(획 굵기 배수), bandW 는 ㅣ 띠 폭 비중, tickY 는 ㅏ 곁획 높이(세로 칸 비율),
// oPlain·oMixed 는 ㅗ 끝 꺾기(홑모음·섞인 모음): 'down' 내림, 'up' 양끝 올림(ш), 'left' 왼끝만 올림
const REF = {
  ref1: { gap: 2.2, pitch: 1.7, band: false, bandW: 0, wrapI: 'fold', hook: true, sLeg: 'bowl', curve: true, hTop: 'cup', oPlain: 'down', oMixed: 'down', uEnds: false, tickY: 0.3 },
  ref2: { gap: 2.0, pitch: 1.6, band: true, bandW: 1.1, wrapI: 'fold', hook: true, sLeg: 'bowl', curve: false, hTop: 'flat', oPlain: 'up', oMixed: 'left', uEnds: false, tickY: 0.3 },
  ref3: { gap: 2.0, pitch: 1.6, band: true, bandW: 1.15, wrapI: 'bracket', hook: false, sLeg: 'step', curve: false, hTop: 'stack', oPlain: 'up', oMixed: 'up', uEnds: false, tickY: 0.5 },
};
// 참고 꼴에서 모양이 바뀌는 자음의 획 층·줄 수 (나머지는 CONS)
const REF_CONS = { 'ㅅ': { rows: 3, cols: 2.4 }, 'ㅈ': { rows: 3.4, cols: 2.4 }, 'ㅊ': { rows: 4, cols: 2.4 }, 'ㅎ': { rows: 3.4, cols: 2.2 } };
// 아래가 비어 ㅏ·ㅣ 기둥이 밑으로 꺾여 받칠 수 있는 초성
const OPEN_BOTTOM = new Set(['ㅅ', 'ㅆ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅇ', 'ㅎ']);

function refEnv(env, R) {
  const { sx, sy } = env;
  return { ...env, ref: R, px: sx * R.pitch, py: sy * R.pitch, gx: sx * R.gap, gy: sy * R.gap, flatTick: true };
}

function refMetrics(name) {
  const pair = PAIRS[name];
  const one = (n) => REF_CONS[n] ?? CONS[n];
  if (!pair) return one(name);
  const [a, b] = pair.map(one);
  return { rows: Math.max(a.rows, b.rows), cols: a.cols + b.cols + 0.4 };
}

function refSyllable({ initial, medial, final }, env) {
  const R = env.ref;
  const out = { paths: [], shapes: [] };
  const P = out.paths;
  const vow = VOWELS[medial];
  const { gx, gy, px, py } = env;
  const L = refMetrics(initial);
  const T = final ? refMetrics(final) : null;
  const rowItem = (m) => ({ w: m.rows - 1 + BIAS, min: (m.rows - 1) * py });
  const colItem = (m) => ({ w: m.cols - 1 + BIAS, min: (m.cols - 1) * px });
  const vItem = (v, band) => (band ? { w: R.bandW, min: px } : { w: VPART[v].w, min: VPART[v].min * px });
  const finalBelow = (top) => refConsonant(final, { x0: 0, y0: top + gy, x1: 1, y1: 1 }, env, out);

  if (vow.v && !vow.h) {
    // 세로 모음: 초성 | 모음 (받침은 아래 전체 폭)
    const v = vow.v;
    // 감싸기·받치기는 그만큼 자리를 뺀 뒤에도 ㅇ·초성이 들어갈 때만 (획이 아주 굵으면 기본 배치로)
    const wrapO = !T && initial === 'ㅇ' && v === 'ㅣ';
    if (wrapO && R.wrapI === 'fold' && 1 - py - gy * 2 >= py) {
      // '이': ㅣ 를 위에서 한 번 되접어 ㅇ 위를 두 줄로 덮고, 오른쪽으로 내려와 ㅇ 밑으로 꺾는다
      const [wl] = split(1 - gx, [colItem(L), { w: 0.55, min: px * 0.5 }], env);
      split(1 - py - gy * 2, [{ w: 1, min: py }], env);
      P.push([[1, 0], [0, 0], [0, py], [1, py], [1, 1], [0, 1]]);
      refConsonant('ㅇ', { x0: 0, y0: py + gy, x1: wl, y1: 1 - gy }, env, out);
      return refDone(out, env);
    }
    const [wl, wv] = split(1 - gx, [colItem(L), vItem(v, wrapO)], env);
    let top = 1;
    if (T) {
      // 갓을 쓴 ㅏ 는 갓 · 곁획 · 아래 끝 세 층이라 두 칸이 든다
      const need = Math.max(L.rows - 1, VPART[v].ticks === 2 || v === 'ㅏ' ? 2 : 1);
      [top] = split(1 - gy, [{ w: need + BIAS, min: need * py }, rowItem(T)], env);
      finalBelow(top);
    }
    // 받침이 없고 초성 아래가 비면 ㅏ·ㅣ 기둥을 초성 밑으로 꺾어 받친다
    const hook = R.hook && !T && OPEN_BOTTOM.has(initial) && (v === 'ㅏ' || v === 'ㅣ') && 1 - gy >= (L.rows - 1) * py;
    if (hook) split(1 - gy, [rowItem(L)], env);
    refConsonant(initial, { x0: 0, y0: 0, x1: wl, y1: hook ? 1 - gy : top }, env, out);
    refVowelV(v, { x0: 1 - wv, y0: 0, x1: 1, y1: top }, top / 2, env, out, { hook: hook ? 0 : null, bracket: wrapO, band: false });
  } else if (vow.h && !vow.v) {
    // 가로 모음: 초성 / 모음 / 받침
    const h = vow.h;
    const hp = HPART[h];
    const wrapT = Boolean(T) && (h === 'ㅡ' || h === 'ㅗ' || h === 'ㅛ') && 1 - gx * 2 >= (T.cols - 1) * px;
    const ends = T ? null : (h === 'ㅗ' && R.oPlain) || (h === 'ㅜ' && R.uEnds ? 'down' : null);
    const raise = ends === 'down' && h === 'ㅗ'; // 가로획을 올리고 끝을 내린다: 그만큼 자리를 더 준다
    const items = [rowItem(L), { w: hp.w + (raise ? 0.6 : 0), min: hp.min * py + (raise ? py : 0) }];
    if (T) items.push(rowItem(T));
    const hs = split(1 - gy * (items.length - 1), items, env);
    const yv = hs[0] + gy;
    refConsonant(initial, { x0: 0, y0: 0, x1: 1, y1: hs[0] }, env, out);
    const box = { x0: 0, y0: yv, x1: 1, y1: yv + hs[1] };
    if (wrapT) {
      refVowelH(h, box, env, out, { wrap: 1 });
      split(1 - gx * 2, [colItem(T)], env);
      refConsonant(final, { x0: gx, y0: 1 - hs[2], x1: 1 - gx, y1: 1 }, env, out);
    } else {
      refVowelH(h, box, env, out, { ends });
      if (T) refConsonant(final, { x0: 0, y0: 1 - hs[2], x1: 1, y1: 1 }, env, out);
    }
  } else {
    // 섞인 모음: 왼쪽 위 초성, 그 아래 가로 부분, 오른쪽에 세로 부분 (받침은 아래 전체 폭)
    const v = vow.v;
    const h = vow.h;
    const hp = HPART[h];
    const band = v === 'ㅣ' && R.band;
    const [wl, wv] = split(1 - gx, [colItem(L), vItem(v, band)], env);
    let top = 1;
    if (T) {
      const need = L.rows - 1 + (hp.w ? 1 : 0) + 1;
      [top] = split(1 - gy, [{ w: need + BIAS, min: need * py }, rowItem(T)], env);
      finalBelow(top);
    }
    const xs = 1 - wv;
    const low = h === 'ㅗ' || h === 'ㅡ'; // 가로획이 아래에 놓이는 가로 부분
    // ref1: 아래 가로획을 세로 부분 기둥까지 잇고 왼끝을 내린다 (ㅣ 는 오른끝, ㅏ·ㅐ 는 왼 기둥)
    const join = !R.band && low && (v === 'ㅣ' || v === 'ㅏ' || v === 'ㅐ') ? (v === 'ㅣ' ? 1 : xs) : null;
    let ends = null;
    if (join != null && R.oMixed === 'down') ends = 'down';
    else if (h === 'ㅗ') ends = R.oMixed;
    else if (h === 'ㅜ' && R.uEnds && !T) ends = 'down';
    const raise = ends === 'down' && low;
    const [hl, hh] = split(top - gy, [rowItem(L), { w: hp.w + (raise ? 0.6 : 0), min: hp.min * py + (raise ? py : 0) }], env);
    refConsonant(initial, { x0: 0, y0: 0, x1: wl, y1: hl }, env, out);
    const lowBox = { x0: 0, y0: top - hh, x1: wl, y1: top };
    refVowelH(h, lowBox, env, out, { ends, join });
    const left = v === 'ㅓ' || v === 'ㅔ';
    const ty = left && hh > 0 ? Math.min(top - py * 0.6, lowBox.y0 + Math.max(hh / 2, py)) : top / 2;
    refVowelV(v, { x0: xs, y0: 0, x1: 1, y1: top }, ty, env, out, { band });
  }
  return refDone(out, env);
}

function refDone(out, env) {
  return { paths: out.paths, shapes: out.shapes, aspect: 1, fit: Math.min(1, 1 / env.crowd) };
}

/**
 * 참고 꼴 세로 모음. hook: 기둥 아래를 이 x 까지 왼쪽으로 꺾는다(초성 받치기), bracket: ㅣ 를 꺾쇠(⊐)로 (ref3 '이'),
 * band: ㅣ 를 두 줄 띠(∩)로 (섞인 모음). ㅣ·ㅏ(갓 + 아래로 꺾인 곁획) 말고는 기본 세로 모음
 */
function refVowelV(name, { x0, y0, x1, y1 }, ty, env, out, { hook = null, bracket = false, band = false }) {
  const R = env.ref;
  const P = out.paths;
  const { px, py } = env;
  const h = y1 - y0;
  if (name === 'ㅣ') {
    if (bracket && x1 - x0 > px * 0.5) {
      const s = clamp(h * 0.2, Math.min(py, h / 4), h / 3);
      P.push([[x0, y0 + s], [x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y1 - s]]);
    } else if (band && x1 - x0 > px * 0.5) {
      P.push([[x0, y1], [x0, y0], [x1, y0], [x1, y1]]);
    } else {
      P.push(hook != null ? [[x1, y0], [x1, y1], [hook, y1]] : [[x1, y0], [x1, y1]]);
    }
    return;
  }
  if (name === 'ㅏ' && x1 - x0 > px * 0.5) {
    // 칸이 낮아 갓과 곁획 사이를 획 간격만큼 띄울 수 없으면 갓 없이 (기둥 + 아래로 꺾인 곁획)
    const cap = h >= py * 1.9;
    const lo = cap ? Math.min(py, h / 2) : Math.min(py, h / 3);
    const t = clamp(y0 + h * R.tickY, y0 + lo, y1 - Math.min(py, h / 3));
    const stem = cap ? [[x1, y0], [x0, y0], [x0, y1]] : [[x0, y0], [x0, y1]];
    if (hook != null) stem.push([hook, y1]);
    P.push(stem, [[x0, t], [x1, t], [x1, y1]]);
    return;
  }
  vowelV(name, { x0, y0, x1, y1 }, ty, env, out);
}

/**
 * 참고 꼴 가로 모음.
 * wrap: ㅡ·ㅗ·ㅛ 가로획 양끝을 이 y 까지 내려 받침을 감싼다(冂).
 * ends: 'down' 가로획을 올리고 끝을 내린다(ㅗ) · ㅜ 는 양끝을 내린다, 'up' ㅗ 양끝을 세운다(ш), 'left' 왼끝만 세운다.
 * join: 아래 가로획 오른끝을 이 x(세로 부분 기둥)까지 잇는다
 */
function refVowelH(name, { x0, y0, x1, y1 }, env, out, { wrap = null, ends = null, join = null }) {
  const P = out.paths;
  const { px, py } = env;
  const w = x1 - x0;
  const xm = x0 + w / 2;
  const two = [x0 + w * 0.3, x1 - w * 0.3];
  if (two[1] - two[0] < px) {
    two[0] = xm - px / 2;
    two[1] = xm + px / 2;
  }
  const right = join ?? x1;
  if (name === 'ㅜ' || name === 'ㅠ') {
    const legs = ends === 'down' && name === 'ㅜ' && w / 2 > px * 0.9;
    P.push(legs ? [[x0, y1], [x0, y0], [right, y0], [right, y1]] : [[x0, y0], [right, y0]]);
    for (const x of name === 'ㅜ' ? [xm] : two) P.push([[x, y0], [x, y1]]);
    return;
  }
  const stems = name === 'ㅗ' ? [xm] : name === 'ㅛ' ? two : [];
  let yb = y1;
  if (wrap != null) {
    P.push([[x0, wrap], [x0, yb], [x1, yb], [x1, wrap]]);
  } else if (ends === 'down') {
    const stub = clamp((y1 - y0) * 0.35, Math.min(py * 0.8, (y1 - y0) / 2), Math.max(py * 0.8, (y1 - y0) / 2));
    yb = y1 - Math.min(stub, (y1 - y0) / 2);
    P.push(join != null ? [[x0, y1], [x0, yb], [right, yb]] : [[x0, y1], [x0, yb], [x1, yb], [x1, y1]]);
  } else if ((ends === 'up' || ends === 'left') && name === 'ㅗ' && w / 2 > px * 0.9 && y1 - y0 > py * 0.5) {
    P.push(ends === 'left' ? [[x0, y0], [x0, yb], [right, yb]] : [[x0, y0], [x0, yb], [right, yb], [right, y0]]);
  } else {
    P.push([[x0, yb], [right, yb]]);
  }
  for (const x of stems) if (yb - y0 > 1e-9) P.push([[x, y0], [x, yb]]);
}

function refConsonant(name, box, env, out) {
  const pair = PAIRS[name];
  if (!pair) return refSingle(name, box, env, out);
  const [a, b] = pair.map((p) => REF_CONS[p] ?? CONS[p]);
  const g = env.gx * 0.9;
  const [wa, wb] = split(box.x1 - box.x0 - g, [
    { w: a.cols - 1 + BIAS, min: (a.cols - 1) * env.px },
    { w: b.cols - 1 + BIAS, min: (b.cols - 1) * env.px },
  ], env);
  refSingle(pair[0], { ...box, x1: box.x0 + wa }, env, out);
  refSingle(pair[1], { ...box, x0: box.x1 - wb }, env, out);
}

/** 참고 꼴 자음: ㅅ·ㅈ·ㅊ·ㅎ 만 따로 긋고 나머지는 기본 자음(single) */
function refSingle(name, box, env, out) {
  const { x0, y0, x1, y1 } = box;
  const P = out.paths;
  const R = env.ref;
  const { px, py } = env;
  const w = x1 - x0;
  const h = y1 - y0;
  switch (name) {
    case 'ㅅ':
      refS(box, env, out, true);
      return;
    // 층 사이는 split 으로 나눠 획 간격(py)을 지키고, 모자라면 fit 에 남긴다
    case 'ㅈ': {
      // 윗가로획 아래에 ㅅ 몸 (갓머리 없이 기둥 꼭대기에서 다리가 나간다)
      const [a] = split(h, [{ w: 1, min: py }, { w: 2.4, min: py }], env);
      P.push([[x0, y0], [x1, y0]]);
      refS({ x0, y0: y0 + a, x1, y1 }, env, out, false);
      return;
    }
    case 'ㅊ': {
      const [a, b] = split(h, [{ w: 0.8, min: py }, { w: 1, min: py }, { w: 2.2, min: py }], env);
      P.push(flatTick(x0, x1, y0, h, env), [[x0, y0 + a], [x1, y0 + a]]);
      refS({ x0, y0: y0 + a + b, x1, y1 }, env, out, false);
      return;
    }
    case 'ㅎ': {
      const [a, b] = split(h, [{ w: 1, min: py }, { w: 1.2, min: py }, { w: 2.6, min: py }], env);
      const yb = y0 + a;
      const yo = yb + b;
      if (R.hTop === 'cup' && w > px * 2.4) {
        // 꼭지는 ⊔ 안에: 양끝을 올린 가로획 사이에 짧은 가로 꼭지
        const t = flatTick(x0, x1, y0, h, env);
        const half = Math.min((t[1][0] - t[0][0]) / 2, w / 2 - px);
        const xm = (x0 + x1) / 2;
        P.push([[xm - half, y0], [xm + half, y0]], [[x0, y0], [x0, yb], [x1, yb], [x1, y0]]);
      } else if (R.hTop === 'stack' && w > px * 2) {
        // 가로획 둘: 아래 가로획은 오른끝을 위로 올려 윗가로획 끝을 막는다 (⅃)
        P.push([[x0, y0], [x1 - Math.max(px, w * 0.22), y0]], [[x0, yb], [x1, yb], [x1, y0]]);
      } else {
        P.push(flatTick(x0, x1, y0, h, env), [[x0, yb], [x1, yb]]);
      }
      rings(x0, yo, x1, y1, env, out);
      return;
    }
    default:
      single(name, box, env, out);
  }
}

/**
 * 참고 꼴 ㅅ (cap: 갓머리 Г 를 긋는다. 아니면 ㅈ·ㅊ 의 몸: 기둥 꼭대기에서 바로 다리가 나간다).
 * 오른 다리: 'bowl' 기둥에서 오른쪽으로 나가 고리를 돌고 오른 아래로 뻗는다 (curve 면 둥근 고리와 휜 다리),
 * 'step' 오른쪽으로 나가 아래로 꺾인다 (Г+ㄱ). 칸이 좁거나 낮으면 'step' 으로
 */
function refS({ x0, y0, x1, y1 }, env, out, cap) {
  const P = out.paths;
  const R = env.ref;
  const { px, py, sx, sy } = env;
  const w = x1 - x0;
  const h = y1 - y0;
  let leg = R.sLeg;
  if (leg === 'bowl' && (h < py * (cap ? 3 : 2) * 1.05 || w < px * 2.2)) leg = 'step';
  const ya = cap ? y0 + clamp(h * (leg === 'step' ? 0.45 : 0.32), Math.min(py, h / 2), h - Math.min(py, h / 2)) : y0;
  const foot = [];
  if (leg === 'step') {
    foot.push([x1, ya], [x1, y1]);
  } else {
    const d = y1 - ya;
    const yb = ya + clamp(d * 0.42, Math.min(py, d / 2), d - Math.min(py, d / 2));
    const xr = x1 - Math.min(w * 0.1, px * 0.6);
    const xc = x0 + clamp(w * 0.42, Math.min(px * 0.9, w / 3), w / 2);
    if (R.curve) {
      // 둥근 고리: 반지름은 고리 높이의 절반 (가로·세로 단위가 달라도 둥글게 보이도록 획 굵기 비로 맞춘다)
      const ry = (yb - ya) / 2;
      const rx = Math.min(ry * (sx / sy), (xr - xc) * 0.9);
      const cx = xr - rx;
      foot.push([cx, ya]);
      for (let i = 1; i < 8; i++) {
        const a = -Math.PI / 2 + (Math.PI * i) / 8;
        foot.push([cx + Math.cos(a) * rx, ya + ry + Math.sin(a) * ry]);
      }
      foot.push([cx, yb], [xc, yb]);
      // 휜 다리: 아래로 내려가다 오른쪽으로 쓸어 나간다 (2차 베지어)
      const c = [Math.max(x0 + px * 0.5, xc - w * 0.04), y1];
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const u = 1 - t;
        foot.push([u * u * xc + 2 * u * t * c[0] + t * t * x1, u * u * yb + 2 * u * t * c[1] + t * t * y1]);
      }
    } else {
      foot.push([xr, ya], [xr, yb], [xc, yb], [x1, y1]);
    }
  }
  if (cap) P.push([[x1, y0], [x0, y0], [x0, y1]], [[x0, ya], ...foot]);
  else P.push([[x0, y1], [x0, ya], ...foot]);
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
