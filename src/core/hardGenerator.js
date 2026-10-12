// 하드 모드 판 생성기 — 일반 모드의 역방향 생성기(generator.js)와 따로 둔다.
//
// ★ 왜 따로인가: 하드 모드는 "리무진 두 대만 빼면 되는 판"이라 판 전체를 역방향으로 지을 필요가 없고,
//   대신 '리무진이 나갈 길이 얼마나 막혀 있는가'를 직접 설계해야 난이도(최소 수)를 맞출 수 있다.
//   그래서 설계한 대로 놓은 뒤 하드 솔버(hardSolver.js)로 재어 보고, 조건에 맞지 않으면 다시 짓는다.
//
// 짓는 순서
//   1) 리무진 2대 — 안전구역 안에 가로 하나·세로 하나. 서로의 통로에 들어가지 않고, 차선끼리 떨어지게
//   2) 변화구역 통로 봉쇄 — 리무진 통로 4개(안전구역 밖 부분)마다 막는 차 2~4대. 일부는 구조물·도우미 차로 잠가
//      '못 비키는 차'를 만들고(연쇄 2~3단계), 일부는 통로 안에 길이 방향으로 눕힌다
//   3) 변화구역 나머지 — 남은 구조물을 흩고, 남은 일반 차를 무작위로 채운다 (둘 다 리무진 차선은 피한다 —
//      통로를 막는 차는 2)에서 설계한 차뿐이다)
//   4) 안전구역 — 일반 차 3~4대(버스는 최대 1대)를 리무진이 안전구역을 빠져나가는 길 위에 놓고, 구조물로 옆길을 막는다.
//      리무진마다 '안전구역을 벗어나는 최소 수'가 safeLeave 범위에 들 때까지 배치를 다시 뽑는다
//   5) 리무진 둘을 모두 빼는 최소 수(랜덤 이동 없음)를 재어 풀리는 판만 쓴다
//
// ⚠️ 같은 시드 → 같은 판. 난수는 시드 난수 하나에서만 뽑고, 솔버 상한도 시간이 아니라 상태 수다.
// ⚠️ 구조물은 리무진 차선(가로 리무진의 행 전체, 세로 리무진의 열 전체)에 절대 놓지 않는다 — 놓으면 그 통로는 영영 못 쓴다.

import { createRng } from './random.js';
import { createPuzzle, EMPTY, BLOCK, VEHICLE_LENGTH } from './rules.js';
import { minEscapeMoves, minLeaveSafeMoves, passageChainOf } from './hardSolver.js';

/** 생성 규칙을 바꾸면 올릴 것 — 저장해 둔 판 캐시가 이 값으로 무효가 된다 */
export const HARD_GENERATOR_VERSION = 4;

