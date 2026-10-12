// 규칙 엔진 — 화면과 무관한 순수 로직. 브라우저와 Node 양쪽에서 그대로 돈다.
//
// ★ 판은 두 덩어리로 나뉜다.
//   퍼즐(puzzle) — 판 크기·구조물·차량의 종류/방향/차선. 한 번 만들면 바뀌지 않는다.
//   위치(pos)    — 숫자 배열 하나. pos[i] = i번 차량이 길이 방향으로 차지한 칸 중 가장 작은 좌표
//                  (가로 차량은 x, 세로 차량은 y). EXITED면 판 밖으로 나간 차량이다.
//   움직이는 것이 숫자 배열 하나뿐이라 되돌리기는 배열을 복사해 두면 끝나고,
//   솔버는 배열을 그대로 문자열 키로 바꿔 방문 표시를 할 수 있다.
//
// 좌표: x는 왼쪽→오른쪽(0..size-1), y는 위→아래(0..size-1).
// 방향 부호(sign): +1 = 오른쪽/아래, -1 = 왼쪽/위. 차량은 자기 길이 방향으로만 움직인다.

export const EXITED = -1;

// 격자(grid) 칸 값 — EMPTY / BLOCK / (차량 번호 + 1)
export const EMPTY = 0;
export const BLOCK = -1;

// 경로가 판 끝까지 비어 있을 때 travel()이 돌려주는 값
export const OFF_BOARD = Infinity;

export const VEHICLE_LENGTH = Object.freeze({ car: 2, bus: 3 });

export const DIRECTIONS = Object.freeze({
  left: Object.freeze({ axis: 'h', sign: -1 }),
  right: Object.freeze({ axis: 'h', sign: +1 }),
  up: Object.freeze({ axis: 'v', sign: -1 }),
  down: Object.freeze({ axis: 'v', sign: +1 }),
});

export function dirName(axis, sign) {
  if (axis === 'h') return sign > 0 ? 'right' : 'left';
  return sign > 0 ? 'down' : 'up';
}

/**
 * 방향키 이름 → 그 차량을 밀 부호. 차량 길이 방향과 수직이면 0(움직일 수 없음).
 */
export function signForDir(vehicle, name) {
  const d = DIRECTIONS[name];
  return d && d.axis === vehicle.axis ? d.sign : 0;
}

/**
 * 판 정의 → 퍼즐.
 *   def = {
 *     size: 6,
 *     blocks: [[x, y], ...],                              // 고정 구조물 (1칸)
 *     vehicles: [{ kind: 'car'|'bus', x, y, front }],    // (x, y) = 차량이 덮는 칸 중 가장 왼쪽·위 칸
 *   }                                                      // front = 앞쪽 방향 'left'|'right'|'up'|'down'
 * 칸이 판 밖이거나 서로 겹치면 예외를 던진다 — 잘못된 판을 조용히 받아 두면 화면에서 차가 겹쳐 그려진다.
 */
export function createPuzzle(def) {
  const size = def.size;
  if (!Number.isInteger(size) || size < 2) {
    throw new Error(`판 크기가 올바르지 않습니다: ${size}`);
  }

  const occupied = new Int16Array(size * size);
  const blockGrid = new Uint8Array(size * size);
  const blocks = [];
  for (const b of def.blocks ?? []) {
    const [x, y] = Array.isArray(b) ? b : [b.x, b.y];
    assertInside(size, x, y, '구조물');
    const k = y * size + x;
    if (occupied[k] !== EMPTY) throw new Error(`구조물이 같은 칸에 두 번 놓였습니다: (${x}, ${y})`);
    occupied[k] = BLOCK;
    blockGrid[k] = 1;
    blocks.push(Object.freeze({ x, y }));
  }

  const vehicles = [];
  const start = [];
  (def.vehicles ?? []).forEach((v, i) => {
    const len = VEHICLE_LENGTH[v.kind];
    if (!len) throw new Error(`${i}번 차량의 종류를 알 수 없습니다: ${v.kind}`);
    const d = DIRECTIONS[v.front];
    if (!d) throw new Error(`${i}번 차량의 앞쪽 방향을 알 수 없습니다: ${v.front}`);

    for (let k = 0; k < len; k++) {
      const x = d.axis === 'h' ? v.x + k : v.x;
      const y = d.axis === 'h' ? v.y : v.y + k;
      assertInside(size, x, y, `${i}번 차량`);
      const c = y * size + x;
      if (occupied[c] !== EMPTY) {
        const what = occupied[c] === BLOCK ? '구조물' : `${occupied[c] - 1}번 차량`;
        throw new Error(`${i}번 차량이 ${what}과 (${x}, ${y})에서 겹칩니다`);
      }
      occupied[c] = i + 1;
    }

    vehicles.push(Object.freeze({
      id: i,
      kind: v.kind,
      len,
      axis: d.axis,
      lane: d.axis === 'h' ? v.y : v.x,   // 움직이지 않는 쪽 좌표 (가로 차량은 행, 세로 차량은 열)
      front: d.sign,                        // 앞쪽 부호
      frontDir: v.front,
      label: v.label ?? null,               // 글자 그림에서 온 이름 (디버그·테스트용)
    }));
    start.push(d.axis === 'h' ? v.x : v.y);
  });

  return Object.freeze({
    size,
    blocks: Object.freeze(blocks),
    blockGrid,
    vehicles: Object.freeze(vehicles),
    start: Object.freeze(start),
  });
}

