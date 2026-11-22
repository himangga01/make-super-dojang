import { STAMP_FONTS, loadFonts, whenFontLoaded, signatureFont, ensureFontCss } from './fonts.js';
import { SIGNATURE_STYLES } from './signature-styles.js';
import { SignaturePad } from './signature-pad.js';
import { renderSignature, transformText } from './signature-gen.js';
import { renderStamp, STAMP_SHAPES, STAMP_CATEGORIES, SEAL_CENTERS, SEAL_CENTER_FONT, SEAL_CENTER_TEXT } from './stamp-gen.js';
import { finalize, toPngBlob, downloadBlob, canCopyImage, copyBlob } from './exporter.js';
import { PhotoSignature, loadImageFile } from './photo-import.js';
import { DocComposer } from './doc-composer.js';
import * as library from './library.js';
import { createZipParts, uniqueNames } from './core/zip.js';
import {
  MAX_NAME_LENGTH, resolveLang, validateName, stampChars, buildFileName, chars, isHexColor, sanitizeFilePart, formatDate,
} from './core/text.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const INK_PRESETS = {
  pen: [
    { color: '#111111', label: '검정' },
    { color: '#1d2b64', label: '남색' },
    { color: '#1f5fd1', label: '파랑' },
  ],
  stamp: [
    { color: '#d0201f', label: '빨강' },
    { color: '#e5532d', label: '주홍' },
    { color: '#111111', label: '검정' },
  ],
};

const DRAW_BASE_WIDTH = 1000; // 직접 서명 내보내기 기준 폭(px)
const CARD_MULT = { sign: 0.36, stamp: 0.42 };
const KIND_BY_TARGET = { sign: 'signature', stamp: 'stamp' };
const KIND_LABEL = { drawing: '서명', signature: '서명', stamp: '도장' };

const state = {
  tab: 'draw',
  drawMode: 'pad',
  ink: { draw: '#111111', sign: '#111111', stamp: '#d0201f' },
  bg: null, // null = 투명
  res: 1,
  sign: { items: [], selected: null, token: 0 },
  stamp: { items: [], selected: null, token: 0, cat: 'all' },
  drawItem: null,
  photoItem: null,
  zipBusy: { sign: false, stamp: false },
  frozen: { sign: null, stamp: null }, // ZIP 을 만드는 동안 고정한 설정
  paintToken: { sign: 0, stamp: 0 },
  deleted: [], // 보관함에서 지운 항목 (되돌리기용)
  previewVersion: 0,
  shareCache: null, // { version, item, blob }
  exportVisible: false,
  ready: false,
};

// ───────────── 탭 ─────────────

const tabs = $$('[role="tab"]');

function selectTab(name, focus = false) {
  state.tab = name;
  for (const t of tabs) {
    const on = t.dataset.tab === name;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(`#panel-${t.dataset.tab}`).hidden = !on;
    if (on && focus) t.focus();
  }
  $('#export-panel').hidden = name === 'doc';
  if (name === 'draw' && state.drawMode === 'pad') pad.resize();
  if (name === 'doc') {
    composer.layout();
    updateDocButtons();
  }
  if (name === 'sign' || name === 'stamp') {
    // 한쪽에서 입력한 이름을 다른 쪽에 채워 준다
    const other = name === 'sign' ? 'stamp' : 'sign';
    if (!nameInput(name).value && nameInput(other).value) {
      nameInput(name).value = nameInput(other).value;
      updateCount(name);
    }
    // 이름은 있는데 아직 만들지 않았으면 (이전에 입력한 이름 복원 포함) 이제 만든다
    if (nameInput(name).value.trim() && !state[name].items.length) generate(name);
  }
  if (name !== 'doc') renderInkSwatches();
  updatePreview();
}

tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t.dataset.tab));
  if (t.dataset.tab === 'sign' || t.dataset.tab === 'stamp') t.addEventListener('pointerdown', () => ensureFontCss(), { once: true });
  t.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    selectTab(tabs[(i + step + tabs.length) % tabs.length].dataset.tab, true);
  });
});

// ───────────── 라디오 그룹 키보드 (방향키로 이동, 선택된 것만 Tab 정지) ─────────────

function enhanceRadioGroup(box) {
  box.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    const items = [...box.querySelectorAll('[role="radio"]')];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = items[(i + step + items.length) % items.length];
    next.focus();
    next.click();
  });
}

function syncRadioTabindex(box) {
  const items = [...box.querySelectorAll('[role="radio"]')];
  const checked = items.find((b) => b.getAttribute('aria-checked') === 'true');
  items.forEach((b) => { b.tabIndex = b === checked || (!checked && b === items[0]) ? 0 : -1; });
}

// ───────────── 직접 서명: 그리기 ─────────────

const padCanvas = $('#pad');
const pad = new SignaturePad(padCanvas, {
  getInk: () => state.ink.draw,
  getWidth: () => Number($('#pen-width').value),
  onChange: onPadChange,
});

function onPadChange() {
  $('#pad-hint').hidden = !pad.isEmpty;
  $('#pad-undo').disabled = pad.isEmpty;
  $('#pad-clear').disabled = pad.isEmpty;
  state.drawItem = pad.isEmpty
    ? null
    : { kind: 'drawing', name: '', label: '직접 서명', render: (mult) => pad.render(DRAW_BASE_WIDTH * mult, state.ink.draw) };
  if (state.tab === 'draw') updatePreview();
  else updateDocButtons();
}
padCanvas.addEventListener('pointerdown', () => { $('#pad-hint').hidden = true; });
$('#pad-undo').addEventListener('click', () => pad.undo());
$('#pad-clear').addEventListener('click', () => pad.clear());

$$('input[name="draw-mode"]').forEach((r) =>
  r.addEventListener('change', () => {
    state.drawMode = r.value;
    $('#draw-pad-mode').hidden = r.value !== 'pad';
    $('#draw-photo-mode').hidden = r.value !== 'photo';
    if (r.value === 'pad') pad.resize();
    updatePreview();
  }),
);

