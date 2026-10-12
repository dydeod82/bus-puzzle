// 판 생성기 — 풀 수 있는 판만 만든다.
//
// ★ 역방향으로 짓는다. 빈 판에서 시작해 '정답 수순을 거꾸로' 한 수씩 둔다.
//   - 들여보내기 (= 나가기의 역): 판 가장자리에서 차선을 따라 빈칸이 이어진 곳에 차를 세운다.
//     앞으로 돌리면 그 차는 같은 길로 나갈 수 있다.
//   - 끌어오기 (= 밀어 두기의 역): 앞이 막힌 차를 반대쪽으로 끌어 온다.
//     앞으로 돌리면 그 차를 밀었을 때 정확히 원래 자리(막힌 곳 바로 앞)에 멈춘다.
//   각 단계가 앞으로도 성립하는 이동이므로 지은 판은 언제나 풀린다.
//
// ★ '밀어 두기가 꼭 필요한' 판은 아무렇게나 지어서는 거의 안 나온다 (무작위 판 수백 개를 풀어 봤지만
//   하나도 없었다 — 나갈 수 있는 차를 계속 내보내면 바깥부터 줄줄이 풀린다).
//   밀어 두기가 꼭 필요하려면 차들이 서로의 앞을 막는 '고리'가 있어야 하고, 가장 작은 고리가 바람개비 4대다.
//       . A A B        A는 B에, B는 C에, C는 D에, D는 A에 막혀 있고
//       . D . B        바깥쪽은 구조물(#)이 막는다 — 누구도 그냥은 못 나간다.
//       . D C C        한 대(열쇠)만 바깥쪽에 빈칸이 있어서, 그 차를 밀어 두면 고리가 풀린다.
//   그래서 고리를 일부러 끼워 넣는다. 고리 하나마다 밀어 두기가 최소 한 번 필요하다는 것이 증명되므로
//   '고리 수'가 곧 최소 밀어 두기 수의 하한이 된다. 솔버가 그만큼으로 풀면 그 수순이 진짜 최소다.
//
// ★ 그냥 지으면 대부분의 차가 처음부터 나갈 수 있는 판이 된다. 그래서 들여보낼 자리 후보를 여러 개 견줘
//   "지금 나갈 수 있는 차를 가장 많이 가로막는" 곳을 고르고, 마지막에 끌어오기로 한 번 더 가린다.
//
// ⚠️ 구조물은 '지금까지 어떤 차도 지나가거나 서 있던 적이 없는 칸'(touched = 0)에만 새로 놓는다.
//   구조물은 처음부터 끝까지 있으므로, 앞으로 돌렸을 때 나중에 지나갈 길에 놓으면 그 수가 막힌다.
//
// ⚠️ 같은 시드 → 같은 판. 난수는 전부 시드 난수 하나에서만 뽑고, 솔버 한도도 시간이 아니라 상태 수다.

import { createRng } from './random.js';
import { createPuzzle, EMPTY, BLOCK, EXITED, VEHICLE_LENGTH } from './rules.js';
import { solve } from './solver.js';

/** 생성 규칙을 바꾸면 올릴 것 — 저장해 둔 판 캐시가 이 값으로 무효가 된다 */
export const GENERATOR_VERSION = 2;

const DEFAULTS = Object.freeze({
  size: 6,
  cars: 4,
  buses: 1,
  blocks: 0,
  minSlides: 0,        // 정답 수순에 '밀어 두기'가 최소 이만큼 (난이도 하한)
  maxSlides: 99,       // 상한 (너무 꼬인 판 방지)
  loops: null,         // 끼워 넣을 고리 수 (기본: minSlides)
  maxExitable: 3,      // 시작하자마자 바로 나갈 수 있는 차량 수 상한
  repairPulls: 20,     // 바로 나갈 수 있는 차가 상한을 넘을 때 더 가려 볼 끌어오기 횟수
  attempts: 40,        // 조건에 맞는 판을 찾을 때까지 지어 볼 횟수
  candidates: 120,     // 들여보내기 한 번에 견줘 볼 자리 후보 수 (들어갈 수 있는 자리가 더 적으면 전부)
  loopTries: 4000,     // 고리 하나를 놓을 자리(모양·방향·위치 조합)를 견줘 볼 최대 수
  solverLimit: 20000,  // 솔버 탐색 한도 (상태 수)
  // 하드 모드용 — 일반 판에서는 모두 0/'all'이라 짓는 방식이 그대로다
  safeSize: 0,         // 판 정중앙에 비워 둘 정사각형(안전구역) 크기. 일반 차량·구조물은 이 밖에만 놓는다
  limos: 0,            // 안전구역 안에 놓을 리무진 수 (가장 먼저 들여보낸다 = 앞으로 돌리면 가장 나중에 나간다)
  goal: 'all',         // 'all' = 판을 다 비울 수 있어야 한다, 'limo' = 리무진만 다 빼낼 수 있으면 된다
  pack: false,         // true = 빽빽한 판용 — 안쪽 고리부터, 앞이 막힐 때까지 깊이 밀어 넣는다 (아래 insert 설명)
  blockDepth: null,    // [최소, 최대] — 구조물을 놓을 고리 범위 (가장자리 = 0). null이면 아무 데나
});

