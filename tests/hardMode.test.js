import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HardSession, HardStatus, HardStuck, zoneLayout, isSafeCell, inChangeZone, randomMovable, spawnVehicle,
  checkHardStuck, generateHardPuzzle, hardPuzzleParams,
} from '../src/core/hardMode.js';
import { HARD_MODE } from '../src/core/levels.js';
import { createRng } from '../src/core/random.js';
import {
  EXITED, EMPTY, OFF_BOARD, buildGrid, createPuzzle, getMove, applyMove, isCleared, listMoves, travel, vehicleCells,
} from '../src/core/rules.js';
import { board, idOf } from './helpers.js';

/** 작은 판으로 시험할 때의 설정 (9×9, 가운데 3×3이 안전구역) */
const SMALL = { ...HARD_MODE, size: 9, safeSize: 3 };

/** 하드 모드 판 하나를 아무렇게나(시드 고정) 두며 매 턴 결과를 넘겨준다 */
function playRandomly(session, turns, seed, onTurn) {
  const pick = createRng(`pick:${seed}`);
  for (let t = 0; t < turns && session.status === HardStatus.PLAYING; t++) {
    const moves = listMoves(session.puzzle, session.pos);
    if (moves.length === 0) break;
    const exits = moves.filter((m) => m.exits);
    const m = exits.length > 0 && pick.chance(0.5) ? pick.pick(exits) : pick.pick(moves);
    const before = session.state;
    const r = session.move(m.vehicle, m.sign);
    onTurn?.(r, before, session.state);
  }
}

const hardBoards = ['T1', 'T2', 'T3'].map((seed) => {
  const g = generateHardPuzzle(seed);
  return { seed, g, puzzle: createPuzzle(g.def) };
});

// ── 구역 ────────────────────────────────────────────────

test('구역: 25×25에서 안전구역은 정중앙 5×5(10~14), 나머지는 변화구역', () => {
  const z = zoneLayout(25, 5);
  assert.deepEqual([z.lo, z.hi], [10, 14]);
  assert.equal(isSafeCell(z, 10, 10), true);
  assert.equal(isSafeCell(z, 14, 14), true);
  assert.equal(isSafeCell(z, 9, 12), false);
  assert.equal(isSafeCell(z, 12, 15), false);
  assert.equal(isSafeCell(z, 0, 0), false);
  assert.throws(() => zoneLayout(25, 4), /짝수/);
});

// ── 판 생성 ─────────────────────────────────────────────

test('판 생성: 25×25, 설정대로의 차량·구조물, 랜덤 이동이 없다면 풀린다', () => {
  const p = hardPuzzleParams();
  for (const { g, puzzle } of hardBoards) {
    assert.equal(puzzle.size, 25);
    assert.equal(puzzle.vehicles.length, HARD_MODE.startVehicles);
    assert.equal(puzzle.vehicles.filter((v) => v.kind === 'bus').length, p.buses);
    assert.equal(puzzle.blocks.length, HARD_MODE.blocks);
    let pos = puzzle.start.slice();
    for (const m of g.solution) pos = applyMove(pos, getMove(puzzle, pos, m.vehicle, m.sign));
    assert.ok(isCleared(pos));
  }
});

// ── 랜덤 이동 ────────────────────────────────────────────

test('랜덤 이동: 매 턴 1~4대를 정하고, 움직일 차가 모자라면 있는 만큼만 — 같은 차는 두 번 안 고른다', () => {
  const requested = new Set();
  for (const { seed, puzzle } of hardBoards) {
    const s = new HardSession(puzzle, seed);
    playRandomly(s, 150, seed, (r, before) => {
      if (!r?.moved || r.cleared) return;
      const { requested: k, moves } = r.random;
      requested.add(k);
      assert.ok(k >= 1 && k <= 4, `대수 ${k}`);
      assert.ok(moves.length <= k);
      assert.equal(new Set(moves.map((m) => m.vehicle)).size, moves.length, '같은 차를 두 번 고르지 않는다');
      for (const m of moves) assert.ok(m.dist >= 1, '고른 차는 실제로 움직인다');
      if (moves.length < k) {
        // 모자랐다면, 그 턴의 랜덤 이동이 끝난 시점에 (이번 턴에 안 고른 차 중) 움직일 수 있는 차가 없어야 한다
        const afterRandom = applyPlayerAndRandom(before, r);
        const left = randomMovable(before.puzzle, buildGrid(before.puzzle, afterRandom), s.zone, afterRandom, new Set(moves.map((m) => m.vehicle)));
        assert.deepEqual(left, []);
      }
    });
  }
  assert.deepEqual([...requested].sort(), [1, 2, 3, 4], '1~4가 모두 나온다');
});