// ───────────── 직접 서명: 사진에서 가져오기 ─────────────

const photo = new PhotoSignature();

/** 사진 처리 결과로 저장할 항목을 다시 정한다 (파일을 고를 때와 슬라이더를 움직일 때 모두) */
function refreshPhotoItem() {
  state.photoItem = photo.isEmpty
    ? null
    : {
        kind: 'drawing',
        name: '',
        label: '사진 서명',
        // 사진은 원본 해상도보다 크게 만들어도 선명해지지 않아 최대 2배까지만 키운다
        exportScale: (res) => (res > 1 ? 2 : 1),
        render: (mult) => photo.render(mult, $('#photo-keep-color').checked ? null : state.ink.draw),
      };
  updatePreview();
}

$('#photo-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  setStatus('사진에서 서명을 찾는 중…');
  try {
    photo.setImage(await loadImageFile(file));
    refreshPhotoItem();
    if (photo.isEmpty) setStatus('서명을 찾지 못했어요. 배경 제거를 약하게 하거나 더 밝은 곳에서 찍어 주세요.', { error: true });
    else setStatus('배경을 지웠어요. 미리보기를 확인하세요.');
  } catch (err) {
    console.error(err);
    setStatus(err.userMessage ?? '사진을 열지 못했어요. JPG나 PNG 파일인지 확인해 주세요.', { error: true });
  }
  e.target.value = '';
});

let photoTimer = 0;
$('#photo-offset').addEventListener('change', (e) => {
  clearTimeout(photoTimer);
  photoTimer = setTimeout(() => {
    // 슬라이더 오른쪽(강하게)일수록 배경을 더 지운다 = 경계값을 낮춘다
    photo.setOffset(-Number(e.target.value));
    refreshPhotoItem();
  }, 0);
});
$('#photo-keep-color').addEventListener('change', updatePreview);

// ───────────── 이름 입력 공통 ─────────────

const langChoice = (target) => document.querySelector(`input[name="${target}-lang"]:checked`).value;
const nameInput = (target) => $(`#${target}-name`);
// 한글을 치는 중에 마지막 글자가 자음·모음 하나뿐이면 아직 덜 친 것으로 본다
const looksUnfinished = (text) => /[ㄱ-ㆎ]$/.test(text);

const debounceTimers = {};
function scheduleGenerate(target, delay = 350) {
  clearTimeout(debounceTimers[target]);
  debounceTimers[target] = setTimeout(() => {
    if (!looksUnfinished(nameInput(target).value)) generate(target);
  }, delay);
}

for (const target of ['sign', 'stamp']) {
  const input = nameInput(target);
  input.addEventListener('input', (e) => {
    updateCount(target);
    // 한글은 마지막 글자가 다른 곳을 누를 때까지 '조합 중'으로 남으므로 조합 중이라고 건너뛰면 안 된다.
    // 대신 조합 중이면 조금 더 기다리고, 끝이 자음·모음 하나면(홍길ㄷ) 아직 덜 친 것으로 보고 건너뛴다
    scheduleGenerate(target, e.isComposing ? 700 : 350);
  });
  input.addEventListener('compositionend', () => {
    updateCount(target);
    scheduleGenerate(target, 250);
  });
  // 글꼴 CSS 를 미리 켜 두면 첫 후보가 빨리 나온다
  input.addEventListener('focus', () => ensureFontCss(), { once: true });
  document.querySelector(`form[data-target="${target}"]`).addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(debounceTimers[target]);
    generate(target, { focusResults: true });
  });
  $$(`input[name="${target}-lang"]`).forEach((r) => r.addEventListener('change', () => generate(target)));
}

function updateCount(target) {
  $(`#${target}-count`).textContent = `${chars(nameInput(target).value).length}/${MAX_NAME_LENGTH}`;
}

// 슬라이더: 움직이는 동안에는 선택한 항목 미리보기만, 손을 떼면 카드 전체를 다시 그린다 (저사양 폰 배려)
for (const [id, target] of [['#sign-slant', 'sign'], ['#sign-weight', 'sign'], ['#stamp-rotation', 'stamp']]) {
  $(id).addEventListener('input', () => liveUpdate(target));
  $(id).addEventListener('change', () => rerenderCards(target));
}

/** 끌고 있는 동안: 고른 카드와 미리보기만 다시 그린다 (전체 카드는 손을 뗄 때) */
function liveUpdate(target) {
  const item = state[target].selected;
  if (item) redrawCard(target, item);
  updatePreview();
}
$('#stamp-rotation').addEventListener('input', (e) => { $('#stamp-rotation-out').textContent = `${e.target.value}°`; });

// 도장 옵션
for (const id of ['#stamp-font', '#stamp-in', '#stamp-date-label']) $(id).addEventListener('change', () => generate('stamp'));
// 둘레글자 도장 가운데 글자 선택지 (목록은 stamp-gen.js 한 곳에서 관리)
$('#stamp-seal-center').innerHTML = SEAL_CENTERS.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
// 가운데 글자 선택지를 쓰는 모양: 한자(代表理事·印)를 고른 글꼴과 상관없이 본명조로 그린다.
// 추가 둘레글자는 sealCenter 표시로 알리고, 표시가 없는 기존 둘레글자 원·별 직인은 special 로 본다
const SHAPE_BY_ID = new Map(STAMP_SHAPES.map((sh) => [sh.id, sh]));
const usesSealCenter = (sh) => Boolean(sh && (sh.sealCenter || sh.special === 'ring' || sh.special === 'ring-star'));
for (const id of ['#stamp-order', '#stamp-texture', '#stamp-bleed', '#stamp-date', '#stamp-seal-center']) $(id).addEventListener('change', () => rerenderCards('stamp'));
$('#stamp-date').value = isoDate(new Date());

