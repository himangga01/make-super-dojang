import { STAMP_FONTS, loadFonts, signatureFont } from './fonts.js';
import { SIGNATURE_STYLES } from './signature-styles.js';
import { SignaturePad } from './signature-pad.js';
import { renderSignature, transformText } from './signature-gen.js';
import { renderStamp, STAMP_SHAPES, STAMP_CATEGORIES } from './stamp-gen.js';
import { finalize, toPngBlob, downloadBlob, canCopyImage, copyBlob } from './exporter.js';
import { PhotoSignature, loadImageFile } from './photo-import.js';
import { DocComposer } from './doc-composer.js';
import * as library from './library.js';
import { createZip, uniqueNames } from './core/zip.js';
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
  // 한쪽에서 입력한 이름을 다른 쪽에 채워 준다
  if (name === 'sign' || name === 'stamp') {
    const other = name === 'sign' ? 'stamp' : 'sign';
    if (!nameInput(name).value && nameInput(other).value) {
      nameInput(name).value = nameInput(other).value;
      updateCount(name);
      generate(name);
    }
  }
  if (name !== 'doc') {
    renderInkSwatches();
    updatePreview();
  }
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

$('#photo-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  setStatus('사진에서 서명을 찾는 중…');
  try {
    photo.setImage(await loadImageFile(file));
    if (photo.isEmpty) {
      state.photoItem = null;
      setStatus('서명을 찾지 못했어요. 배경 제거를 약하게 하거나 더 밝은 곳에서 찍어 주세요.', true);
    } else {
      state.photoItem = {
        kind: 'drawing',
        name: '',
        label: '사진 서명',
        render: (mult) => photo.render(mult, $('#photo-keep-color').checked ? null : state.ink.draw),
      };
      setStatus('배경을 지웠어요. 아래 미리보기를 확인하세요.');
    }
  } catch (err) {
    console.error(err);
    setStatus('사진을 열지 못했어요. JPG나 PNG 파일인지 확인해 주세요.', true);
  }
  updatePreview();
  e.target.value = '';
});

let photoTimer = 0;
$('#photo-offset').addEventListener('input', (e) => {
  clearTimeout(photoTimer);
  photoTimer = setTimeout(() => {
    photo.setOffset(Number(e.target.value));
    updatePreview();
  }, 120);
});
$('#photo-keep-color').addEventListener('change', updatePreview);

// ───────────── 이름 입력 공통 ─────────────

const langChoice = (target) => document.querySelector(`input[name="${target}-lang"]:checked`).value;
const nameInput = (target) => $(`#${target}-name`);

const debounceTimers = {};
for (const target of ['sign', 'stamp']) {
  const input = nameInput(target);
  input.addEventListener('input', () => {
    updateCount(target);
    clearTimeout(debounceTimers[target]);
    debounceTimers[target] = setTimeout(() => generate(target), 300);
  });
  document.querySelector(`form[data-target="${target}"]`).addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(debounceTimers[target]);
    input.blur(); // 모바일 키보드를 닫아 결과가 보이게 한다
    generate(target);
  });
  $$(`input[name="${target}-lang"]`).forEach((r) => r.addEventListener('change', () => generate(target)));
}

function updateCount(target) {
  $(`#${target}-count`).textContent = `${chars(nameInput(target).value).length}/${MAX_NAME_LENGTH}`;
}

// 서명 옵션: 글꼴은 그대로라 그림만 다시 그린다
$('#sign-slant').addEventListener('input', () => rerenderCards('sign'));
$('#sign-weight').addEventListener('input', () => rerenderCards('sign'));

// 도장 옵션
for (const id of ['#stamp-font', '#stamp-in', '#stamp-date-label']) $(id).addEventListener('change', () => generate('stamp'));
for (const id of ['#stamp-order', '#stamp-texture', '#stamp-bleed', '#stamp-date']) $(id).addEventListener('change', () => rerenderCards('stamp'));
$('#stamp-rotation').addEventListener('input', (e) => {
  $('#stamp-rotation-out').textContent = `${e.target.value}°`;
  rerenderCards('stamp');
});
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
    generate('stamp');
  }),
);

