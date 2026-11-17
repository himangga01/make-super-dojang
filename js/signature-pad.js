// 직접 서명 패드. 픽셀이 아니라 획 좌표를 저장해 어떤 배율로도 다시 그린다.

export class SignaturePad {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{onChange?: () => void, getInk: () => string, getWidth: () => number}} opts
   */
  constructor(canvas, { onChange, getInk, getWidth }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange ?? (() => {});
    this.getInk = getInk;
    this.getWidth = getWidth;
    /** @type {Array<Array<{x:number,y:number,w:number}>>} CSS 픽셀 좌표 */
    this.strokes = [];
    this.current = null;
    this.size = { w: 0, h: 0 };
    this.dpr = 1;

    canvas.addEventListener('pointerdown', (e) => this.#down(e));
    canvas.addEventListener('pointermove', (e) => this.#move(e));
    canvas.addEventListener('pointerup', (e) => this.#up(e));
    canvas.addEventListener('pointercancel', (e) => this.#up(e));
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  get isEmpty() {
    return this.strokes.length === 0;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    // 패드 비율이 고정이라 폭 비율만큼 저장된 획을 늘이거나 줄인다
    if (this.size.w && Math.abs(this.size.w - rect.width) > 0.5) {
      const k = rect.width / this.size.w;
      for (const s of this.strokes) for (const p of s) { p.x *= k; p.y *= k; p.w *= k; }
    }
    this.size = { w: rect.width, h: rect.height };
    this.dpr = dpr;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.redraw();
  }

  undo() {
    this.strokes.pop();
    this.redraw();
    this.onChange();
  }

  clear() {
    this.strokes = [];
    this.redraw();
    this.onChange();
  }

  redraw() {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const s of this.strokes) drawStroke(ctx, s, this.getInk());
  }

  /**
   * 내보내기용으로 다시 그린다. 화면 크기와 상관없이 폭 targetWidth 기준으로 맞춘다.
   * @returns {HTMLCanvasElement}
   */
  render(targetWidth, ink) {
    const k = targetWidth / (this.size.w || 1);
    const c = document.createElement('canvas');
    c.width = Math.round(this.size.w * k);
    c.height = Math.round(this.size.h * k);
    const ctx = c.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    for (const s of this.strokes) drawStroke(ctx, s, ink);
    return c;
  }

  #point(e, prev) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const base = this.getWidth();
    let target = base;
    if (prev) {
      const dt = Math.max(1, e.timeStamp - prev.t);
      const v = Math.hypot(x - prev.x, y - prev.y) / dt; // px/ms
      target = base * clamp(1.35 - v * 0.4, 0.45, 1.35);
    }
    if (e.pointerType === 'pen' && e.pressure > 0) target *= 0.4 + e.pressure * 1.2;
    const w = prev ? prev.w * 0.7 + target * 0.3 : target * 0.9;
    return { x, y, w, t: e.timeStamp };
  }

  #down(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // 그리는 중에 두 번째 손가락이나 손바닥이 닿으면 무시한다
    if (this.current && e.pointerId !== this.pointerId) return;
    if (!e.isPrimary && e.pointerType === 'touch') return;
    this.pointerId = e.pointerId;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.#point(e, null);
    this.current = [p];
    this.strokes.push(this.current);
    this.ctx.fillStyle = this.getInk();
    this.ctx.beginPath();
    this.ctx.arc(p.x, p.y, p.w / 2, 0, Math.PI * 2);
    this.ctx.fill();
  }

  #move(e) {
    if (!this.current || e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ev of events.length ? events : [e]) {
      const prev = this.current[this.current.length - 1];
      const p = this.#point(ev, prev);
      if (Math.hypot(p.x - prev.x, p.y - prev.y) < 0.8) continue;
      this.current.push(p);
      drawLastSegment(this.ctx, this.current, this.getInk());
    }
  }

  #up(e) {
    if (!this.current || e.pointerId !== this.pointerId) return;
    const s = this.current;
    this.current = null;
    if (s.length > 1) {
      // 마지막 중간점에서 끝점까지 이어 준다
      const a = s[s.length - 2];
      const b = s[s.length - 1];
      segment(this.ctx, mid(a, b), b, b, b.w, this.getInk());
    }
    for (const p of s) delete p.t;
    this.onChange();
  }
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function segment(ctx, from, ctrl, to, width, ink) {
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
  ctx.stroke();
}

/** 점 사이 중간점을 2차 곡선으로 이어 부드럽게 그린다 */
function drawStroke(ctx, pts, ink) {
  if (pts.length === 0) return;
  if (pts.length === 1) {
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, pts[0].w / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  let from = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const to = mid(pts[i - 1], pts[i]);
    segment(ctx, from, pts[i - 1], to, (pts[i - 1].w + pts[i].w) / 2, ink);
    from = to;
  }
  const last = pts[pts.length - 1];
  segment(ctx, from, last, last, last.w, ink);
}

function drawLastSegment(ctx, pts, ink) {
  const n = pts.length;
  const from = n > 2 ? mid(pts[n - 3], pts[n - 2]) : pts[0];
  const to = mid(pts[n - 2], pts[n - 1]);
  segment(ctx, from, pts[n - 2], to, (pts[n - 2].w + pts[n - 1].w) / 2, ink);
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