const BLOCKS_RESERVED_PER_LOOP = 4;

export function normalizeParams(params) {
  const p = { ...DEFAULTS, ...params };
  if (p.loops == null) p.loops = p.minSlides;
  return p;
}

/**
 * @returns {{ def, par, slides, optimal, solution, exitableAtStart, attempts, met }}
 *   def      — createPuzzle에 넘길 판 정의
 *   par      — 목표 이동 수 (솔버가 찾은 수순의 길이)
 *   optimal  — par가 최소임이 증명됐는가 (솔버의 밀어 두기 수 = 고리 수)
 *   met      — 난이도 조건을 모두 맞췄는가 (못 맞추면 가장 가까운 판을 돌려준다)
 * 차량이 너무 많아 한 번도 다 세우지 못하면 예외를 던진다.
 */
export function generatePuzzle(params, seed) {
  const base = normalizeParams(params);
  // 고리를 다 못 넣는 조건(작은 판에 차가 빽빽한 자유 모드 등)이면 고리를 하나씩 줄여 가며 다시 짓는다
  for (let loops = base.loops; loops >= 0; loops--) {
    const result = generateWith({ ...base, loops }, seed);
    if (result) return result;
  }
  throw new Error('판을 만들지 못했어요 — 차량이나 구조물 수를 줄여 보세요.');
}

function generateWith(p, seed) {
  const rng = createRng(seed);
  let best = null;

  for (let attempt = 1; attempt <= p.attempts; attempt++) {
    const st = build(p, rng);
    if (!st) continue;

    const def = toDef(st, rng);
    const puzzle = createPuzzle(def);
    // 하드 모드: "랜덤 이동이 없다면 리무진을 모두 뺄 수 있는가"를 본다
    const limoIds = puzzle.vehicles.filter((v) => v.kind === 'limo').map((v) => v.id);
    const goal = p.goal === 'limo' && limoIds.length > 0 ? (pos) => limoIds.every((i) => pos[i] === EXITED) : null;
    let result = solve(puzzle, puzzle.start, { maxStates: p.solverLimit, goal });
    if (!result.solved) continue;
    if (result.slides > st.loops) {
      // 고리 수보다 많이 밀었다 — 밀어 두기 횟수 순으로 다시 훑어 더 짧은 수순이 있는지 본다
      const exact = solve(puzzle, puzzle.start, { maxStates: p.solverLimit, guided: false, goal });
      if (exact.solved && exact.slides < result.slides) result = exact;
    }

    const exitable = countExitable(st);
    const candidate = {
      def,
      par: result.length,
      slides: result.slides,
      optimal: result.slides === st.loops,
      solution: result.moves,
      exitableAtStart: exitable,
      attempts: attempt,
      met: exitable <= p.maxExitable && result.slides >= p.minSlides && result.slides <= p.maxSlides,
    };
    if (candidate.met) return candidate;
    if (!best || closeness(candidate, p) < closeness(best, p)) best = candidate;
  }
  return best;
}

/** 조건에서 얼마나 벗어났는가 (작을수록 좋음) */
function closeness(c, p) {
  const slideMiss = c.slides < p.minSlides ? p.minSlides - c.slides : Math.max(0, c.slides - p.maxSlides);
  return slideMiss * 2 + Math.max(0, c.exitableAtStart - p.maxExitable);
}

// ── 짓는 상태 ──────────────────────────────────────────────
//   grid    칸 점유 (EMPTY / BLOCK / 차량 번호 + 1)
//   touched 지금까지 차가 서 있거나 지나간 적이 있는 칸 — 새 구조물을 놓을 수 없다
//   vs      차량 { kind, len, axis, lane, p }

