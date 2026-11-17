// 글꼴 목록과 로더. 글꼴 파일은 index.html 의 Google Fonts 링크로 선언한다.

export const SIGNATURE_FONTS = {
  ko: [
    { family: 'Nanum Pen Script', weight: 400, label: '나눔손글씨 펜', sizeFactor: 1.1 },
    { family: 'Nanum Brush Script', weight: 400, label: '나눔손글씨 붓', sizeFactor: 1.1 },
    { family: 'East Sea Dokdo', weight: 400, label: '동해 독도', sizeFactor: 1.1 },
    { family: 'Dokdo', weight: 400, label: '독도', sizeFactor: 1 },
    { family: 'Gaegu', weight: 700, label: '개구', sizeFactor: 1 },
    { family: 'Hi Melody', weight: 400, label: '하이멜로디', sizeFactor: 1 },
    { family: 'Gamja Flower', weight: 400, label: '감자꽃', sizeFactor: 1 },
    { family: 'Yeon Sung', weight: 400, label: '연성', sizeFactor: 1 },
  ],
  en: [
    { family: 'Great Vibes', weight: 400, label: 'Great Vibes', sizeFactor: 1 },
    { family: 'Dancing Script', weight: 600, label: 'Dancing Script', sizeFactor: 1 },
    { family: 'Allura', weight: 400, label: 'Allura', sizeFactor: 1 },
    { family: 'Sacramento', weight: 400, label: 'Sacramento', sizeFactor: 1 },
    { family: 'Alex Brush', weight: 400, label: 'Alex Brush', sizeFactor: 1 },
    { family: 'Mr Dafoe', weight: 400, label: 'Mr Dafoe', sizeFactor: 1 },
    { family: 'Homemade Apple', weight: 400, label: 'Homemade Apple', sizeFactor: 1 },
    { family: 'Caveat', weight: 600, label: 'Caveat', sizeFactor: 1 },
  ],
};

export const STAMP_FONTS = {
  ko: [
    { family: 'Nanum Myeongjo', weight: 800, label: '나눔명조' },
    { family: 'Song Myung', weight: 400, label: '송명' },
    { family: 'Black Han Sans', weight: 400, label: '검은고딕' },
    { family: 'Gowun Batang', weight: 700, label: '고운바탕' },
    { family: 'Do Hyeon', weight: 400, label: '도현' },
    { family: 'Hahmlet', weight: 700, label: '함렛' },
    { family: 'Nanum Brush Script', weight: 400, label: '나눔손글씨 붓' },
  ],
  en: [
    { family: 'Cinzel', weight: 700, label: 'Cinzel' },
    { family: 'Playfair Display', weight: 700, label: 'Playfair' },
    { family: 'Libre Baskerville', weight: 700, label: 'Baskerville' },
    { family: 'Oswald', weight: 600, label: 'Oswald' },
  ],
};

export function fontString(font, px) {
  return `${font.weight} ${px}px "${font.family}", sans-serif`;
}

const loaded = new Map();

/**
 * 글꼴과 글자를 미리 불러온다. 한글 글꼴은 글자 범위별로 나뉘어 있어 text 를 함께 넘겨야
 * 필요한 조각을 받는다. 시간 안에 못 받으면 false (대체 글꼴로 그려진다).
 */
export async function loadFont(font, text, timeoutMs = 4000) {
  const key = `${font.family}|${font.weight}|${text}`;
  if (loaded.has(key)) return loaded.get(key);
  if (!document.fonts?.load) return true;

  const spec = `${font.weight} 48px "${font.family}"`;
  const task = document.fonts
    .load(spec, text)
    .then((faces) => faces.length > 0)
    .catch(() => false);
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));
  const ok = await Promise.race([task, timeout]);
  if (ok) loaded.set(key, ok); // 실패는 저장하지 않아 다음에 다시 시도한다
  return ok;
}

export function loadFonts(fonts, text) {
  return Promise.all(fonts.map((f) => loadFont(f, text)));
}
