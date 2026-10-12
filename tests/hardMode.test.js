import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HardSession, HardStatus, HardStuck, zoneLayout, isSafeCell, inChangeZone, randomMovable, randomTravel, spawnVehicle,
  checkHardStuck, generateHardPuzzle, hardScore, livePassages, estimateTarget, blockChance, runRandomPhase,
} from '../src/core/hardMode.js';
import { minLeaveSafeMoves } from '../src/core/hardSolver.js';
import { HARD_GEN_DEFAULTS } from '../src/core/hardGenerator.js';
import { HARD_MODE } from '../src/core/levels.js';
import { createRng } from '../src/core/random.js';
import {
  EXITED, EMPTY, BLOCK, OFF_BOARD, buildGrid, createPuzzle, getMove, applyMove, isCleared, listMoves, travel, vehicleCells,
} from '../src/core/rules.js';
import { parseTextBoard } from '../src/core/textBoard.js';
import { board, idOf } from './helpers.js';

/** 작은 판으로 시험할 때의 설정 (9×9, 가운데 3×3이 안전구역) */
const SMALL = { ...HARD_MODE, size: 9, safeSize: 3 };

/** 글자 그림 판에서 labels의 차를 리무진으로 바꾼다 (글자 그림은 칸 수로 자동차·버스만 가른다) */
function limoBoard(text, labels) {
  const def = parseTextBoard(text);
  for (const v of def.vehicles) if (labels.includes(v.label)) v.kind = 'limo';
  return createPuzzle(def);
}

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

test('구역: 25×25에서 안전구역은 정중앙 7×7(9~15), 바깥 9칸이 변화구역 (25 = 9 + 7 + 9)', () => {
  const z = zoneLayout(25, 7);
  assert.deepEqual([z.lo, z.hi], [9, 15]);
  assert.deepEqual([HARD_MODE.size, HARD_MODE.safeSize], [25, 7]);
  assert.equal(isSafeCell(z, 9, 9), true);
  assert.equal(isSafeCell(z, 15, 15), true);
  assert.equal(isSafeCell(z, 12, 9), true);
  assert.equal(isSafeCell(z, 8, 12), false, '안전구역 바로 왼쪽 칸은 변화구역');
  assert.equal(isSafeCell(z, 12, 16), false, '안전구역 바로 아래 칸은 변화구역');
  assert.equal(isSafeCell(z, 0, 0), false);
  assert.throws(() => zoneLayout(25, 4), /짝수/);
});

// ── 판 생성 ─────────────────────────────────────────────

/** 리무진 차선(가로 리무진의 행, 세로 리무진의 열)의 칸인가 */
function onLimoLane(puzzle, x, y) {
  return puzzle.vehicles.some((v) => v.kind === 'limo' && (v.axis === 'h' ? y === v.lane : x === v.lane));
}

test('판 생성: 구조물은 변화구역 곳곳에 차와 섞여 흩어지고, 안전구역 안에도 따로 놓인다 — 리무진 차선에는 없다', () => {
  const z = zoneLayout(25, 7);
  for (const { puzzle } of hardBoards) {
    const ring = (b) => Math.min(b.x, b.y, 24 - b.x, 24 - b.y);
    const inside = puzzle.blocks.filter((b) => isSafeCell(z, b.x, b.y));
    const outside = puzzle.blocks.filter((b) => !isSafeCell(z, b.x, b.y));
    assert.equal(inside.length, HARD_MODE.safeBlocks, '안전구역 안의 구조물');
    assert.equal(outside.length, HARD_MODE.blocks, '변화구역의 구조물');
    assert.ok(puzzle.blocks.every((b) => !onLimoLane(puzzle, b.x, b.y)), '리무진 차선에 구조물이 있으면 그 통로는 영영 못 쓴다');
    assert.ok(outside.some((b) => ring(b) <= 2), '가장자리 쪽에도 구조물이 있다');
    assert.ok(outside.some((b) => ring(b) >= 6), '안쪽에도 구조물이 있다');
    // 차도 바깥 고리까지 고루 놓인다 (안쪽부터 빽빽이 채우는 방식이 아니다)
    const outerVehicles = puzzle.vehicles.filter((v) => vehicleCells(puzzle, v.id, puzzle.start[v.id]).some((c) => ring(c) <= 2));
    assert.ok(outerVehicles.length >= 10);
  }
});

