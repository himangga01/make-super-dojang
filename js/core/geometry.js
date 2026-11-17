// 도장 글자 배치 계산 (DOM 없음)

/**
 * 글자 수와 배치 방식으로 격자(열, 행)를 정한다.
 * @param {number} n 글자 수
 * @param {'column'|'row'|'grid'} mode
 *   column: 세로 한 줄 (많으면 여러 열), row: 가로 한 줄, grid: 정사각에 가깝게
 */
export function gridFor(n, mode) {
  if (n <= 0) return { cols: 1, rows: 1 };
  if (mode === 'row') return { cols: n, rows: 1 };
  if (mode === 'column') {
    if (n <= 4) return { cols: 1, rows: n };
    const cols = Math.ceil(n / 4);
    return { cols, rows: Math.ceil(n / cols) };
  }
  // grid
  if (n === 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 1, rows: 2 };
  if (n === 3) return { cols: 1, rows: 3 };
  if (n === 4) return { cols: 2, rows: 2 };
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
}

/**
 * 격자 칸에 글자를 넣는 순서를 정한다.
 * @param {'horizontal'|'vertical'} order
 *   horizontal: 왼쪽→오른쪽, 위→아래
 *   vertical: 전통 세로쓰기. 오른쪽 열부터 위→아래
 * @returns {Array<{col:number,row:number}>} 글자 i가 들어갈 칸
 */
export function cellOrder(n, cols, rows, order) {
  const cells = [];
  if (order === 'vertical') {
    for (let c = cols - 1; c >= 0; c--) {
      for (let r = 0; r < rows; r++) cells.push({ col: c, row: r });
    }
  } else {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) cells.push({ col: c, row: r });
    }
  }
  return cells.slice(0, n);
}

/**
 * 반지름 a(가로), b(세로)인 타원 안에, 가로:세로 = ratio 인 가장 큰 사각형.
 * 사각형 꼭짓점 (a cosθ, b sinθ) 에서 2a cosθ / 2b sinθ = ratio → tanθ = a / (b·ratio)
 */
export function rectInEllipse(a, b, ratio) {
  const theta = Math.atan2(a, b * ratio);
  return { width: 2 * a * Math.cos(theta), height: 2 * b * Math.sin(theta) };
}

/**
 * 폭 w, 높이 h 영역 안에 비율 ratio 사각형을 최대 크기로 맞춘다.
 */
export function fitRatio(w, h, ratio) {
  if (w / h > ratio) return { width: h * ratio, height: h };
  return { width: w, height: w / ratio };
}

/**
 * 글자 경계 상자(gw×gh)를 칸(cw×ch)에 채우는 가로·세로 배율.
 * 가로세로 배율 차이를 [minAspect, maxAspect] 로 제한해 지나친 찌그러짐을 막는다.
 */
export function fillScale(gw, gh, cw, ch, minAspect = 0.6, maxAspect = 1.6) {
  if (gw <= 0 || gh <= 0) return { sx: 1, sy: 1 };
  let sx = cw / gw;
  let sy = ch / gh;
  const aspect = sx / sy;
  if (aspect > maxAspect) sx = sy * maxAspect;
  else if (aspect < minAspect) sy = sx / minAspect;
  // 제한 때문에 칸을 넘으면 같은 비율로 줄인다
  const over = Math.max((gw * sx) / cw, (gh * sy) / ch, 1);
  return { sx: sx / over, sy: sy / over };
}

/** 점이 볼록 다각형 안(경계 포함)에 있는지. 꼭짓점 순서는 시계·반시계 상관없다 */
export function pointInConvex(pt, poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * 원점 중심 볼록 다각형 안에 들어가는, 가로:세로 = ratio 인 가장 큰 사각형.
 * 반폭을 이분 탐색하며 네 꼭짓점이 모두 안에 있는지 확인한다.
 */
export function largestRectInPolygon(poly, ratio) {
  let hi = Math.max(...poly.map((p) => Math.hypot(p.x, p.y)));
  let lo = 0;
  for (let i = 0; i < 40; i++) {
    const s = (lo + hi) / 2;
    const hy = s / ratio;
    const ok = [[s, hy], [-s, hy], [s, -hy], [-s, -hy]].every(([x, y]) => pointInConvex({ x, y }, poly));
    if (ok) lo = s;
    else hi = s;
  }
  return { width: lo * 2, height: (lo * 2) / ratio };
}

/** 정다각형 꼭짓점 (반지름 a, b 로 늘린 모양). start 는 첫 꼭짓점 각도(라디안) */
export function polygonPoints(sides, a, b, start = 0) {
  return Array.from({ length: sides }, (_, i) => {
    const t = start + (i / sides) * Math.PI * 2;
    return { x: Math.cos(t) * a, y: Math.sin(t) * b };
  });
}
