// 글꼴 목록과 로더. 글꼴 파일은 index.html 의 Google Fonts 링크로 선언한다.
// 목록을 바꾼 뒤에는 node scripts/fonts-link.mjs 로 index.html 링크를 다시 만든다.

/**
 * 서명 글꼴. sizeFactor 는 글꼴마다 다른 기본 크기를 비슷하게 맞추는 값,
 * weightScale 은 '굵기' 조절을 줄이는 값 (원래 획이 굵은 글꼴은 글자 속이 메워지지 않게)
 */
export const SIGNATURE_FONTS = {
  'Nanum Pen Script': { weight: 400, label: '나눔손글씨 펜', sizeFactor: 1.15 },
  'Nanum Brush Script': { weight: 400, label: '나눔손글씨 붓', sizeFactor: 1.15 },
  'East Sea Dokdo': { weight: 400, label: '동해 독도', sizeFactor: 1.15 },
  Dokdo: { weight: 400, label: '독도', sizeFactor: 1 },
  Gaegu: { weight: 700, label: '개구', sizeFactor: 1, weightScale: 0.7 },
  'Hi Melody': { weight: 400, label: '하이멜로디', sizeFactor: 1 },
  'Gamja Flower': { weight: 400, label: '감자꽃', sizeFactor: 1 },
  'Yeon Sung': { weight: 400, label: '연성', sizeFactor: 1 },
  'Poor Story': { weight: 400, label: '푸어스토리', sizeFactor: 1 },
  'Single Day': { weight: 400, label: '싱글데이', sizeFactor: 1 },
  'Cute Font': { weight: 400, label: '귀여운체', sizeFactor: 1.15 },
  'Kirang Haerang': { weight: 400, label: '기랑해랑', sizeFactor: 1, weightScale: 0.35 },
  Stylish: { weight: 400, label: '스타일리시', sizeFactor: 1 },
  'Black And White Picture': { weight: 400, label: '흑백사진', sizeFactor: 1.05, weightScale: 0.45 },
  'Great Vibes': { weight: 400, label: 'Great Vibes', sizeFactor: 1 },
  'Dancing Script': { weight: 600, label: 'Dancing Script', sizeFactor: 1 },
  Allura: { weight: 400, label: 'Allura', sizeFactor: 1 },
  Sacramento: { weight: 400, label: 'Sacramento', sizeFactor: 1.1 },
  'Alex Brush': { weight: 400, label: 'Alex Brush', sizeFactor: 1 },
  'Mr Dafoe': { weight: 400, label: 'Mr Dafoe', sizeFactor: 1, weightScale: 0.6 },
  'Homemade Apple': { weight: 400, label: 'Homemade Apple', sizeFactor: 0.8 },
  Caveat: { weight: 600, label: 'Caveat', sizeFactor: 1 },
  'Pinyon Script': { weight: 400, label: 'Pinyon Script', sizeFactor: 0.95 },
  'Herr Von Muellerhoff': { weight: 400, label: 'Herr Von Muellerhoff', sizeFactor: 1.15 },
  'Monsieur La Doulaise': { weight: 400, label: 'Monsieur La Doulaise', sizeFactor: 1.1 },
  'La Belle Aurore': { weight: 400, label: 'La Belle Aurore', sizeFactor: 0.9 },
  Kristi: { weight: 400, label: 'Kristi', sizeFactor: 1.1 },
  Satisfy: { weight: 400, label: 'Satisfy', sizeFactor: 1 },
  Parisienne: { weight: 400, label: 'Parisienne', sizeFactor: 1 },
  Yellowtail: { weight: 400, label: 'Yellowtail', sizeFactor: 1, weightScale: 0.7 },
  'Rouge Script': { weight: 400, label: 'Rouge Script', sizeFactor: 1.05 },
  'Mrs Saint Delafield': { weight: 400, label: 'Mrs Saint Delafield', sizeFactor: 1.1 },
  'Cedarville Cursive': { weight: 400, label: 'Cedarville Cursive', sizeFactor: 0.9 },
  'Reenie Beanie': { weight: 400, label: 'Reenie Beanie', sizeFactor: 1.1 },
  'Marck Script': { weight: 400, label: 'Marck Script', sizeFactor: 1 },
};