function cellIdx(N, axis, lane, c) {
  return axis === 'h' ? lane * N + c : c * N + lane;
}

function fill(st, i, value) {
  const v = st.vs[i];
  for (let k = 0; k < v.len; k++) st.grid[cellIdx(st.N, v.axis, v.lane, v.p + k)] = value;
}

function touchVehicle(st, v) {
  for (let k = 0; k < v.len; k++) st.touched[cellIdx(st.N, v.axis, v.lane, v.p + k)] = 1;
}

/** v가 sign 쪽으로 나갈 때 지나는 칸들을 touched로 표시 */
function touchPath(st, v, sign) {
  const { N } = st;
  for (let c = sign > 0 ? v.p + v.len : v.p - 1; c >= 0 && c < N; c += sign) {
    st.touched[cellIdx(N, v.axis, v.lane, c)] = 1;
  }
}

function placeBlock(st, k) {
  st.grid[k] = BLOCK;
  st.blocks.push([k % st.N, Math.floor(k / st.N)]);
  st.blockBudget--;
}

/** v의 sign 쪽 경로가 판 끝까지 비어 있는가 */
function pathClear(N, grid, v, sign) {
  for (let c = sign > 0 ? v.p + v.len : v.p - 1; c >= 0 && c < N; c += sign) {
    if (grid[cellIdx(N, v.axis, v.lane, c)] !== EMPTY) return false;
  }
  return true;
}

function countExitable(st) {
  let n = 0;
  for (const v of st.vs) if (pathClear(st.N, st.grid, v, -1) || pathClear(st.N, st.grid, v, +1)) n++;
  return n;
}

function build(p, rng) {
  const N = p.size;
  const st = {
    N,
    grid: new Int16Array(N * N),
    touched: new Uint8Array(N * N),
    vs: [],
    blocks: [],
    blockBudget: p.blocks,
    loops: 0,
    center: p.safeSize > 0 ? centerSquare(N, p.safeSize) : null,   // 안전구역 { lo, hi } — 일반 차량·구조물을 놓지 않는다
  };

  // 처음 구조물 — 고리용으로 몇 개는 남겨 둔다 (남으면 마지막에 빈 곳에 놓는다)
  const initial = Math.max(0, p.blocks - BLOCKS_RESERVED_PER_LOOP * p.loops);
  // 안전구역의 리무진 — 빈 판일 때 가장 먼저 들여보낸다 (앞으로 돌리면 가장 나중에 나가는 차).
  // ★ 구조물보다 먼저 둔다 — 리무진이 나갈 길은 touched가 되어 구조물이 그 위에 놓이지 않는다 (구조물 벽의 '문'이 된다)
  for (let k = 0; k < p.limos; k++) {
    if (!insert(st, 'limo', rng, p.candidates, 'center', false)) return null;
  }

  const ringOf = (k) => Math.min(k % N, Math.floor(k / N), N - 1 - (k % N), N - 1 - Math.floor(k / N));
  const blockCells = [...Array(N * N).keys()].filter((k) => !inCenter(st, k % N, Math.floor(k / N))
    && !st.touched[k]
    && (!p.blockDepth || (ringOf(k) >= p.blockDepth[0] && ringOf(k) <= p.blockDepth[1])));
  for (const k of rng.shuffle(blockCells).slice(0, initial)) placeBlock(st, k);

  const pool = { car: p.cars, bus: p.buses };
  const total = p.cars + p.buses;

  // 고리를 끼울 때 — 고리는 네 방향 가장자리로 길이 트여 있어야 해서 판이 덜 찼을 때 넣는다
  const loopAt = Array.from({ length: p.loops }, () => rng.range(0, Math.floor(total * 0.15)))
    .sort((a, b) => a - b);

  let placed = 0;
  let li = 0;
  let loopMisses = 0;
  while (pool.car + pool.bus > 0) {
    // 예정된 고리부터. 판이 찰수록 넣기 어려워지므로 두어 번 놓치면 이 판은 버리고 새로 짓는다
    if (li < loopAt.length && placed >= loopAt[li]) {
      if (tryLoop(st, rng, pool, p)) {
        placed += 4;
        li++;
        loopMisses = 0;
        continue;
      }
      if (++loopMisses > 2) return null;
    }

    // 버스는 긴 빈 줄이 필요하므로 앞쪽에서 더 자주 뽑는다
    const busShare = pool.bus / (pool.car + pool.bus);
    // 빽빽한 판은 버스(3칸)를 먼저 다 넣는다 — 3칸 빈 줄은 판이 찰수록 금방 사라진다
    const kind = p.pack
      ? (pool.bus > 0 ? 'bus' : 'car')
      : pool.bus > 0 && (pool.car === 0 || rng.next() < Math.min(1, busShare * 1.4)) ? 'bus' : 'car';
    if (insert(st, kind, rng, p.candidates, st.center ? 'outer' : null, p.pack)) {
      pool[kind]--;
      placed++;
      continue;
    }
    // 빽빽한 판: 버스가 들어갈 3칸 줄이 없으면 자동차를 먼저 (끝까지 못 넣으면 그때 실패)
    const other = kind === 'bus' ? 'car' : 'bus';
    if (!p.pack || pool[other] === 0 || !insert(st, other, rng, p.candidates, st.center ? 'outer' : null, true)) return null;
    pool[other]--;
    placed++;
  }

  // 처음부터 나갈 수 있는 차가 너무 많으면 끌어오기로 더 가린다
  for (let r = 0; r < p.repairPulls && countExitable(st) > p.maxExitable; r++) {
    if (!pull(st, rng)) break;
  }

  // 남은 구조물 — 아무도 지나간 적 없는 빈칸에만
  const free = [];
  for (let k = 0; k < N * N; k++) {
    if (st.grid[k] === EMPTY && !st.touched[k] && !inCenter(st, k % N, Math.floor(k / N))) free.push(k);
  }
  for (const k of rng.shuffle(free).slice(0, Math.max(0, st.blockBudget))) placeBlock(st, k);

  return st;
}