// ───────────── 생성 ─────────────

async function generate(target) {
  const s = state[target];
  const token = ++s.token;
  const raw = nameInput(target).value;
  const container = $(`#${target}-results`);
  saveNames();

  const lang = resolveLang(langChoice(target), raw);
  if (target === 'stamp') syncStampOptions(lang);

  if (!raw.trim()) {
    setResults(target, [], target === 'sign' ? '이름을 입력하면 서명 후보 24가지가 나타나요.' : `이름을 입력하면 도장 후보 ${STAMP_SHAPES.length}가지가 나타나요.`);
    return;
  }
  const v = validateName(raw, lang);
  if (!v.ok) {
    setResults(target, [], v.message, true);
    return;
  }

  const name = v.value;
  const { specs, fonts, text } = target === 'sign' ? signatureSpecs(name, lang) : stampSpecs(name, lang);

  if (!container.querySelector('.card')) container.innerHTML = '<p class="empty">글꼴을 불러오는 중…</p>';
  const results = await loadFonts(fonts, text);
  if (token !== s.token) return; // 그사이 입력이 바뀌었다
  const okByFamily = new Map(fonts.map((f, i) => [f.family, results[i]]));

  const prevId = s.selected?.id;
  const items = specs.map((spec) => ({ ...spec, kind: KIND_BY_TARGET[target], name, fontOk: okByFamily.get(spec.font.family) }));
  setResults(target, items);
  selectItem(target, items.find((it) => it.id === prevId) ?? items[0] ?? null);
}

