// 여백 자르기, 배경 합성, PNG 저장과 복사

// 이미 여백을 잘라 낸 캔버스. finalize 에서 다시 자르지 않는다 (고해상도 서명에서 한 번에 수백 ms 절약)
const trimmed = new WeakSet();

/** 알파값이 있는 영역만 남기고 pad 비율만큼 여백을 붙인다. 비어 있으면 null */
export function trimCanvas(canvas, padRatio = 0.06) {
  const { width: w, height: h } = canvas;
  if (!w || !h) return null;
  // 32비트 단위로 읽고, 위·아래 끝 줄을 찾은 뒤 그 사이에서만 좌우를 찾는다
  const px = new Uint32Array(canvas.getContext('2d').getImageData(0, 0, w, h).data.buffer);
  const opaque = (i) => (px[i] >>> 24) > 4; // 리틀 엔디언: 가장 높은 바이트가 알파
  let minY = -1;
  for (let y = 0; y < h && minY < 0; y++) for (let x = 0, i = y * w; x < w; x++, i++) if (opaque(i)) { minY = y; break; }
  if (minY < 0) return null;
  let maxY = minY;
  for (let y = h - 1; y > minY; y--) {
    let hit = false;
    for (let x = 0, i = y * w; x < w; x++, i++) if (opaque(i)) { hit = true; break; }
    if (hit) { maxY = y; break; }
  }
  let minX = w;
  let maxX = -1;
  for (let y = minY; y <= maxY; y++) {
    const row = y * w;
    for (let x = 0; x < minX; x++) if (opaque(row + x)) { minX = x; break; }
    for (let x = w - 1; x > maxX; x--) if (opaque(row + x)) { maxX = x; break; }
  }
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const pad = Math.round(Math.max(cw, ch) * padRatio);
  const out = document.createElement('canvas');
  out.width = cw + pad * 2;
  out.height = ch + pad * 2;
  out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, pad, pad, cw, ch);
  trimmed.add(out);
  return out;
}

/** bg 가 null 이면 투명 그대로, 색이면 배경을 칠한 새 캔버스 */
export function withBackground(canvas, bg) {
  if (!bg) return canvas;
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

export function toPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG 변환 실패'))), 'image/png');
  });
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  // 클릭 직후 링크를 지우면 일부 브라우저가 download 이름을 잃어버려 잠시 뒤에 정리한다
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 30_000);
}

export function canCopyImage() {
  return Boolean(window.isSecureContext && navigator.clipboard?.write && window.ClipboardItem);
}

/**
 * Safari 는 사용자가 누른 직후(같은 이벤트 안)에 clipboard.write 를 불러야 허용한다.
 * 그래서 PNG 를 다 만든 뒤가 아니라, 만드는 중인 Promise 를 ClipboardItem 에 바로 넘긴다.
 * @param {Promise<Blob>|Blob} blobOrPromise
 */
export function copyBlob(blobOrPromise) {
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': Promise.resolve(blobOrPromise) })]);
}

/** 렌더 결과를 최종 PNG 캔버스로 만든다 */
export function finalize(canvas, bg) {
  const out = trimmed.has(canvas) ? canvas : trimCanvas(canvas);
  if (!out) return null;
  if (out !== canvas) canvas.width = canvas.height = 0; // 잘라 내기 전 캔버스는 바로 놓아 준다
  return withBackground(out, bg);
}
