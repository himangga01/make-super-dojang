import { SIGNATURE_FONTS, STAMP_FONTS, loadFonts } from './fonts.js';
import { SignaturePad } from './signature-pad.js';
import { renderSignature } from './signature-gen.js';
import { renderStamp, KO_SHAPES, EN_SHAPES } from './stamp-gen.js';
import { finalize, toPngBlob, downloadBlob, canCopyImage, copyBlob } from './exporter.js';
import { MAX_NAME_LENGTH, resolveLang, validateName, stampChars, buildFileName, chars, isHexColor } from './core/text.js';

const $ = (sel) => document.querySelector(sel);

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
const CARD_MULT = { sign: 0.4, stamp: 0.42 };

const state = {
  tab: 'draw',
  ink: { draw: '#111111', sign: '#111111', stamp: '#d0201f' },
  bg: null, // null = 투명
  res: 1,
  sign: { items: [], selected: null, token: 0 },
  stamp: { items: [], selected: null, token: 0 },
  drawItem: null,
};

// ───────────── 탭 ─────────────

const tabs = [...document.querySelectorAll('[role="tab"]')];

function selectTab(name, focus = false) {
  state.tab = name;
  for (const t of tabs) {
    const on = t.dataset.tab === name;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(`#panel-${t.dataset.tab}`).hidden = !on;
    if (on && focus) t.focus();
  }
  if (name === 'draw') pad.resize();
  $('#status').textContent = '';
  renderInkSwatches();
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

// ───────────── 직접 서명 ─────────────

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
    : { kind: 'drawing', name: '', render: (mult) => pad.render(DRAW_BASE_WIDTH * mult, state.ink.draw) };
  if (state.tab === 'draw') updatePreview();
}
padCanvas.addEventListener('pointerdown', () => { $('#pad-hint').hidden = true; });
$('#pad-undo').addEventListener('click', () => pad.undo());
$('#pad-clear').addEventListener('click', () => pad.clear());

// ───────────── 이름 입력 공통 ─────────────

function langChoice(target) {
  return document.querySelector(`input[name="${target}-lang"]:checked`).value;
}

function nameInput(target) {
  return $(`#${target}-name`);
}

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
  document.querySelectorAll(`input[name="${target}-lang"]`).forEach((r) =>
    r.addEventListener('change', () => generate(target)),
  );
}

function updateCount(target) {
  $(`#${target}-count`).textContent = `${chars(nameInput(target).value).length}/${MAX_NAME_LENGTH}`;
}

// 서명 옵션
$('#sign-slant').addEventListener('input', () => rerenderCards('sign'));
$('#sign-flourish').addEventListener('change', () => rerenderCards('sign'));
// 도장 옵션
for (const id of ['#stamp-font', '#stamp-order', '#stamp-in', '#stamp-texture']) {
  $(id).addEventListener('change', () => generate('stamp'));
}

// ───────────── 생성 ─────────────

async function generate(target) {
  const s = state[target];
  const token = ++s.token;
  const raw = nameInput(target).value;
  const container = $(`#${target}-results`);

  const lang = resolveLang(langChoice(target), raw);
  if (target === 'stamp') syncStampOptions(lang);

  if (!raw.trim()) {
    setResults(target, [], target === 'sign' ? '이름을 입력하면 서명 후보가 나타나요.' : '이름을 입력하면 도장 후보가 나타나요.');
    return;
  }
  const v = validateName(raw, lang);
  if (!v.ok) {
    setResults(target, [], v.message, true);
    return;
  }

  const name = v.value;
  const specs = target === 'sign' ? signatureSpecs(name, lang) : stampSpecs(name, lang);
  const fonts = [...new Set(specs.map((x) => x.font))];
  const fontText = target === 'stamp' && lang === 'ko' ? specs[0].chars.join('') : name + (target === 'stamp' ? name.toUpperCase() + '★' : '');

  if (!container.querySelector('.card')) container.innerHTML = '<p class="empty">글꼴을 불러오는 중…</p>';
  const results = await loadFonts(fonts, fontText);
  if (token !== s.token) return; // 그사이 입력이 바뀌었다
  const okByFont = new Map(fonts.map((f, i) => [f, results[i]]));

  const prevIndex = s.selected ? s.items.indexOf(s.selected) : 0;
  const items = specs.map((spec) => ({ ...spec, kind: target === 'sign' ? 'signature' : 'stamp', name, fontOk: okByFont.get(spec.font) }));
  setResults(target, items);
  selectItem(target, items[Math.min(Math.max(prevIndex, 0), items.length - 1)] ?? null);
}

function signatureSpecs(name, lang) {
  return SIGNATURE_FONTS[lang].map((font) => ({
    font,
    label: font.label,
    render: (mult) =>
      renderSignature({
        text: name,
        font,
        ink: state.ink.sign,
        slant: Number($('#sign-slant').value),
        flourish: $('#sign-flourish').checked,
        mult,
      }),
  }));
}