export const STAMP_FONTS = {
  ko: [
    { family: 'Nanum Myeongjo', weight: 800, label: '나눔명조' },
    { family: 'Noto Serif KR', weight: 900, label: '본명조' },
    { family: 'Song Myung', weight: 400, label: '송명' },
    { family: 'Black Han Sans', weight: 400, label: '검은고딕' },
    { family: 'Gowun Batang', weight: 700, label: '고운바탕' },
    { family: 'Do Hyeon', weight: 400, label: '도현' },
    { family: 'Hahmlet', weight: 700, label: '함렛' },
    { family: 'Jua', weight: 400, label: '주아' },
    { family: 'Gugi', weight: 400, label: '구기' },
    { family: 'Nanum Brush Script', weight: 400, label: '나눔손글씨 붓' },
  ],
  en: [
    { family: 'Cinzel', weight: 700, label: 'Cinzel' },
    { family: 'Playfair Display', weight: 700, label: 'Playfair' },
    { family: 'Libre Baskerville', weight: 700, label: 'Baskerville' },
    { family: 'Oswald', weight: 600, label: 'Oswald' },
    { family: 'Special Elite', weight: 400, label: 'Typewriter' },
    { family: 'Black Ops One', weight: 400, label: 'Stencil' },
    { family: 'Bebas Neue', weight: 400, label: 'Bebas' },
  ],
};

export function signatureFont(family) {
  const f = SIGNATURE_FONTS[family];
  if (!f) throw new Error(`알 수 없는 서명 글꼴: ${family}`);
  return { family, ...f };
}

export function fontString(font, px) {
  return `${font.weight} ${px}px "${font.family}", sans-serif`;
}

let cssReady = null;

/**
 * 글꼴 CSS(@font-face 선언 약 2,000개, 1.3MB)는 첫 화면 표시를 늦추지 않도록 media="print" 로 받아 둔다.
 * 처음 글꼴이 필요할 때 켜고, 다 읽힐 때까지 기다린다.
 */
export function ensureFontCss() {
  if (cssReady) return cssReady;
  const link = document.getElementById('font-css');
  if (!link) return (cssReady = Promise.resolve());
  cssReady = new Promise((resolve) => {
    const done = () => resolve();
    if (link.sheet && link.media === 'all') return done();
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true }); // 실패해도 대체 글꼴로 계속한다
    link.media = 'all';
    // 이미 받아 둔 경우에는 load 가 다시 오지 않을 수 있다
    if (link.sheet) requestAnimationFrame(() => (link.sheet ? done() : null));
    setTimeout(done, 8000); // 네트워크가 멈춰도 대체 글꼴로라도 진행한다
  });
  return cssReady;
}

const loaded = new Map();
const pending = new Map();

/**
 * 글꼴과 글자를 미리 불러온다. 한글 글꼴은 글자 범위별로 나뉘어 있어 text 를 함께 넘겨야
 * 필요한 조각을 받는다. 시간 안에 못 받으면 false (대체 글꼴로 그려진다).
 */
export async function loadFont(font, text, timeoutMs = 5000) {
  const key = `${font.family}|${font.weight}|${text}`;
  if (loaded.has(key)) return loaded.get(key);
  if (!document.fonts?.load) return true;
  await ensureFontCss();

  const task = fontTask(font, text, key);
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));
  return Promise.race([task, timeout]);
}

/**
 * 시간 안에 못 받은 글꼴이 나중에 도착하면 알려 준다. 카드를 대체 글꼴로 그린 뒤 다시 그릴 때 쓴다.
 * @returns {Promise<boolean>}
 */
export function whenFontLoaded(font, text) {
  const key = `${font.family}|${font.weight}|${text}`;
  if (loaded.has(key)) return Promise.resolve(loaded.get(key));
  return fontTask(font, text, key);
}

function fontTask(font, text, key) {
  if (!pending.has(key)) {
    const spec = `${font.weight} 48px "${font.family}"`;
    const task = document.fonts
      .load(spec, text)
      .then((faces) => faces.length > 0)
      .catch(() => false)
      .then((ok) => {
        pending.delete(key);
        if (ok) loaded.set(key, ok); // 실패는 저장하지 않아 다음에 다시 시도한다
        return ok;
      });
    pending.set(key, task);
  }
  return pending.get(key);
}

export function loadFonts(fonts, text) {
  return Promise.all(fonts.map((f) => loadFont(f, text)));
}