// HARD_MODE에 없으면 쓰는 값 (safeCars·safeBusMax·safeLeave는 HARD_MODE에서 조정한다). 나머지는 생성기 내부 조절값 —
// config.gen으로 덮어쓸 수 있다 (실험·보고서용)
export const HARD_GEN_DEFAULTS = Object.freeze({
  safeCars: [3, 4],        // 안전구역 안 일반 차 수 (범위)
  safeBusMax: 1,           // 그중 버스 최대
  safeLeave: [3, 5],       // 리무진마다 안전구역을 벗어나는 최소 수가 이 범위여야 한다
  safeTries: 120,          // 안전구역 배치를 몇 번까지 다시 뽑아 보는가 (판 하나당)
  attempts: 30,            // 판을 몇 번까지 다시 지어 보는가 (난이도 필터가 없을 때 — 있으면 stages × stageAttempts)
  solverNodes: 6000,       // 최소 수 탐색 상한 (상태 수, 리무진 한 대 탐색마다) — 넘으면 그 판은 버린다 (1만5천이면 버리는 판 하나에 1초씩 써서 줄였다)
  leaveNodes: 1000,        // 안전구역을 벗어나는 최소 수 탐색 상한 — 넘으면 그 배치는 버린다 (대개 너무 막힌 배치다)
  fillSamples: 8,          // 변화구역 차 한 대를 놓을 때 견줘 보는 자리 수 (바로 나갈 수 없는 자리를 고른다)
  // 변화구역 통로 봉쇄 (통로 = 리무진 차선에서 안전구역 밖 부분, 리무진마다 앞뒤 둘)
  passageBlockers: [2, 4], // 통로마다 막는 차 수
  lockChance: 0.6,         // 가로지른 막는 차를 '못 비키게' 잠글 확률 (한쪽은 구조물, 다른 쪽은 도우미 차)
  chainDepth: [2, 3],      // 잠근 차의 연쇄 길이 — 2 = 막는 차 + 도우미, 3 = 도우미도 잠근다
  sideWallChance: 0.8,     // 잠그지 않은 막는 차·연쇄 끝의 도우미도 한쪽 옆을 구조물로 막을 확률 (비킬 방향이 하나가 된다)
  collinearChance: 0.35,   // 통로마다 막는 차 하나를 통로 안에 길이 방향으로 눕힐 확률 (그 차는 판 밖으로만 빠질 수 있다)
  // 난이도 필터 (targetMoves가 있을 때) — 단계마다 위 값을 덮어쓴다. 범위에 드는 판이 stageAttempts번 안에 안 나오면 다음 단계,
  // 마지막 단계는 finalAttempts번까지 (짓다가 버리는 판이 많아 마지막에 여유를 둔다)
  stageAttempts: 6,
  finalAttempts: 18,
  stages: Object.freeze([
    Object.freeze({}),
    Object.freeze({ passageBlockers: [3, 4], lockChance: 0.75 }),
    Object.freeze({ passageBlockers: [3, 4], lockChance: 0.85, chainDepth: [2, 4], collinearChance: 0.5 }),
    Object.freeze({ passageBlockers: [4, 4], lockChance: 0.95, chainDepth: [3, 4], collinearChance: 0.5 }),
  ]),
});

// ── 짓는 판 ─────────────────────────────────────────────
//   grid  칸 점유 (EMPTY / BLOCK / 차 번호 + 1)
//   vs    차 { kind, len, axis, lane, p, role }  role: 'limo' | 'safe' | 'blocker' | 'helper' | 'fill'
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

// ── 2) 변화구역 통로 봉쇄 ─────────────────────────────────
//   통로 = 리무진 차선 중 안전구역 밖 부분 (경계 바로 바깥 칸 → 판 끝). 리무진마다 앞뒤 둘, 모두 넷.
//   ★ 넷 모두 막는다 — 하나라도 비어 있으면 리무진이 그 길로 바로 나가 다른 설계가 소용없다.
//   - 가로지른 차(통로와 수직)는 lockChance로 잠근다: 통로에서 비켜날 두 쪽 중 한쪽 바로 옆에 구조물,
//     다른 쪽 길에 도우미 차. 그러면 도우미가 먼저 비켜야 막는 차가 비킬 수 있다(연쇄 2단계). 도우미도 같은 식으로
//     잠그면 3단계. 구조물이 통로 곁에 모여 '구조물의 3분의 1쯤은 연쇄에 쓰인다'가 된다
//   - 통로 안에 길이 방향으로 누운 차는 판 밖으로 나가는 수밖에 없다 — 그보다 바깥에 있는 막는 차가 먼저 빠져야 한다
//   ⚠️ 막는 차·도우미·구조물은 다른 리무진의 차선을 피한다. 통로를 막는 차 수가 설계와 어긋나지 않게 한다

/** 리무진의 통로(sign 쪽) 칸 좌표 — 리무진 축 방향 좌표, 경계 바로 바깥부터 판 끝까지 */
function passageCoords(b, sign) {
  const out = [];
  if (sign > 0) for (let c = b.hi + 1; c < b.N; c++) out.push(c);
  else for (let c = b.lo - 1; c >= 0; c--) out.push(c);
  return out;
}

/** 변화구역에 놓을 수 있고 피할 칸(차선)에 걸리지 않는가 — except는 일부러 걸치는 칸 하나 (통로를 가로지르는 칸) */
function fitsAvoiding(b, axis, lane, p, len, avoid, except = -1) {
  if (!fits(b, axis, lane, p, len, 'change')) return false;
  return cellsOf(b, axis, lane, p, len).every((k) => k === except || !avoid.has(k));
}