test('판 생성: 일반 차(버스 30%)는 안전구역에 3~4대(버스 최대 1대), 나머지는 변화구역에 — 리무진은 가로·세로 하나씩, 랜덤 이동이 없다면 모두 뺄 수 있다', () => {
  const z = zoneLayout(25, 7);
  for (const { g, puzzle } of hardBoards) {
    const regular = puzzle.vehicles.filter((v) => v.kind !== 'limo');
    const limos = puzzle.vehicles.filter((v) => v.kind === 'limo');
    assert.equal(puzzle.size, 25);
    assert.equal(regular.length, HARD_MODE.startVehicles);
    assert.equal(regular.filter((v) => v.kind === 'bus').length, Math.round(HARD_MODE.startVehicles * HARD_MODE.busRatio));
    assert.equal(limos.length, 2);
    assert.deepEqual(limos.map((v) => v.axis).sort(), ['h', 'v'], '가로 하나·세로 하나');
    assert.equal(puzzle.blocks.length, HARD_MODE.blocks + HARD_MODE.safeBlocks);
    const safeCars = [];
    for (const v of puzzle.vehicles) {
      const cells = vehicleCells(puzzle, v.id, puzzle.start[v.id]);
      const inSafe = cells.filter((c) => isSafeCell(z, c.x, c.y)).length;
      assert.ok(inSafe === 0 || inSafe === cells.length, '안전구역 경계에 걸친 차는 없다');
      if (v.kind === 'limo') assert.equal(inSafe, cells.length, '리무진은 안전구역 안');
      else if (inSafe > 0) safeCars.push(v);
    }
    assert.ok(safeCars.length >= HARD_MODE.safeCars[0] && safeCars.length <= HARD_MODE.safeCars[1], `안전구역 차 ${safeCars.length}대`);
    assert.ok(safeCars.filter((v) => v.kind === 'bus').length <= HARD_MODE.safeBusMax, '안전구역 버스는 최대 1대');
    // 솔버의 수순을 규칙 엔진으로 다시 둬서 리무진 두 대가 정말 나가는지 본다
    let pos = puzzle.start.slice();
    for (const m of g.solution) {
      const move = getMove(puzzle, pos, m.vehicle, m.sign);
      assert.ok(move?.moved);
      pos = applyMove(pos, move);
    }
    assert.ok(limos.every((v) => pos[v.id] === EXITED));
  }
});

test('판 생성: 리무진마다 안전구역을 벗어나는 데만 최소 3~5수', () => {
  const z = zoneLayout(25, 7);
  for (const { g, puzzle } of hardBoards) {
    const limos = puzzle.vehicles.filter((v) => v.kind === 'limo').map((v) => v.id);
    const leave = limos.map((l) => minLeaveSafeMoves(puzzle, puzzle.start, l, (x, y) => isSafeCell(z, x, y), { maxDepth: 8 }));
    for (const r of leave) {
      assert.ok(r.solved, '안전구역을 벗어날 수 있다 (안에서 꽉 막히지 않았다)');
      assert.ok(r.length >= HARD_MODE.safeLeave[0] && r.length <= HARD_MODE.safeLeave[1], `벗어나는 최소 ${r.length}수`);
    }
    assert.deepEqual(leave.map((r) => r.length), g.leaveSafe, '생성기가 잰 값과 같다');
  }
});

/**
 * 리무진 통로(안전구역 밖 부분)마다: 그 칸을 막는 차들 — [{ limo, sign, blockers: [차 번호], cells: [{x, y}] }]
 */
function changePassages(puzzle) {
  const z = zoneLayout(puzzle.size, HARD_MODE.safeSize);
  const grid = buildGrid(puzzle, puzzle.start);
  const out = [];
  for (const L of puzzle.vehicles.filter((v) => v.kind === 'limo')) {
    for (const sign of [-1, 1]) {
      const cells = [];
      const blockers = [];
      for (let c = sign > 0 ? puzzle.start[L.id] + L.len : puzzle.start[L.id] - 1; c >= 0 && c < puzzle.size; c += sign) {
        const [x, y] = L.axis === 'h' ? [c, L.lane] : [L.lane, c];
        if (isSafeCell(z, x, y)) continue;
        cells.push({ x, y });
        const g = grid[y * puzzle.size + x];
        if (g > 0 && !blockers.includes(g - 1)) blockers.push(g - 1);
      }
      out.push({ limo: L, sign, blockers, cells });
    }
  }
  return out;
}