const CAT_ORDER = STAMP_CATEGORIES.map((c) => c.id);
const catBox = $('#stamp-cats');
catBox.innerHTML = STAMP_CATEGORIES.map((c) => {
  const n = c.id === 'all' ? STAMP_SHAPES.length : STAMP_SHAPES.filter((s) => s.cat === c.id).length;
  return `<button type="button" class="chip" role="radio" data-cat="${c.id}" aria-checked="${c.id === 'all'}">${c.label} ${n}</button>`;
}).join('');
catBox.querySelectorAll('.chip').forEach((b) =>
  b.addEventListener('click', () => {
    state.stamp.cat = b.dataset.cat;
    catBox.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    syncRadioTabindex(catBox);
    generate('stamp');
  }),
);
enhanceRadioGroup(catBox);
syncRadioTabindex(catBox);

// ───────────── 옵션 ─────────────

/** 카드를 그릴 때 쓰는 설정. ZIP 을 만드는 동안에는 시작할 때 값으로 고정해 결과가 섞이지 않게 한다 */
function opts(target) {
  if (state.frozen[target]) return state.frozen[target];
  if (target === 'sign') {
    return { ink: state.ink.sign, slant: Number($('#sign-slant').value), weight: Number($('#sign-weight').value) };
  }
  return {
    ink: state.ink.stamp,
    order: $('#stamp-order').value,
    texture: $('#stamp-texture').checked,
    bleed: $('#stamp-bleed').checked,
    rotation: Number($('#stamp-rotation').value),
    date: dotDate($('#stamp-date').value),
    sealCenter: $('#stamp-seal-center').value,
  };
}

// ───────────── 생성 ─────────────

async function generate(target, { focusResults = false } = {}) {
  const s = state[target];
  const token = ++s.token;
  const raw = nameInput(target).value;
  const container = $(`#${target}-results`);
  saveNames();

  if (!raw.trim()) {
    setResults(target, [], target === 'sign' ? '이름을 입력하면 서명 후보 24가지가 나타나요.' : `이름을 입력하면 도장 후보 ${STAMP_SHAPES.length}가지가 나타나요.`);
    return;
  }
  const lang = resolveLang(langChoice(target), raw);
  // 이름을 지웠을 때가 아니라 실제로 입력이 있을 때만 언어별 옵션을 바꾼다 (고른 글꼴이 초기화되지 않게)
  if (target === 'stamp') syncStampOptions(lang);
  const v = validateName(raw, lang);
  if (!v.ok) {
    setResults(target, [], v.message, true);
    return;
  }

  const name = v.value;
  const { specs, fonts, text } = target === 'sign' ? signatureSpecs(name, lang) : stampSpecs(name, lang);

  if (!container.querySelector('.card')) container.innerHTML = '<p class="empty">글꼴을 불러오는 중…</p>';
  else container.classList.add('loading');
  const results = await loadFonts(fonts, text);
  container.classList.remove('loading');
  if (token !== s.token) return; // 그사이 입력이 바뀌었다
  const okByFamily = new Map(fonts.map((f, i) => [f.family, results[i]]));

  const prevId = s.selected?.id;
  const items = specs.map((spec) => ({ ...spec, kind: KIND_BY_TARGET[target], name, fontOk: okByFamily.get(spec.font.family) }));
  setResults(target, items);
  selectItem(target, items.find((it) => it.id === prevId) ?? items[0] ?? null);
  // 결과 제목으로 초점을 옮기면 제목이 읽히므로 따로 알리지 않는다 (두 번 읽히지 않게)
  if (focusResults) $(`#${target}-count-label`).focus(); // 모바일 키보드를 닫고 결과로 이동
  else announce(`${target === 'sign' ? '서명' : '도장'} 후보 ${items.length}가지를 만들었어요.`);

  // 시간 안에 못 받은 글꼴은 도착하는 대로 해당 카드를 다시 그린다
  for (const font of fonts.filter((f) => !okByFamily.get(f.family))) {
    whenFontLoaded(font, text).then((ok) => {
      if (!ok || token !== s.token) return;
      // 가운데 한자 글꼴이 늦게 오면 가운데 글자를 쓰는 둘레글자 카드도 다시 그린다
      const usesFont = (x) => x.font.family === font.family || (target === 'stamp' && font.family === SEAL_CENTER_FONT.family && usesSealCenter(SHAPE_BY_ID.get(x.id)));
      for (const it of s.items.filter(usesFont)) {
        if (it.font.family === font.family) {
          it.fontOk = true;
          it.card?.querySelector('.card-warn')?.remove();
        }
        redrawCard(target, it);
      }
      if (state.tab === target) updatePreview();
    });
  }
}

function signatureSpecs(name, lang) {
  const specs = SIGNATURE_STYLES[lang].map((style) => {
    const font = signatureFont(style.font);
    return {
      id: style.id,
      font,
      label: style.label,
      sub: font.label,
      render: (mult) => {
        const o = opts('sign');
        return renderSignature({ text: name, style, ink: o.ink, slantAdjust: o.slant, weight: o.weight, mult });
      },
    };
  });
  const text = name + transformText(name, 'monogram') + transformText(name, 'first-initial');
  return { specs, fonts: uniqueFonts(specs.map((x) => x.font)), text };
}

