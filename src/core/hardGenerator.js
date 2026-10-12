// 하드 모드 판 생성기 — 일반 모드의 역방향 생성기(generator.js)와 따로 둔다.
//
// ★ 왜 따로인가: 하드 모드는 "리무진 두 대만 빼면 되는 판"이라 판 전체를 역방향으로 지을 필요가 없고,
//   대신 '리무진이 나갈 길이 얼마나 막혀 있는가'를 직접 설계해야 난이도(최소 수)를 맞출 수 있다.
//   그래서 설계한 대로 놓은 뒤 하드 솔버(hardSolver.js)로 재어 보고, 조건에 맞지 않으면 다시 짓는다.
//
// 짓는 순서
//   1) 리무진 2대 — 안전구역 안에 가로 하나·세로 하나. 서로의 통로에 들어가지 않고, 차선끼리 떨어지게
//   2) 변화구역 — 구조물을 흩고(리무진 차선은 피한다), 일반 차를 무작위로 채운다
//   3) 안전구역 — 일반 차 3~4대(버스는 최대 1대)를 리무진이 안전구역을 빠져나가는 길 위에 놓고, 구조물로 옆길을 막는다.
//      리무진마다 '안전구역을 벗어나는 최소 수'가 safeLeave 범위에 들 때까지 배치를 다시 뽑는다
//   4) 리무진 둘을 모두 빼는 최소 수(랜덤 이동 없음)를 재어 풀리는 판만 쓴다
//
// ⚠️ 같은 시드 → 같은 판. 난수는 시드 난수 하나에서만 뽑고, 솔버 상한도 시간이 아니라 상태 수다.
// ⚠️ 구조물은 리무진 차선(가로 리무진의 행 전체, 세로 리무진의 열 전체)에 절대 놓지 않는다 — 놓으면 그 통로는 영영 못 쓴다.

import { createRng } from './random.js';
import { createPuzzle, EMPTY, BLOCK, VEHICLE_LENGTH } from './rules.js';
import { minEscapeMoves, minLeaveSafeMoves } from './hardSolver.js';

/** 생성 규칙을 바꾸면 올릴 것 — 저장해 둔 판 캐시가 이 값으로 무효가 된다 */
export const HARD_GENERATOR_VERSION = 1;

// HARD_MODE에 없으면 쓰는 값 (safeCars·safeBusMax·safeLeave는 HARD_MODE에서 조정한다). 나머지는 생성기 내부 조절값 —
// config.gen으로 덮어쓸 수 있다 (실험·보고서용)
export const HARD_GEN_DEFAULTS = Object.freeze({
  safeCars: [3, 4],        // 안전구역 안 일반 차 수 (범위)
  safeBusMax: 1,           // 그중 버스 최대
  safeLeave: [3, 5],       // 리무진마다 안전구역을 벗어나는 최소 수가 이 범위여야 한다
  safeTries: 120,          // 안전구역 배치를 몇 번까지 다시 뽑아 보는가 (판 하나당)
  attempts: 30,            // 판을 몇 번까지 다시 지어 보는가
  solverNodes: 15000,      // 최소 수 탐색 상한 (상태 수, 리무진 한 대 탐색마다) — 넘으면 그 판은 버린다
  leaveNodes: 1000,        // 안전구역을 벗어나는 최소 수 탐색 상한 — 넘으면 그 배치는 버린다 (대개 너무 막힌 배치다)
  fillSamples: 8,          // 변화구역 차 한 대를 놓을 때 견줘 보는 자리 수 (바로 나갈 수 없는 자리를 고른다)
});

// ── 짓는 판 ─────────────────────────────────────────────
//   grid  칸 점유 (EMPTY / BLOCK / 차 번호 + 1)
//   vs    차 { kind, len, axis, lane, p, role }  role: 'limo' | 'safe' | 'fill'
//   blocks [[x, y], ...]

function cellIdx(N, axis, lane, c) {
  return axis === 'h' ? lane * N + c : c * N + lane;
}

function newBoard(N, safeSize) {
  const lo = (N - safeSize) / 2;
  return { N, lo, hi: lo + safeSize - 1, grid: new Int16Array(N * N), vs: [], blocks: [] };
}

