// js/fonts.js 의 글꼴 목록으로 index.html 의 Google Fonts 링크를 다시 만든다.
// 사용: node scripts/fonts-link.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SIGNATURE_FONTS, STAMP_FONTS, EXTRA_FONTS } from '../js/fonts.js';

/** 모든 글꼴을 한 번씩, 같은 글꼴의 여러 굵기는 한 항목으로 묶은 css2 주소 */
export function fontsCssUrl() {
  const weights = new Map();
  const add = (family, weight) => {
    if (!weights.has(family)) weights.set(family, new Set());
    weights.get(family).add(weight);
  };
  for (const [family, f] of Object.entries(SIGNATURE_FONTS)) add(family, f.weight);
  for (const list of Object.values(STAMP_FONTS)) for (const f of list) add(f.family, f.weight);
  // 특정 모양만 쓰는 글꼴 (인감체 가운데 본명조 500 은 기존 본명조 900 과 한 항목으로 묶인다)
  for (const f of EXTRA_FONTS) add(f.family, f.weight);

  const families = [...weights].map(([family, ws]) => {
    const name = family.replace(/ /g, '+');
    const list = [...ws].sort((a, b) => a - b);
    return list.length === 1 && list[0] === 400 ? `family=${name}` : `family=${name}:wght@${list.join(';')}`;
  });
  return { url: `https://fonts.googleapis.com/css2?${families.join('&')}&display=block`, count: families.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { url, count } = fontsCssUrl();
  const file = new URL('../index.html', import.meta.url);
  const html = readFileSync(file, 'utf8');
  const next = html.replace(/(<link id="font-css" rel="stylesheet" href=")[^"]*(")/, `$1${url}$2`);
  if (next === html && !html.includes(url)) throw new Error('index.html 에서 글꼴 링크를 찾지 못했어요.');
  writeFileSync(file, next);
  console.log(`글꼴 ${count}종 링크를 갱신했어요.`);
}