/** 구조물을 놓을 수 있는 칸인가 — 판 안·빈칸·변화구역·차선 아님·비워 둘 칸(keep) 아님 */
function canWall(b, axis, lane, c, avoid, keep) {
  if (c < 0 || c >= b.N) return false;
  const k = cellIdx(b.N, axis, lane, c);
  return b.grid[k] === EMPTY && !avoid.has(k) && !keep.has(k) && !isSafe(b, k % b.N, Math.floor(k / b.N));
}

/**
 * v가 side 쪽으로 [t0, t1]을 비우려면 지나갈 칸 — 구조물을 놓지 않을 칸(keep)으로 남겨 둔다.
 * ⚠️ 한쪽을 구조물로 막은 차의 반대쪽 길에 나중에 흩는 구조물이 떨어지면 그 차는 영영 못 비키고 통로가 죽는다
 */
function keepSweep(b, v, t0, t1, side, keep) {
  for (const c of sweepCells(b, v, t0, t1, side)) keep.add(cellIdx(b.N, v.axis, v.lane, c));
}

/** v가 side 쪽으로 [t0, t1]을 비우려면 지나갈 칸 (판 안만) */
function sweepCells(b, v, t0, t1, side) {
  const n = side > 0 ? t1 - v.p + 1 : v.p + v.len - t0;
  const out = [];
  for (let k = 1; k <= n; k++) {
    const c = side > 0 ? v.p + v.len - 1 + k : v.p - k;
    if (c >= 0 && c < b.N) out.push(c);
  }
  return out;
}

/** 그 길에 구조물이 있는가 — 있으면 그쪽으로는 영영 못 비킨다 */
function sweepDead(b, v, t0, t1, side) {
  return sweepCells(b, v, t0, t1, side).some((c) => b.grid[cellIdx(b.N, v.axis, v.lane, c)] === BLOCK);
}

/** (아직 놓지 않은) 그 자리의 차가 [t0, t1]을 비울 길이 적어도 한쪽은 트였는가 — 양쪽 다 구조물이면 놓자마자 죽은 차다 */
function canClear(b, axis, lane, p, len, t0, t1) {
  const v = { axis, lane, p, len };
  return !sweepDead(b, v, t0, t1, 1) || !sweepDead(b, v, t0, t1, -1);
}

/**
 * id번 차가 자기 차선의 [t0, t1]을 비우지 못하게 잠근다 — 한쪽 바로 옆에 구조물, 다른 쪽 길에 도우미 차.
 * depth: 이 차부터 센 연쇄 길이 (2면 도우미까지, 3이면 도우미도 잠근다)
 * 잠그지 않는 차(depth 1, 연쇄의 끝)도 sideWallChance로 한쪽 옆만 구조물로 막아 둔다 — 비킬 방향이 하나로 정해지고,
 * 나중에 무작위로 채운 차가 반대쪽 길에 서면 저절로 연쇄가 한 단계 더 생긴다
 * @param toward 이 차가 '요청한 차와 같은 차선'에 이어 선 도우미면 요청한 차 쪽 방향 (아니면 0)
 *   ⚠️ 그런 도우미는 요청한 차 쪽으로는 못 비킨다(요청한 차가 반대쪽이 막혀 물러설 수 없다) — 남은 길은 바깥쪽 하나뿐이라
 *      거기에 구조물을 두면 연쇄 전체가 죽는다. 그래서 더 잠그지도, 옆을 막지도 않는다
 * ⚠️ 한쪽을 막을 때는 반대쪽 길에 이미 구조물이 없는지 본다 — 있으면 양쪽이 다 막혀 그 통로가 죽는다
 * @returns 실제로 만든 연쇄 길이 (잠그지 못했으면 1)
 */
