// 텍스트 관련 순수 함수 (DOM 없음)

export const MAX_NAME_LENGTH = 14;

const HANGUL_RE = /[ᄀ-ᇿ㄰-㆏가-힣]/;
const HANGUL_SYLLABLE_RE = /^[가-힣]$/;

/** 입력에 한글이 있으면 'ko', 없으면 'en' */
export function detectLang(text) {
  return HANGUL_RE.test(text) ? 'ko' : 'en';
}

export function hasHangul(text) {
  return HANGUL_RE.test(text);
}

/** 사용자 선택('auto' | 'ko' | 'en')과 입력으로 실제 언어를 정한다 */
export function resolveLang(choice, text) {
  return choice === 'auto' ? detectLang(text) : choice;
}

/** 서로게이트 쌍을 고려해 글자 단위로 나눈다 */
export function chars(text) {
  return Array.from(text);
}

export function normalizeName(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 이름 입력 검증
 * @returns {{ok: true, value: string} | {ok: false, message: string}}
 */
export function validateName(raw, lang) {
  const value = normalizeName(raw ?? '');
  if (!value) return { ok: false, message: '이름을 입력해 주세요.' };
  if (chars(value).length > MAX_NAME_LENGTH) {
    return { ok: false, message: `이름은 ${MAX_NAME_LENGTH}자까지 입력할 수 있어요.` };
  }
  if (lang === 'en' && hasHangul(value)) {
    return { ok: false, message: '영문 모드에서는 한글을 쓸 수 없어요. 언어를 한글 또는 자동으로 바꿔 주세요.' };
  }
  return { ok: true, value };
}

/** 도장에 들어갈 글자 목록. 공백은 빼고, 옵션에 따라 '인'을 붙인다 */
export function stampChars(name, { addIn = false, lang = 'ko' } = {}) {
  const list = chars(name.replace(/\s+/g, ''));
  if (addIn && lang === 'ko' && list.length > 0 && list[list.length - 1] !== '인') {
    list.push('인');
  }
  return list;
}

export function isHangulSyllable(ch) {
  return HANGUL_SYLLABLE_RE.test(ch);
}

/** 파일 이름에 쓸 수 없는 문자를 지운다 */
export function sanitizeFilePart(text) {
  return text
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 40);
}

export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

const KIND_LABEL = { drawing: '서명', signature: '서명', stamp: '도장' };

/** 예: 서명_홍길동_20261117.png */
export function buildFileName(kind, name, date = new Date()) {
  const label = KIND_LABEL[kind] ?? '이미지';
  const part = sanitizeFilePart(name ?? '');
  return [label, part, formatDate(date)].filter(Boolean).join('_') + '.png';
}

/** #RGB / #RRGGBB 형식 확인 */
export function isHexColor(value) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}