test('판 생성: 리무진 통로 4개(안전구역 밖 부분) 모두 막는 차 2~4대 — 쉬운 통로가 없다', () => {
  const [lo, hi] = HARD_GEN_DEFAULTS.passageBlockers;
  for (const { seed, puzzle } of hardBoards) {
    const ps = changePassages(puzzle);
    assert.equal(ps.length, 4);
    for (const ps1 of ps) assert.ok(ps1.blockers.length >= lo && ps1.blockers.length <= hi, `${seed}: 막는 차 ${ps1.blockers.length}대`);
  }
});

test('판 생성: 못 비키는 막는 차가 있다 — 한쪽 옆은 구조물, 반대쪽 길에는 다른 차 (연쇄), 연쇄는 3단계까지', () => {
  let locked = 0;
  let deepest = 0;
  for (const { g, puzzle } of hardBoards) {
    const grid = buildGrid(puzzle, puzzle.start);
    const N = puzzle.size;
    const at = (v, c) => (v.axis === 'h' ? v.lane * N + c : c * N + v.lane);
    for (const { limo, blockers } of changePassages(puzzle)) {
      for (const id of blockers) {
        const v = puzzle.vehicles[id];
        if (v.axis === limo.axis) continue;   // 가로지른 차만
        const p = puzzle.start[id];
        const t = limo.lane;   // 이 차가 비워야 할 칸 (자기 축 좌표)
        const sides = [1, -1].map((side) => {
          const n = side > 0 ? t - p + 1 : p + v.len - t;
          const cells = [];
          for (let k = 1; k <= n; k++) {
            const c = side > 0 ? p + v.len - 1 + k : p - k;
            if (c >= 0 && c < N) cells.push(grid[at(v, c)]);
          }
          return { wall: cells.length > 0 && cells[0] === BLOCK, car: cells.some((x) => x > 0) };
        });
        if (sides.some((a, i) => a.wall && sides[1 - i].car)) locked++;
      }
    }
    deepest = Math.max(deepest, ...g.passages.map((ps) => ps.chain));
  }
  assert.ok(locked >= hardBoards.length * 2, `못 비키는 막는 차 ${locked}대`);
  assert.equal(deepest, 3, '연쇄 3단계(막는 차 → 도우미 → 도우미의 도우미)도 있다');
});

test('판 생성: 통로 안에 길이 방향으로 누운 막는 차도 있다 (판 밖으로만 빠질 수 있다)', () => {
  const collinear = hardBoards.flatMap(({ puzzle }) => changePassages(puzzle)
    .flatMap(({ limo, blockers }) => blockers.filter((id) => puzzle.vehicles[id].axis === limo.axis)));
  assert.ok(collinear.length >= 1);
});

test('판 생성: 변화구역 구조물의 일부는 통로 곁 연쇄에 쓰이고, 나머지는 흩어진다', () => {
  for (const { g } of hardBoards) {
    assert.ok(g.chainBlocks >= 6 && g.chainBlocks <= HARD_MODE.blocks / 2, `연쇄에 쓴 구조물 ${g.chainBlocks}개`);
  }
});

test('판 생성: 같은 시드면 같은 판', () => {
  const again = generateHardPuzzle(hardBoards[0].seed);
  assert.deepEqual(again.def, hardBoards[0].g.def);
  assert.notDeepEqual(generateHardPuzzle('다른 시드').def, hardBoards[0].g.def);
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
        // 모자랐다면, 그 턴의 랜덤 이동이 끝난 시점에 (이번 턴에 안 고른 차 중) 움직일 수 있는 차가 없어야 한다 —
        // 있다면 그 차의 수는 모두 '리무진 통로를 완전히 비우는 수'여야 한다 (한 턴에 maxClears번까지라 막혔다)
        const afterRandom = applyPlayerAndRandom(before, r);
        const grid = buildGrid(before.puzzle, afterRandom);
        const left = randomMovable(before.puzzle, grid, s.zone, afterRandom, new Set(moves.map((m) => m.vehicle)));
        for (const i of left) {
          for (const sign of [-1, 1]) {
            const dist = randomTravel(before.puzzle, grid, s.zone, afterRandom, i, sign);
            if (dist > 0) assert.ok(clearsPassage(before.puzzle, afterRandom, s.limoIds, i, afterRandom[i] + sign * dist), '남은 수는 통로를 비우는 수뿐');
          }
        }
      }
    });
  }
  assert.deepEqual([...requested].sort(), [1, 2, 3, 4], '1~4가 모두 나온다');
});