function lockVehicle(b, rng, id, t0, t1, depth, avoid, budget, g, toward = 0) {
  const v = b.vs[id];
  if (toward) {
    keepSweep(b, v, t0, t1, -toward, budget.keep);
    return 1;
  }
  if (depth < 2 || budget.blocks <= 0 || budget.vehicles <= 0) {
    let walled = 0;
    if (budget.blocks > 0 && rng.chance(g.sideWallChance)) {
      for (const side of rng.shuffle([1, -1])) {
        const c = side > 0 ? v.p + v.len : v.p - 1;
        if (sweepDead(b, v, t0, t1, -side) || !canWall(b, v.axis, v.lane, c, avoid, budget.keep)) continue;
        addBlock(b, cellIdx(b.N, v.axis, v.lane, c));
        budget.blocks--;
        walled = side;
        break;
      }
    }
    // 남은 쪽(막지 않았으면 양쪽) 길은 구조물 없이 남긴다
    for (const side of [1, -1]) if (side !== walled) keepSweep(b, v, t0, t1, side, budget.keep);
    return 1;
  }
  const sides = rng.shuffle([1, -1]);
  for (const wallSide of sides) {
    const helpSide = -wallSide;
    // 구조물 칸 = 막을 쪽 끝 바로 옆
    const wallC = wallSide > 0 ? v.p + v.len : v.p - 1;
    if (!canWall(b, v.axis, v.lane, wallC, avoid, budget.keep)) continue;
    // 도우미가 서야 할 길 = 반대쪽으로 [t0, t1]을 비우려고 지나갈 칸 (판 안만). 그 길에 구조물이 있으면 안 된다
    const sweep = sweepCells(b, v, t0, t1, helpSide);
    if (sweep.length === 0) continue;   // 판 끝에 붙어 있다 — 그쪽으로는 그냥 나가 버린다
    if (sweepDead(b, v, t0, t1, helpSide)) continue;
    const helper = placeHelper(b, rng, v, sweep, helpSide, avoid, budget);
    if (!helper) continue;
    addBlock(b, cellIdx(b.N, v.axis, v.lane, wallC));
    budget.blocks--;
    keepSweep(b, v, t0, t1, helpSide, budget.keep);   // 도우미가 비킨 뒤 v가 지나갈 길 — 도우미 너머에 구조물이 떨어지면 안 된다
    // 도우미도 잠근다 — 가로지른 도우미는 v 차선의 한 칸을, 같은 차선의 도우미는 v가 지나갈 칸 전부를 비워야 한다
    const h = b.vs[helper.id];
    const sub = h.axis !== v.axis
      ? lockVehicle(b, rng, helper.id, v.lane, v.lane, depth - 1, avoid, budget, g)
      : lockVehicle(b, rng, helper.id, Math.min(...sweep), Math.max(...sweep), depth - 1, avoid, budget, g, -helpSide);
    return 1 + sub;
  }
  return lockVehicle(b, rng, id, t0, t1, 1, avoid, budget, g);   // 잠그지 못했다 — 한쪽 옆만이라도
}

/** v가 helpSide로 지나갈 칸(sweep)에 도우미 차 한 대 — 가로지르게(7할) 또는 v 차선에 이어서 */
function placeHelper(b, rng, v, sweep, helpSide, avoid, budget) {
  const kind = budget.buses > 0 && rng.chance(budget.busRatio) ? 'bus' : 'car';
  const len = VEHICLE_LENGTH[kind];
  const options = [];
  if (rng.chance(0.7)) {
    const axis = v.axis === 'h' ? 'v' : 'h';
    for (const c of sweep) {
      // c = v 축 좌표 → 도우미의 차선(lane)은 c, 도우미 축 방향에서 v.lane을 덮어야 한다
      for (let p = v.lane - len + 1; p <= v.lane; p++) {
        if (fitsAvoiding(b, axis, c, p, len, avoid) && canClear(b, axis, c, p, len, v.lane, v.lane)) options.push({ axis, lane: c, p });
      }
    }
  }
  if (options.length === 0) {
    // 같은 차선 — v 끝 바로 다음부터 len칸
    const p = helpSide > 0 ? v.p + v.len : v.p - len;
    if (fitsAvoiding(b, v.axis, v.lane, p, len, avoid)) options.push({ axis: v.axis, lane: v.lane, p });
  }
  if (options.length === 0) return null;
  const o = rng.pick(options);
  budget.vehicles--;
  if (kind === 'bus') budget.buses--;
  return { id: addVehicle(b, { kind, len, axis: o.axis, lane: o.lane, p: o.p, role: 'helper' }) };
}

/**
 * 통로 하나를 막는다. @returns { blockers: 막는 차 번호들, chain: 가장 긴 연쇄 } | null (막는 차를 다 못 놓았다)
 */
