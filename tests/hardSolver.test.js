import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  passageInfo, relevantVehicles, minEscapeMoves, minLeaveSafeMoves, minClearPassageMoves, buildFullGrid,
} from '../src/core/hardSolver.js';
import { createPuzzle, buildGrid, travel, EXITED, OFF_BOARD, getMove, applyMove } from '../src/core/rules.js';
import { parseTextBoard } from '../src/core/textBoard.js';
import { createRng } from '../src/core/random.js';
import { idOf } from './helpers.js';

function limoBoard(text, labels) {
  const def = parseTextBoard(text);
  for (const v of def.vehicles) if (labels.includes(v.label)) v.kind = 'limo';
  return createPuzzle(def);
}

/**
 * 줄이기 없는 완전 탐색 — 리무진을 다 빼는 진짜 최소 수 (작은 판 전용).
 * @param movable 움직여도 되는 차 (없으면 모든 차) — A*가 관련 차량만 움직이므로 같은 조건으로 견주려고
 */
function exactEscape(puzzle, limoIds, maxStates = 300000, movable = null) {
  const start = puzzle.start.slice();
  if (limoIds.every((l) => start[l] === EXITED)) return 0;
  let frontier = [start];
  const seen = new Set([start.join()]);
  for (let d = 1; frontier.length > 0; d++) {
    const next = [];
    for (const cur of frontier) {
      const grid = buildGrid(puzzle, cur);
      for (let i = 0; i < puzzle.vehicles.length; i++) {
        if (cur[i] === EXITED || (movable && !movable.has(i))) continue;
        for (const s of [-1, 1]) {
          const t = travel(puzzle, grid, cur, i, s);
          if (t === 0) continue;
          const p = cur.slice();
          p[i] = t === OFF_BOARD ? EXITED : cur[i] + s * t;
          if (limoIds.every((l) => p[l] === EXITED)) return d;
          const k = p.join();
          if (seen.has(k)) continue;
          seen.add(k);
          if (seen.size > maxStates) return null;
          next.push(p);
        }
      }
    }
    frontier = next;
  }
  return null;
}

function replayEscapes(puzzle, moves, limoIds) {
  let pos = puzzle.start.slice();
  for (const m of moves) {
    const mv = getMove(puzzle, pos, m.vehicle, m.sign);
    if (!mv?.moved) return false;
    pos = applyMove(pos, mv);
  }
  return limoIds.every((l) => pos[l] === EXITED);
}

// k: 가로 리무진 — 왼쪽은 구조물(죽은 통로), 오른쪽 통로를 a·b가 가로막고 b는 c에 막혀 있다
const CHAIN = `
  . . . . . . . . .
  . . . . . . c . .
  . . . . . . C . .
  . . . . a . b . .
  # k K . A . B . .
  . . . . . . . . .
  . . . . . . # . .
  . . . . . . . . .
  . . . . . . . . .
`;

test('통로: 리무진 앞뒤 두 통로의 칸·막는 차·구조물 여부', () => {
  const p = limoBoard(CHAIN, ['k']);
  const k = idOf(p, 'k');
  const [back, front] = passageInfo(p, p.start, buildFullGrid(p, p.start), k);
  assert.equal(back.dead, true);
  assert.deepEqual(back.blockers, []);
  assert.equal(front.dead, false);
  assert.deepEqual(front.blockers, [idOf(p, 'a'), idOf(p, 'b')]);
  assert.equal(front.cells.length, 6);
});

test('관련 차량: 통로를 막는 차에서 시작해 그 차를 막는 차로 퍼진다', () => {
  const p = limoBoard(CHAIN, ['k']);
  const grid = buildFullGrid(p, p.start);
  const seeds = [idOf(p, 'k'), idOf(p, 'a'), idOf(p, 'b')];
  const r = relevantVehicles(p, p.start, grid, seeds, 3);
  assert.ok(r.ids.includes(idOf(p, 'c')), 'b가 위로 비키려면 c가 먼저 — c도 관련 차량');
  assert.equal(r.depthOf.get(idOf(p, 'c')), 1);
});

test('최소 수: 연쇄가 있는 판 — a 비키기, c 비키기, b 비키기, 리무진 = 4수', () => {
  const p = limoBoard(CHAIN, ['k']);
  const k = idOf(p, 'k');
  const r = minEscapeMoves(p, p.start, [k]);
  assert.equal(r.solved, true);
  assert.equal(r.length, 4);
  assert.equal(exactEscape(p, [k]), 4);
  assert.ok(replayEscapes(p, r.moves, [k]), '찾은 수순을 실제로 두면 리무진이 나간다');
});

/** 작은 무작위 판 — 리무진 1대(0번) + 자동차·버스 여럿 + 구조물 몇 개 */
function randomSmallBoard(rng, N, count, blocks) {
  const occ = new Set();
  const vehicles = [];
  const blockList = [];
  const place = (kind, len) => {
    for (let a = 0; a < 60; a++) {
      const h = rng.chance(0.5);
      const lane = rng.int(N);
      const p0 = rng.int(N - len + 1);
      const cells = Array.from({ length: len }, (_, k) => (h ? `${p0 + k},${lane}` : `${lane},${p0 + k}`));
      if (cells.some((c) => occ.has(c))) continue;
      cells.forEach((c) => occ.add(c));
      vehicles.push({ kind, x: h ? p0 : lane, y: h ? lane : p0, front: h ? 'right' : 'down' });
      return;
    }
  };
  place('limo', 2);
  for (let c = 0; c < count; c++) {
    const bus = rng.chance(0.3);
    place(bus ? 'bus' : 'car', bus ? 3 : 2);
  }
  for (let b = 0; b < blocks; b++) {
    const x = rng.int(N);
    const y = rng.int(N);
    if (occ.has(`${x},${y}`)) continue;
    occ.add(`${x},${y}`);
    blockList.push([x, y]);
  }
  return createPuzzle({ size: N, blocks: blockList, vehicles });
}