/** i번 차를 to로 옮기면 지금 막혀 있는 리무진 통로 하나가 완전히 비는가 */
function clearsPassage(puzzle, pos, limoIds, i, to) {
  const blocked = livePassages(puzzle, pos, limoIds).filter((ps) => ps.blockers.length > 0);
  const next = pos.slice();
  next[i] = to;
  const after = livePassages(puzzle, next, limoIds);
  return blocked.some((ps) => after.find((q) => q.limo === ps.limo && q.sign === ps.sign).blockers.length === 0);
}

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
        assert.notEqual(pz.vehicles[m.vehicle].kind, 'limo', '리무진은 랜덤으로 움직이지 않는다');
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

test('랜덤 이동: 안전구역 차도 플레이어가 변화구역으로 완전히 빼내면 그때부터 랜덤 이동 대상', () => {
  // 11×11, 안전구역 (4~6). a는 안전구역 안의 세로 차 — 플레이어가 위로 밀면 맨 윗줄 c 앞(1~2행)에 멈춘다 = 변화구역.
  // 그 아래 3행이 비어 있어 랜덤 이동이 한 칸 움직일 수 있다
  const p = board(`
    . . . . . c C . . . .
    . . . . . . . . . . .
    . . . . . . . . . . .
    . . . . . . . . . . .
    . . . . . a . . . . .
    . . . . . A . . . . .
    . . . . . # . . . . .
    . . . . . . . . . . .
    . . . . . . . . . . .
    . . . . . . . . . . .
    . . . . . . . . . . .
  `);
  const z = zoneLayout(11, 3);
  const a = idOf(p, 'a');
  assert.ok(!randomMovable(p, buildGrid(p, p.start), z, p.start).includes(a), '안전구역 안에서는 아니다');
  const pos = applyMove(p.start, getMove(p, p.start, a, -1));
  assert.equal(pos[a], 1);
  assert.ok(inChangeZone(p, z, a, pos[a]));
  assert.ok(randomMovable(p, buildGrid(p, pos), z, pos).includes(a), '변화구역으로 나오면 대상이다');
});

// ── 길막기 ─────────────────────────────────────────────

/** 길막기를 늘 하는 작은 판 설정 (한 턴에 랜덤 이동 1대) */
const ALWAYS_BLOCK = { ...SMALL, randomMin: 1, randomMax: 1, blockMove: { chance: 1, cooldown: 0.5, maxClears: 1 } };

// 9×9, 안전구역 (3~5). k: 가로 리무진(4행 3~4열). x는 왼쪽 통로, y는 오른쪽 통로를 막는다.
// z는 맨 위에서 아래로 밀리면 (6,6) 구조물 앞(4~5행)에 멈춘다 — 오른쪽 통로의 (6,4)에 선다
const BLOCK_BOARD = `
  . . . . . . z . .
  . . . . . . Z . .
  . . . . . . . . .
  . x . . . . . . .
  . X . k K . . y .
  . . . . . . . Y .
  . . . . . . # . .
  . . . . . . . . .
  . . . . . . . . .
`;

test('길막기: 플레이어가 뚫는 통로 추정 — 방금 막는 차가 줄어든 통로, 없으면 막는 차가 가장 적은 통로', () => {
  const p = limoBoard(BLOCK_BOARD, ['k']);
  const k = idOf(p, 'k');
  const y = idOf(p, 'y');
  // y를 아래로 빼면 오른쪽 통로의 막는 차가 1 → 0
  const after = applyMove(p.start, getMove(p, p.start, y, 1));
  const t = estimateTarget(p, p.start, after, [k]);
  assert.equal(t.limo, k);
  assert.equal(t.sign, 1);
  // 막는 차가 줄어든 통로가 없으면(위치 그대로) → 막는 차가 가장 적은 통로
  const same = estimateTarget(p, p.start, p.start, [k]);
  assert.equal(same.blockers.length, 1, '두 통로 모두 1대 — 먼저 나온 통로(왼쪽)');
  assert.equal(same.sign, -1);
});

