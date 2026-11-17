// 문서 이미지 위에 서명·도장을 올려 한 장으로 저장한다.
import { loadImageFile } from './photo-import.js';

export class DocComposer {
  /**
   * @param {HTMLElement} stage 문서와 서명이 놓일 영역
   * @param {{onChange?: () => void}} opts
   */
  constructor(stage, { onChange } = {}) {
    this.stage = stage;
    this.onChange = onChange ?? (() => {});
    this.doc = null; // 원본 해상도 캔버스
    this.docType = 'image/png';
    this.docName = '';
    this.overlays = []; // 문서 픽셀 좌표 {canvas, x, y, w, h, el}
    this.selected = null;
    this.multiply = true;
    new ResizeObserver(() => this.layout()).observe(stage);
  }

  get hasDocument() {
    return Boolean(this.doc);
  }

  async setDocument(file) {
    this.doc = await loadImageFile(file, 4000);
    this.docType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    this.docName = file.name.replace(/\.[^.]+$/, '');
    this.overlays.forEach((o) => o.el.remove());
    this.overlays = [];
    this.stage.querySelector('.doc-canvas')?.remove();
    // 화면 표시용으로 따로 복사하지 않고 원본 캔버스를 그대로 보여 준다 (큰 문서에서 메모리 절약)
    this.doc.className = 'doc-canvas';
    this.stage.prepend(this.doc);
    this.stage.classList.add('has-doc');
    this.layout();
    this.onChange();
  }

  /** 화면 표시 배율 (문서 픽셀 → CSS 픽셀) */
  get scale() {
    return this.doc ? this.stage.clientWidth / this.doc.width : 1;
  }

  /** @param {HTMLCanvasElement} canvas 투명 배경 서명·도장 */
  add(canvas, { widthRatio = 0.28, label = '서명' } = {}) {
    if (!this.doc) return;
    const w = this.doc.width * widthRatio;
    const h = (w * canvas.height) / canvas.width;
    // 새로 넣을 때마다 조금씩 비켜 겹치지 않게 한다
    const n = this.overlays.length;
    const shift = (n % 5) * 0.04;
    const o = {
      canvas,
      w,
      h,
      x: clamp(this.doc.width * (0.55 + shift) - w / 2, 0, this.doc.width - w),
      y: clamp(this.doc.height * (0.7 + shift) - h / 2, 0, this.doc.height - h),
    };
    o.label = label;
    o.el = this.#createElement(o);
    this.overlays.push(o);
    this.stage.append(o.el);
    this.#select(o);
    this.layout();
    // 화면 밖에 놓이면 아무 일도 안 일어난 것처럼 보이므로 보이는 곳으로 옮긴다
    o.el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    this.onChange();
    return o;
  }

  setMultiply(on) {
    this.multiply = on;
    this.stage.classList.toggle('multiply', on);
  }

  clearOverlays() {
    this.overlays.forEach((o) => o.el.remove());
    this.overlays = [];
    this.onChange();
  }

  layout() {
    const k = this.scale;
    for (const o of this.overlays) {
      Object.assign(o.el.style, {
        left: `${o.x * k}px`,
        top: `${o.y * k}px`,
        width: `${o.w * k}px`,
        height: `${o.h * k}px`,
      });
    }
  }

  /** 올린 항목이 문서 밖으로 완전히 나가지 않게 위치와 크기를 묶어 둔다 */
  #clampOverlay(o) {
    const ratio = o.h / o.w;
    o.w = clamp(o.w, this.doc.width * 0.04, this.doc.width * 1.2);
    o.h = o.w * ratio;
    o.x = clamp(o.x, -o.w * 0.5, this.doc.width - o.w * 0.5);
    o.y = clamp(o.y, -o.h * 0.5, this.doc.height - o.h * 0.5);
  }

  /** 원본 해상도로 합성한 캔버스 */
  compose() {
    const out = document.createElement('canvas');
    out.width = this.doc.width;
    out.height = this.doc.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(this.doc, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.globalCompositeOperation = this.multiply ? 'multiply' : 'source-over';
    for (const o of this.overlays) ctx.drawImage(o.canvas, o.x, o.y, o.w, o.h);
    return out;
  }

  #select(o) {
    this.selected = o;
    for (const it of this.overlays) it.el.classList.toggle('selected', it === o);
    if (o) this.stage.append(o.el); // 맨 위로
  }

  #createElement(o) {
    const el = document.createElement('div');
    el.className = 'overlay';
    el.tabIndex = 0;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', `문서에 올린 ${o.label}. 끌어서 옮기고, 모서리로 크기를 바꾸세요. 방향키로 옮기고 +, - 로 크기를 바꿀 수 있어요.`);
    o.canvas.className = 'overlay-img';
    el.append(o.canvas);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'overlay-del';
    del.setAttribute('aria-label', `${o.label} 빼기`);
    del.textContent = '×';
    del.addEventListener('pointerdown', (e) => e.stopPropagation());
    del.addEventListener('click', () => {
      el.remove();
      this.overlays = this.overlays.filter((x) => x !== o);
      this.onChange();
    });

    const handle = document.createElement('div');
    handle.className = 'overlay-handle';
    handle.setAttribute('aria-hidden', 'true');
    el.append(del, handle);

    // 끌어서 옮기기
    el.addEventListener('pointerdown', (e) => {
      if (e.target === handle) return;
      e.preventDefault();
      this.#select(o);
      el.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY, ox: o.x, oy: o.y };
      const move = (ev) => {
        const k = this.scale;
        o.x = clamp(start.ox + (ev.clientX - start.x) / k, -o.w * 0.5, this.doc.width - o.w * 0.5);
        o.y = clamp(start.oy + (ev.clientY - start.y) / k, -o.h * 0.5, this.doc.height - o.h * 0.5);
        this.layout();
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });

    // 오른쪽 아래 모서리로 크기 바꾸기 (비율 유지)
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.#select(o);
      handle.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY, w: o.w };
      const ratio = o.h / o.w;
      const move = (ev) => {
        const k = this.scale;
        // 가로·세로 중 더 크게 움직인 쪽을 따른다 (아래로만 끌어도 커지도록)
        const dx = (ev.clientX - start.x) / k;
        const dy = (ev.clientY - start.y) / k / ratio;
        const d = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
        o.w = clamp(start.w + d, this.doc.width * 0.04, this.doc.width * 1.2);
        o.h = o.w * ratio;
        this.layout();
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });

    // 키보드: 방향키 이동, +/- 크기, Delete 빼기
    el.addEventListener('keydown', (e) => {
      const step = (e.shiftKey ? 0.05 : 0.01) * this.doc.width;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) {
        e.preventDefault();
        o.x += moves[e.key][0];
        o.y += moves[e.key][1];
      } else if (e.key === '+' || e.key === '=' || e.key === '-') {
        const ratio = o.h / o.w;
        o.w *= e.key === '-' ? 0.92 : 1.08;
        o.h = o.w * ratio;
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        del.click();
        return;
      } else return;
      this.#clampOverlay(o);
      this.layout();
    });
    return el;
  }
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