function blockPassage(b, rng, limoId, sign, g, avoid, budget) {
  const L = b.vs[limoId];
  const coords = passageCoords(b, sign);
  const want = rng.range(g.passageBlockers[0], g.passageBlockers[1]);
  const blockers = [];
  let chain = 1;
  const pickKind = () => (budget.buses > 0 && rng.chance(budget.busRatio) ? 'bus' : 'car');
  const laneCell = (c) => cellIdx(b.N, L.axis, L.lane, c);

  // 길이 방향으로 눕힌 차 (통로당 최대 1대)
  if (rng.chance(g.collinearChance) && budget.vehicles > 0) {
    const kind = pickKind();
    const len = VEHICLE_LENGTH[kind];
    const starts = [];
    for (let i = 0; i + len <= coords.length; i++) {
      const cs = coords.slice(i, i + len);
      const p = Math.min(...cs);
      if (fits(b, L.axis, L.lane, p, len, 'change')) starts.push(p);
    }
    if (starts.length > 0) {
      const p = rng.pick(starts);
      blockers.push(addVehicle(b, { kind, len, axis: L.axis, lane: L.lane, p, role: 'blocker' }));
      budget.vehicles--;
      if (kind === 'bus') budget.buses--;
    }
  }
  // 가로지른 차 — 남은 수만큼, 통로의 빈칸 중 무작위로
  for (let tries = 0; blockers.length < want && tries < 40 && budget.vehicles > 0; tries++) {
    const free = coords.filter((c) => b.grid[laneCell(c)] === EMPTY);
    if (free.length === 0) break;
    const c = rng.pick(free);
    const kind = pickKind();
    const len = VEHICLE_LENGTH[kind];
    const axis = L.axis === 'h' ? 'v' : 'h';
    const ps = [];
    for (let p = L.lane - len + 1; p <= L.lane; p++) {
      // ⚠️ 이미 놓인 구조물이 양쪽 길을 다 막는 자리면 그 통로는 놓는 순간 죽는다
      if (fitsAvoiding(b, axis, c, p, len, avoid, laneCell(c)) && canClear(b, axis, c, p, len, L.lane, L.lane)) ps.push(p);
    }
    if (ps.length === 0) continue;
    const id = addVehicle(b, { kind, len, axis, lane: c, p: rng.pick(ps), role: 'blocker' });
    budget.vehicles--;
    if (kind === 'bus') budget.buses--;
    blockers.push(id);
    const depth = rng.chance(g.lockChance) ? rng.range(g.chainDepth[0], g.chainDepth[1]) : 1;
    chain = Math.max(chain, lockVehicle(b, rng, id, L.lane, L.lane, depth, avoid, budget, g));
  }
  return blockers.length >= g.passageBlockers[0] ? { limo: limoId, sign, blockers, chain } : null;
}

// ── 3) 변화구역 나머지 ─────────────────────────────────────

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
 * @param avoid 놓지 않을 칸 (리무진 차선 — 통로를 막는 차는 설계한 차뿐이어야 한다)
 */
