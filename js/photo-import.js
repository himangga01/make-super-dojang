// 종이에 쓴 서명 사진 → 배경이 투명한 서명
import { extractSignatureMask, maskBounds } from './core/image.js';

export const MAX_PIXELS = 50_000_000; // 이보다 큰 이미지는 휴대폰에서 메모리가 모자라 탭이 꺼질 수 있다

/**
 * 이미지 파일을 읽어 긴 변이 maxSide 이하인 캔버스로 만든다.
 * 먼저 크기만 확인해 지나치게 큰 이미지는 풀기 전에 거절한다. 사진 회전 정보(EXIF)는 브라우저가 반영한다.
 */
export async function loadImageFile(file, maxSide = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('이미지를 열 수 없어요.'));
    });
    const sw = img.naturalWidth;
    const sh = img.naturalHeight;
    if (!sw || !sh) throw new Error('이미지를 열 수 없어요.');
    if (sw * sh > MAX_PIXELS) {
      const err = new Error(`이미지가 너무 커요 (${sw}×${sh}). 5천만 화소 이하로 줄여 주세요.`);
      err.userMessage = err.message;
      throw err;
    }
    const k = Math.min(1, maxSide / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * k));
    canvas.height = Math.max(1, Math.round(sh * k));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class PhotoSignature {
  constructor() {
    this.source = null;
    this.rgba = null;
    this.alpha = null;
    this.bounds = null;
    this.offset = 0;
  }

  get isEmpty() {
    return !this.bounds;
  }

  setImage(canvas) {
    this.source = canvas;
    this.rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    this.update();
  }

  setOffset(offset) {
    this.offset = offset;
    if (this.source) this.update();
  }

  update() {
    const { width: w, height: h } = this.source;
    this.alpha = extractSignatureMask(this.rgba, w, h, this.offset).alpha;
    this.bounds = maskBounds(this.alpha, w, h);
  }

  /**
   * @param {number} mult 1 이면 사진 해상도 그대로, 그 이상이면 2배로 키운다
   * @param {string|null} ink null 이면 사진 원래 색
   */
  render(mult, ink) {
    if (!this.bounds) return document.createElement('canvas');
    const { width: w } = this.source;
    const b = this.bounds;
    const crop = document.createElement('canvas');
    crop.width = b.w;
    crop.height = b.h;
    const ctx = crop.getContext('2d');
    const img = ctx.createImageData(b.w, b.h);
    const out = img.data;
    const rgb = ink ? hexToRgb(ink) : null;
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const si = (b.y + y) * w + (b.x + x);
        const di = (y * b.w + x) * 4;
        if (rgb) {
          out[di] = rgb[0];
          out[di + 1] = rgb[1];
          out[di + 2] = rgb[2];
        } else {
          // 원래 색을 쓰되 종이 빛이 섞인 옅은 색을 조금 진하게 한다
          out[di] = this.rgba[si * 4] * 0.8;
          out[di + 1] = this.rgba[si * 4 + 1] * 0.8;
          out[di + 2] = this.rgba[si * 4 + 2] * 0.8;
        }
        out[di + 3] = this.alpha[si];
      }
    }
    ctx.putImageData(img, 0, 0);
    if (mult <= 1) return crop;
    const big = document.createElement('canvas');
    big.width = b.w * 2;
    big.height = b.h * 2;
    const bctx = big.getContext('2d');
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(crop, 0, 0, big.width, big.height);
    return big;
  }
}

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