function isSafe(b, x, y) {
  return x >= b.lo && x <= b.hi && y >= b.lo && y <= b.hi;
}

function cellsOf(b, axis, lane, p, len) {
  const out = [];
  for (let k = 0; k < len; k++) out.push(cellIdx(b.N, axis, lane, p + k));
  return out;
}

/** 놓을 수 있는가 — 칸이 모두 비었고, region('safe' | 'change')에 모두 들어가는가 */
function fits(b, axis, lane, p, len, region) {
  if (p < 0 || p + len > b.N || lane < 0 || lane >= b.N) return false;
  for (const k of cellsOf(b, axis, lane, p, len)) {
    if (b.grid[k] !== EMPTY) return false;
    if (isSafe(b, k % b.N, Math.floor(k / b.N)) !== (region === 'safe')) return false;
  }
  return true;
}

function addVehicle(b, v) {
  const id = b.vs.length;
  b.vs.push(v);
  for (const k of cellsOf(b, v.axis, v.lane, v.p, v.len)) b.grid[k] = id + 1;
  return id;
}

/** 마지막에 넣은 차들을 빼서 count대로 되돌린다 (안전구역 배치를 다시 뽑을 때) */
function truncateVehicles(b, count) {
  while (b.vs.length > count) {
    const v = b.vs.pop();
    for (const k of cellsOf(b, v.axis, v.lane, v.p, v.len)) b.grid[k] = EMPTY;
  }
}

function addBlock(b, k) {
  b.grid[k] = BLOCK;
  b.blocks.push([k % b.N, Math.floor(k / b.N)]);
}

function truncateBlocks(b, count) {
  while (b.blocks.length > count) {
    const [x, y] = b.blocks.pop();
    b.grid[y * b.N + x] = EMPTY;
  }
}

/** v가 sign 쪽으로 판 끝까지 길이 트였는가 */
function clearToEdge(b, axis, lane, p, len, sign) {
  for (let c = sign > 0 ? p + len : p - 1; c >= 0 && c < b.N; c += sign) {
    if (b.grid[cellIdx(b.N, axis, lane, c)] !== EMPTY) return false;
  }
  return true;
}

// ── 1) 리무진 ───────────────────────────────────────────

/**
 * 가로 리무진 A(행 ra, 열 ca~ca+1)와 세로 리무진 B(열 cb, 행 rb~rb+1).
 *   - 양쪽에 안전구역 칸이 한 칸 이상 남게 (그 칸에 막는 차를 놓는다)
 *   - 서로의 차선에 들어가지 않게, 그리고 두 칸 이상 떨어지게 (통로가 한쪽에 몰리지 않게)
 * ⚠️ 두 차선은 언제나 한 칸(cb, ra)에서 엇갈린다. 그 칸에 차를 두면 한 대가 두 통로를 함께 막으므로 비워 둔다
 */
function placeLimos(b, rng) {
  const { lo, hi } = b;
  const options = [];
  for (let ra = lo + 1; ra <= hi - 1; ra++) {
    for (let ca = lo + 1; ca <= hi - 2; ca++) {
      for (let cb = lo + 1; cb <= hi - 1; cb++) {
        if (cb >= ca - 1 && cb <= ca + 2) continue;   // A 몸통과 두 칸 이상 떨어진 열
        for (let rb = lo + 1; rb <= hi - 2; rb++) {
          if (ra >= rb - 1 && ra <= rb + 2) continue;   // B 몸통과 두 칸 이상 떨어진 행
          options.push([ra, ca, cb, rb]);
        }
      }
    }
  }
  const [ra, ca, cb, rb] = rng.pick(options);
  const a = addVehicle(b, { kind: 'limo', len: 2, axis: 'h', lane: ra, p: ca, role: 'limo' });
  const c = addVehicle(b, { kind: 'limo', len: 2, axis: 'v', lane: cb, p: rb, role: 'limo' });
  return { ids: [a, c], ra, ca, cb, rb, cross: ra * b.N + cb };
}

/** 리무진 차선의 칸 — 구조물을 놓지 않는다 */
function laneCells(b, limos) {
  const set = new Set();
  for (let c = 0; c < b.N; c++) {
    set.add(cellIdx(b.N, 'h', limos.ra, c));
    set.add(cellIdx(b.N, 'v', limos.cb, c));
  }
  return set;
}

