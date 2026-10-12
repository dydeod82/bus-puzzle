import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GameSession, GameStatus } from '../src/core/game.js';
import { EXITED } from '../src/core/rules.js';
import { board, idOf } from './helpers.js';

const ROW = `
  . . . . . .
  a A . . b B
  . . . . . .
  . . . . . .
  # c C . . .
  . . . . . .
`;

test('움직이지 못한 수는 이동 횟수에 들어가지 않는다', () => {
  const p = board(`
    . . . . .
    # a A # .
    . . . . .
    . . . . .
    . . . b B
  `);
  const g = new GameSession(p);
  const m = g.move(idOf(p, 'a'), +1);
  assert.equal(m.moved, false);
  assert.equal(g.moveCount, 0);
  assert.deepEqual(g.pos, [...p.start]);
});

test('이동·탈출하면 횟수가 늘고 남은 차량이 줄어든다', () => {
  const p = board(ROW);
  const g = new GameSession(p);
  const a = idOf(p, 'a');
  const b = idOf(p, 'b');
  assert.equal(g.remaining, 3);

  g.move(a, +1);                   // b 앞까지 미끄러짐
  assert.equal(g.pos[a], 2);
  assert.equal(g.moveCount, 1);

  g.move(b, +1);                   // b 탈출
  assert.equal(g.pos[b], EXITED);
  assert.equal(g.isOnBoard(b), false);
  assert.equal(g.remaining, 2);
  assert.equal(g.moveCount, 2);

  assert.equal(g.move(b, -1), null);   // 나간 차량은 못 민다
  assert.equal(g.moveCount, 2);
});

test('되돌리기: 위치가 돌아오고 이동 횟수는 줄며, 되돌리기 횟수가 남는다', () => {
  const p = board(ROW);
  const g = new GameSession(p);
  const a = idOf(p, 'a');
  const b = idOf(p, 'b');

  g.move(a, +1);
  g.move(b, +1);
  assert.equal(g.undo().vehicle, b);
  assert.equal(g.pos[b], 4);        // 나갔던 차량이 판으로 돌아온다
  assert.equal(g.moveCount, 1);
  assert.equal(g.undoCount, 1);

  g.undo();
  assert.deepEqual(g.pos, [...p.start]);
  assert.equal(g.moveCount, 0);
  assert.equal(g.undoCount, 2);

  assert.equal(g.undo(), null);     // 되돌릴 것이 없으면 세지 않는다
  assert.equal(g.undoCount, 2);
});

test('재시작: 위치·이동 횟수·되돌리기 횟수가 모두 처음으로', () => {
  const p = board(ROW);
  const g = new GameSession(p);
  g.move(idOf(p, 'a'), +1);
  g.move(idOf(p, 'b'), +1);
  g.undo();
  g.restart();
  assert.deepEqual(g.pos, [...p.start]);
  assert.equal(g.moveCount, 0);
  assert.equal(g.undoCount, 0);
  assert.equal(g.status, GameStatus.PLAYING);
});

test('모든 차량이 나가면 클리어 — 그 뒤로는 움직일 수 없다', () => {
  const p = board(ROW);
  const g = new GameSession(p);
  g.move(idOf(p, 'b'), +1);
  g.move(idOf(p, 'a'), +1);
  assert.equal(g.status, GameStatus.PLAYING);
  g.move(idOf(p, 'c'), +1);
  assert.equal(g.status, GameStatus.CLEARED);
  assert.equal(g.remaining, 0);
  assert.equal(g.moveCount, 3);
  assert.equal(g.move(idOf(p, 'c'), -1), null);
});

test('막힘: 나갈 수 있던 마지막 차가 나가면 STUCK, 되돌리면 다시 PLAYING', () => {
  const p = board(`
    . . . # .
    # a A b .
    . d . B .
    . D c C #
    . # . e E
  `);
  const g = new GameSession(p);
  const e = idOf(p, 'e');
  assert.equal(g.status, GameStatus.PLAYING);

  g.move(e, +1);
  assert.equal(g.status, GameStatus.STUCK);
  assert.equal(g.move(idOf(p, 'a'), +1), null);   // 막힌 뒤에는 되돌리기·재시작만

  g.undo();
  assert.equal(g.status, GameStatus.PLAYING);
  assert.equal(g.pos[e], 3);
});