test('최소 수: 작은 무작위 판에서, 같은 차만 움직이는 완전 탐색과 언제나 같은 답 (A*가 최소를 놓치지 않는다)', () => {
  const rng = createRng('hard-solver-exact');
  let compared = 0;
  for (let t = 0; t < 120 && compared < 25; t++) {
    const puzzle = randomSmallBoard(rng, 7, 8, 3);
    const limo = 0;
    const r = minEscapeMoves(puzzle, puzzle.start, [limo], { closureDepth: 3 });
    if (!r.solved && r.reason !== 'depth' && r.reason !== 'impossible') continue;
    const grid = buildFullGrid(puzzle, puzzle.start);
    const seeds = new Set([limo]);
    for (const ps of passageInfo(puzzle, puzzle.start, grid, limo)) if (!ps.dead) ps.blockers.forEach((b) => seeds.add(b));
    const { ids } = relevantVehicles(puzzle, puzzle.start, grid, [...seeds], 3);
    const exact = exactEscape(puzzle, [limo], 300000, new Set(ids));
    if (exact == null) {
      assert.equal(r.solved, false, `시도 ${t}: 완전 탐색은 못 푸는데 A*가 풀었다`);
      continue;
    }
    compared++;
    assert.equal(r.solved, true, `시도 ${t}`);
    assert.equal(r.length, exact, `시도 ${t}: A* ${r.length} / 완전 탐색 ${exact}`);
    assert.ok(replayEscapes(puzzle, r.moves, [limo]));
    // 관련 차량만 움직인 답은 판 전체를 움직이는 진짜 최소보다 짧을 수 없다 (상한)
    const full = exactEscape(puzzle, [limo]);
    if (full != null) assert.ok(r.length >= full);
  }
  assert.ok(compared >= 10, `견준 판 ${compared}개`);
});

test('최소 수: 리무진 두 대 — 통로를 함께 쓰는 차는 한 번만 센다', () => {
  // k(가로)는 오른쪽, m(세로)은 아래로 — a 하나가 두 통로를 다 막고 있다
  const p = limoBoard(`
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . k K . . . . a .
    . . . . . . . A .
    . . . . . . . . .
    . . . . . . . m .
    . . . . . . . M .
  `, ['k', 'm']);
  const k = idOf(p, 'k');
  const m = idOf(p, 'm');
  // m(세로, 7열 7~8행) 위쪽 통로에 a(7열 4~5행)가 있다. k(가로, 4행) 오른쪽 통로에도 a가 있다
  const r = minEscapeMoves(p, p.start, [k, m]);
  assert.equal(r.solved, true);
  assert.equal(r.length, exactEscape(p, [k, m]));
});

test('안전구역을 벗어나는 최소 수', () => {
  // 9×9, 안전구역 3~5. k는 안전구역 안 가로 리무진 — 왼쪽은 구조물, 오른쪽을 세로 차 b가 막고 b는 아래가 구조물
  const p = limoBoard(`
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . b . . .
    . . # k K B . . #
    . . . . . # . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
  `, ['k']);
  const k = idOf(p, 'k');
  const inSafe = (x, y) => x >= 3 && x <= 5 && y >= 3 && y <= 5;
  const r = minLeaveSafeMoves(p, p.start, k, inSafe);
  // b를 위로 비키고(1) 리무진을 오른쪽으로(2) — 오른쪽 끝 구조물 앞(6~7열)에서 멈춰 안전구역 밖
  assert.equal(r.solved, true);
  assert.equal(r.length, 2);
});

test('상한: 깊이 상한보다 긴 수순은 찾지 않고, 상태 수 상한에 걸리면 이유를 알려 준다', () => {
  const p = limoBoard(CHAIN, ['k']);
  const k = idOf(p, 'k');
  assert.equal(minEscapeMoves(p, p.start, [k], { maxDepth: 3 }).solved, false);
  assert.equal(minEscapeMoves(p, p.start, [k], { maxDepth: 3 }).reason, 'depth');
  assert.equal(minEscapeMoves(p, p.start, [k], { maxNodes: 1 }).reason, 'nodes');
  // 양쪽 통로가 모두 구조물에 막히면 처음부터 불가능
  const dead = limoBoard(`
    . . . . .
    . . . . .
    # k K . #
    . . . . .
    . . . . .
  `, ['k']);
  assert.equal(minEscapeMoves(dead, dead.start, [idOf(dead, 'k')]).reason, 'impossible');
});

test('통로 하나를 비우는 최소 수 (분석용)', () => {
  const p = limoBoard(CHAIN, ['k']);
  const k = idOf(p, 'k');
  const [, front] = passageInfo(p, p.start, buildFullGrid(p, p.start), k);
  const r = minClearPassageMoves(p, p.start, front);
  assert.equal(r.solved, true);
  assert.equal(r.length, 3);
});