/** 그 들어오는 쪽 가장자리에서부터 비어 있는 칸 수 */
function fromLowFree(st, o) {
  const { N, grid } = st;
  let free = 0;
  if (o.fromLow) {
    for (let c = 0; c < N && grid[cellIdx(N, o.axis, o.lane, c)] === EMPTY; c++) free++;
  } else {
    for (let c = N - 1; c >= 0 && grid[cellIdx(N, o.axis, o.lane, c)] === EMPTY; c--) free++;
  }
  return free;
}

function centerSquare(N, size) {
  const lo = Math.floor((N - size) / 2);
  return { lo, hi: lo + size - 1 };
}

function inCenter(st, x, y) {
  const c = st.center;
  return !!c && x >= c.lo && x <= c.hi && y >= c.lo && y <= c.hi;
}

/** 차가 놓일 칸들이 구역 조건을 맞추는가 — 'center' 전부 안전구역 안 / 'outer' 하나도 안 걸침 / null 아무 데나 */
function fitsRegion(st, axis, lane, pos, len, region) {
  if (!region) return true;
  for (let k = 0; k < len; k++) {
    const x = axis === 'h' ? pos + k : lane;
    const y = axis === 'h' ? lane : pos + k;
    if (inCenter(st, x, y) !== (region === 'center')) return false;
  }
  return true;
}

/**
 * 들여보내기 — 들어갈 수 있는 자리를 전부 늘어놓고(많으면 일부만) 견줘, 가장 많이 가로막는 곳에 세운다.
 * ⚠️ 무작위로 몇 자리만 찍어 보면 판 끝물에 '지금 나갈 수 있는 차를 가리는 자리'를 거의 못 찾는다
 * @param region 'center' | 'outer' | null — 하드 모드의 안전구역 안/밖 (fitsRegion)
 * @param pack   빽빽한 판(하드 모드)용 채우기.
 *   ★ 칸의 90%를 채우려면 '안에서 밖으로' 채워야 한다. 들여보내는 차는 가장자리에서 그 자리까지 길이 트여 있어야 하므로,
 *     바깥을 먼저 막아 버리면 안쪽 빈칸은 영영 못 채운다. 그래서 판 가장자리에서 가장 먼(가장 안쪽 고리) 자리부터,
 *     앞이 막힐 때까지 바짝 밀어 넣는다(빈칸을 사이에 남기지 않는다). 무작위로 견주던 방식은 100대에서 이미 반 넘게 실패했다
 */
