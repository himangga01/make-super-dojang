import { STAMP_FONTS, loadFonts, whenFontLoaded, signatureFont } from './fonts.js';
import { SIGNATURE_STYLES } from './signature-styles.js';
import { SignaturePad } from './signature-pad.js';
import { renderSignature, transformText } from './signature-gen.js';
import { renderStamp, STAMP_SHAPES, STAMP_CATEGORIES } from './stamp-gen.js';
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
$('#photo-offset').addEventListener('input', (e) => {
  clearTimeout(photoTimer);
  photoTimer = setTimeout(() => {
    // 슬라이더 오른쪽(강하게)일수록 배경을 더 지운다 = 경계값을 낮춘다
    photo.setOffset(-Number(e.target.value));
    refreshPhotoItem();
  }, 120);
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
    // 한글 조합 중(홍→홍ㄱ→홍기…)에는 만들지 않는다. 조합이 끝나면 compositionend 에서 만든다
    if (e.isComposing) return;
    scheduleGenerate(target);
  });
  input.addEventListener('compositionend', () => {
    updateCount(target);
    scheduleGenerate(target, 500);
  });
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
  $(id).addEventListener('input', () => updatePreview());
  $(id).addEventListener('change', () => rerenderCards(target));
}
$('#stamp-rotation').addEventListener('input', (e) => { $('#stamp-rotation-out').textContent = `${e.target.value}°`; });

