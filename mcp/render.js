// MCP 서버가 헤드리스 Chrome 안에서 부르는 렌더 함수들.
// 웹사이트와 같은 모듈(서명·도장·사진·문서 합성)을 그대로 써서 결과가 사이트와 똑같다.
// 입출력은 모두 직렬화할 수 있는 값(문자열·숫자·base64)이다.
import { SIGNATURE_STYLES } from '../js/signature-styles.js';
import { renderSignature, transformText } from '../js/signature-gen.js';
import { renderStamp, STAMP_SHAPES, STAMP_CATEGORIES, SEAL_CENTERS, SEAL_CENTER_TEXT, stampFont, sealCenterFonts } from '../js/stamp-gen.js';
import { STAMP_FONTS, signatureFont, loadFont } from '../js/fonts.js';
import { finalize } from '../js/exporter.js';
import { loadImageFile, PhotoSignature } from '../js/photo-import.js';
import { SignaturePad } from '../js/signature-pad.js';
import { resolveLang, validateName, stampChars } from '../js/core/text.js';

const FONT_TIMEOUT_MS = 15_000;
const PREVIEW_MULT = { signature: 0.36, stamp: 0.42 }; // 사이트 카드와 같은 배율
const DOC_MAX_SIDE = 4000; // 사이트 '문서에 넣기'와 같다
const PHOTO_MAX_SIDE = 1600;
const DRAW_BASE_WIDTH = 1000; // 사이트 직접 서명 내보내기 기준 폭
const PREVIEW_MAX_SIDE = 1600;
const PAD_BOX = 600; // 획 좌표를 이 크기 상자에 맞춘 뒤 펜 굵기를 적용한다 (사이트 패드와 비슷한 크기)

class UserError extends Error {}
const fail = (message) => { throw new UserError(message); };

// ───────────── 목록 ─────────────

function catalog() {
  return {
    signatureStyles: Object.fromEntries(
      Object.entries(SIGNATURE_STYLES).map(([lang, list]) => [
        lang,
        list.map((s) => ({ id: s.id, label: s.label, font: s.font })),
      ]),
    ),
    stampShapes: STAMP_SHAPES.map((s) => ({ id: s.id, label: s.label, category: s.cat })),
    stampCategories: STAMP_CATEGORIES.filter((c) => c.id !== 'all').map((c) => ({ id: c.id, label: c.label })),
    sealCenters: SEAL_CENTERS.map((c) => ({ id: c.id, label: c.label })),
    stampFonts: Object.fromEntries(
      Object.entries(STAMP_FONTS).map(([lang, list]) => [lang, list.map((f) => ({ family: f.family, label: f.label }))]),
    ),
  };
}

// ───────────── 공통 ─────────────

function nameAndLang(rawName, langChoice = 'auto') {
  const lang = resolveLang(langChoice, rawName ?? '');
  const v = validateName(rawName, lang);
  if (!v.ok) fail(v.message);
  return { name: v.value, lang };
}

async function ensureFonts(fonts, text) {
  const seen = new Map();
  for (const f of fonts) seen.set(`${f.family}|${f.weight}`, f);
  const list = [...seen.values()];
  const ok = await Promise.all(list.map((f) => loadFont(f, text, FONT_TIMEOUT_MS)));
  return list.filter((_, i) => !ok[i]).map((f) => f.family); // 받지 못해 대체 글꼴로 그린 글꼴
}

function toBase64(canvas, type = 'image/png', quality) {
  return canvas.toDataURL(type, quality).split(',')[1];
}

function output(canvas, extra = {}) {
  const out = { png: toBase64(canvas), width: canvas.width, height: canvas.height, ...extra };
  canvas.width = canvas.height = 0;
  return out;
}