function stampSpecs(name, lang) {
  const fonts = STAMP_FONTS[lang];
  const chosen = fonts.find((f) => f.family === $('#stamp-font').value);
  const list = stampChars(name, { addIn: $('#stamp-in').checked, lang });
  const baseChars = stampChars(name, { addIn: false, lang });
  // 새 모양은 목록 끝에 붙어 있으므로 '전체'에서는 분류 순서로 모아 보여 준다 (같은 분류 안에서는 목록 순서)
  const shapes = STAMP_SHAPES.filter((sh) => state.stamp.cat === 'all' || sh.cat === state.stamp.cat)
    .sort((a, b) => CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat));
  const dateLabel = $('#stamp-date-label').value;

  const specs = shapes.map((shape) => {
    // 추천 조합: 모양마다 글꼴을 돌려 가며 쓴다 (분류를 바꿔도 같은 모양은 같은 글꼴)
    const font = chosen ?? fonts[STAMP_SHAPES.indexOf(shape) % fonts.length];
    return {
      id: shape.id,
      font,
      label: shape.label,
      sub: shape.fontLabel ?? font.label, // 인장체처럼 웹 글꼴을 쓰지 않는 모양은 자기 이름을 단다
      render: (mult) => renderStamp({ lang, chars: list, baseChars, text: name, shape, font, dateLabel, mult, ...opts('stamp') }),
    };
  });
  // 둘레글자 가운데 '인', 가운뎃점, 업무용 도장의 기본 문구까지 미리 받는다
  const text = `${list.join('')}${name}${name.toUpperCase()}인★·0123456789.${dateLabel || '확인결재접수APPROVEDRECEIVEDCHECKED'}${SEAL_CENTER_TEXT}`;
  // 둘레글자 가운데 한자(代表理事)는 고른 글꼴과 상관없이 본명조로 그리므로 함께 받는다
  const extra = lang === 'ko' && shapes.some(usesSealCenter) ? [SEAL_CENTER_FONT] : [];
  return { specs, fonts: uniqueFonts([...specs.map((x) => x.font), ...extra]), text };
}

function uniqueFonts(list) {
  const seen = new Map();
  for (const f of list) seen.set(f.family, f);
  return [...seen.values()];
}

/** 언어에 맞게 도장 글꼴 목록과 한글 전용 옵션을 맞춘다 */
function syncStampOptions(lang) {
  const select = $('#stamp-font');
  if (select.dataset.lang !== lang) {
    const prev = select.value;
    select.innerHTML = '<option value="auto">추천 조합</option>' +
      STAMP_FONTS[lang].map((f) => `<option value="${f.family}">${f.label}</option>`).join('');
    select.value = STAMP_FONTS[lang].some((f) => f.family === prev) ? prev : 'auto';
    select.dataset.lang = lang;
  }
  $$('#panel-stamp .ko-only').forEach((el) => { el.hidden = lang !== 'ko'; });
}

// ───────────── 카드 ─────────────

const DL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';

function setResults(target, items, message, isError = false) {
  const s = state[target];
  s.items = items;
  const container = $(`#${target}-results`);
  container.querySelectorAll('canvas').forEach((c) => { c.width = c.height = 0; }); // 이전 카드 그림을 바로 놓아 준다
  container.innerHTML = '';
  $(`#${target}-zip`).disabled = !items.length || state.zipBusy[target];
  $(`#${target}-count-label`).textContent = items.length ? `${target === 'sign' ? '서명' : '도장'} 후보 ${items.length}가지` : '';
  if (!items.length) {
    const p = document.createElement('p');
    p.className = isError ? 'error' : 'empty';
    p.textContent = message ?? '';
    container.append(p);
    selectItem(target, null);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'card';

    const sel = document.createElement('button');
    sel.type = 'button';
    sel.className = 'card-select';
    sel.setAttribute('aria-pressed', 'false');
    sel.setAttribute('aria-label', `${item.label}, ${item.sub}`);
    sel.addEventListener('click', () => selectItem(target, item));

    const foot = document.createElement('div');
    foot.className = 'card-foot';
    const label = document.createElement('span');
    label.className = 'card-label';
    label.innerHTML = '<span class="name"></span><span class="sub"></span>';
    label.querySelector('.name').textContent = item.label;
    label.querySelector('.sub').textContent = item.sub;
    label.setAttribute('aria-hidden', 'true');
    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'card-dl';
    dl.innerHTML = DL_ICON;
    dl.title = '바로 다운로드';
    dl.setAttribute('aria-label', `${item.label} 바로 다운로드`);
    dl.addEventListener('click', () => {
      selectItem(target, item);
      download(item);
    });
    foot.append(label, dl);

    card.append(sel, foot);
    if (!item.fontOk) {
      const warn = document.createElement('span');
      warn.className = 'card-warn';
      warn.textContent = '대체 글꼴';
      warn.title = '글꼴을 아직 받지 못해 기본 글꼴로 그렸어요. 받는 대로 다시 그려요.';
      card.append(warn);
    }
    item.el = sel;
    item.card = card;
    frag.append(card);
  }
  container.append(frag);
  paintCards(target, items);
}

/**
 * 카드 그림을 한 번에 다 그리면 저사양 폰에서 0.5~1초 멈춘다. 한 프레임에 약 12ms 만큼씩 나눠 그리고,
 * 고른 카드를 먼저 그린다. 새로 그리기 시작하면 이전 작업은 멈춘다.
 */
function paintCards(target, items) {
  const token = ++state.paintToken[target];
  const selected = state[target].selected;
  const queue = selected && items.includes(selected) ? [selected, ...items.filter((x) => x !== selected)] : items.slice();
  const step = () => {
    if (token !== state.paintToken[target]) return;
    const until = performance.now() + 12;
    while (queue.length && performance.now() < until) redrawCard(target, queue.shift());
    if (queue.length) requestAnimationFrame(step);
  };
  step();
}

function redrawCard(target, item) {
  if (!item.el) return;
  const next = item.render(CARD_MULT[target]);
  const old = item.el.querySelector('canvas');
  if (old) {
    old.replaceWith(next);
    old.width = old.height = 0;
  } else {
    item.el.append(next);
  }
}

/** 옵션(기울기, 잉크 색 등)만 바뀌었을 때 카드 그림만 다시 그린다 */
const rerenderQueued = {};
function rerenderCards(target) {
  if (rerenderQueued[target]) return;
  rerenderQueued[target] = true;
  requestAnimationFrame(() => {
    rerenderQueued[target] = false;
    paintCards(target, state[target].items);
    if (state.tab === target) updatePreview();
  });
}