test('길막기: 확률이 맞으면 랜덤 이동 한 대가 그 통로로 들어온다 — 빨간 강조용 표시(blocking)와 상태(lastBlock)가 남는다', () => {
  const p = limoBoard(BLOCK_BOARD, ['k']);
  const s = new HardSession(p, 'block', ALWAYS_BLOCK);
  const r = s.move(idOf(p, 'y'), 1);
  assert.equal(r.random.blocked, true);
  assert.equal(r.random.moves.length, 1);
  const m = r.random.moves[0];
  assert.equal(m.vehicle, idOf(p, 'z'));
  assert.equal(m.blocking, true);
  assert.ok(vehicleCells(p, m.vehicle, m.to).some((c) => c.x === 6 && c.y === 4), '오른쪽 통로 (6,4)에 선다');
  assert.equal(s.state.lastBlock, true);
  // 되돌리면 길막기 기록도 함께 돌아간다
  s.undo();
  assert.equal(s.state.lastBlock, false);
  const again = s.move(idOf(p, 'y'), 1);
  assert.deepEqual(again.random.moves, r.random.moves, '같은 수 → 같은 길막기');
});

test('길막기: 통로가 활짝 열려 있으면 리무진 바로 앞 칸은 막지 않는다', () => {
  // k: 가로 리무진(4행 4~5열) — 앞(오른쪽) 칸 (6,4)이 바로 변화구역. 오른쪽 통로는 비어 있고 왼쪽은 x가 막는다.
  // z는 (6,4)로, w는 (8,4)로 들어올 수 있다 — 리무진 코앞인 z가 아니라 w가 막으러 온다
  const text = (withW) => `
    . . . . . . z . ${withW ? 'w' : '.'}
    . . . . . . Z . ${withW ? 'W' : '.'}
    . . . . . . . . .
    . x . . . . . . .
    . X . . k K . . .
    . . . . . . . . .
    . . . . . . # . #
    . . . . . . . . .
    q Q . . . . . . .
  `;
  const p = limoBoard(text(true), ['k']);
  const s = new HardSession(p, 'front', ALWAYS_BLOCK);
  const r = s.move(idOf(p, 'q'), 1);   // 통로와 상관없는 수 → 목표는 막는 차가 가장 적은 오른쪽 통로(0대)
  assert.equal(r.random.target.sign, 1);
  assert.equal(r.random.blocked, true);
  assert.equal(r.random.moves[0].vehicle, idOf(p, 'w'));

  // w가 없으면 길막기를 하지 않는다 (z가 아무렇게나 골려 그 자리에 갈 수는 있어도 길막기는 아니다)
  const p2 = limoBoard(text(false), ['k']);
  for (let t = 0; t < 10; t++) {
    const s2 = new HardSession(p2, `front-${t}`, ALWAYS_BLOCK);
    const r2 = s2.move(idOf(p2, 'q'), 1);
    assert.equal(r2.random.blocked, false);
    assert.ok(r2.random.moves.every((m) => !m.blocking));
  }
});

test('길막기: 바로 앞 턴에 길막기를 했으면 확률이 절반', () => {
  const bm = HARD_MODE.blockMove;
  assert.equal(blockChance(bm, false), bm.chance);
  assert.equal(blockChance(bm, true), bm.chance * bm.cooldown);
  assert.equal(bm.chance, 0.35);
  // 실제 랜덤 이동에서도 — 확률 1에 직전 길막기가 있으면 절반쯤만 막는다
  const p = limoBoard(BLOCK_BOARD, ['k']);
  const k = idOf(p, 'k');
  const after = applyMove(p.start, getMove(p, p.start, idOf(p, 'y'), 1));
  const target = estimateTarget(p, p.start, after, [k]);
  const zone = zoneLayout(9, 3);
  let blocked = 0;
  for (let t = 0; t < 400; t++) {
    const r = runRandomPhase(p, zone, after.slice(), createRng(`cool-${t}`), ALWAYS_BLOCK, { limoIds: [k], target, lastBlock: true });
    if (r.blocked) blocked++;
  }
  assert.ok(blocked > 400 * 0.4 && blocked < 400 * 0.6, `직전 길막기 뒤 ${blocked}/400`);
});