/** 턴 시작 상태 + 결과로 '랜덤 이동 직후'(새 차 도착 전) 위치를 다시 만든다 */
function applyPlayerAndRandom(before, r) {
  const pos = applyMove(before.pos, r.move);
  for (const m of r.random.moves) pos[m.vehicle] = m.to;
  return pos;
}

test('랜덤 이동: 판 밖으로 나가지 않고, 안전구역에 들어가지 않고, 막힌 곳 바로 앞에서 멈춘다', () => {
  for (const { seed, puzzle } of hardBoards) {
    const s = new HardSession(puzzle, seed);
    playRandomly(s, 150, seed, (r, before) => {
      if (!r?.moved || r.cleared) return;
      const pz = before.puzzle;
      const pos = applyMove(before.pos, r.move);
      for (const m of r.random.moves) {
        assert.ok(inChangeZone(pz, s.zone, m.vehicle, pos[m.vehicle]), '움직이기 전에도 변화구역 안');
        assert.equal(pos[m.vehicle], m.from);
        pos[m.vehicle] = m.to;
        assert.notEqual(m.to, EXITED, '판 밖으로 나가지 않는다');
        const v = pz.vehicles[m.vehicle];
        for (const c of vehicleCells(pz, m.vehicle, m.to)) {
          assert.ok(c.x >= 0 && c.y >= 0 && c.x < pz.size && c.y < pz.size, '판 안');
          assert.equal(isSafeCell(s.zone, c.x, c.y), false, '안전구역에 들어가지 않는다');
        }
        // 멈춘 자리의 바로 다음 칸은 판 끝·안전구역·다른 무언가 중 하나여야 한다 (중간에 서지 않는다)
        const grid = buildGrid(pz, pos);
        const next = m.sign > 0 ? m.to + v.len : m.to - 1;
        if (next >= 0 && next < pz.size) {
          const [x, y] = v.axis === 'h' ? [next, v.lane] : [v.lane, next];
          assert.ok(grid[y * pz.size + x] !== EMPTY || isSafeCell(s.zone, x, y), '막힌 곳 바로 앞에서 멈춘다');
        }
      }
      // 겹친 차가 없다
      const cells = new Set();
      const after = s.state;
      after.pos.forEach((p, i) => {
        if (p === EXITED) return;
        for (const c of vehicleCells(after.puzzle, i, p)) {
          const k = `${c.x},${c.y}`;
          assert.ok(!cells.has(k), `칸 ${k}가 겹친다`);
          cells.add(k);
        }
      });
    });
  }
});

test('랜덤 이동: 안전구역에 한 칸이라도 걸친 차는 움직이지 않는다', () => {
  // 9×9, 안전구역 (3~5, 3~5). a는 안전구역에 걸쳐 있고 양옆이 비어 있다. b는 변화구역에서 움직일 수 있다
  const p = board(`
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . a A . . .
    . . . . . . . . .
    . . . . . . . . .
    . b B . . . . . .
    . . . . . . . . .
  `);
  const z = zoneLayout(9, 3);
  const grid = buildGrid(p, p.start);
  assert.deepEqual(randomMovable(p, grid, z, p.start), [idOf(p, 'b')]);
});

// ── 새 차량 ─────────────────────────────────────────────

// 세로 자동차 4대가 맨 윗줄에 붙어 있고 바로 밑이 구조물 — 위로 밀면 바로 나가고, 랜덤으로는 못 움직인다
const COLUMNS = `
  a b c d . e f g .
  A B C D . E F G .
  # # # # . # # # .
  . . . . . . . . .
  . . . . . . . . .
  . . . . . . . . .
  . . . . . . . . .
  . . . . . . . . .
  . . . . . . . . .
`;

