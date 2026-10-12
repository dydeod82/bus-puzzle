// 하드 모드 난이도 측정용 솔버 — "랜덤 이동·새 차량이 없다고 가정하면, 최소 몇 수로 리무진을 다 빼는가".
//
// ★ 판 전체(차 100대)를 탐색하면 너무 크다. 그래서 '관련 차량'만 움직여 본다:
//     리무진 → 리무진 통로를 막는 차 → 그 차가 움직이는 길을 막는 가장 가까운 차 → … (closureDepth 단계까지)
//   나머지 차는 구조물처럼 제자리에 둔다. 그래서 찾은 수순은 실제 게임에서도 그대로 둘 수 있는 수순이고(관련 없는 차를
//   안 움직였을 뿐), 길이는 진짜 최소의 상한이다. 관련 차량을 다 잡으면 진짜 최소다.
//
// ★ A* — 휴리스틱은 '리무진마다 쓸 통로를 하나씩 골랐을 때, 그 통로들을 지금 막고 있는 서로 다른 차의 수 + 남은 리무진 수'의
//   최솟값. 막는 차는 저마다 적어도 한 번은 움직여야 하고 리무진도 한 번씩 나가야 하므로 과대평가하지 않는다.
//
// ⚠️ 판 생성에 쓰는 상한은 '탐색한 상태 수'다 (maxNodes). 시간으로 끊으면 같은 시드라도 컴퓨터 빠르기에 따라
//    다른 판이 나와, 기록에서 시드로 같은 판을 다시 하는 기능이 깨진다. 시간 상한(timeLimitMs)은 분석 도구에서만 쓴다.

import { EXITED, EMPTY, BLOCK } from './rules.js';

export const HARD_SOLVER_DEFAULTS = Object.freeze({
  maxDepth: 40,          // 이보다 긴 수순은 찾지 않는다 (f = g + h가 넘으면 버린다)
  maxNodes: 120000,      // 펼쳐 볼 상태 수 상한 — 판 생성의 실제 상한 (이 PC에서 1초 안쪽)
  timeLimitMs: Infinity, // 분석 도구에서만 1000 — 판 생성에서 쓰면 시드 재현이 깨진다
  closureDepth: 4,       // 관련 차량을 몇 단계까지 따라가는가
});

function cellIndex(N, v, c) {
  return v.axis === 'h' ? v.lane * N + c : c * N + v.lane;
}

/**
 * 리무진의 두 통로(뒤 −1 / 앞 +1). 통로 = 리무진 앞머리 다음 칸부터 판 끝까지.
 * @returns [{ limo, sign, cells: 칸 번호들, blockers: 막는 차 번호들(가까운 순, 중복 없음), dead: 구조물이 있어 영영 못 쓴다 }]
 */
export function passageInfo(puzzle, pos, grid, limoId) {
  const v = puzzle.vehicles[limoId];
  const N = puzzle.size;
  return [-1, 1].map((sign) => {
    const cells = [];
    const blockers = [];
    let dead = false;
    if (pos[limoId] !== EXITED) {
      for (let c = sign > 0 ? pos[limoId] + v.len : pos[limoId] - 1; c >= 0 && c < N; c += sign) {
        const k = cellIndex(N, v, c);
        cells.push(k);
        const g = grid[k];
        if (g === BLOCK) dead = true;
        else if (g > 0 && !blockers.includes(g - 1)) blockers.push(g - 1);
      }
    }
    return { limo: limoId, sign, cells, blockers, dead };
  });
}

/**
 * 관련 차량 — seeds(리무진·통로를 막는 차)에서 시작해, 각 차가 앞뒤로 움직일 때 처음 부딪히는 차를 depth 단계까지 모은다.
 * @returns { ids: 관련 차 번호들, depthOf: Map(차 → 몇 단계에서 들어왔나) }
 */