function selectItem(target, item) {
  const s = state[target];
  s.selected = item;
  for (const it of s.items) {
    it.el?.setAttribute('aria-pressed', String(it === item));
    it.card?.classList.toggle('selected', it === item);
  }
  if (state.tab === target) updatePreview();
  else updateDocButtons();
}

// ───────────── 잉크 색 / 배경 / 해상도 ─────────────

const inkKey = () => (state.tab === 'doc' ? 'draw' : state.tab);

function renderInkSwatches() {
  const box = $('#ink-swatches');
  const presets = state.tab === 'stamp' ? INK_PRESETS.stamp : INK_PRESETS.pen;
  const current = state.ink[inkKey()];
  const isPreset = presets.some((p) => p.color === current);
  box.innerHTML =
    presets
      .map((p) => `<button type="button" class="swatch" role="radio" data-ink="${p.color}" aria-checked="${p.color === current}" style="--c:${p.color}" title="${p.label}"><span class="sr">${p.label}</span></button>`)
      .join('') +
    `<label class="swatch custom${isPreset ? '' : ' active'}" title="직접 고르기"><input type="color" value="${isPreset ? '#7a3cff' : current}" aria-label="잉크 색 직접 고르기"></label>`;
  box.querySelectorAll('[data-ink]').forEach((b) => b.addEventListener('click', () => setInk(b.dataset.ink)));
  const picker = box.querySelector('input[type="color"]');
  picker.addEventListener('input', (e) => setInk(e.target.value, true, { live: true }));
  picker.addEventListener('change', (e) => setInk(e.target.value, true));
  syncRadioTabindex(box);
}

function setInk(color, custom = false, { live = false } = {}) {
  if (!isHexColor(color)) return;
  const key = inkKey();
  state.ink[key] = color;
  const box = $('#ink-swatches');
  box.querySelectorAll('[data-ink]').forEach((b) => b.setAttribute('aria-checked', String(!custom && b.dataset.ink === color)));
  box.querySelector('.custom').classList.toggle('active', custom);
  syncRadioTabindex(box);
  if (key === 'draw') {
    pad.redraw();
    updatePreview();
  } else if (live) {
    liveUpdate(key);
  } else {
    rerenderCards(key);
  }
}
enhanceRadioGroup($('#ink-swatches'));

const bgBox = $('#bg-swatches');
bgBox.querySelectorAll('[data-bg]').forEach((b) =>
  b.addEventListener('click', () => setBg(b.dataset.bg === 'transparent' ? null : b.dataset.bg, b)),
);
$('#bg-custom').addEventListener('input', (e) => setBg(e.target.value, null));
enhanceRadioGroup(bgBox);
syncRadioTabindex(bgBox);

function setBg(color, button) {
  state.bg = color;
  bgBox.querySelectorAll('[data-bg]').forEach((b) => b.setAttribute('aria-checked', String(b === button)));
  bgBox.querySelector('.custom').classList.toggle('active', !button);
  syncRadioTabindex(bgBox);
  updatePreview();
}

$$('input[name="res"]').forEach((r) =>
  r.addEventListener('change', () => {
    state.res = Number(r.value);
    updatePreview();
  }),
);

// ───────────── 미리보기 / 저장 ─────────────

function currentItem(tab = state.tab) {
  if (tab === 'draw') return state.drawMode === 'pad' ? state.drawItem : state.photoItem;
  if (tab === 'sign' || tab === 'stamp') return state[tab].selected;
  return null;
}

const exportScale = (item) => item.exportScale?.(state.res) ?? state.res;
const buildOutput = (item, bg = state.bg, res = state.res) => finalize(item.render(res), bg);

let previewQueued = false;
function updatePreview() {
  updateDocButtons();
  state.previewVersion++;
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    const item = currentItem();
    const box = $('#preview');
    const old = box.querySelector('canvas');
    if (old) {
      old.remove();
      old.width = old.height = 0;
    }
    // 미리보기는 화면에 220px 정도로만 보이므로 보통 해상도로 그리고, 크기 표시는 저장 배율로 계산한다
    const out = item ? finalize(item.render(1), state.bg) : null;
    $('#preview-empty').hidden = Boolean(out);
    for (const id of ['#download', '#copy', '#share', '#save-library']) $(id).disabled = !out;
    if (out) {
      const k = exportScale(item) / (item.exportScale?.(1) ?? 1);
      $('#preview-meta').textContent = `약 ${Math.round(out.width * k)} × ${Math.round(out.height * k)}px · ${state.bg ? '배경색' : '투명 배경'} PNG`;
      box.append(out);
    } else {
      $('#preview-meta').textContent = '';
    }
    updateQuickbar(out);
    prepareShare(item);
  });
}

function emptyMessage() {
  if (state.tab === 'draw') return state.drawMode === 'pad' ? '먼저 서명을 그려 주세요.' : '먼저 서명 사진을 선택해 주세요.';
  return '먼저 이름을 입력해 주세요.';
}

async function outputBlob(item, { bg = state.bg, res = state.res } = {}) {
  const out = item && buildOutput(item, bg, res);
  if (!out) throw new Error('empty');
  const blob = await toPngBlob(out);
  out.width = out.height = 0;
  return blob;
}

async function download(item = currentItem()) {
  if (!item) return setStatus(emptyMessage(), { error: true });
  try {
    const blob = await outputBlob(item);
    const fileName = buildFileName(item.kind, item.name);
    downloadBlob(blob, fileName);
    setStatus(`${fileName} 파일을 다운로드했어요.`);
  } catch (err) {
    console.error(err);
    setStatus('다운로드하지 못했어요. 다시 시도해 주세요.', { error: true });
  }
}