function insert(st, kind, rng, candidates, region = null, pack = false) {
  const { N, grid } = st;
  const len = VEHICLE_LENGTH[kind];
  const before = countExitable(st);
  let best = null;

  const options = [];
  for (const axis of ['h', 'v']) {
    for (let lane = 0; lane < N; lane++) {
      for (const fromLow of [true, false]) {   // 왼쪽·위 가장자리에서 들어오는가
        let free = 0;
        if (fromLow) {
          for (let c = 0; c < N && grid[cellIdx(N, axis, lane, c)] === EMPTY; c++) free++;
        } else {
          for (let c = N - 1; c >= 0 && grid[cellIdx(N, axis, lane, c)] === EMPTY; c--) free++;
        }
        for (let gap = 0; gap <= free - len; gap++) {
          if (fitsRegion(st, axis, lane, fromLow ? gap : N - len - gap, len, region)) options.push({ axis, lane, fromLow, gap });
        }
      }
    }
  }
  rng.shuffle(options);

  if (pack) {
    let pick = null;
    for (const o of options) {
      const pos = o.fromLow ? o.gap : N - len - o.gap;
      // 차가 차지할 칸들 중 가장자리에 가장 가까운 칸의 깊이 (고리 번호)
      let depth = Infinity;
      for (let k = 0; k < len; k++) {
        const x = o.axis === 'h' ? pos + k : o.lane;
        const y = o.axis === 'h' ? o.lane : pos + k;
        depth = Math.min(depth, x, y, N - 1 - x, N - 1 - y);
      }
      const inner = fromLowFree(st, o) - len === o.gap;   // 안쪽 끝이 무언가에 붙었다 (사이 빈칸 없음)
      const score = depth * 4 + (inner ? 2 : 0) + rng.next();
      if (!pick || score > pick.score) pick = { ...o, pos, score };
    }
    if (!pick) return false;
    const i = st.vs.length;
    const v = { kind, len, axis: pick.axis, lane: pick.lane, p: pick.pos };
    st.vs.push(v);
    fill(st, i, i + 1);
    touchVehicle(st, v);
    touchPath(st, v, pick.fromLow ? -1 : +1);
    return true;
  }

  for (const { axis, lane, fromLow, gap } of options.slice(0, candidates)) {
    const pos = fromLow ? gap : N - len - gap;
    const i = st.vs.length;
    st.vs.push({ kind, len, axis, lane, p: pos });
    fill(st, i, i + 1);
    const after = countExitable(st);
    fill(st, i, EMPTY);
    st.vs.pop();

    // 가장자리에 딱 붙인 차는 그쪽으로 언제나 나갈 수 있어 나중에 가릴 방법이 없다 → 감점
    const score = -3 * (after - before) - (gap === 0 ? 2 : 0) + rng.next() * 1.5;
    if (!best || score > best.score) best = { axis, lane, pos, fromLow, score };
  }

  if (!best) return false;
  const i = st.vs.length;
  const v = { kind, len, axis: best.axis, lane: best.lane, p: best.pos };
  st.vs.push(v);
  fill(st, i, i + 1);
  touchVehicle(st, v);
  touchPath(st, v, best.fromLow ? -1 : +1);
  return true;
}

/**
 * 끌어오기 — 앞이 막힌 차를 반대쪽으로 끌어 와 '지금 바로 나갈 수 있는 차'를 줄인다.
 * 끌어 온 자리에서 그 차가 반대쪽으로 바로 나갈 수 있으면 의미가 없으므로 후보에서 뺀다.
 */