// ── 2) 변화구역 ─────────────────────────────────────────

function scatterBlocks(b, rng, count, forbidden) {
  const cells = [];
  for (let k = 0; k < b.N * b.N; k++) {
    if (b.grid[k] === EMPTY && !forbidden.has(k) && !isSafe(b, k % b.N, Math.floor(k / b.N))) cells.push(k);
  }
  for (const k of rng.shuffle(cells).slice(0, count)) addBlock(b, k);
}

/**
 * 변화구역을 일반 차로 채운다. 한 대마다 무작위 자리를 몇 개 뽑아, 놓자마자 나갈 수 없는 자리를 먼저 고른다
 * (전부 나갈 수 있는 자리면 그중 하나). 버스(3칸)부터 — 3칸 빈 줄은 판이 찰수록 금방 사라진다.
 */
function fillChangeZone(b, rng, cars, buses, samples) {
  const kinds = [...Array(buses).fill('bus'), ...Array(cars).fill('car')];
  for (const kind of kinds) {
    const len = VEHICLE_LENGTH[kind];
    let pick = null;
    let seen = 0;
    for (let t = 0; t < 400 && seen < samples; t++) {
      const axis = rng.chance(0.5) ? 'h' : 'v';
      const lane = rng.int(b.N);
      const p = rng.int(b.N - len + 1);
      if (!fits(b, axis, lane, p, len, 'change')) continue;
      seen++;
      const exitable = clearToEdge(b, axis, lane, p, len, -1) || clearToEdge(b, axis, lane, p, len, 1);
      if (!pick || (pick.exitable && !exitable)) pick = { axis, lane, p, exitable };
      if (!exitable) break;
    }
    if (!pick) return false;
    addVehicle(b, { kind, len, axis: pick.axis, lane: pick.lane, p: pick.p, role: 'fill' });
  }
  return true;
}

// ── 3) 안전구역 ─────────────────────────────────────────

/**
 * 리무진이 안전구역을 빠져나가는 길 4갈래 (A 왼쪽·오른쪽, B 위·아래) — 리무진에서 안전구역 경계까지의 칸.
 * 엇갈리는 칸(cross)은 뺀다.
 */
function safeSegments(b, limos) {
  const { N, lo, hi } = b;
  const segs = [];
  const A = b.vs[limos.ids[0]];
  const B = b.vs[limos.ids[1]];
  segs.push({ limo: limos.ids[0], axis: 'h', lane: A.lane, cs: range(lo, A.p - 1) });
  segs.push({ limo: limos.ids[0], axis: 'h', lane: A.lane, cs: range(A.p + A.len, hi) });
  segs.push({ limo: limos.ids[1], axis: 'v', lane: B.lane, cs: range(lo, B.p - 1) });
  segs.push({ limo: limos.ids[1], axis: 'v', lane: B.lane, cs: range(B.p + B.len, hi) });
  for (const s of segs) s.cells = s.cs.map((c) => cellIdx(N, s.axis, s.lane, c)).filter((k) => k !== limos.cross);
  return segs;
}

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/** 길(seg)의 한 칸을 가로지르는(수직으로 놓인) 자리 — 안전구역 안에 몸통 전체가 들어가는 것만 */
function crossingPlacements(b, seg, len) {
  const axis = seg.axis === 'h' ? 'v' : 'h';
  const out = [];
  for (const k of seg.cells) {
    const x = k % b.N;
    const y = Math.floor(k / b.N);
    const lane = axis === 'v' ? x : y;
    const at = axis === 'v' ? y : x;   // 그 차의 축 방향에서 길이 지나는 좌표
    for (let p = at - len + 1; p <= at; p++) {
      if (fits(b, axis, lane, p, len, 'safe')) out.push({ axis, lane, p });
    }
  }
  return out;
}