test('길막기: 랜덤 이동이 리무진 통로를 완전히 비우는 것은 한 턴에 한 번까지', () => {
  // a는 왼쪽 통로, b는 오른쪽 통로를 혼자 막는다 — 둘 다 위아래로 비킬 수 있다. 랜덤 이동 2대를 해도 통로는 하나만 열린다
  const p = limoBoard(`
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . a . k K . . b .
    . A . . . . . B .
    . . . . . . . . .
    . . . . . . . . .
    q Q . . . . . . .
  `, ['k']);
  const k = idOf(p, 'k');
  const config = { ...SMALL, randomMin: 2, randomMax: 2, blockMove: { chance: 0, cooldown: 0.5, maxClears: 1 } };
  let opened = 0;
  for (let t = 0; t < 30; t++) {
    const s = new HardSession(p, `clear-${t}`, config);
    const before = s.state;
    const r = s.move(idOf(p, 'q'), 1);
    const afterPlayer = applyMove(before.pos, r.move);
    const passagesBefore = livePassages(p, afterPlayer, [k]);
    const passagesAfter = livePassages(p, applyPlayerAndRandom(before, r), [k]);
    const newlyOpen = passagesAfter.filter((ps, n) => ps.blockers.length === 0 && passagesBefore[n].blockers.length > 0);
    assert.ok(newlyOpen.length <= 1, `시도 ${t}: 통로 ${newlyOpen.length}개가 한꺼번에 열렸다`);
    opened += newlyOpen.length;
  }
  assert.ok(opened > 0, '한 개는 열릴 수 있다');
});

