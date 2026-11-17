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