test('새 차량: 탈출하면 3턴 카운트다운, 그 사이 여러 대를 빼도 1대만 온다', () => {
  const p = board(COLUMNS);
  const s = new HardSession(p, 'cd', SMALL);
  const up = (label) => s.move(idOf(p, label), -1);

  let r = up('a');
  assert.equal(r.countdownStarted, true);
  assert.equal(s.countdown, 3);
  r = up('b');                        // 카운트다운 중 탈출 — 다시 시작하지 않는다
  assert.equal(r.countdownStarted, false);
  assert.equal(s.countdown, 2);
  r = up('c');
  assert.equal(s.countdown, 1);
  assert.equal(r.spawned, null);
  r = up('d');                        // 3턴이 지났다 — 1대 도착, 이 턴의 탈출은 도착 전 일이라 새 카운트다운 없음
  assert.notEqual(r.spawned, null);
  assert.equal(s.countdown, null);
  assert.equal(s.puzzle.vehicles.length, 8);   // 7대 + 새 차 1대
  assert.equal(s.remaining, 7 - 4 + 1);

  r = up('e');                        // 차가 온 뒤의 탈출 — 새 카운트다운
  assert.equal(r.countdownStarted, true);
  assert.equal(s.countdown, 3);
});

test('새 차량: 변화구역의 빈 자리에, 바로 나갈 수 없는 자리를 고른다', () => {
  const z = zoneLayout(25, 5);
  for (const { seed, puzzle } of hardBoards) {
    for (let k = 0; k < 20; k++) {
      const rng = createRng(`spawn:${seed}:${k}`);
      const added = spawnVehicle(puzzle, z, puzzle.start, rng, HARD_MODE);
      assert.ok(added, '자리가 있다');
      assert.equal(added.exitable, false, '바로 나갈 수 있는 자리는 피한다');
      const pos = [...puzzle.start, added.p];
      const grid = buildGrid(added.puzzle, pos);
      assert.ok(inChangeZone(added.puzzle, z, added.id, added.p));
      assert.notEqual(travel(added.puzzle, grid, pos, added.id, -1), OFF_BOARD);
      assert.notEqual(travel(added.puzzle, grid, pos, added.id, 1), OFF_BOARD);
      // 다른 차·구조물과 겹치지 않는다 (buildGrid가 덮어썼다면 칸 수가 모자란다)
      const filled = grid.reduce((n, c) => n + (c !== EMPTY ? 1 : 0), 0);
      const expected = puzzle.blocks.length + pos.reduce((n, q, i) => n + (q === EXITED ? 0 : added.puzzle.vehicles[i].len), 0);
      assert.equal(filled, expected);
    }
  }
});

// ── 클리어·막힘 ───────────────────────────────────────────

test('클리어: 판이 비는 순간 클리어, 진행 중이던 카운트다운은 취소', () => {
  const p = board(`
    a b . . . . . . .
    A B . . . . . . .
    # # . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
  `);
  const s = new HardSession(p, 'clear', SMALL);
  s.move(idOf(p, 'a'), -1);
  assert.equal(s.countdown, 3);
  const r = s.move(idOf(p, 'b'), -1);
  assert.equal(r.cleared, true);
  assert.equal(s.status, HardStatus.CLEARED);
  assert.equal(s.countdown, null);
  assert.equal(s.move(idOf(p, 'b'), 1), null);
});

test('막힘: 아무 차도 못 움직이면 막힘, 카운트다운 중이거나 랜덤 이동이 판을 바꿀 수 있으면 아니다', () => {
  const z = zoneLayout(9, 3);
  // 바람개비 네 대가 서로 막고 바깥은 구조물 — 플레이어도 랜덤도 아무것도 못 움직인다
  const stuck = board(`
    . . . # . . . . .
    # a A b . . . . .
    . d . B . . . . .
    . D c C # . . . .
    . # . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
  `);
  assert.equal(checkHardStuck(stuck, z, stuck.start, null), HardStuck.STUCK);
  assert.equal(checkHardStuck(stuck, z, stuck.start, 2), HardStuck.OK);

  // 나갈 수는 없지만 플레이어가 한 칸 밀 수 있고, 그 뒤 랜덤으로 움직일 차가 있다 → 판이 바뀔 수 있다
  const shuffled = board(`
    # . . . . . . . #
    # a A . . . . . #
    # # # # # # # # #
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
  `);
  assert.equal(checkHardStuck(shuffled, z, shuffled.start, null), HardStuck.OK);

  const s = new HardSession(stuck, 'stuck', SMALL);
  assert.equal(s.status, HardStatus.STUCK);
});