test('길막기: 실제 판에서 — 한 턴에 많아야 한 대, 길막기 이동은 목표 통로 칸에 선다', () => {
  let seen = 0;
  for (const { seed, puzzle } of hardBoards) {
    const s = new HardSession(puzzle, seed);
    playRandomly(s, 150, seed, (r, before) => {
      if (!r?.moved || r.cleared) return;
      const blocking = r.random.moves.filter((m) => m.blocking);
      assert.ok(blocking.length <= 1);
      assert.equal(r.random.blocked, blocking.length === 1);
      for (const m of blocking) {
        const cells = vehicleCells(before.puzzle, m.vehicle, m.to).map((c) => c.y * before.puzzle.size + c.x);
        assert.ok(cells.some((c) => r.random.target.cells.includes(c)));
        seen++;
      }
    });
  }
  assert.ok(seen > 0, '실제 판에서도 길막기가 일어난다');
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

// ── 리무진 ──────────────────────────────────────────────

test('리무진: 변화구역에 나가 있어도 랜덤 이동 대상이 아니다', () => {
  // k는 변화구역(맨 아래 줄)의 리무진, b는 일반 차 — 둘 다 오른쪽이 비어 있다
  const p = limoBoard(`
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    b B . . . . . . .
    . . . . . . . . .
    k K . . . . . . .
  `, ['k']);
  const z = zoneLayout(9, 3);
  assert.equal(p.vehicles[idOf(p, 'k')].kind, 'limo');
  assert.deepEqual(randomMovable(p, buildGrid(p, p.start), z, p.start), [idOf(p, 'b')]);
});

// k: 안전구역의 가로 리무진 (오른쪽으로 나간다) · m: 안전구역의 세로 리무진 (아래로 나간다) · a: 일반 차
const LIMOS = `
  a A . . . . . . .
  . . . . . . . . .
  . . . . . . . . .
  . . . k K . . . .
  . . . . . m . . .
  . . . . . M . . .
  . . . . . . . . .
  . . . . . . . . .
  . . . . . . . . .
`;

test('리무진: 두 대를 모두 빼면 클리어 — 일반 차는 남아 있어도 된다, 리무진 탈출도 카운트다운을 시작시킨다', () => {
  const p = limoBoard(LIMOS, ['k', 'm']);
  const s = new HardSession(p, 'limo', SMALL);
  assert.deepEqual([s.limosOut, s.limosTotal], [0, 2]);

  const r1 = s.move(idOf(p, 'k'), 1);
  assert.equal(r1.cleared, false);
  assert.equal(r1.countdownStarted, true, '리무진 탈출도 탈출');
  assert.deepEqual([s.limosOut, s.limosTotal], [1, 2]);
  assert.equal(s.status, HardStatus.PLAYING);

  const r2 = s.move(idOf(p, 'm'), 1);
  assert.equal(r2.cleared, true);
  assert.equal(s.status, HardStatus.CLEARED);
  assert.equal(s.countdown, null, '진행 중이던 카운트다운 취소');
  assert.notEqual(s.pos[idOf(p, 'a')], EXITED, '일반 차는 판에 남아 있다');
  assert.deepEqual([s.limosOut, s.limosTotal], [2, 2]);
});

test('리무진: 차선 양쪽에 구조물이 있어 영영 못 나가면 막힘 (다른 차가 움직일 수 있어도)', () => {
  const dead = limoBoard(`
    a A . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . # . k K . . # .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
  `, ['k']);
  const z = zoneLayout(9, 3);
  const k = idOf(dead, 'k');
  assert.equal(checkHardStuck(dead, z, dead.start, null, { targets: [k] }), HardStuck.STUCK);
  assert.equal(checkHardStuck(dead, z, dead.start, 2, { targets: [k] }), HardStuck.STUCK, '새 차가 와도 리무진 길은 안 열린다');
  assert.equal(new HardSession(dead, 'dead', SMALL).status, HardStatus.STUCK);

  // 구조물이 한쪽에만 있으면 막힌 것이 아니다 (다른 쪽 길을 차가 막고 있어도 그 차는 비킬 수 있다)
  const open = limoBoard(`
    a A . . . . . . .
    . . . . . . . . .
    . . . . . . . b .
    . # . k K . . B .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
  `, ['k']);
  assert.equal(checkHardStuck(open, z, open.start, null, { targets: [idOf(open, 'k')] }), HardStuck.OK);
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
  assert.equal(s.turn, 3, '판은 3턴째로 돌아간다');
  assert.equal(s.moveCount, 4, '되돌려도 이동 횟수는 줄지 않는다');
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

// ── 점수 ────────────────────────────────────────────────

test('점수: 예시 값 — 30회 70점, 50회 55점, 70회 45점, 100회 35점', () => {
  assert.equal(hardScore(30), 70);
  assert.equal(hardScore(50), 55);
  assert.equal(hardScore(70), 45);
  assert.equal(hardScore(100), 35);
});

test('점수: 구간 경계와 소수점 버림, 최저 10점', () => {
  assert.equal(hardScore(0), 100);
  assert.equal(hardScore(1), 99);
  assert.equal(hardScore(40), 60);     // 1~40번째는 1회당 1점
  assert.equal(hardScore(41), 59);     // 100 − 40.5 = 59.5 → 59
  assert.equal(hardScore(42), 59);     // 100 − 41
  assert.equal(hardScore(71), 44);     // 100 − 55.33 = 44.67 → 44
  assert.equal(hardScore(73), 44);     // 100 − 56
  assert.equal(hardScore(150), 18);
  assert.equal(hardScore(10000), 10, '클리어하면 최저 10점');
  for (let n = 1; n <= 300; n++) assert.ok(hardScore(n) <= hardScore(n - 1), '움직일수록 점수가 오르지 않는다');
});

test('점수: 숫자는 설정에서 바꿀 수 있다', () => {
  const cfg = { base: 50, min: 5, tiers: [{ upTo: 10, movesPerPoint: 1 }, { upTo: null, movesPerPoint: 5 }] };
  assert.equal(hardScore(10, cfg), 40);
  assert.equal(hardScore(20, cfg), 38);
  assert.equal(hardScore(1000, cfg), 5);
  assert.equal(hardScore(30, HARD_MODE.score), 70);
});

test('점수: 이동 횟수는 실제로 움직인 수만 — 막힌 시도·랜덤 이동은 빼고, 되돌려도 줄지 않는다', () => {
  const p = board(COLUMNS);
  const s = new HardSession(p, 'score', SMALL);
  s.move(idOf(p, 'a'), -1);
  s.move(idOf(p, 'b'), 1);                    // 막힘 — 세지 않는다
  assert.equal(s.moveCount, 1);
  s.move(idOf(p, 'b'), -1);
  assert.equal(s.moveCount, 2);
  assert.equal(s.expectedScore, 98);
  s.undo();
  s.undo();
  assert.equal(s.turn, 0);
  assert.equal(s.moveCount, 2, '되돌려도 2회 그대로');
  assert.equal(s.expectedScore, 98);
  assert.equal(s.canUndo, false);
  s.restart();                                 // 같은 판 다시 = 새 시도
  assert.equal(s.moveCount, 0);
  assert.equal(s.expectedScore, 100);
});