function assertInside(size, x, y, what) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= size || y >= size) {
    throw new Error(`${what}이(가) 판 밖에 있습니다: (${x}, ${y}), 판 크기 ${size}`);
  }
}

/** i번 차량이 위치 p에 있을 때 덮는 칸들 */
export function vehicleCells(puzzle, i, p) {
  const v = puzzle.vehicles[i];
  const cells = [];
  for (let k = 0; k < v.len; k++) {
    cells.push(v.axis === 'h' ? { x: p + k, y: v.lane } : { x: v.lane, y: p + k });
  }
  return cells;
}

/**
 * 현재 위치로 칸 점유 격자를 만든다. 값: EMPTY / BLOCK / 차량 번호 + 1.
 * out을 넘기면 그 배열을 재사용한다(솔버가 상태마다 새로 만들지 않도록).
 */
export function buildGrid(puzzle, pos, out) {
  const { size, blockGrid, vehicles } = puzzle;
  const grid = out ?? new Int16Array(size * size);
  for (let k = 0; k < grid.length; k++) grid[k] = blockGrid[k] ? BLOCK : EMPTY;
  for (let i = 0; i < vehicles.length; i++) {
    const p = pos[i];
    if (p === EXITED) continue;
    const v = vehicles[i];
    if (v.axis === 'h') {
      const base = v.lane * size + p;
      for (let k = 0; k < v.len; k++) grid[base + k] = i + 1;
    } else {
      for (let k = 0; k < v.len; k++) grid[(p + k) * size + v.lane] = i + 1;
    }
  }
  return grid;
}

/**
 * i번 차량을 sign 방향으로 밀면 몇 칸 가는가 — 가장 가벼운 판정(솔버용).
 * 막히면 막힌 곳 바로 앞까지의 칸 수(0 이상), 판 끝까지 비어 있으면 OFF_BOARD.
 * 이미 나간 차량에는 부르지 말 것.
 */
export function travel(puzzle, grid, pos, i, sign) {
  const size = puzzle.size;
  const v = puzzle.vehicles[i];
  let c = sign > 0 ? pos[i] + v.len : pos[i] - 1;   // 앞머리 바로 다음 칸
  let dist = 0;
  if (v.axis === 'h') {
    const base = v.lane * size;
    while (c >= 0 && c < size) {
      if (grid[base + c] !== EMPTY) return dist;
      dist++;
      c += sign;
    }
  } else {
    while (c >= 0 && c < size) {
      if (grid[c * size + v.lane] !== EMPTY) return dist;
      dist++;
      c += sign;
    }
  }
  return OFF_BOARD;
}

/**
 * i번 차량을 sign 방향으로 밀었을 때의 결과. 상태는 바꾸지 않는다.
 *   moved   — 실제로 움직였는가. false면 흔들림 연출만 하고 이동 횟수에 넣지 않는다
 *   exits   — 판 밖으로 나가는가
 *   dist    — 판 안에서 움직인 칸 수 (나가는 경우 판 끝에 닿기까지의 칸 수 — 애니메이션용)
 *   to      — 도착 위치 (나가면 EXITED)
 *   blocker — 막은 칸 { x, y, vehicle } (vehicle은 차량 번호, 구조물이면 null). 나가면 null
 * 이미 나간 차량이면 null.
 */
