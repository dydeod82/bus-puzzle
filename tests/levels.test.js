// 1~10단계가 모두 풀리고, 설정한 난이도 조건을 맞추는지 — 레벨 숫자를 바꾸면 이 테스트가 먼저 알려 준다
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LEVELS } from '../src/core/levels.js';
import { generatePuzzle } from '../src/core/generator.js';
import { createPuzzle, getMove, applyMove, isCleared, exitableNow } from '../src/core/rules.js';

LEVELS.forEach((lv, i) => {
  test(`${i + 1}단계 (${lv.size}×${lv.size}): 풀리고 조건을 맞춘다`, () => {
    const g = generatePuzzle(lv, lv.seed);
    const puzzle = createPuzzle(g.def);

    assert.equal(puzzle.size, lv.size);
    assert.equal(puzzle.vehicles.filter((v) => v.kind === 'car').length, lv.cars);
    assert.equal(puzzle.vehicles.filter((v) => v.kind === 'bus').length, lv.buses);
    assert.equal(puzzle.blocks.length, lv.blocks);

    let pos = puzzle.start.slice();
    for (const m of g.solution) {
      const move = getMove(puzzle, pos, m.vehicle, m.sign);
      assert.ok(move && move.moved, '수순의 모든 수가 실제로 움직여야 한다');
      pos = applyMove(pos, move);
    }
    assert.ok(isCleared(pos), '수순을 끝까지 두면 판이 빈다');

    assert.equal(g.met, true, '난이도 조건(밀어 두기 수·바로 나가는 차 수)을 맞춘다');
    assert.equal(g.optimal, true, '목표 이동 수가 최소임이 증명된다');
    assert.ok(g.slides >= lv.minSlides && g.slides <= lv.maxSlides);
    assert.ok(exitableNow(puzzle, puzzle.start).length <= lv.maxExitable);
  });
});

test('단계가 오를수록 판·차량·구조물이 줄지 않는다', () => {
  for (let i = 1; i < LEVELS.length; i++) {
    const a = LEVELS[i - 1];
    const b = LEVELS[i];
    assert.ok(b.size >= a.size && b.cars + b.buses >= a.cars + a.buses && b.blocks >= a.blocks, `${i}→${i + 1}단계`);
  }
  assert.equal(LEVELS[0].size, 6);
  assert.equal(LEVELS.at(-1).size, 14);
});