function base64ToFile(data, mime, name = 'input') {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

async function base64ToImage(data, mime) {
  const url = URL.createObjectURL(base64ToFile(data, mime));
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => fail('이미지를 열 수 없어요.'));
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dotDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

// ───────────── 서명 ─────────────

function signatureSpecs(o) {
  const { name, lang } = nameAndLang(o.name, o.lang);
  let styles = SIGNATURE_STYLES[lang];
  if (o.styles?.length) {
    const byId = new Map(SIGNATURE_STYLES[lang].map((s) => [s.id, s]));
    styles = o.styles.map((id) => byId.get(id) ?? fail(`'${lang === 'ko' ? '한글' : '영문'}' 서명 형태에 '${id}'가 없어요. list_styles 로 목록을 확인하세요.`));
  }
  const specs = styles.map((style) => ({
    id: style.id,
    label: style.label,
    font: signatureFont(style.font),
    render: (mult) => renderSignature({ text: name, style, ink: o.ink, slantAdjust: o.slant ?? 0, weight: o.weight ?? 0, mult }),
  }));
  const text = name + transformText(name, 'monogram') + transformText(name, 'first-initial');
  return { name, lang, specs, text };
}

// ───────────── 도장 ─────────────

function stampSpecs(o) {
  const { name, lang } = nameAndLang(o.name, o.lang);
  const fonts = STAMP_FONTS[lang];
  let chosen = null;
  if (o.font) {
    chosen = fonts.find((f) => f.family === o.font || f.label === o.font)
      ?? fail(`${lang === 'ko' ? '한글' : '영문'} 도장 글꼴에 '${o.font}'가 없어요. list_styles 로 목록을 확인하세요.`);
  }
  let shapes = STAMP_SHAPES;
  if (o.shapes?.length) {
    const byId = new Map(STAMP_SHAPES.map((s) => [s.id, s]));
    shapes = o.shapes.map((id) => byId.get(id) ?? fail(`도장 모양 '${id}'가 없어요. list_styles 로 목록을 확인하세요.`));
  } else if (o.category && o.category !== 'all') {
    shapes = STAMP_SHAPES.filter((s) => s.cat === o.category);
    if (!shapes.length) fail(`도장 분류 '${o.category}'가 없어요.`);
  }
  const list = stampChars(name, { addIn: Boolean(o.addIn), lang });
  const baseChars = stampChars(name, { addIn: false, lang });
  const dateLabel = o.dateLabel ?? '';
  const date = dotDate(o.date);
  const specs = shapes.map((shape) => {
    // 사이트와 같다: 모양이 정한 글꼴(인감체)은 글꼴 선택과 상관없이 쓰고, 그 밖은 고른 글꼴 또는 '추천 조합'
    const font = stampFont(shape, fonts, chosen);
    return {
      id: shape.id,
      label: shape.label,
      font,
      fontLabel: shape.fontLabel, // 인장체·인감체처럼 글꼴 선택을 따르지 않는 모양은 글꼴 이름 대신 이 이름을 보여 준다
      render: (mult) => renderStamp({
        lang, chars: list, baseChars, text: name, shape, font, dateLabel, mult,
        ink: o.ink, order: o.order ?? 'horizontal', texture: Boolean(o.texture), bleed: Boolean(o.bleed),
        rotation: o.rotation ?? 0, date, sealCenter: o.sealCenter,
      }),
    };
  });
  // 사이트(app.js stampSpecs)와 같은 글자를 미리 받는다: 둘레글자 '인', 가운뎃점, 업무용 도장 기본 문구, 직인 가운데 한자
  const text = `${list.join('')}${name}${name.toUpperCase()}인★·0123456789.${dateLabel || '확인결재접수APPROVEDRECEIVEDCHECKED'}${SEAL_CENTER_TEXT}`;
  // 가운데 한자는 모양마다 정한 본명조(기본 900, 인감체 직인 500)로 그린다
  const extraFonts = lang === 'ko' ? sealCenterFonts(shapes) : [];
  return { name, lang, specs, text, extraFonts };
}

// ───────────── 후보 만들기 (한 장, 여러 장, 미리보기 시트) ─────────────

async function build(kind, o) {
  const s = kind === 'signature' ? signatureSpecs(o) : stampSpecs(o);
  const fallbackFonts = await ensureFonts([...s.specs.map((x) => x.font), ...(s.extraFonts ?? [])], s.text);
  return { ...s, fallbackFonts };
}

/** 고른 후보들을 최종 PNG로 */
async function render(kind, o) {
  const s = await build(kind, o);
  const items = [];
  for (const spec of s.specs) {
    const canvas = finalize(spec.render(o.res ?? 1), o.bg ?? null);
    if (!canvas) continue;
    items.push(output(canvas, { id: spec.id, label: spec.label, font: spec.fontLabel ?? spec.font.label ?? spec.font.family }));
  }
  if (!items.length) fail('그릴 수 있는 후보가 없어요.');
  return { name: s.name, lang: s.lang, fallbackFonts: s.fallbackFonts, items };
}

/** 후보 전체를 번호 붙은 한 장짜리 미리보기로 */
async function sheet(kind, o) {
  const s = await build(kind, o);
  const cells = s.specs.map((spec) => ({ spec, canvas: finalize(spec.render(PREVIEW_MULT[kind]), null) }));
  const cols = Math.min(4, cells.length);
  const rows = Math.ceil(cells.length / cols);
  const cw = 300;
  const ch = kind === 'stamp' ? 250 : 190;
  const labelH = 34;
  const pad = 14;
  const out = document.createElement('canvas');
  out.width = cols * cw;
  out.height = rows * ch;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  cells.forEach(({ spec, canvas }, i) => {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    ctx.strokeStyle = '#e6dfd5';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
    if (canvas) {
      const bw = cw - pad * 2;
      const bh = ch - labelH - pad * 2;
      const k = Math.min(bw / canvas.width, bh / canvas.height, 1.6);
      const w = canvas.width * k;
      const h = canvas.height * k;
      ctx.drawImage(canvas, x + (cw - w) / 2, y + pad + (bh - h) / 2, w, h);
      canvas.width = canvas.height = 0;
    }
    ctx.fillStyle = '#3d2f22';
    ctx.font = '600 17px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(`${i + 1}. ${spec.label}`, x + cw / 2, y + ch - labelH / 2 - 4, cw - 16);
  });
  return {
    name: s.name,
    lang: s.lang,
    fallbackFonts: s.fallbackFonts,
    items: s.specs.map((spec, i) => ({ no: i + 1, id: spec.id, label: spec.label, font: spec.fontLabel ?? spec.font.label ?? spec.font.family })),
    ...output(out),
  };
}

// ───────────── 사진에서 서명 ─────────────

async function photo(o) {
  const canvas = await loadImageFile(base64ToFile(o.data, o.mime), PHOTO_MAX_SIDE).catch((err) => fail(err.userMessage ?? '사진을 열지 못했어요. JPG·PNG·WebP 파일인지 확인해 주세요.'));
  const p = new PhotoSignature();
  p.setImage(canvas);
  // 사이트 슬라이더와 같다: 강하게(+)일수록 경계값을 낮춰 배경을 더 지운다
  p.setOffset(-(o.strength ?? 0));
  if (p.isEmpty) fail('사진에서 서명을 찾지 못했어요. strength 를 낮추거나(배경 제거 약하게) 더 밝은 곳에서 찍은 사진을 써 주세요.');
  // 사진은 원본보다 크게 만들어도 선명해지지 않아 사이트처럼 최대 2배까지만 키운다
  const out = finalize(p.render((o.res ?? 1) > 1 ? 2 : 1, o.keepColor ? null : o.ink), o.bg ?? null);
  if (!out) fail('사진에서 서명을 찾지 못했어요.');
  return output(out);
}

// ───────────── 획 좌표로 직접 서명 ─────────────

function drawn(o) {
  const pts = o.strokes.flat();
  if (!pts.length) fail('획이 비어 있어요.');
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0, 1e-6);
  const k = PAD_BOX / span;
  const base = o.penWidth ?? 3.5;
  const margin = base * 2;
  const holder = document.createElement('canvas');
  const pad = new SignaturePad(holder, { getInk: () => o.ink, getWidth: () => base });
  pad.strokes = o.strokes.map((stroke) => stroke.map((p) => ({
    x: (p[0] - x0) * k + margin,
    y: (p[1] - y0) * k + margin,
    w: base * (p[2] ?? 1), // 세 번째 값은 그 점의 굵기 배율(필압)
  })));
  pad.size = {
    w: (Math.max(...xs) - x0) * k + margin * 2,
    h: (Math.max(...ys) - y0) * k + margin * 2,
  };
  const out = finalize(pad.render(DRAW_BASE_WIDTH * (o.res ?? 1), o.ink), o.bg ?? null);
  if (!out) fail('그려진 획이 없어요.');
  return output(out);
}