function pull(st, rng) {
  const { N, grid, vs } = st;
  const options = [];
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i];
    if (v.kind === 'limo') continue;   // 리무진은 안전구역에 둔 그대로
    for (let d = -1; d <= 1; d += 2) {
      const beyond = d > 0 ? v.p + v.len : v.p - 1;
      if (beyond < 0 || beyond >= N || grid[cellIdx(N, v.axis, v.lane, beyond)] === EMPTY) continue;

      let free = 0;
      let reachesEdge = true;
      for (let c = d > 0 ? v.p - 1 : v.p + v.len; c >= 0 && c < N; c -= d) {
        if (grid[cellIdx(N, v.axis, v.lane, c)] !== EMPTY) { reachesEdge = false; break; }
        free++;
      }
      if (reachesEdge) continue;
      for (let k = 1; k <= free; k++) {
        const pos = v.p - d * k;
        if (fitsRegion(st, v.axis, v.lane, pos, v.len, st.center ? 'outer' : null)) options.push({ i, pos });
      }
    }
  }
  if (options.length === 0) return false;

  const before = countExitable(st);
  let best = null;
  for (const o of options) {
    const v = vs[o.i];
    const orig = v.p;
    fill(st, o.i, EMPTY);
    v.p = o.pos;
    fill(st, o.i, o.i + 1);
    const after = countExitable(st);
    fill(st, o.i, EMPTY);
    v.p = orig;
    fill(st, o.i, o.i + 1);
    if (after >= before) continue;
    const score = -3 * (after - before) + rng.next();
    if (!best || score > best.score) best = { ...o, score };
  }
  if (!best) return false;

  // 앞으로 돌리면 이 차가 원래 자리까지 미끄러져 간다 — 지나는 칸 전부를 touched로
  const v = vs[best.i];
  const lo = Math.min(v.p, best.pos);
  const hi = Math.max(v.p, best.pos) + v.len;
  for (let c = lo; c < hi; c++) st.touched[cellIdx(N, v.axis, v.lane, c)] = 1;
  fill(st, best.i, EMPTY);
  v.p = best.pos;
  fill(st, best.i, best.i + 1);
  return true;
}

// ── 고리 (바람개비) ───────────────────────────────────────
//
// 기준 모양 — 위(T)·아래(B)는 가로, 오른쪽(R)·왼쪽(L)은 세로. 각 팔은 다음 팔에 막힌다 (T→R→B→L→T).
//   T: (0..lT-1, 0)          고리 방향 → (오른쪽)   바깥 ←
//   R: (lT, 0..lR-1)         고리 방향 ↓            바깥 ↑
//   B: (lT-lB+1..lT, lR)     고리 방향 ←            바깥 →
//   L: (lT-lB, 1..lR)        고리 방향 ↑            바깥 ↓
// 맞물리려면 L과 R의 길이가 같고 B가 T보다 길지 않아야 한다. 가운데 빈칸은 (lB-1) × (lR-1).
// 이것을 회전·뒤집기 8가지로 돌려 판 위 아무 데나 놓는다.

const ARM_COUNT = 4;

function canonicalLoop(lT, lR, lB) {
  const xL = lT - lB;
  const arms = [
    { cells: range(lT).map((i) => [i, 0]), cycle: [1, 0], out: [-1, 0] },
    { cells: range(lR).map((j) => [lT, j]), cycle: [0, 1], out: [0, -1] },
    { cells: range(lB).map((i) => [xL + 1 + i, lR]), cycle: [-1, 0], out: [1, 0] },
    { cells: range(lR).map((j) => [xL, 1 + j]), cycle: [0, -1], out: [0, 1] },
  ];
  const center = [];
  for (let x = xL + 1; x < lT; x++) for (let y = 1; y < lR; y++) center.push([x, y]);
  return { arms, center };
}

function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}

/** 회전·뒤집기 8가지 중 하나 (점과 방향 벡터에 같이 쓴다) */
function transform(code, [x, y]) {
  let a = code & 4 ? -x : x;
  let b = y;
  for (let r = 0; r < (code & 3); r++) [a, b] = [-b, a];
  return [a, b];
}

function tryLoop(st, rng, pool, p) {
  const combos = [];
  for (const lT of [2, 3]) {
    for (const lB of [2, 3]) {
      if (lB > lT) continue;
      for (const lS of [2, 3]) {
        const lens = [lT, lS, lB, lS];
        const buses = lens.filter((l) => l === 3).length;
        if (buses <= pool.bus && 4 - buses <= pool.car) combos.push(lens);
      }
    }
  }
  if (combos.length === 0) return false;

  // 모양 × 돌리기 × 열쇠 × 자리를 전부 늘어놓고 섞어서 차례로 본다.
  // ⚠️ 자리를 무작위로 몇 번 찍어 보는 식으로는 판이 조금만 차도 실패한다 (빈 곳이 드물어 거의 다 겹친다)
  const N = st.N;
  const layouts = combos.flatMap((lens) => layoutsFor(lens).map((layout) => ({ lens, layout })));
  const options = [];   // 레이아웃 번호 × 자리를 정수 하나로 묶는다 (객체 수만 개를 만들지 않도록)
  layouts.forEach(({ layout }, li) => {
    for (let dx = -layout.minX; dx <= N - 1 - layout.maxX; dx++) {
      for (let dy = -layout.minY; dy <= N - 1 - layout.maxY; dy++) {
        options.push(li * 4096 + (dx + 32) * 64 + (dy + 32));
      }
    }
  });
  rng.shuffle(options);

  const tries = Math.min(options.length, p.loopTries);
  for (let t = 0; t < tries; t++) {
    const o = options[t];
    const { lens, layout } = layouts[Math.floor(o / 4096)];
    const dx = (Math.floor(o / 64) % 64) - 32;
    const dy = (o % 64) - 32;
    if (placeLoopAt(st, layout, dx, dy)) {
      for (const l of lens) pool[l === 3 ? 'bus' : 'car']--;
      st.loops++;
      return true;
    }
  }
  return false;
}