function copy() {
  const item = currentItem();
  if (!item) return;
  // Safari 는 탭한 직후에 clipboard.write 를 불러야 하므로 PNG 를 만드는 Promise 를 바로 넘긴다
  copyBlob(outputBlob(item))
    .then(() => setStatus('이미지를 복사했어요. 문서에 붙여 넣으세요.'))
    .catch((err) => {
      console.error(err);
      setStatus('복사하지 못했어요. 다운로드를 이용해 주세요.', { error: true });
    });
}

function canShareFiles() {
  try {
    return Boolean(navigator.canShare?.({ files: [new File([new Blob()], 'a.png', { type: 'image/png' })] }));
  } catch {
    return false;
  }
}
const SHARE_SUPPORTED = canShareFiles();

/** 공유는 탭 직후에 불러야 하는 브라우저가 있어, 고른 항목의 PNG 를 미리 만들어 둔다 */
let shareTimer = 0;
function prepareShare(item) {
  if (!SHARE_SUPPORTED) return;
  clearTimeout(shareTimer);
  state.shareCache = null;
  if (!item || !state.exportVisible) return; // 저장 패널을 보고 있을 때만 (공유하지 않는 사람의 폰을 덜 바쁘게)
  const version = state.previewVersion;
  shareTimer = setTimeout(async () => {
    try {
      const blob = await outputBlob(item);
      if (version === state.previewVersion) state.shareCache = { version, item, blob };
    } catch { /* 공유할 때 다시 만든다 */ }
  }, 1500);
}

async function share() {
  const item = currentItem();
  if (!item) return;
  const fileName = buildFileName(item.kind, item.name);
  try {
    const cache = state.shareCache;
    const blob = cache && cache.item === item && cache.version === state.previewVersion ? cache.blob : await outputBlob(item);
    await navigator.share({ files: [new File([blob], fileName, { type: 'image/png' })], title: fileName });
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error(err);
      setStatus('공유하지 못했어요. 다운로드를 이용해 주세요.', { error: true });
    }
  }
}

$('#download').addEventListener('click', () => download());
$('#copy').addEventListener('click', copy);
$('#copy').hidden = !canCopyImage();
$('#share').addEventListener('click', share);
$('#share').hidden = !SHARE_SUPPORTED;

// ───────────── 빠른 저장 바 ─────────────
// 후보 카드 아래에 있는 저장 패널은 휴대폰에서 2~3화면 아래라, 고르면 화면 아래에 바로 저장 버튼을 띄운다.

function quickbarWanted() {
  const typing = document.activeElement?.matches?.('input[type="text"]');
  return (state.tab === 'sign' || state.tab === 'stamp') && Boolean(currentItem()) && !state.exportVisible && !typing;
}

function updateQuickbar(out) {
  const bar = $('#quickbar');
  const show = Boolean(out) && quickbarWanted();
  bar.hidden = !show;
  document.body.classList.toggle('has-quickbar', show);
  if (!out) return;
  const thumb = bar.querySelector('.quickbar-thumb');
  thumb.querySelector('canvas')?.remove();
  const c = document.createElement('canvas');
  const k = Math.min(96 / out.width, 96 / out.height, 1);
  c.width = Math.max(1, Math.round(out.width * k));
  c.height = Math.max(1, Math.round(out.height * k));
  c.getContext('2d').drawImage(out, 0, 0, c.width, c.height);
  thumb.append(c);
}

function syncQuickbar() {
  const show = quickbarWanted();
  $('#quickbar').hidden = !show;
  document.body.classList.toggle('has-quickbar', show);
}
// 저장 패널의 다운로드 버튼이 화면에 보이면 빠른 저장 바는 필요 없다
new IntersectionObserver((entries) => {
  state.exportVisible = entries.some((e) => e.isIntersecting);
  syncQuickbar();
  if (state.exportVisible) prepareShare(currentItem());
}).observe($('#download'));
document.addEventListener('focusin', syncQuickbar);
document.addEventListener('focusout', () => setTimeout(syncQuickbar, 0));

$('#quick-download').addEventListener('click', () => download());
$('#quick-more').addEventListener('click', () => {
  // 패널 맨 위가 아니라 미리보기와 다운로드 버튼이 함께 보이게 옮긴다 (가로 모드 포함)
  $('#preview').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('#export-title').setAttribute('tabindex', '-1');
  $('#export-title').focus({ preventScroll: true });
});

// ───────────── 전체 ZIP ─────────────

async function downloadZip(target) {
  const s = state[target];
  if (!s.items.length || state.zipBusy[target]) return;
  // 만드는 도중 이름·분류를 바꿔도 섞이지 않도록 시작할 때의 목록과 설정을 고정한다
  const items = s.items.slice();
  const name = items[0].name;
  const snapshot = { bg: state.bg, res: state.res };
  state.frozen[target] = { ...opts(target) }; // 만드는 도중 색·기울기·효과를 바꿔도 이 ZIP 에는 반영하지 않는다
  const button = $(`#${target}-zip`);
  state.zipBusy[target] = true;
  button.disabled = true;
  try {
    const files = [];
    const names = uniqueNames(items.map((it, i) => `${String(i + 1).padStart(2, '0')}_${sanitizeFilePart(`${it.label}_${it.sub}`)}.png`));
    for (let i = 0; i < items.length; i++) {
      setStatus(`이미지를 묶는 중… ${i + 1}/${items.length}`, { sticky: true });
      const blob = await outputBlob(items[i], snapshot);
      files.push({ name: names[i], data: new Uint8Array(await blob.arrayBuffer()) });
      await new Promise((r) => setTimeout(r, 0)); // 화면이 멈추지 않게 한 장마다 쉬어 간다
    }
    const zip = new Blob(createZipParts(files), { type: 'application/zip' });
    const fileName = `${KIND_LABEL[KIND_BY_TARGET[target]]}_전체_${sanitizeFilePart(name)}_${formatDate(new Date())}.zip`;
    downloadBlob(zip, fileName);
    setStatus(`${fileName} 파일을 다운로드했어요.`);
  } catch (err) {
    console.error(err);
    setStatus('ZIP 파일을 만들지 못했어요.', { error: true });
  } finally {
    state.zipBusy[target] = false;
    state.frozen[target] = null;
    button.disabled = !s.items.length;
  }
}
$('#sign-zip').addEventListener('click', () => downloadZip('sign'));
$('#stamp-zip').addEventListener('click', () => downloadZip('stamp'));

