// 여백 자르기, 배경 합성, PNG 저장과 복사

/** 알파값이 있는 영역만 남기고 pad 비율만큼 여백을 붙인다. 비어 있으면 null */
export function trimCanvas(canvas, padRatio = 0.06) {
  const { width: w, height: h } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > 4) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const pad = Math.round(Math.max(cw, ch) * padRatio);
  const out = document.createElement('canvas');
  out.width = cw + pad * 2;
  out.height = ch + pad * 2;
  out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, pad, pad, cw, ch);
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
  const trimmed = trimCanvas(canvas);
  if (!trimmed) return null;
  return withBackground(trimmed, bg);
}