function stampSpecs(name, lang) {
  const fonts = STAMP_FONTS[lang];
  const shapes = lang === 'ko' ? KO_SHAPES : EN_SHAPES;
  const fontChoice = $('#stamp-font').value;
  const list = stampChars(name, { addIn: $('#stamp-in').checked, lang });
  const order = $('#stamp-order').value;
  const texture = $('#stamp-texture').checked;

  const combos = [];
  const chosen = fonts.find((f) => f.family === fontChoice);
  shapes.forEach((shape, i) => {
    if (chosen) combos.push([shape, chosen]);
    else {
      combos.push([shape, fonts[(i * 2) % fonts.length]]);
      combos.push([shape, fonts[(i * 2 + 1) % fonts.length]]);
    }
  });

  return combos.map(([shape, font]) => ({
    font,
    chars: list,
    label: `${shape.label} · ${font.label}`,
    render: (mult) =>
      renderStamp({ lang, chars: list, text: name, shape: shape.id, font, order, ink: state.ink.stamp, texture, mult }),
  }));
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
  document.querySelectorAll('#panel-stamp .ko-only').forEach((el) => { el.hidden = lang !== 'ko'; });
}

// ───────────── 카드 ─────────────

const DL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';

function setResults(target, items, message, isError = false) {
  const s = state[target];
  s.items = items;
  const container = $(`#${target}-results`);
  container.innerHTML = '';
  if (!items.length) {
    const p = document.createElement('p');
    p.className = isError ? 'error' : 'empty';
    p.textContent = message ?? '';
    container.append(p);
    selectItem(target, null);
    return;
  }
  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'card';

    const sel = document.createElement('button');
    sel.type = 'button';
    sel.className = 'card-select';
    sel.setAttribute('aria-pressed', 'false');
    sel.setAttribute('aria-label', `${item.label} 선택`);
    sel.append(item.render(CARD_MULT[target]));
    const label = document.createElement('span');
    label.className = 'card-label';
    label.textContent = item.label;
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
    container.append(card);
  }
}

/** 옵션(기울기, 잉크 색 등)만 바뀌었을 때 카드 그림만 다시 그린다 */
let rerenderQueued = {};
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
}

// ───────────── 잉크 색 / 배경 / 해상도 ─────────────

function inkKey() {
  return state.tab;
}

function renderInkSwatches() {
  const box = $('#ink-swatches');
  const presets = state.tab === 'stamp' ? INK_PRESETS.stamp : INK_PRESETS.pen;
  const current = state.ink[inkKey()];
  const isPreset = presets.some((p) => p.color === current);
  box.innerHTML =
    presets
      .map(
        (p) => `<button type="button" class="swatch" role="radio" data-ink="${p.color}" aria-checked="${p.color === current}" style="--c:${p.color}" title="${p.label}"><span class="sr">${p.label}</span></button>`,
      )
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

document.querySelectorAll('input[name="res"]').forEach((r) =>
  r.addEventListener('change', () => {
    state.res = Number(r.value);
    updatePreview();
  }),
);

// ───────────── 미리보기 / 저장 ─────────────

function currentItem() {
  if (state.tab === 'draw') return state.drawItem;
  return state[state.tab].selected;
}

function buildOutput(item) {
  return finalize(item.render(state.res), state.bg);
}

let previewQueued = false;
function updatePreview() {
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    const item = currentItem();
    const box = $('#preview');
    box.querySelector('canvas')?.remove();
    const out = item ? buildOutput(item) : null;
    $('#preview-empty').hidden = Boolean(out);
    $('#download').disabled = !out;
    $('#copy').disabled = !out;
    $('#preview-meta').textContent = out ? `${out.width} × ${out.height}px · ${state.bg ? '배경색' : '투명 배경'} PNG` : '';
    if (out) box.append(out);
  });
}

async function download(item = currentItem()) {
  if (!item) {
    setStatus(state.tab === 'draw' ? '먼저 서명을 그려 주세요.' : '먼저 이름을 입력해 주세요.', true);
    return;
  }
  const out = buildOutput(item);
  if (!out) {
    setStatus('저장할 내용이 없어요.', true);
    return;
  }
  try {
    const blob = await toPngBlob(out);
    const fileName = buildFileName(item.kind, item.name);
    downloadBlob(blob, fileName);
    setStatus(`${fileName} 파일을 저장했어요.`);
  } catch (err) {
    setStatus('저장하지 못했어요. 다시 시도해 주세요.', true);
    console.error(err);
  }
}

async function copy() {
  const item = currentItem();
  const out = item && buildOutput(item);
  if (!out) return;
  try {
    await copyBlob(await toPngBlob(out));
    setStatus('이미지를 복사했어요. 문서에 붙여 넣으세요.');
  } catch (err) {
    setStatus('복사하지 못했어요. 다운로드를 이용해 주세요.', true);
    console.error(err);
  }
}

let statusTimer = 0;
function setStatus(text, isError = false) {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('error', isError);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.textContent = ''; }, 5000);
}

$('#download').addEventListener('click', () => download());
$('#copy').addEventListener('click', copy);
$('#copy').hidden = !canCopyImage();

// 시작 (모든 모듈 변수가 초기화된 뒤에 호출한다)
onPadChange();
syncStampOptions('ko');
selectTab('draw');