function signatureSpecs(name, lang) {
  const styles = SIGNATURE_STYLES[lang];
  const specs = styles.map((style) => {
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
  const fonts = uniqueFonts(specs.map((x) => x.font));
  const text = name + transformText(name, 'monogram') + transformText(name, 'first-initial');
  return { specs, fonts, text };
}

function stampSpecs(name, lang) {
  const fonts = STAMP_FONTS[lang];
  const chosen = fonts.find((f) => f.family === $('#stamp-font').value);
  const list = stampChars(name, { addIn: $('#stamp-in').checked, lang });
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
  $(`#${target}-zip`).disabled = !items.length;
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
    sel.setAttribute('aria-label', `${item.label}, ${item.sub} 선택`);
    sel.append(item.render(CARD_MULT[target]));
    const label = document.createElement('span');
    label.className = 'card-label';
    label.textContent = `${item.label} · ${item.sub}`;
    sel.append(label);
    sel.addEventListener('click', () => selectItem(target, item));

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

    card.append(sel, dl);
    if (!item.fontOk) {
      const warn = document.createElement('span');
      warn.className = 'card-warn';
      warn.textContent = '대체 글꼴';
      warn.title = '글꼴을 불러오지 못해 기본 글꼴로 그렸어요.';
      card.append(warn);
    }
    item.el = sel;
    frag.append(card);
  }
  container.append(frag);
}

/** 옵션(기울기, 잉크 색 등)만 바뀌었을 때 카드 그림만 다시 그린다 */
const rerenderQueued = {};
function rerenderCards(target) {
  if (rerenderQueued[target]) return;
  rerenderQueued[target] = true;
  requestAnimationFrame(() => {
    rerenderQueued[target] = false;
    for (const item of state[target].items) {
      const old = item.el?.querySelector('canvas');
      if (old) old.replaceWith(item.render(CARD_MULT[target]));
    }
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
}

function setInk(color, custom = false) {
  if (!isHexColor(color)) return;
  const key = inkKey();
  state.ink[key] = color;
  const box = $('#ink-swatches');
  box.querySelectorAll('[data-ink]').forEach((b) => b.setAttribute('aria-checked', String(!custom && b.dataset.ink === color)));
  box.querySelector('.custom').classList.toggle('active', custom);
  if (key === 'draw') {
    pad.redraw();
    updatePreview();
  } else {
    rerenderCards(key);
  }
}

const bgBox = $('#bg-swatches');
bgBox.querySelectorAll('[data-bg]').forEach((b) =>
  b.addEventListener('click', () => setBg(b.dataset.bg === 'transparent' ? null : b.dataset.bg, b)),
);
$('#bg-custom').addEventListener('input', (e) => setBg(e.target.value, null));

function setBg(color, button) {
  state.bg = color;
  bgBox.querySelectorAll('[data-bg]').forEach((b) => b.setAttribute('aria-checked', String(b === button)));
  bgBox.querySelector('.custom').classList.toggle('active', !button);
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

const buildOutput = (item, bg = state.bg) => finalize(item.render(state.res), bg);

let previewQueued = false;
function updatePreview() {
  updateDocButtons();
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    const item = currentItem();
    const box = $('#preview');
    box.querySelector('canvas')?.remove();
    const out = item ? buildOutput(item) : null;
    $('#preview-empty').hidden = Boolean(out);
    for (const id of ['#download', '#copy', '#share', '#save-library']) $(id).disabled = !out;
    $('#preview-meta').textContent = out ? `${out.width} × ${out.height}px · ${state.bg ? '배경색' : '투명 배경'} PNG` : '';
    if (out) box.append(out);
  });
}

function emptyMessage() {
  if (state.tab === 'draw') return state.drawMode === 'pad' ? '먼저 서명을 그려 주세요.' : '먼저 서명 사진을 선택해 주세요.';
  return '먼저 이름을 입력해 주세요.';
}

async function outputBlob(item) {
  const out = item && buildOutput(item);
  if (!out) throw new Error('empty');
  return toPngBlob(out);
}

async function download(item = currentItem()) {
  if (!item) return setStatus(emptyMessage(), true);
  try {
    const blob = await outputBlob(item);
    const fileName = buildFileName(item.kind, item.name);
    downloadBlob(blob, fileName);
    setStatus(`${fileName} 파일을 저장했어요.`);
  } catch (err) {
    console.error(err);
    setStatus('저장하지 못했어요. 다시 시도해 주세요.', true);
  }
}

async function copy() {
  try {
    await copyBlob(await outputBlob(currentItem()));
    setStatus('이미지를 복사했어요. 문서에 붙여 넣으세요.');
  } catch (err) {
    console.error(err);
    setStatus('복사하지 못했어요. 다운로드를 이용해 주세요.', true);
  }
}

function canShareFiles() {
  try {
    return Boolean(navigator.canShare?.({ files: [new File([new Blob()], 'a.png', { type: 'image/png' })] }));
  } catch {
    return false;
  }
}

async function share() {
  const item = currentItem();
  try {
    const fileName = buildFileName(item.kind, item.name);
    const file = new File([await outputBlob(item)], fileName, { type: 'image/png' });
    await navigator.share({ files: [file], title: fileName });
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error(err);
      setStatus('공유하지 못했어요. 다운로드를 이용해 주세요.', true);
    }
  }
}

$('#download').addEventListener('click', () => download());
$('#copy').addEventListener('click', copy);
$('#copy').hidden = !canCopyImage();
$('#share').addEventListener('click', share);
$('#share').hidden = !canShareFiles();

// ───────────── 전체 ZIP ─────────────

async function downloadZip(target) {
  const s = state[target];
  if (!s.items.length) return;
  const button = $(`#${target}-zip`);
  button.disabled = true;
  setStatus(`${s.items.length}개 이미지를 묶는 중…`);
  try {
    const files = [];
    const names = uniqueNames(s.items.map((it, i) => `${String(i + 1).padStart(2, '0')}_${sanitizeFilePart(`${it.label}_${it.sub}`)}.png`));
    for (let i = 0; i < s.items.length; i++) {
      const blob = await outputBlob(s.items[i]);
      files.push({ name: names[i], data: new Uint8Array(await blob.arrayBuffer()) });
      // 화면이 멈추지 않게 가끔 쉬어 간다
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
    const zip = new Blob([createZip(files)], { type: 'application/zip' });
    const label = target === 'sign' ? '서명' : '도장';
    const fileName = `${label}_전체_${sanitizeFilePart(s.items[0].name)}_${formatDate(new Date())}.zip`;
    downloadBlob(zip, fileName);
    setStatus(`${fileName} 파일을 저장했어요.`);
  } catch (err) {
    console.error(err);
    setStatus('ZIP 파일을 만들지 못했어요.', true);
  } finally {
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
    grid.innerHTML = '<p class="empty">이 브라우저에서는 보관함을 쓸 수 없어요.</p>';
    return;
  }
  libraryUrls.forEach((u) => URL.revokeObjectURL(u));
  libraryUrls = [];
  $('#library-count').textContent = items.length ? `${items.length}개` : '';
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
        <button type="button" data-act="dl">저장</button>
        <button type="button" data-act="doc">문서에</button>
        <button type="button" data-act="del">삭제</button>
      </div>`;
    el.querySelector('img').src = url;
    el.querySelector('img').alt = it.label;
    el.querySelector('.lib-label').textContent = `${it.label}${it.name ? ` · ${it.name}` : ''}`;
    el.querySelector('[data-act="dl"]').addEventListener('click', () => {
      const fileName = buildFileName(it.kind, it.name, new Date(it.createdAt));
      downloadBlob(it.blob, fileName);
      setStatus(`${fileName} 파일을 저장했어요.`);
    });
    el.querySelector('[data-act="doc"]').addEventListener('click', async () => {
      selectTab('doc');
      if (!composer.hasDocument) return setStatus('먼저 문서 이미지를 선택해 주세요.', true);
      composer.add(await blobToCanvas(it.blob), { widthRatio: it.kind === 'stamp' ? 0.16 : 0.3 });
      setStatus('문서에 넣었어요. 끌어서 위치를 맞추세요.');
    });
    el.querySelector('[data-act="del"]').addEventListener('click', async () => {
      await library.removeItem(it.id);
      renderLibrary();
    });
    grid.append(el);
  }
}

$('#save-library').addEventListener('click', async () => {
  const item = currentItem();
  if (!item) return setStatus(emptyMessage(), true);
  try {
    // 보관함에는 다른 곳에 다시 쓰기 좋게 투명 배경으로 저장한다
    const blob = await toPngBlob(buildOutput(item, null));
    await library.addItem({ kind: item.kind, name: item.name ?? '', label: item.label, blob });
    await renderLibrary();
    setStatus('보관함에 저장했어요.');
  } catch (err) {
    console.error(err);
    setStatus('보관함에 저장하지 못했어요. 저장 공간을 확인해 주세요.', true);
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
    setStatus('문서 이미지를 열지 못했어요.', true);
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
    if (canvas) composer.add(canvas, { widthRatio: tab === 'stamp' ? 0.16 : 0.3 });
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
    const ext = type === 'image/jpeg' ? 'jpg' : 'png';
    const fileName = `${sanitizeFilePart(composer.docName) || '문서'}_서명완료_${formatDate(new Date())}.${ext}`;
    downloadBlob(blob, fileName);
    setStatus(`${fileName} 파일을 저장했어요.`);
  } catch (err) {
    console.error(err);
    setStatus('문서를 저장하지 못했어요.', true);
  }
});

function updateDocButtons() {
  if (!state.ready) return; // 시작 전에는 composer 가 아직 없다
  const has = composer.hasDocument;
  for (const b of $$('#doc-add [data-add]')) b.disabled = !has || !currentItem(b.dataset.add);
  $('#doc-download').disabled = !has;
  $('#doc-clear').disabled = !has || composer.overlays.length === 0;
}

// ───────────── 알림 / 기타 ─────────────

let statusTimer = 0;
function setStatus(text, isError = false) {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => el.classList.remove('show'), isError ? 5000 : 3500);
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
function restoreNames() {
  try {
    const saved = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}');
    for (const target of ['sign', 'stamp']) {
      if (saved[target]) {
        nameInput(target).value = saved[target];
        updateCount(target);
        generate(target);
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
selectTab('draw');
restoreNames();
renderLibrary();