export function relevantVehicles(puzzle, pos, grid, seeds, depth) {
  const N = puzzle.size;
  const depthOf = new Map(seeds.map((i) => [i, 0]));
  let frontier = seeds.slice();
  for (let d = 1; d <= depth && frontier.length > 0; d++) {
    const next = [];
    for (const i of frontier) {
      if (pos[i] === EXITED) continue;
      const v = puzzle.vehicles[i];
      for (let s = -1; s <= 1; s += 2) {
        for (let c = s > 0 ? pos[i] + v.len : pos[i] - 1; c >= 0 && c < N; c += s) {
          const g = grid[cellIndex(N, v, c)];
          if (g === EMPTY) continue;
          if (g > 0 && !depthOf.has(g - 1)) {
            depthOf.set(g - 1, d);
            next.push(g - 1);
          }
          break;
        }
      }
    }
    frontier = next;
  }
  return { ids: [...depthOf.keys()], depthOf };
}

/** 우선순위 큐 — f가 작은 것 먼저, 같으면 g가 큰 것(목표에 더 다가간 것) 먼저, 그다음 넣은 순서 */
class Heap {
  constructor() {
    this.a = [];
  }

  get size() {
    return this.a.length;
  }

  #less(x, y) {
    return x.f < y.f || (x.f === y.f && (x.g > y.g || (x.g === y.g && x.n < y.n)));
  }

  push(e) {
    const a = this.a;
    a.push(e);
    for (let k = a.length - 1; k > 0;) {
      const p = (k - 1) >> 1;
      if (!this.#less(a[k], a[p])) break;
      [a[k], a[p]] = [a[p], a[k]];
      k = p;
    }
  }

  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      for (let k = 0; ;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && this.#less(a[l], a[m])) m = l;
        if (r < a.length && this.#less(a[r], a[m])) m = r;
        if (m === k) break;
        [a[k], a[m]] = [a[m], a[k]];
        k = m;
      }
    }
    return top;
  }
}

/**
 * 관련 차량만 움직이는 A*. goal·heuristic은 (pos, grid)를 받는다 — pos는 판 전체 위치 배열(관련 없는 차는 늘 제자리).
 * @returns {{ solved, length, moves, explored, relevant, reason?, ms }}
 *   reason: 'depth'(상한 안에 답이 없다) · 'nodes'(상태 수 상한) · 'time'(시간 상한) · 'impossible'(휴리스틱이 무한대)
 */
