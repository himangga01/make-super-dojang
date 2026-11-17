// 사진 속 서명에서 배경을 지우는 순수 함수 (DOM 없음)

/** RGBA → 밝기(0~255). 투명한 부분은 흰색으로 본다 */
export function toGray(rgba, w, h) {
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) {
    const lum = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
    // 투명한 픽셀은 (0,0,0,0) 이라 그대로 재면 잉크로 오인한다. 흰 종이 위에 얹어 잰다
    const a = rgba[i + 3] / 255;
    g[j] = lum * a + 255 * (1 - a);
  }
  return g;
}

/**
 * 그림자나 조명 차이를 줄인다. 칸마다 가장 밝은 값(종이 색)을 배경으로 보고,
 * 칸 사이를 선형 보간한 배경으로 나눠 종이를 흰색(255)에 맞춘다.
 */
export function normalizeIllumination(gray, w, h, cell = 32) {
  const cw = Math.ceil(w / cell);
  const ch = Math.ceil(h / cell);
  const bg = new Float32Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      // 잡음 하나에 휘둘리지 않도록 상위 10% 근처 값을 쓴다
      const hist = new Uint32Array(256);
      let count = 0;
      for (let y = cy * cell; y < Math.min(h, (cy + 1) * cell); y++) {
        for (let x = cx * cell; x < Math.min(w, (cx + 1) * cell); x++) {
          hist[gray[y * w + x]]++;
          count++;
        }
      }
      let acc = 0;
      let v = 255;
      for (; v > 0; v--) {
        acc += hist[v];
        if (acc >= count * 0.1) break;
      }
      bg[cy * cw + cx] = Math.max(v, 1);
    }
  }
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(Math.max(y / cell - 0.5, 0), ch - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, ch - 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(Math.max(x / cell - 0.5, 0), cw - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, cw - 1);
      const tx = fx - x0;
      const b =
        bg[y0 * cw + x0] * (1 - tx) * (1 - ty) +
        bg[y0 * cw + x1] * tx * (1 - ty) +
        bg[y1 * cw + x0] * (1 - tx) * ty +
        bg[y1 * cw + x1] * tx * ty;
      out[y * w + x] = (gray[y * w + x] / b) * 255;
    }
  }
  return out;
}

/** 오츠(Otsu) 방법: 두 무리(잉크, 종이)의 분산이 가장 잘 갈리는 경계값 */
export function otsuThreshold(gray) {
  const hist = new Float64Array(256);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * 밝기 → 알파. threshold 보다 어두우면 잉크(불투명), 밝으면 종이(투명).
 * 경계 ±soft 구간은 부드럽게 이어 가장자리가 계단지지 않게 한다.
 */
export function inkAlpha(gray, threshold, soft = 18) {
  const a = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const t = (threshold + soft - gray[i]) / (2 * soft);
    a[i] = t <= 0 ? 0 : t >= 1 ? 255 : t * 255;
  }
  return a;
}

/** 서명 사진 → 알파 마스크. offset 으로 경계값을 조정한다(+ 면 더 많이 남김) */
export function extractSignatureMask(rgba, w, h, offset = 0) {
  // 칸이 획보다 작으면 굵은 획을 배경으로 오인하므로 사진 크기에 맞춰 칸을 키운다
  const cell = Math.max(32, Math.round(Math.max(w, h) / 24));
  const gray = normalizeIllumination(toGray(rgba, w, h), w, h, cell);
  const auto = otsuThreshold(gray);
  // 종이만 찍힌 사진처럼 대비가 거의 없으면 오츠 값이 너무 높게 잡혀 종이 결이 남는다
  const threshold = Math.min(Math.max(auto, 60), 215) + offset;
  const alpha = removeSpecks(inkAlpha(gray, threshold), w, h, Math.max(12, Math.round(w * h * 0.00004)));
  return { alpha, threshold };
}

/**
 * 면적이 minArea 보다 작은 잉크 덩어리(먼지, 종이 결)를 지운다.
 * alpha > 96 인 픽셀을 8방향으로 이어 덩어리를 찾는다.
 */
export function removeSpecks(alpha, w, h, minArea) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const members = [];
  for (let start = 0; start < alpha.length; start++) {
    if (seen[start] || alpha[start] <= 96) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    members.length = 0;
    while (top > 0) {
      const i = stack[--top];
      members.push(i);
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = ny * w + nx;
          if (!seen[j] && alpha[j] > 96) {
            seen[j] = 1;
            stack[top++] = j;
          }
        }
      }
    }
    if (members.length < minArea) {
      for (const i of members) alpha[i] = 0;
    }
  }
  // 덩어리에 붙지 않은 옅은 가장자리 픽셀도 정리한다
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] > 0 && alpha[i] <= 96 && !hasStrongNeighbor(alpha, w, h, i)) alpha[i] = 0;
  }
  return alpha;
}

function hasStrongNeighbor(alpha, w, h, i) {
  const x = i % w;
  const y = (i - x) / w;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && alpha[ny * w + nx] > 96) return true;
    }
  }
  return false;
}

/** 알파 마스크에서 잉크가 있는 영역 (없으면 null) */
export function maskBounds(alpha, w, h, min = 8) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > min) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