// 도장 옵션
for (const id of ['#stamp-font', '#stamp-in', '#stamp-date-label']) $(id).addEventListener('change', () => generate('stamp'));
for (const id of ['#stamp-order', '#stamp-texture', '#stamp-bleed', '#stamp-date']) $(id).addEventListener('change', () => rerenderCards('stamp'));
$('#stamp-date').value = isoDate(new Date());

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
  announce(`${target === 'sign' ? '서명' : '도장'} 후보 ${items.length}가지를 만들었어요.`);
  if (focusResults) $(`#${target}-count-label`).focus(); // 모바일 키보드를 닫고 결과로 이동

  // 시간 안에 못 받은 글꼴은 도착하는 대로 해당 카드를 다시 그린다
  for (const font of fonts.filter((f) => !okByFamily.get(f.family))) {
    whenFontLoaded(font, text).then((ok) => {
      if (!ok || token !== s.token) return;
      for (const it of s.items.filter((x) => x.font.family === font.family)) {
        it.fontOk = true;
        it.card?.querySelector('.card-warn')?.remove();
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
      render: (mult) =>
        renderSignature({
          text: name,
          style,
          ink: state.ink.sign,
          slantAdjust: Number($('#sign-slant').value),
          weight: Number($('#sign-weight').value),
          mult,
        }),
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
  const shapes = STAMP_SHAPES.filter((sh) => state.stamp.cat === 'all' || sh.cat === state.stamp.cat);
  const dateLabel = $('#stamp-date-label').value;

  const specs = shapes.map((shape) => {
    // 추천 조합: 모양마다 글꼴을 돌려 가며 쓴다 (분류를 바꿔도 같은 모양은 같은 글꼴)
    const font = chosen ?? fonts[STAMP_SHAPES.indexOf(shape) % fonts.length];
    return {
      id: shape.id,
      font,
      label: shape.label,
      sub: font.label,
      render: (mult) =>
        renderStamp({
          lang,
          chars: list,
          baseChars,
          text: name,
          shape,
          font,
          order: $('#stamp-order').value,
          ink: state.ink.stamp,
          texture: $('#stamp-texture').checked,
          bleed: $('#stamp-bleed').checked,
          rotation: Number($('#stamp-rotation').value),
          date: dotDate($('#stamp-date').value),
          dateLabel,
          mult,
        }),
    };
  });
  const text = `${list.join('')}${name}${name.toUpperCase()}★0123456789.${dateLabel || '확인APPROVED'}`;
  return { specs, fonts: uniqueFonts(specs.map((x) => x.font)), text };
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
  container.innerHTML = '';
  $(`#${target}-zip`).disabled = !items.length || state.zipBusy[target];
  $(`#${target}-count-label`).textContent = items.length ? `${items.length}가지` : '';
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
    sel.append(item.render(CARD_MULT[target]));
    sel.addEventListener('click', () => selectItem(target, item));

    const foot = document.createElement('div');
    foot.className = 'card-foot';
    const label = document.createElement('span');
    label.className = 'card-label';
    label.textContent = `${item.label} · ${item.sub}`;
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
}

function redrawCard(target, item) {
  const old = item.el?.querySelector('canvas');
  if (old) {
    const next = item.render(CARD_MULT[target]);
    old.replaceWith(next);
    old.width = old.height = 0;
  }
}

/** 옵션(기울기, 잉크 색 등)만 바뀌었을 때 카드 그림만 다시 그린다 */
const rerenderQueued = {};
function rerenderCards(target) {
  if (rerenderQueued[target]) return;
  rerenderQueued[target] = true;
  requestAnimationFrame(() => {
    rerenderQueued[target] = false;
    for (const item of state[target].items) redrawCard(target, item);
    if (state.tab === target) updatePreview();
  });
}

function selectItem(target, item) {
  const s = state[target];
  s.selected = item;
  for (const it of s.items) it.el?.setAttribute('aria-pressed', String(it === item));
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
  box.querySelector('input[type="color"]').addEventListener('input', (e) => setInk(e.target.value, true));
  syncRadioTabindex(box);
}

function setInk(color, custom = false) {
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
const buildOutput = (item, bg = state.bg) => finalize(item.render(state.res), bg);

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

async function outputBlob(item) {
  const out = item && buildOutput(item);
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
  if (!item) return;
  const version = state.previewVersion;
  shareTimer = setTimeout(async () => {
    try {
      const blob = await outputBlob(item);
      if (version === state.previewVersion) state.shareCache = { version, item, blob };
    } catch { /* 공유할 때 다시 만든다 */ }
  }, 600);
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

function updateQuickbar(out) {
  const bar = $('#quickbar');
  const show = Boolean(out) && state.tab !== 'doc' && !state.exportVisible;
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

new IntersectionObserver((entries) => {
  state.exportVisible = entries.some((e) => e.isIntersecting);
  const bar = $('#quickbar');
  if (state.exportVisible) {
    bar.hidden = true;
    document.body.classList.remove('has-quickbar');
  } else if (currentItem() && state.tab !== 'doc') {
    bar.hidden = false;
    document.body.classList.add('has-quickbar');
  }
}, { threshold: 0.25 }).observe($('#preview'));

$('#quick-download').addEventListener('click', () => download());
$('#quick-more').addEventListener('click', () => {
  $('#export-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  const button = $(`#${target}-zip`);
  state.zipBusy[target] = true;
  button.disabled = true;
  try {
    const files = [];
    const names = uniqueNames(items.map((it, i) => `${String(i + 1).padStart(2, '0')}_${sanitizeFilePart(`${it.label}_${it.sub}`)}.png`));
    for (let i = 0; i < items.length; i++) {
      setStatus(`이미지를 묶는 중… ${i + 1}/${items.length}`, { sticky: true });
      const blob = await outputBlob(items[i]);
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
  $('#library-clear').hidden = !items.length;
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
      await renderLibrary();
      // 실수로 지웠을 때 되돌릴 수 있게 잠시 기회를 준다
      setStatus('보관함에서 삭제했어요.', {
        action: { label: '되돌리기', run: async () => { await library.restoreItem(it); renderLibrary(); } },
      });
    });
    grid.append(el);
  }
}

$('#save-library').addEventListener('click', async () => {
  const item = currentItem();
  if (!item) return setStatus(emptyMessage(), { error: true });
  try {
    // 보관함에는 다른 곳에 다시 쓰기 좋게 투명 배경으로 저장한다
    const out = buildOutput(item, null);
    const blob = await toPngBlob(out);
    out.width = out.height = 0;
    await library.addItem({ kind: item.kind, name: item.name ?? '', label: item.label, blob });
    navigator.storage?.persist?.().catch(() => {}); // 브라우저가 오래된 저장 데이터를 지우지 않도록 요청
    await renderLibrary();
    setStatus('보관함에 저장했어요.');
  } catch (err) {
    console.error(err);
    setStatus('보관함에 저장하지 못했어요. 사생활 보호 모드이거나 저장 공간이 부족할 수 있어요.', { error: true });
  }
});

$('#library-clear').addEventListener('click', async () => {
  if (!window.confirm('보관함의 서명·도장과 기억해 둔 이름을 모두 지울까요? 되돌릴 수 없어요.')) return;
  try {
    await library.clearItems();
    localStorage.removeItem(NAMES_KEY);
    await renderLibrary();
    setStatus('보관함과 기억해 둔 이름을 지웠어요.');
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
  let anyMissing = false;
  for (const b of $$('#doc-add [data-add]')) {
    const missing = !currentItem(b.dataset.add);
    anyMissing ||= missing;
    b.disabled = !has || missing;
  }
  $('#doc-add-hint').hidden = !anyMissing;
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
  if (action) {
    btn.textContent = action.label;
    btn.onclick = () => {
      el.classList.remove('show');
      action.run();
    };
  }
  clearTimeout(statusTimer);
  if (!sticky) statusTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : error ? 5000 : 3500);
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
function saveNames() {
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify({ sign: nameInput('sign').value, stamp: nameInput('stamp').value }));
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
      }
    }
  } catch { /* 무시 */ }
}

// 앱 설치(PWA)
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('#install').hidden = false;
});
$('#install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('#install').hidden = true;
});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('서비스 워커 등록 실패', err));
}

// 시작 (모든 모듈 변수가 초기화된 뒤에 호출한다)
state.ready = true;
onPadChange();
syncStampOptions('ko');
restoreNames();
selectTab('draw');
renderLibrary();
