// js/fonts.js 의 글꼴 목록으로 index.html 의 Google Fonts 링크를 다시 만든다.
// 사용: node scripts/fonts-link.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { SIGNATURE_FONTS, STAMP_FONTS } from '../js/fonts.js';

const weights = new Map();
const add = (family, weight) => {
  if (!weights.has(family)) weights.set(family, new Set());
  weights.get(family).add(weight);
};
for (const [family, f] of Object.entries(SIGNATURE_FONTS)) add(family, f.weight);
for (const list of Object.values(STAMP_FONTS)) for (const f of list) add(f.family, f.weight);

const families = [...weights].map(([family, ws]) => {
  const name = family.replace(/ /g, '+');
  const list = [...ws].sort((a, b) => a - b);
  return list.length === 1 && list[0] === 400 ? `family=${name}` : `family=${name}:wght@${list.join(';')}`;
});
const url = `https://fonts.googleapis.com/css2?${families.join('&')}&display=block`;

const file = new URL('../index.html', import.meta.url);
const html = readFileSync(file, 'utf8');
const next = html.replace(/(<link id="font-css" rel="stylesheet" href=")[^"]*(")/, `$1${url}$2`);
if (next === html && !html.includes(url)) throw new Error('index.html 에서 글꼴 링크를 찾지 못했어요.');
writeFileSync(file, next);
console.log(`글꼴 ${families.length}종 링크를 갱신했어요.`);