// ───────────── 보관함 ─────────────

let libraryUrls = [];

async function renderLibrary() {
  const grid = $('#library-grid');
  let items = [];
  try {
    items = await library.listItems();
  } catch (err) {
    console.error(err);
    grid.innerHTML = '<p class="empty">이 브라우저(사생활 보호 모드 등)에서는 보관함을 쓸 수 없어요.</p>';
    return;
  }
  libraryUrls.forEach((u) => URL.revokeObjectURL(u));
  libraryUrls = [];
  $('#library-count').textContent = items.length ? `${items.length}개` : '';
  $('#library-clear').hidden = !items.length && !hasSavedNames();
  if (!items.length) {
    grid.innerHTML = '<p class="empty">저장한 서명·도장이 여기에 모여요.</p>';
    return;
  }
  grid.innerHTML = '';
  for (const it of items) {
    const url = URL.createObjectURL(it.blob);
    libraryUrls.push(url);
    const el = document.createElement('div');
    el.className = 'lib-item';
    el.innerHTML = `
      <div class="lib-thumb checker"><img alt=""></div>
      <span class="lib-label"></span>
      <div class="lib-actions">
        <button type="button" data-act="dl">다운로드</button>
        <button type="button" data-act="doc">문서에 넣기</button>
        <button type="button" data-act="del">삭제</button>
      </div>`;
    const title = `${it.label}${it.name ? ` · ${it.name}` : ''}`;
    el.querySelector('img').src = url;
    el.querySelector('img').alt = title;
    el.querySelector('.lib-label').textContent = title;
    for (const b of el.querySelectorAll('button')) b.setAttribute('aria-label', `${title} ${b.textContent}`);
    el.querySelector('[data-act="dl"]').addEventListener('click', () => {
      const fileName = buildFileName(it.kind, it.name, new Date(it.createdAt));
      downloadBlob(it.blob, fileName);
      setStatus(`${fileName} 파일을 다운로드했어요.`);
    });
    el.querySelector('[data-act="doc"]').addEventListener('click', async () => {
      selectTab('doc');
      if (!composer.hasDocument) return setStatus('먼저 문서 이미지를 선택해 주세요.', { error: true });
      const label = KIND_LABEL[it.kind] ?? '서명';
      composer.add(await blobToCanvas(it.blob), { widthRatio: it.kind === 'stamp' ? 0.16 : 0.3, label });
      setStatus(`${label}을 넣었어요. 끌어서 위치를 맞추세요.`);
    });
    el.querySelector('[data-act="del"]').addEventListener('click', async () => {
      await library.removeItem(it.id);
      state.deleted.push(it);
      await renderLibrary();
      $('#library-title').focus(); // 지운 버튼이 사라지므로 초점을 보관함 제목으로
      // 연달아 지워도 모두 되돌릴 수 있게 지운 항목을 쌓아 둔다
      const n = state.deleted.length;
      setStatus(n > 1 ? `보관함에서 ${n}개를 삭제했어요.` : '보관함에서 삭제했어요.', {
        action: { label: '되돌리기', run: restoreDeleted },
      });
    });
    grid.append(el);
  }
}

async function restoreDeleted() {
  const items = state.deleted.splice(0);
  for (const it of items) await library.restoreItem(it);
  await renderLibrary();
  $('#library-title').focus();
  setStatus(`${items.length}개를 되살렸어요.`);
}

$('#save-library').addEventListener('click', async () => {
  const item = currentItem();
  if (!item) return setStatus(emptyMessage(), { error: true });
  try {
    // 보관함에는 다른 곳에 다시 쓰기 좋게 투명 배경으로 저장한다
    const out = buildOutput(item, null);
    const blob = await toPngBlob(out);
    out.width = out.height = 0;
    const { removed } = await library.addItem({ kind: item.kind, name: item.name ?? '', label: item.label, blob });
    navigator.storage?.persist?.().catch(() => {}); // 브라우저가 오래된 저장 데이터를 지우지 않도록 요청
    await renderLibrary();
    if (removed.length) {
      state.deleted.push(...removed);
      setStatus(`보관함이 가득 차(${library.LIBRARY_LIMIT}개) 가장 오래된 ${removed.length}개를 지웠어요.`, {
        action: { label: '되돌리기', run: restoreDeleted },
      });
    } else {
      setStatus('보관함에 저장했어요.');
    }
  } catch (err) {
    console.error(err);
    setStatus('보관함에 저장하지 못했어요. 사생활 보호 모드이거나 저장 공간이 부족할 수 있어요.', { error: true });
  }
});

$('#library-clear').addEventListener('click', async () => {
  if (!window.confirm('보관함의 서명·도장과 입력한 이름을 모두 지울까요? 되돌릴 수 없어요.')) return;
  try {
    await library.clearItems();
    state.deleted = [];
    localStorage.removeItem(NAMES_KEY);
    // 화면에 남은 이름과 후보도 지워야 다른 동작에서 이름이 다시 저장되지 않는다
    for (const target of ['sign', 'stamp']) {
      nameInput(target).value = '';
      updateCount(target);
      state[target].token++;
      setResults(target, [], target === 'sign' ? '이름을 입력하면 서명 후보 24가지가 나타나요.' : `이름을 입력하면 도장 후보 ${STAMP_SHAPES.length}가지가 나타나요.`);
    }
    await renderLibrary();
    setStatus('보관함과 이름을 모두 지웠어요.');
  } catch (err) {
    console.error(err);
    setStatus('지우지 못했어요.', { error: true });
  }
});

