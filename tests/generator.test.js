import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRng, hashSeed } from '../src/core/random.js';
import { generatePuzzle } from '../src/core/generator.js';
import { solve, solveExact } from '../src/core/solver.js';
import { createPuzzle, getMove, applyMove, isCleared, exitableNow } from '../src/core/rules.js';
import { board } from './helpers.js';

/** 수순을 규칙 엔진으로 처음부터 다시 둬서 정말 판이 비는지 본다 — 솔버 내부를 믿지 않는다 */
function replayClears(puzzle, moves) {
  let pos = puzzle.start.slice();
  for (const m of moves) {
    const move = getMove(puzzle, pos, m.vehicle, m.sign);
    if (!move || !move.moved) return false;
    pos = applyMove(pos, move);
  }
  return isCleared(pos);
}

test('시드 난수: 같은 시드는 같은 수열, 다른 시드는 다른 수열', () => {
  const a = createRng('abc');
  const b = createRng('abc');
  const c = createRng('abd');
  const seqA = Array.from({ length: 8 }, () => a.next());
  const seqB = Array.from({ length: 8 }, () => b.next());
  const seqC = Array.from({ length: 8 }, () => c.next());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  assert.equal(hashSeed(123), hashSeed('123'));   // 숫자와 같은 글자는 같은 시드
  for (const x of seqA) assert.ok(x >= 0 && x < 1);
});

test('생성기: 같은 시드·같은 설정이면 같은 판', () => {
  const params = { size: 8, cars: 8, buses: 3, blocks: 5, minSlides: 1, maxSlides: 1, maxExitable: 3 };
  const a = generatePuzzle(params, 'same');
  const b = generatePuzzle(params, 'same');
  const c = generatePuzzle(params, 'other');
  assert.deepEqual(a.def, b.def);
  assert.equal(a.par, b.par);
  assert.notDeepEqual(a.def, c.def);
});

test('생성기: 만든 판은 언제나 풀리고, 목표 이동 수가 수순 길이와 같다', () => {
  for (let s = 0; s < 12; s++) {
    const size = 7 + (s % 4);
    // 칸의 40% 남짓을 차로 채운다 (레벨 10이 약 43%)
    const cars = Math.round(size * size * 0.13);
    const buses = Math.round(size * size * 0.05);
    const params = { size, cars, buses, blocks: 4 + (s % 5), minSlides: s % 3, maxExitable: 4 };
    const g = generatePuzzle(params, `solvable-${s}`);
    const puzzle = createPuzzle(g.def);
    assert.equal(puzzle.vehicles.length, params.cars + params.buses, `시드 ${s}: 차량 수`);
    assert.equal(g.def.blocks.length, params.blocks, `시드 ${s}: 구조물 수`);
    assert.ok(replayClears(puzzle, g.solution), `시드 ${s}: 수순으로 판이 비어야 한다`);
    assert.equal(g.par, g.solution.length);
    assert.equal(g.exitableAtStart, exitableNow(puzzle, puzzle.start).length);
  }
});

test('생성기: 고리를 넣으면 밀어 두기가 꼭 필요하다 (진짜 최소 이동 > 차량 수)', () => {
  const g = generatePuzzle({ size: 7, cars: 6, buses: 1, blocks: 4, minSlides: 1, maxSlides: 1, maxExitable: 3 }, 'loop');
  const puzzle = createPuzzle(g.def);
  assert.equal(g.slides, 1);
  assert.equal(g.optimal, true);
  assert.equal(solveExact(puzzle), puzzle.vehicles.length + 1);
});

test('솔버: 작은 판에서는 줄이기 없는 완전 탐색과 같은 답을 낸다', () => {
  for (let s = 0; s < 10; s++) {
    const g = generatePuzzle(
      { size: 6, cars: 5, buses: 1, blocks: 4, minSlides: s % 2, maxSlides: 1, maxExitable: 3 },
      `exact-${s}`,
    );
    const puzzle = createPuzzle(g.def);
    assert.equal(g.par, solveExact(puzzle, puzzle.start, { maxStates: 400000 }), `시드 ${s}`);
  }
});

test('솔버: 못 푸는 판이면 solved=false', () => {
  const p = board(`
    . . . # .
    # a A b .
    . d . B .
    . D c C #
    . # . . .
  `);
  assert.equal(solve(p).solved, false);
  assert.equal(solveExact(p), null);
});

test('솔버: 바람개비 고리는 열쇠 한 대를 밀어 둬야 풀린다', () => {
  // d만 아래로 두 칸 빈 곳이 있다 — d를 밀면 c → b → a → d 순으로 빠진다
  const p = board(`
    . . . # . . .
    # a A b . . .
    . d . B . . .
    . D c C # . .
    . . . . . . .
    . . . . . . .
    . # . . . . .
  `);
  const r = solve(p);
  assert.equal(r.solved, true);
  assert.equal(r.slides, 1);
  assert.equal(r.length, 5);
  assert.equal(solveExact(p), 5);
  assert.ok(replayClears(p, r.moves));
});

test('솔버: 게임 도중의 위치에서도 남은 수순을 찾는다', () => {
  const p = board(`
    . . . # . . .
    # a A b . . .
    . d . B . . .
    . D c C # . .
    . . . . . . .
    . . . . . . .
    . # . . . . .
  `);
  const pos = p.start.slice();
  pos[2] = -1;   // c를 이미 빼낸 위치라고 치면 (실제로는 못 나가지만 솔버는 위치만 본다)
  const r = solve(p, pos);
  assert.equal(r.solved, true);
  assert.equal(r.slides, 0);           // c가 없으면 b가 아래로 바로 빠진다
  assert.equal(r.length, 3);
});