/**
 * 안전구역 배치 한 벌 — 일반 차 n대(버스 최대 1대)를 길 위에 가로질러 놓고, 구조물 wallCount개를 놓는다.
 *   - 차는 아직 막히지 않은 길부터 하나씩 맡는다 (4갈래보다 차가 적으면 한 갈래는 변화구역 차에 맡긴다)
 *   - 구조물은 그 차들이 옆으로 비킬 때 지나야 할 바로 옆 칸에 무게를 둔다 — 한쪽을 막아야 반대쪽 차를 먼저 치워야 하는 연쇄가 생긴다
 * @returns false — 차를 놓을 자리가 없다
 */
function placeSafeLayout(b, rng, limos, lanes, n, buses, wallCount) {
  const segs = rng.shuffle(safeSegments(b, limos).filter((s) => s.cells.length > 0));
  const busAt = buses > 0 ? rng.int(n) : -1;
  const placed = [];
  for (let k = 0; k < n; k++) {
    const kind = k === busAt ? 'bus' : 'car';
    const len = VEHICLE_LENGTH[kind];
    let options = [];
    // 아직 아무도 막지 않은 갈래 → 그다음은 아무 갈래
    for (const s of segs.slice(k % Math.max(1, segs.length)).concat(segs)) {
      options = crossingPlacements(b, s, len);
      if (options.length > 0) break;
    }
    if (options.length === 0) return false;
    const o = rng.pick(options);
    placed.push(addVehicle(b, { kind, len, axis: o.axis, lane: o.lane, p: o.p, role: 'safe' }));
  }

  // 구조물 — 안전구역의 빈칸 중 리무진 차선이 아닌 곳. 놓은 차의 양 끝 바로 옆 칸은 4배 무게
  const near = new Set();
  for (const i of placed) {
    const v = b.vs[i];
    for (const c of [v.p - 1, v.p + v.len]) if (c >= 0 && c < b.N) near.add(cellIdx(b.N, v.axis, v.lane, c));
  }
  const pool = [];
  for (let k = 0; k < b.N * b.N; k++) {
    if (b.grid[k] !== EMPTY || lanes.has(k) || !isSafe(b, k % b.N, Math.floor(k / b.N))) continue;
    pool.push({ k, w: near.has(k) ? 4 : 1 });
  }
  for (let t = 0; t < wallCount && pool.length > 0; t++) {
    const total = pool.reduce((s, e) => s + e.w, 0);
    let r = rng.next() * total;
    let j = 0;
    while (r >= pool[j].w) r -= pool[j++].w;
    addBlock(b, pool[j].k);
    pool.splice(j, 1);
  }
  return true;
}

// ── 판 정의 · 평가 ───────────────────────────────────────

/** 지은 판 → 판 정의. 차 순서를 섞어 번호(=색)가 짓는 순서를 드러내지 않게 하고, 앞쪽 방향은 무작위 */
function toDef(b, rng) {
  const order = rng.shuffle(b.vs.map((_, i) => i));
  const vehicles = order.map((i) => {
    const v = b.vs[i];
    return {
      kind: v.kind,
      x: v.axis === 'h' ? v.p : v.lane,
      y: v.axis === 'h' ? v.lane : v.p,
      front: v.axis === 'h' ? (rng.chance(0.5) ? 'right' : 'left') : (rng.chance(0.5) ? 'down' : 'up'),
    };
  });
  return { def: { size: b.N, blocks: b.blocks.map(([x, y]) => [x, y]), vehicles }, order };
}

/** 지은 판 그대로(섞기 전 번호)의 퍼즐 — 안전구역 배치를 고를 때 재어 보는 용도 */
function rawPuzzle(b) {
  return createPuzzle({
    size: b.N,
    blocks: b.blocks,
    vehicles: b.vs.map((v) => ({
      kind: v.kind, x: v.axis === 'h' ? v.p : v.lane, y: v.axis === 'h' ? v.lane : v.p, front: v.axis === 'h' ? 'right' : 'down',
    })),
  });
}

/** 실험·보고서용 — 솔버 호출 수·시간·결과를 센다 (config.gen.stats에 빈 객체를 넘기면 채운다) */
function tally(stats, name, r) {
  const s = (stats[name] ??= { calls: 0, ms: 0, explored: 0, results: {} });
  s.calls++;
  s.ms += r.ms;
  s.explored += r.explored;
  const key = r.solved ? String(r.length) : r.reason;
  s.results[key] = (s.results[key] ?? 0) + 1;
}