/** 팔 길이 조합 하나에 대한 레이아웃 32가지 (돌리기 8 × 열쇠 4) — 순수 계산이라 한 번만 만든다 */
const layoutCache = new Map();
function layoutsFor(lens) {
  const k = lens.join();
  if (!layoutCache.has(k)) {
    const shape = canonicalLoop(lens[0], lens[1], lens[2]);
    const list = [];
    for (let code = 0; code < 8; code++) {
      for (let key = 0; key < ARM_COUNT; key++) list.push(loopLayout(shape, code, key));
    }
    layoutCache.set(k, list);
  }
  return layoutCache.get(k);
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const dot = (c, d) => c[0] * d[0] + c[1] * d[1];
/** cells 중 dir 쪽 끝 칸 */
const endCell = (cells, dir) => cells.reduce((m, c) => (dot(c, dir) > dot(m, dir) ? c : m));

/** 고리 모양을 돌리고 열쇠의 밀어 둔 자리를 정한다 (아직 판 위 자리는 없다 — 원점 기준) */
function loopLayout(shape, code, keyIdx) {
  const tf = (pt) => transform(code, pt);
  const arms = shape.arms.map((a) => ({ cells: a.cells.map(tf), cycle: tf(a.cycle), out: tf(a.out) }));
  const center = shape.center.map(tf);

  // 열쇠: 앞 팔이 막힌 칸(hit)을 비울 만큼 바깥으로 밀어 둔 자리
  const key = arms[keyIdx];
  const pred = arms[(keyIdx + ARM_COUNT - 1) % ARM_COUNT];
  const hit = add(endCell(pred.cells, pred.cycle), pred.cycle);
  const shifted = (s) => key.cells.map((c) => [c[0] + key.out[0] * s, c[1] + key.out[1] * s]);
  let shift = 1;
  while (shifted(shift).some((c) => c[0] === hit[0] && c[1] === hit[1])) shift++;
  const slidOut = shifted(shift);

  // 모양 전체(팔·밀어 둔 자리·빗장 칸)가 판 안에 들어가야 한다
  const extra = [add(endCell(slidOut, key.out), key.out)];
  arms.forEach((a, k) => { if (k !== keyIdx) extra.push(add(endCell(a.cells, a.out), a.out)); });
  const all = [...arms.flatMap((a) => a.cells), ...slidOut, ...extra];
  return {
    arms,
    center,
    slidOut,
    keyIdx,
    body: [...arms.flatMap((a) => a.cells), ...slidOut, ...center],   // 반드시 비어 있어야 할 칸 (빠른 거르기용)
    minX: Math.min(...all.map((c) => c[0])),
    maxX: Math.max(...all.map((c) => c[0])),
    minY: Math.min(...all.map((c) => c[1])),
    maxY: Math.max(...all.map((c) => c[1])),
  };
}

/** 고리 하나를 (dx, dy)만큼 옮겨 판에 놓아 본다. 성립하지 않으면 아무것도 바꾸지 않고 false */
function placeLoopAt(st, layout, dx, dy) {
  const { N, grid, touched } = st;

  // 1) 팔·밀어 둔 자리·가운데가 전부 빈칸 — 대부분의 후보가 여기서 걸러지므로 배열을 만들기 전에 본다
  for (const c of layout.body) {
    if (grid[(c[1] + dy) * N + c[0] + dx] !== EMPTY) return false;
  }

  const inside = ([x, y]) => x >= 0 && y >= 0 && x < N && y < N;
  const idx = ([x, y]) => y * N + x;
  const mv = (c) => [c[0] + dx, c[1] + dy];
  const keyIdx = layout.keyIdx;
  const arms = layout.arms.map((a) => ({ ...a, cells: a.cells.map(mv) }));
  const center = layout.center.map(mv);
  const slidOut = layout.slidOut.map(mv);
  const key = arms[keyIdx];
  const outEnd = endCell;

  // 2) 들여보내는 순서(열쇠 → 다음 → 다음 → 앞)대로, 각 팔의 고리 방향 길이 가장자리까지 트였는가
  const tmp = grid.slice();
  const pathCells = [];
  const order = range(ARM_COUNT).map((k) => (keyIdx + k) % ARM_COUNT);
  for (const k of order) {
    const a = arms[k];
    const cells = k === keyIdx ? slidOut : a.cells;
    for (let c = add(outEnd(cells, a.cycle), a.cycle); inside(c); c = add(c, a.cycle)) {
      if (tmp[idx(c)] !== EMPTY) return false;
      pathCells.push(c);
    }
    for (const c of cells) tmp[idx(c)] = 1;
  }
  // 끌어오기: 밀어 둔 자리 → 고리 자리. 지나는 칸이 비어 있어야 한다
  for (const c of slidOut) tmp[idx(c)] = EMPTY;
  for (const c of key.cells) {
    if (tmp[idx(c)] !== EMPTY) return false;
    tmp[idx(c)] = 1;
  }

  // 3) 빗장 — 열쇠 아닌 팔은 바깥쪽 어딘가에 구조물이, 열쇠는 밀어 둔 자리 바로 바깥에 구조물이 있어야 한다.
  //    없으면 새로 놓는다 (지나간 적 없는 빈칸이고, 이 고리의 길 위가 아닐 때만)
  const gadgetCells = new Set([...arms.flatMap((a) => a.cells), ...slidOut, ...center, ...pathCells].map(idx));
  const canPlace = (c) => inside(c) && tmp[idx(c)] === EMPTY && !touched[idx(c)] && !gadgetCells.has(idx(c));
  const newBlocks = new Set();

  const stopper = add(outEnd(slidOut, key.out), key.out);
  if (!inside(stopper)) return false;
  if (tmp[idx(stopper)] !== BLOCK) {
    if (!canPlace(stopper)) return false;
    newBlocks.add(idx(stopper));
  }

  for (const k of order) {
    if (k === keyIdx) continue;
    const a = arms[k];
    let locked = false;
    let firstFree = null;
    for (let c = add(outEnd(a.cells, a.out), a.out); inside(c); c = add(c, a.out)) {
      if (tmp[idx(c)] === BLOCK || newBlocks.has(idx(c))) { locked = true; break; }
      if (firstFree === null && canPlace(c)) firstFree = c;
    }
    if (locked) continue;
    if (firstFree === null) return false;   // 바깥으로 나갈 길을 막을 수 없다 — 이 팔은 그냥 나가 버린다
    newBlocks.add(idx(firstFree));
  }
  if (newBlocks.size > st.blockBudget) return false;

  // ── 확정 ──
  for (const k of newBlocks) placeBlock(st, k);
  for (const k of order) {
    const cells = arms[k].cells;
    const horizontal = cells[0][1] === cells[1][1];
    const coords = cells.map((c) => (horizontal ? c[0] : c[1]));
    const v = {
      kind: cells.length === 3 ? 'bus' : 'car',
      len: cells.length,
      axis: horizontal ? 'h' : 'v',
      lane: horizontal ? cells[0][1] : cells[0][0],
      p: Math.min(...coords),
    };
    const i = st.vs.length;
    st.vs.push(v);
    fill(st, i, i + 1);
  }
  for (const c of [...arms.flatMap((a) => a.cells), ...slidOut, ...pathCells]) touched[idx(c)] = 1;
  return true;
}

/** 지은 판 → 판 정의. 차량 순서를 섞어 번호(=색)가 짓는 순서를 드러내지 않게 하고, 앞쪽 방향은 무작위로 정한다 */
function toDef(st, rng) {
  const vehicles = rng.shuffle(st.vs.slice()).map((v) => ({
    kind: v.kind,
    x: v.axis === 'h' ? v.p : v.lane,
    y: v.axis === 'h' ? v.lane : v.p,
    front: v.axis === 'h' ? (rng.chance(0.5) ? 'right' : 'left') : (rng.chance(0.5) ? 'down' : 'up'),
  }));
  return { size: st.N, blocks: st.blocks.slice(), vehicles };
}

export const _internal = { build, countExitable, toDef };