export function searchHard(puzzle, startPos, relIds, goal, heuristic, opts = {}) {
  const o = { ...HARD_SOLVER_DEFAULTS, ...opts };
  const t0 = Date.now();
  const N = puzzle.size;
  const rel = relIds.slice();
  const R = rel.length;
  const isRel = new Uint8Array(puzzle.vehicles.length);
  for (const i of rel) isRel[i] = 1;

  // 움직이지 않는 것: 구조물 + 관련 없는 차
  const base = new Int16Array(N * N);
  for (const b of puzzle.blocks) base[b.y * N + b.x] = BLOCK;
  puzzle.vehicles.forEach((v, i) => {
    if (isRel[i] || startPos[i] === EXITED) return;
    for (let k = 0; k < v.len; k++) base[cellIndex(N, v, startPos[i] + k)] = i + 1;
  });
  // 상태 = 관련 차들의 위치만 (Int8Array). 판 전체 위치(work)는 하나를 두고 필요할 때 덮어쓴다 — 상태마다 102칸 배열을
  // 들고 있으면 12만 상태에 100MB가 넘는다
  const work = Array.from(startPos);
  const load = (st) => {
    for (let k = 0; k < R; k++) work[rel[k]] = st[k];
    return work;
  };
  const grid = new Int16Array(N * N);
  const fillGrid = (st) => {
    grid.set(base);
    for (let k = 0; k < R; k++) {
      const p = st[k];
      if (p === EXITED) continue;
      const v = puzzle.vehicles[rel[k]];
      for (let j = 0; j < v.len; j++) grid[cellIndex(N, v, p + j)] = rel[k] + 1;
    }
    return grid;
  };
  const keyOf = (st) => String.fromCharCode(...st.map((p) => p + 2));

  const start = Int8Array.from(rel.map((i) => startPos[i]));
  fillGrid(start);
  if (goal(load(start), grid)) return { solved: true, length: 0, moves: [], explored: 0, relevant: R, ms: Date.now() - t0 };
  const h0 = heuristic(load(start), grid);
  if (!Number.isFinite(h0)) return { solved: false, reason: 'impossible', explored: 0, relevant: R, ms: Date.now() - t0 };

  const best = new Map([[keyOf(start), 0]]);
  const open = new Heap();
  let counter = 0;
  open.push({ st: start, g: 0, f: h0, n: counter++, parent: null, move: null });
  let explored = 0;

  while (open.size > 0) {
    const node = open.pop();
    if (best.get(keyOf(node.st)) < node.g) continue;   // 더 짧은 길로 이미 왔다
    explored++;
    if (explored > o.maxNodes) return { solved: false, reason: 'nodes', explored, relevant: R, ms: Date.now() - t0 };
    if ((explored & 1023) === 0 && Date.now() - t0 > o.timeLimitMs) {
      return { solved: false, reason: 'time', explored, relevant: R, ms: Date.now() - t0 };
    }

    fillGrid(node.st);
    const moves = [];
    for (let k = 0; k < R; k++) {
      const p = node.st[k];
      if (p === EXITED) continue;
      const v = puzzle.vehicles[rel[k]];
      for (let s = -1; s <= 1; s += 2) {
        let dist = 0;
        let exits = true;
        for (let c = s > 0 ? p + v.len : p - 1; c >= 0 && c < N; c += s) {
          if (grid[cellIndex(N, v, c)] !== EMPTY) {
            exits = false;
            break;
          }
          dist++;
        }
        if (exits || dist > 0) moves.push({ k, sign: s, to: exits ? EXITED : p + s * dist });
      }
    }

    for (const m of moves) {
      const next = Int8Array.from(node.st);
      next[m.k] = m.to;
      const g = node.g + 1;
      const key = keyOf(next);
      const prev = best.get(key);
      if (prev !== undefined && prev <= g) continue;
      fillGrid(next);
      const full = load(next);
      const move = { vehicle: rel[m.k], sign: m.sign };
      if (goal(full, grid)) {
        const path = [move];
        for (let q = node; q.parent; q = q.parent) path.push(q.move);
        path.reverse();
        return { solved: true, length: g, moves: path, explored, relevant: R, ms: Date.now() - t0 };
      }
      const h = heuristic(full, grid);
      if (!Number.isFinite(h) || g + h > o.maxDepth) continue;
      best.set(key, g);
      open.push({ st: next, g, f: g + h, n: counter++, parent: node, move });
    }
  }
  return { solved: false, reason: 'depth', explored, relevant: R, ms: Date.now() - t0 };
}

// ── 목표별 묶음 ──────────────────────────────────────────

function buildFullGrid(puzzle, pos) {
  const N = puzzle.size;
  const grid = new Int16Array(N * N);
  for (const b of puzzle.blocks) grid[b.y * N + b.x] = BLOCK;
  puzzle.vehicles.forEach((v, i) => {
    if (pos[i] === EXITED) return;
    for (let k = 0; k < v.len; k++) grid[cellIndex(N, v, pos[i] + k)] = i + 1;
  });
  return grid;
}

/** 리무진 통로를 막는 차들 (살아 있는 통로만) — 관련 차량을 모으는 출발점 */
function passageSeeds(puzzle, pos, grid, limoIds) {
  const seeds = new Set(limoIds.filter((i) => pos[i] !== EXITED));
  for (const l of limoIds) {
    for (const ps of passageInfo(puzzle, pos, grid, l)) if (!ps.dead) ps.blockers.forEach((b) => seeds.add(b));
  }
  return [...seeds];
}

/**
 * 리무진을 모두 빼는 최소 수 (랜덤 이동·새 차량 없음).
 * @returns searchHard 결과 + { relevantDepth: 관련 차량이 몇 단계까지 퍼졌나 }
 */