// ── 같은 시드 · 되돌리기 ──────────────────────────────────

test('같은 시드·같은 수순이면 랜덤 이동·새 차량까지 완전히 같다', () => {
  const { seed, puzzle } = hardBoards[0];
  const a = new HardSession(puzzle, seed);
  const b = new HardSession(puzzle, seed);
  const logA = [];
  playRandomly(a, 80, 'same', (r) => logA.push(JSON.stringify(r)));
  const logB = [];
  playRandomly(b, 80, 'same', (r) => logB.push(JSON.stringify(r)));
  assert.deepEqual(logA, logB);
  assert.deepEqual(a.state.pos, b.state.pos);
  assert.deepEqual(a.state.rng, b.state.rng);

  // 시드가 다르면 (같은 판·같은 수라도) 랜덤 결과가 달라진다
  const c = new HardSession(puzzle, `${seed}-다른`);
  const m = listMoves(puzzle, puzzle.start)[0];
  assert.notDeepEqual(
    JSON.stringify(new HardSession(puzzle, seed).move(m.vehicle, m.sign).random),
    JSON.stringify(c.move(m.vehicle, m.sign).random),
  );
});

test('되돌리기: 난수 상태까지 돌아가 같은 수를 다시 두면 같은 결과가 나온다', () => {
  const { seed, puzzle } = hardBoards[1];
  const s = new HardSession(puzzle, seed);
  playRandomly(s, 30, 'undo', null);           // 판을 좀 섞어 두고
  const snapshot = s.state;
  const moves = listMoves(s.puzzle, s.pos);
  const m = moves[moves.length - 1];

  const first = s.move(m.vehicle, m.sign);
  const afterFirst = s.state;
  const undone = s.undo();
  assert.equal(undone.after, snapshot);
  assert.deepEqual(s.state.rng, snapshot.rng, '난수 상태가 돌아온다');
  assert.deepEqual(s.state.pos, snapshot.pos);
  assert.equal(s.undoCount, 1);

  const second = s.move(m.vehicle, m.sign);
  assert.deepEqual(second, first, '같은 수 → 같은 랜덤 이동·같은 새 차량');
  assert.deepEqual(s.state.pos, afterFirst.pos);
  assert.deepEqual(s.state.rng, afterFirst.rng);
});

test('되돌리기: 새 차량 도착과 카운트다운도 함께 되돌린다', () => {
  const p = board(COLUMNS);
  const s = new HardSession(p, 'undo-spawn', SMALL);
  for (const label of ['a', 'b', 'c']) s.move(idOf(p, label), -1);
  assert.equal(s.countdown, 1);
  const r = s.move(idOf(p, 'd'), -1);
  assert.notEqual(r.spawned, null);
  assert.equal(s.puzzle.vehicles.length, 8);

  s.undo();
  assert.equal(s.puzzle.vehicles.length, 7, '도착한 차가 사라진다');
  assert.equal(s.countdown, 1);
  assert.equal(s.moveCount, 3);
  assert.equal(s.pos[idOf(p, 'd')], 0, 'd가 판으로 돌아온다');

  const again = s.move(idOf(p, 'd'), -1);
  assert.deepEqual(again.spawned, r.spawned, '같은 자리에 같은 차가 다시 온다');
});

test('막혀서 못 움직인 수는 턴이 아니다 — 랜덤 이동도 카운트다운도 없다', () => {
  const p = board(COLUMNS);
  const s = new HardSession(p, 'blocked', SMALL);
  s.move(idOf(p, 'a'), -1);
  const before = s.state;
  const r = s.move(idOf(p, 'b'), 1);    // 아래는 구조물 — 한 칸도 못 간다
  assert.equal(r.moved, false);
  assert.equal(s.state, before);
  assert.equal(s.moveCount, 1);
  assert.equal(s.countdown, 3);
});