// ───────────── 문서에 넣기 ─────────────

async function overlayCanvas(item) {
  if (item.kind === 'image') {
    const img = await base64ToImage(item.data, item.mime);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return { canvas: c, fallbackFonts: [] };
  }
  // 사이트처럼 문서에는 고해상도(2배) 투명 이미지를 올린다
  const s = await build(item.kind, { ...item, styles: [item.style].filter(Boolean), shapes: [item.shape].filter(Boolean) });
  const canvas = finalize(s.specs[0].render(2), null);
  if (!canvas) fail(`${item.kind === 'stamp' ? '도장' : '서명'}을 그리지 못했어요.`);
  return { canvas, fallbackFonts: s.fallbackFonts };
}

async function compose(o) {
  const doc = await loadImageFile(base64ToFile(o.data, o.mime), DOC_MAX_SIDE).catch((err) => fail(err.userMessage ?? '문서 이미지를 열지 못했어요. JPG·PNG·WebP 파일인지 확인해 주세요.'));
  const out = document.createElement('canvas');
  out.width = doc.width;
  out.height = doc.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(doc, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.globalCompositeOperation = o.multiply === false ? 'source-over' : 'multiply';
  const fallbackFonts = new Set();
  const placed = [];
  for (const item of o.items) {
    const { canvas, fallbackFonts: missing } = await overlayCanvas(item);
    missing.forEach((f) => fallbackFonts.add(f));
    const ratio = canvas.height / canvas.width;
    const defWidth = item.kind === 'stamp' ? 0.16 : 0.3; // 사이트에서 처음 넣을 때 크기
    // 사이트 문서 편집기와 같은 범위로 크기·위치를 맞춘다 (문서 밖으로 나가지 않게)
    let w = Math.min(Math.max((item.width ?? defWidth) * doc.width, doc.width * 0.04), doc.width * 1.2);
    w = Math.min(w, doc.width, doc.height / ratio);
    const h = w * ratio;
    const x = Math.min(Math.max((item.x ?? 0.5) * doc.width - w / 2, 0), doc.width - w);
    const y = Math.min(Math.max((item.y ?? 0.5) * doc.height - h / 2, 0), doc.height - h);
    ctx.drawImage(canvas, x, y, w, h);
    placed.push({ kind: item.kind, x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) });
    canvas.width = canvas.height = 0;
  }
  doc.width = doc.height = 0;
  const type = o.mime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const data = toBase64(out, type, 0.92);
  // 대화 화면에 바로 보여 줄 작은 미리보기 (원본 크기 그대로는 수 MB라 클라이언트가 못 받을 수 있다)
  const k = Math.min(1, PREVIEW_MAX_SIDE / Math.max(out.width, out.height));
  const small = document.createElement('canvas');
  small.width = Math.round(out.width * k);
  small.height = Math.round(out.height * k);
  const sctx = small.getContext('2d');
  sctx.imageSmoothingQuality = 'high';
  sctx.fillStyle = '#ffffff';
  sctx.fillRect(0, 0, small.width, small.height);
  sctx.drawImage(out, 0, 0, small.width, small.height);
  const preview = toBase64(small, 'image/jpeg', 0.85);
  const result = { data, mime: type, width: out.width, height: out.height, preview, placed, fallbackFonts: [...fallbackFonts] };
  small.width = small.height = 0;
  out.width = out.height = 0;
  return result;
}

// ───────────── 노출 ─────────────

/** 사용자 입력 문제는 code 'user' 로 구분해 MCP 응답에서 그대로 보여 준다 */
async function call(fn, args) {
  const api = { catalog, render, sheet, photo, drawn, compose };
  try {
    const f = api[fn] ?? fail(`알 수 없는 함수: ${fn}`);
    return { ok: true, value: await f(...args) };
  } catch (err) {
    return { ok: false, user: err instanceof UserError, message: String(err?.message ?? err) };
  }
}

window.dojang = { call };
window.dojangReady = true;