export function minEscapeMoves(puzzle, pos, limoIds, opts = {}) {
  const o = { ...HARD_SOLVER_DEFAULTS, ...opts };
  const grid0 = buildFullGrid(puzzle, pos);
  const { ids, depthOf } = relevantVehicles(puzzle, pos, grid0, passageSeeds(puzzle, pos, grid0, limoIds), o.closureDepth);

  const heuristic = (p, g) => {
    // 리무진마다 살아 있는 통로들의 '막는 차' 집합
    const options = [];
    for (const l of limoIds) {
      if (p[l] === EXITED) continue;
      const alive = passageInfo(puzzle, p, g, l).filter((ps) => !ps.dead).map((ps) => ps.blockers);
      if (alive.length === 0) return Infinity;
      options.push(alive);
    }
    if (options.length === 0) return 0;
    // 통로 조합마다 서로 다른 막는 차 수 — 그중 가장 작은 것
    let bestCount = Infinity;
    const walk = (k, acc) => {
      if (k === options.length) {
        bestCount = Math.min(bestCount, acc.size);
        return;
      }
      for (const b of options[k]) walk(k + 1, new Set([...acc, ...b]));
    };
    walk(0, new Set());
    return bestCount + options.length;
  };
  const goal = (p) => limoIds.every((l) => p[l] === EXITED);
  const r = searchHard(puzzle, pos, ids, goal, heuristic, o);
  return { ...r, relevantDepth: Math.max(0, ...depthOf.values()) };
}

/**
 * 리무진 한 대가 안전구역을 벗어나는 최소 수 — 리무진의 두 칸이 모두 안전구역 밖이거나 판 밖이면 벗어난 것.
 * @param inSafe (x, y) → 안전구역인가
 */
export function minLeaveSafeMoves(puzzle, pos, limoId, inSafe, opts = {}) {
  const o = { ...HARD_SOLVER_DEFAULTS, ...opts };
  const N = puzzle.size;
  const v = puzzle.vehicles[limoId];
  const outside = (p) => {
    if (p[limoId] === EXITED) return true;
    for (let k = 0; k < v.len; k++) {
      const idx = cellIndex(N, v, p[limoId] + k);
      if (inSafe(idx % N, Math.floor(idx / N))) return false;
    }
    return true;
  };
  const grid0 = buildFullGrid(puzzle, pos);
  const { ids } = relevantVehicles(puzzle, pos, grid0, passageSeeds(puzzle, pos, grid0, [limoId]), o.closureDepth);
  // 휴리스틱: 리무진이 안전구역 밖까지 가는 데 지나갈 칸(경계까지 + 몸길이)을 막는 차 수 + 1
  const heuristic = (p, g) => {
    let bestCount = Infinity;
    for (const ps of passageInfo(puzzle, p, g, limoId)) {
      let need = 0;
      while (need < ps.cells.length) {
        const idx = ps.cells[need];
        need++;
        if (!inSafe(idx % N, Math.floor(idx / N))) break;   // 경계를 막 넘은 칸
      }
      const span = ps.cells.slice(0, Math.min(ps.cells.length, need + v.len - 1));
      if (span.some((k) => g[k] === BLOCK)) continue;
      const blockers = new Set(span.map((k) => g[k]).filter((x) => x > 0));
      bestCount = Math.min(bestCount, blockers.size);
    }
    return bestCount + 1;
  };
  return searchHard(puzzle, pos, ids, outside, heuristic, o);
}

/**
 * 통로 하나를 비우는 최소 수 (리무진은 움직이지 않는다) — 분석용.
 * @param passage passageInfo의 한 항목
 */
export function minClearPassageMoves(puzzle, pos, passage, opts = {}) {
  const o = { ...HARD_SOLVER_DEFAULTS, ...opts };
  const grid0 = buildFullGrid(puzzle, pos);
  const { ids } = relevantVehicles(puzzle, pos, grid0, passage.blockers, o.closureDepth);
  const cells = passage.cells;
  const clear = (p, g) => cells.every((k) => g[k] <= 0);
  const heuristic = (p, g) => (cells.some((k) => g[k] === BLOCK) ? Infinity : new Set(cells.map((k) => g[k]).filter((x) => x > 0)).size);
  return searchHard(puzzle, pos, ids.filter((i) => i !== passage.limo), clear, heuristic, o);
}

export { buildFullGrid };