async function blobToCanvas(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}

// ───────────── 문서에 넣기 ─────────────

const composer = new DocComposer($('#doc-stage'), { onChange: updateDocButtons });

$('#doc-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    await composer.setDocument(file);
    setStatus('문서를 불러왔어요. 넣을 항목을 고르세요.');
  } catch (err) {
    console.error(err);
    setStatus(err.userMessage ?? '문서 이미지를 열지 못했어요.', { error: true });
  }
  e.target.value = '';
});

$$('#doc-add [data-add]').forEach((b) =>
  b.addEventListener('click', () => {
    const tab = b.dataset.add;
    const item = currentItem(tab);
    if (!item) return;
    // 문서에는 고해상도 투명 이미지를 올린다
    const canvas = finalize(item.render(2), null);
    if (!canvas) return;
    const label = tab === 'stamp' ? '도장' : '서명';
    composer.add(canvas, { widthRatio: tab === 'stamp' ? 0.16 : 0.3, label });
    setStatus(`${label}을 넣었어요. 끌어서 위치를 맞추세요.`);
  }),
);

$('#doc-multiply').addEventListener('change', (e) => composer.setMultiply(e.target.checked));
$('#doc-clear').addEventListener('click', () => composer.clearOverlays());
$('#doc-download').addEventListener('click', async () => {
  try {
    const out = composer.compose();
    const type = composer.docType;
    const blob = await new Promise((resolve, reject) =>
      out.toBlob((b) => (b ? resolve(b) : reject(new Error('변환 실패'))), type, 0.92),
    );
    out.width = out.height = 0; // 원본 크기 임시 캔버스를 바로 놓아 준다
    const ext = type === 'image/jpeg' ? 'jpg' : 'png';
    const fileName = `${sanitizeFilePart(composer.docName) || '문서'}_서명완료_${formatDate(new Date())}.${ext}`;
    downloadBlob(blob, fileName);
    setStatus(`${fileName} 파일을 다운로드했어요.`);
  } catch (err) {
    console.error(err);
    setStatus('문서를 저장하지 못했어요. 문서 이미지가 너무 크면 줄여서 다시 올려 주세요.', { error: true });
  }
});

function updateDocButtons() {
  if (!state.ready) return; // 시작 전에는 composer 가 아직 없다
  const has = composer.hasDocument;
  let allMissing = true;
  for (const b of $$('#doc-add [data-add]')) {
    const missing = !currentItem(b.dataset.add);
    if (!missing) allMissing = false;
    b.disabled = !has || missing;
  }
  $('#doc-add-hint').hidden = !allMissing;
  $('#doc-download').disabled = !has;
  $('#doc-clear').disabled = !has || composer.overlays.length === 0;
}

// ───────────── 알림 / 기타 ─────────────

let statusTimer = 0;
/**
 * @param {string} text
 * @param {{error?: boolean, sticky?: boolean, action?: {label: string, run: () => void}}} [opts]
 */
function setStatus(text, { error = false, sticky = false, action = null } = {}) {
  const el = $('#status');
  $('#status-text').textContent = text;
  el.classList.toggle('error', error);
  el.classList.add('show');
  const btn = $('#status-action');
  btn.hidden = !action;
  btn.onclick = null;
  el.classList.toggle('has-action', Boolean(action));
  if (action) {
    btn.textContent = action.label;
    btn.onclick = () => {
      el.classList.remove('show');
      action.run();
    };
  }
  clearTimeout(statusTimer);
  statusDelay = action ? 8000 : error ? 5000 : 3500;
  if (!sticky) statusTimer = setTimeout(hideStatus, statusDelay);
}
let statusDelay = 3500;
function hideStatus() {
  const el = $('#status');
  // 되돌리기 버튼에 초점이 있거나 마우스가 올라가 있으면 기다린다
  if (el.matches(':hover') || el.contains(document.activeElement)) {
    statusTimer = setTimeout(hideStatus, 1500);
    return;
  }
  el.classList.remove('show');
}

/** 화면에는 띄우지 않고 스크린리더에만 알린다 */
function announce(text) {
  const el = $('#announce');
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = text; });
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dotDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[1]}.${m[2]}.${m[3]}` : isoDate(new Date()).replace(/-/g, '.');
}

const NAMES_KEY = 'super-dojang:names';
function hasSavedNames() {
  try {
    const saved = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}');
    return Boolean(saved.sign || saved.stamp);
  } catch {
    return false;
  }
}
function saveNames() {
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify({ sign: nameInput('sign').value, stamp: nameInput('stamp').value }));
    $('#library-clear').hidden = false;
  } catch { /* 저장 못 해도 동작에는 지장 없다 */ }
}
/** 이름만 채워 두고, 실제 생성(글꼴 다운로드)은 그 탭을 열 때 한다 */
function restoreNames() {
  try {
    const saved = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}');
    for (const target of ['sign', 'stamp']) {
      if (saved[target]) {
        nameInput(target).value = saved[target];
        updateCount(target);
        // 곧 쓸 가능성이 높으니 글꼴 CSS 를 쉬는 시간에 미리 켜 둔다
        setTimeout(() => ensureFontCss(), 1200);
      }
    }
  } catch { /* 무시 */ }
}

// 예전 판에서 등록한 서비스 워커와 그 캐시를 지운다. 이 서비스는 웹페이지로만 동작한다.
// (남아 있으면 예전 파일을 계속 보여 줄 수 있다)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations?.()
    .then((regs) => Promise.all(regs.map((r) => r.unregister())))
    .catch(() => {});
}
if ('caches' in window) {
  caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('super-dojang-')).map((k) => caches.delete(k))))
    .catch(() => {});
}

// 시작 (모든 모듈 변수가 초기화된 뒤에 호출한다)
state.ready = true;
onPadChange();
syncStampOptions('ko');
restoreNames();
selectTab('draw');
renderLibrary();