export function getMove(puzzle, pos, i, sign, grid) {
  const from = pos[i];
  if (from === EXITED) return null;
  const g = grid ?? buildGrid(puzzle, pos);
  const v = puzzle.vehicles[i];
  const t = travel(puzzle, g, pos, i, sign);
  const exits = t === OFF_BOARD;
  const dist = exits ? (sign > 0 ? puzzle.size - (from + v.len) : from) : t;

  let blocker = null;
  if (!exits) {
    const c = sign > 0 ? from + v.len + dist : from - 1 - dist;
    const x = v.axis === 'h' ? c : v.lane;
    const y = v.axis === 'h' ? v.lane : c;
    const cell = g[y * puzzle.size + x];
    blocker = { x, y, vehicle: cell === BLOCK ? null : cell - 1 };
  }

  return {
    vehicle: i,
    sign,
    dir: dirName(v.axis, sign),
    from,
    to: exits ? EXITED : from + sign * dist,
    dist,
    exits,
    moved: exits || dist > 0,
    blocker,
  };
}

/** 이동을 적용한 새 위치 배열. 원본은 바꾸지 않는다. */
export function applyMove(pos, move) {
  const next = pos.slice();
  next[move.vehicle] = move.to;
  return next;
}

/** 지금 상태에서 가능한 모든 이동 (한 칸 이상 움직이거나 나가는 것만) */
export function listMoves(puzzle, pos, grid) {
  const g = grid ?? buildGrid(puzzle, pos);
  const moves = [];
  for (let i = 0; i < puzzle.vehicles.length; i++) {
    if (pos[i] === EXITED) continue;
    for (const sign of [-1, 1]) {
      const m = getMove(puzzle, pos, i, sign, g);
      if (m.moved) moves.push(m);
    }
  }
  return moves;
}

export function remainingCount(pos) {
  let n = 0;
  for (const p of pos) if (p !== EXITED) n++;
  return n;
}

export function isCleared(pos) {
  return remainingCount(pos) === 0;
}

/** 지금 한 번에 판 밖으로 나갈 수 있는 차량 번호들 */
export function exitableNow(puzzle, pos, grid) {
  const g = grid ?? buildGrid(puzzle, pos);
  const out = [];
  for (let i = 0; i < puzzle.vehicles.length; i++) {
    if (pos[i] === EXITED) continue;
    if (travel(puzzle, g, pos, i, -1) === OFF_BOARD || travel(puzzle, g, pos, i, 1) === OFF_BOARD) {
      out.push(i);
    }
  }
  return out;
}

export const StuckCheck = Object.freeze({
  OK: 'ok',            // 언젠가 나갈 수 있는 차량이 있다 (또는 이미 클리어)
  STUCK: 'stuck',      // 어떤 차량도, 어떤 순서로 움직여도 판 밖으로 나갈 수 없다
  UNKNOWN: 'unknown',  // 탐색 한도를 넘어 판정하지 못했다 — 막히지 않은 것으로 다룬다
});

/**
 * 막힘 판정 — "남은 차량 중 어느 것도 판 밖으로 나갈 방법이 없는가".
 *
 * ★ 글자 그대로의 기준이다. 판을 다 비울 수 없게 됐더라도 나갈 수 있는 차량이 하나라도 남아 있으면
 *   막힌 것이 아니다. 그래서 '나가기'는 탐색할 필요가 없다 — 어딘가에서 나갈 수 있는 차가 보이는 순간 답이 OK다.
 *   남은 것은 '미끄러지기'만으로 닿는 상태들을 전부 훑어, 그 어디에서도 나갈 차가 없음을 확인하는 일이다.
 *
 * ⚠️ 한 상태 안에서는 '나갈 차가 있는가'를 먼저 전부 보고 나서 다음 상태를 쌓는다.
 *   섞어서 하면 한도가 작을 때 바로 앞에 답이 있는데도 UNKNOWN을 낸다.
 */
export function checkStuck(puzzle, pos, { maxStates = 20000 } = {}) {
  if (isCleared(pos)) return StuckCheck.OK;

  const n = puzzle.vehicles.length;
  const grid = new Int16Array(puzzle.size * puzzle.size);
  const seen = new Set([pos.join(',')]);
  const queue = [pos];
  const slides = [];

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    buildGrid(puzzle, cur, grid);
    slides.length = 0;

    for (let i = 0; i < n; i++) {
      if (cur[i] === EXITED) continue;
      for (let s = -1; s <= 1; s += 2) {
        const t = travel(puzzle, grid, cur, i, s);
        if (t === OFF_BOARD) return StuckCheck.OK;
        if (t > 0) slides.push(i, cur[i] + s * t);
      }
    }

    for (let k = 0; k < slides.length; k += 2) {
      const next = cur.slice();
      next[slides[k]] = slides[k + 1];
      const key = next.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size > maxStates) return StuckCheck.UNKNOWN;
      queue.push(next);
    }
  }
  return StuckCheck.STUCK;
}