function leaveSafeOf(b, puzzle, limoId, opts) {
  return minLeaveSafeMoves(puzzle, puzzle.start, limoId, (x, y) => isSafe(b, x, y), opts);
}

/**
 * 하드 모드 판 하나.
 * @param config HARD_MODE (size, safeSize, startVehicles, busRatio, limos, blocks, safeBlocks, safeCars, safeBusMax, safeLeave, gen?)
 * @returns {{ def, par, solution, leaveSafe: [A, B], attempts, ms }}
 *   par — 랜덤 이동이 없다면 리무진 둘을 모두 빼는 최소 수 (관련 차만 움직인 수순 — 실제 최소의 상한)
 */
export function generateHardBoard(config, seed) {
  const t0 = Date.now();
  if ((config.limos ?? 2) !== 2) throw new Error('하드 모드 판 생성기는 리무진 2대(가로·세로 하나씩)만 짓습니다.');
  const g = { ...HARD_GEN_DEFAULTS, ...config, ...(config.gen ?? {}) };
  const rng = createRng(`hard:${seed}`);
  const solveOpts = { maxNodes: g.solverNodes };
  const totalBuses = Math.round(config.startVehicles * config.busRatio);

  for (let attempt = 1; attempt <= g.attempts; attempt++) {
    const b = newBoard(config.size, config.safeSize);
    const limos = placeLimos(b, rng);
    const lanes = laneCells(b, limos);

    const nSafe = rng.range(g.safeCars[0], g.safeCars[1]);
    const safeBuses = Math.min(g.safeBusMax, totalBuses, rng.chance(0.5) ? 1 : 0);
    scatterBlocks(b, rng, config.blocks, lanes);
    const outside = config.startVehicles - nSafe;
    const outBuses = totalBuses - safeBuses;
    if (!fillChangeZone(b, rng, outside - outBuses, outBuses, g.fillSamples)) continue;

    // 안전구역 — 리무진마다 벗어나는 최소 수가 범위에 들 때까지 다시 뽑는다.
    // ★ 먼저 안전구역을 비워 둔 채로 재 본다. 안전구역의 차·구조물은 길을 더 막을 뿐이므로, 빈 채로도 상한을 넘으면
    //   어떤 배치를 뽑아도 안 된다 — 변화구역부터 다시 짓는다 (그냥 두면 배치를 수백 번 헛뽑는다)
    const leaveOpts = { ...solveOpts, maxDepth: g.safeLeave[1], maxNodes: g.leaveNodes };
    const empty = rawPuzzle(b);
    if (limos.ids.some((id) => !leaveSafeOf(b, empty, id, leaveOpts).solved)) continue;
    const vCount = b.vs.length;
    const bCount = b.blocks.length;
    let leave = null;
    for (let t = 0; t < g.safeTries; t++) {
      truncateVehicles(b, vCount);
      truncateBlocks(b, bCount);
      if (!placeSafeLayout(b, rng, limos, lanes, nSafe, safeBuses, config.safeBlocks ?? 0)) continue;
      // 상한(safeLeave[1])보다 긴 수순은 찾지 않는다 — 못 찾으면 너무 막힌 배치라 어차피 버린다
      const puzzle = rawPuzzle(b);
      const ls = [];
      for (const id of limos.ids) {
        const r = leaveSafeOf(b, puzzle, id, leaveOpts);
        if (g.stats) tally(g.stats, 'leave', r);
        if (!r.solved || r.length < g.safeLeave[0]) break;
        ls.push(r.length);
      }
      if (ls.length === limos.ids.length) {
        leave = ls;
        break;
      }
    }
    if (!leave) continue;

    const { def } = toDef(b, rng);
    const puzzle = createPuzzle(def);
    const limoIds = puzzle.vehicles.filter((v) => v.kind === 'limo').map((v) => v.id);
    const r = minEscapeMoves(puzzle, puzzle.start, limoIds, solveOpts);
    if (g.stats) tally(g.stats, 'escape', r);
    if (!r.solved) continue;
    return { def, par: r.length, solution: r.moves, leaveSafe: leave, attempts: attempt, ms: Date.now() - t0 };
  }
  throw new Error('하드 모드 판을 만들지 못했어요.');
}