function fillChangeZone(b, rng, cars, buses, samples, avoid) {
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
      if (cellsOf(b, axis, lane, p, len).some((k) => avoid.has(k))) continue;
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

// ── 4) 안전구역 ─────────────────────────────────────────

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
  // ⚠️ 구조물이 안전구역 차의 양쪽 길을 다 막으면 그 차는 영영 못 비키고 그 길(통로)이 죽는다 — 차마다 한쪽 길은 남긴다
  const targets = placed.map((i) => (b.vs[i].axis === 'v' ? limos.ra : limos.cb));   // 그 차가 비워야 할 리무진 차선
  const stillMovable = () => placed.every((i, n) => [1, -1].some((side) => !sweepDead(b, b.vs[i], targets[n], targets[n], side)));
  let walls = 0;
  while (walls < wallCount && pool.length > 0) {
    const total = pool.reduce((s, e) => s + e.w, 0);
    let r = rng.next() * total;
    let j = 0;
    while (r >= pool[j].w) r -= pool[j++].w;
    const k = pool[j].k;
    pool.splice(j, 1);
    addBlock(b, k);
    if (!stillMovable()) {
      b.blocks.pop();
      b.grid[k] = EMPTY;
      continue;
    }
    walls++;
  }
  return walls === wallCount;   // 다 못 놓았으면 이 배치는 버린다 (구조물 수는 설정 그대로여야 한다)
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

/** 리무진마다 앞뒤 통로가 모두 쓸 수 있는가 (연쇄 하한이 '영영 못 비킨다'고 하는 차가 없다) */
function passagesAlive(puzzle, limos) {
  return limos.ids.every((id) => [-1, 1].every((sign) => passageChainOf(puzzle, puzzle.start, id, sign) !== null));
}

/** 판이 목표 범위에서 얼마나 벗어났나 (0 = 범위 안) */
function missOf(par, range) {
  return par < range[0] ? range[0] - par : Math.max(0, par - range[1]);
}

/**
 * 하드 모드 판 하나.
 *
 * ★ 난이도 필터 — 랜덤 이동이 없다고 가정한 최소 클리어 수가 targetMoves 범위인 판만 쓴다.
 *   단계(stages)마다 stageAttempts번까지 지어 보고, 범위에 드는 판이 없으면 다음 단계로 — 단계가 오를수록 통로를 막는 차가
 *   늘고 잠금·연쇄가 깊어진다 ('조금씩 늘려 재시도'). 끝까지 못 맞추면 범위에 가장 가까운 판을 쓴다 (게임이 멈추면 안 된다).
 *
 * @param config HARD_MODE (size, safeSize, startVehicles, busRatio, limos, blocks, safeBlocks, safeCars, safeBusMax, safeLeave,
 *   targetMoves, gen?)
 * @returns {{ def, par, exact, solution, leaveSafe, passages: [{ blockers, chain }] ×4, chainBlocks, stage, attempts, tried, met, ms }}
 *   par — 랜덤 이동이 없다면 리무진 둘을 모두 빼는 최소 수 (관련 차만 움직인 수순 — 실제 최소의 상한)
 *   exact — par가 최소임이 증명됐는가 (연쇄 하한과 같거나, 더 짧은 수순이 없음을 확인했다)
 *   leaveSafe — 리무진마다 안전구역을 벗어나는 최소 수 (판의 리무진 번호 순)
 *   stage — 몇 번째 단계에서 지은 판인가 (0부터), attempts — 몇 번째로 지은 판인가, tried — 모두 몇 번 지어 봤나,
 *   met — targetMoves 범위에 들었는가
 */
export function generateHardBoard(config, seed) {
  const t0 = Date.now();
  if ((config.limos ?? 2) !== 2) throw new Error('하드 모드 판 생성기는 리무진 2대(가로·세로 하나씩)만 짓습니다.');
  const base = { ...HARD_GEN_DEFAULTS, ...config, ...(config.gen ?? {}) };
  const rng = createRng(`hard:${seed}`);
  const range = base.targetMoves ?? null;
  const stages = range ? base.stages : [{}];
  let best = null;
  let attempt = 0;
  for (let stage = 0; stage < stages.length; stage++) {
    const g = { ...base, ...stages[stage] };
    const tries = !range ? g.attempts : stage === stages.length - 1 ? g.finalAttempts : g.stageAttempts;
    for (let t = 0; t < tries; t++) {
      attempt++;
      const board = buildBoard(config, g, rng);
      if (!board) continue;
      const result = { ...board, stage, attempts: attempt };
      if (!range) return { ...result, met: true, tried: attempt, ms: Date.now() - t0 };
      const miss = missOf(board.par, range);
      if (miss === 0) return { ...result, met: true, tried: attempt, ms: Date.now() - t0 };
      if (!best || miss < best.miss) best = { ...result, miss };
    }
  }
  if (best) {
    const { miss, ...result } = best;
    return { ...result, met: false, tried: attempt, ms: Date.now() - t0 };
  }
  throw new Error('하드 모드 판을 만들지 못했어요.');
}

/** 판 한 벌을 지어 재 본다 — 풀리지 않거나 조건을 못 맞추면 null (g.stats가 있으면 이유를 센다) */
function buildBoard(config, g, rng) {
  const reject = (why) => {
    if (g.stats) (g.stats.reject ??= {})[why] = (g.stats.reject[why] ?? 0) + 1;
    return null;
  };
  const solveOpts = { maxNodes: g.solverNodes };
  const totalBuses = Math.round(config.startVehicles * config.busRatio);
  const b = newBoard(config.size, config.safeSize);
  const limos = placeLimos(b, rng);
  const lanes = laneCells(b, limos);

  const nSafe = rng.range(g.safeCars[0], g.safeCars[1]);
  const safeBuses = Math.min(g.safeBusMax, totalBuses, rng.chance(0.5) ? 1 : 0);
  // 변화구역에 쓸 몫 — 통로 봉쇄가 먼저 쓰고, 남은 것을 흩고 채운다
  const budget = {
    vehicles: config.startVehicles - nSafe,
    buses: totalBuses - safeBuses,
    blocks: config.blocks,
    busRatio: config.busRatio,
    keep: new Set(),   // 구조물을 놓지 않을 칸 — 설계한 차가 비켜날 길
  };
  const passages = [];
  for (const id of limos.ids) {
    for (const sign of [-1, 1]) passages.push(blockPassage(b, rng, id, sign, g, lanes, budget));
  }
  if (passages.some((ps) => !ps)) return reject('passage');
  const chainBlocks = config.blocks - budget.blocks;
  scatterBlocks(b, rng, budget.blocks, new Set([...lanes, ...budget.keep]));
  if (!fillChangeZone(b, rng, budget.vehicles - budget.buses, budget.buses, g.fillSamples, lanes)) return reject('fill');

  // 안전구역 — 리무진마다 벗어나는 최소 수가 범위에 들 때까지 다시 뽑는다.
  // ★ 먼저 안전구역을 비워 둔 채로 재 본다. 안전구역의 차·구조물은 길을 더 막을 뿐이므로, 빈 채로도 상한을 넘으면
  //   어떤 배치를 뽑아도 안 된다 — 변화구역부터 다시 짓는다 (그냥 두면 배치를 수백 번 헛뽑는다)
  const leaveOpts = { ...solveOpts, maxDepth: g.safeLeave[1], maxNodes: g.leaveNodes };
  const empty = rawPuzzle(b);
  if (limos.ids.some((id) => !leaveSafeOf(b, empty, id, leaveOpts).solved)) return reject('leave-empty');
  // ★ 통로 4개가 모두 '쓸 수 있는' 통로여야 한다 — 막는 차가 영영 못 비키는 통로(구조물에 갇힌 연쇄)는 쉬운 통로를 없앤 게 아니라
  //   통로 하나를 지운 것이라, 리무진마다 길이 하나만 남는다. 연쇄 하한이 '못 쓴다'고 하면 버린다
  if (!passagesAlive(empty, limos)) return reject('dead-passage');
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
    if (ls.length === limos.ids.length && passagesAlive(puzzle, limos)) {
      leave = ls;
      break;
    }
  }
  if (!leave) return reject('leave');

  const { def, order } = toDef(b, rng);
  const puzzle = createPuzzle(def);
  const limoIds = puzzle.vehicles.filter((v) => v.kind === 'limo').map((v) => v.id);
  // 판 정의는 차 순서를 섞었으므로, 리무진별 값도 섞은 뒤의 순서(판의 리무진 번호 순)로 돌려준다
  const leaveByLimo = limoIds.map((id) => leave[limos.ids.indexOf(order[id])]);
  const r = minEscapeMoves(puzzle, puzzle.start, limoIds, solveOpts);
  if (g.stats) tally(g.stats, 'escape', r);
  if (!r.solved) {
    if (g.stats) (g.stats.failedDefs ??= []).push({ def, reason: r.reason });
    return reject(`escape-${r.reason}`);
  }
  return {
    def,
    par: r.length,
    exact: r.exact,
    solution: r.moves,
    leaveSafe: leaveByLimo,
    // 통로마다 (설계한) 막는 차 수와 가장 긴 연쇄 — 보고서용
    passages: passages.map((ps) => ({ blockers: ps.blockers.length, chain: ps.chain })),
    chainBlocks,   // 변화구역 구조물 중 연쇄(잠금)에 쓴 수
  };
}
