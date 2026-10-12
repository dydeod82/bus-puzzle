import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createPuzzle, getMove, applyMove, listMoves, exitableNow, checkStuck, StuckCheck,
  signForDir, vehicleCells, isCleared, remainingCount, EXITED,
} from '../src/core/rules.js';
import { board, idOf } from './helpers.js';

// ── 미끄러지기 ─────────────────────────────────────────────

test('막히면 막은 차량 바로 앞에서 멈춘다', () => {
  const p = board(`
    . . . . . .
    a A . . b B
    . . . . . .
    . . . . . .
    . . . . . .
    . . . . . .
  `);
  const m = getMove(p, p.start, idOf(p, 'a'), +1);
  assert.equal(m.moved, true);
  assert.equal(m.exits, false);
  assert.equal(m.dist, 2);
  assert.equal(m.to, 2);
  assert.equal(m.dir, 'right');
  assert.deepEqual(m.blocker, { x: 4, y: 1, vehicle: idOf(p, 'b') });
});

test('구조물에 막히면 구조물 바로 앞에서 멈춘다 — 뒤쪽으로 미는 것도 된다', () => {
  const p = board(`
    . . . . .
    # . b b B
    . . . . .
    . . . . .
    . . . . .
  `);
  const b = idOf(p, 'b');
  assert.equal(p.vehicles[b].kind, 'bus');
  assert.equal(p.vehicles[b].frontDir, 'right');

  const back = getMove(p, p.start, b, -1);   // 앞쪽이 오른쪽인 버스를 왼쪽(뒤)으로
  assert.equal(back.moved, true);
  assert.equal(back.exits, false);
  assert.equal(back.dist, 1);
  assert.equal(back.to, 1);
  assert.deepEqual(back.blocker, { x: 0, y: 1, vehicle: null });
});

test('경로가 판 끝까지 비어 있으면 판 밖으로 나간다', () => {
  const p = board(`
    . . . . .
    . . . . .
    D . . . .
    d . . . .
    d . . . .
  `);
  const d = idOf(p, 'd');
  assert.equal(p.vehicles[d].kind, 'bus');
  assert.equal(p.vehicles[d].frontDir, 'up');

  const m = getMove(p, p.start, d, -1);
  assert.equal(m.exits, true);
  assert.equal(m.moved, true);
  assert.equal(m.to, EXITED);
  assert.equal(m.dist, 2);          // 판 끝에 닿기까지 두 칸 (애니메이션용)
  assert.equal(m.blocker, null);
});

test('이미 판 끝에 붙어 있으면 그 쪽으로 바로 나간다', () => {
  const p = board(`
    . . . . .
    . . . a A
    . . . . .
    . . . . .
    . . . . .
  `);
  const m = getMove(p, p.start, idOf(p, 'a'), +1);
  assert.equal(m.exits, true);
  assert.equal(m.dist, 0);
  assert.equal(m.moved, true);
});

test('한 칸도 못 움직이면 moved=false — 흔들림만', () => {
  const p = board(`
    . . . . .
    # a A # .
    . . . . .
    . . . . .
    . . . . .
  `);
  const a = idOf(p, 'a');
  for (const sign of [-1, +1]) {
    const m = getMove(p, p.start, a, sign);
    assert.equal(m.moved, false);
    assert.equal(m.exits, false);
    assert.equal(m.dist, 0);
    assert.equal(m.to, m.from);
  }
});

test('세로 차량은 위아래로 움직인다', () => {
  const p = board(`
    . . c . .
    . . C . .
    . . . . .
    . . . . .
    . . # . .
  `);
  const c = idOf(p, 'c');
  assert.equal(p.vehicles[c].axis, 'v');
  assert.equal(p.vehicles[c].frontDir, 'down');

  const down = getMove(p, p.start, c, +1);
  assert.equal(down.dist, 2);
  assert.equal(down.to, 2);
  assert.deepEqual(down.blocker, { x: 2, y: 4, vehicle: null });
  assert.deepEqual(vehicleCells(p, c, down.to), [{ x: 2, y: 2 }, { x: 2, y: 3 }]);

  const up = getMove(p, p.start, c, -1);
  assert.equal(up.exits, true);
});

test('applyMove는 원본을 바꾸지 않고, 나간 차량은 EXITED가 된다', () => {
  const p = board(`
    . . .
    a A .
    . . .
  `);
  const a = idOf(p, 'a');
  const m = getMove(p, p.start, a, +1);
  const next = applyMove(p.start, m);
  assert.equal(p.start[a], 0);
  assert.equal(next[a], EXITED);
  assert.equal(remainingCount(next), 0);
  assert.equal(isCleared(next), true);
  assert.equal(getMove(p, next, a, +1), null);   // 나간 차량은 더 못 민다
});

test('listMoves·exitableNow는 남은 차량만, 실제로 움직이는 수만 센다', () => {
  const p = board(`
    . . . . .
    # a A . #
    . . . . .
    . . . b B
    . . . . .
  `);
  const a = idOf(p, 'a');
  const b = idOf(p, 'b');
  const moves = listMoves(p, p.start);
  // a: 왼쪽은 구조물에 바로 막힘(제외), 오른쪽 1칸 / b: 왼쪽 3칸 미끄러져 나감, 오른쪽 바로 나감
  assert.deepEqual(
    moves.map((m) => [m.vehicle, m.sign, m.exits]),
    [[a, +1, false], [b, -1, true], [b, +1, true]],
  );
  assert.deepEqual(exitableNow(p, p.start), [b]);
});

// ── 방향키 ────────────────────────────────────────────────

test('방향키는 차량 길이 방향일 때만 부호가 나온다', () => {
  const h = { axis: 'h' };
  const v = { axis: 'v' };
  assert.equal(signForDir(h, 'left'), -1);
  assert.equal(signForDir(h, 'right'), +1);
  assert.equal(signForDir(h, 'up'), 0);
  assert.equal(signForDir(v, 'up'), -1);
  assert.equal(signForDir(v, 'down'), +1);
  assert.equal(signForDir(v, 'left'), 0);
  assert.equal(signForDir(v, 'nope'), 0);
});

// ── 막힘 판정 ─────────────────────────────────────────────

// 네 대가 바람개비처럼 서로의 앞을 막고, 바깥쪽은 구조물이 막는다 — 어떤 차도 영영 못 움직인다.
// e만 아래 줄에서 따로 나갈 수 있다.
const PINWHEEL = `
  . . . # .
  # a A b .
  . d . B .
  . D c C #
  . # . e E
`;

test('막힘: 어떤 차도 나갈 수 없으면 STUCK', () => {
  const p = board(PINWHEEL.replace('e E', '. .'));
  assert.equal(checkStuck(p, p.start), StuckCheck.STUCK);
});

test('막힘: 판을 다 비울 수 없어도 나갈 차가 하나라도 있으면 OK (글자 그대로의 기준)', () => {
  const p = board(PINWHEEL);
  assert.equal(checkStuck(p, p.start), StuckCheck.OK);
});

test('막힘: 지금 당장 나갈 차가 없어도, 밀어 두면 나갈 수 있으면 OK', () => {
  const p = board(`
    . . . # .
    . . . b .
    . . . B .
    # . a A #
    . . . . .
  `);
  assert.deepEqual(exitableNow(p, p.start), []);
  // a를 왼쪽으로 한 칸 밀면 b가 아래로 빠진다
  assert.equal(checkStuck(p, p.start), StuckCheck.OK);
});

test('막힘: 탐색 한도를 넘으면 UNKNOWN', () => {
  const p = board(`
    . . . # .
    . . . b .
    . . . B .
    # . a A #
    . . . . .
  `);
  assert.equal(checkStuck(p, p.start, { maxStates: 1 }), StuckCheck.UNKNOWN);
});

test('막힘: 이미 클리어한 판은 막힌 것이 아니다', () => {
  const p = board(`
    . . .
    . . .
    . . .
  `);
  assert.equal(checkStuck(p, p.start), StuckCheck.OK);
});

// ── 판 정의 검증 ──────────────────────────────────────────

test('createPuzzle: 겹치거나 판 밖에 있거나 종류·방향이 이상하면 예외', () => {
  const ok = { kind: 'car', x: 0, y: 0, front: 'right' };
  assert.throws(() => createPuzzle({ size: 4, vehicles: [ok, { kind: 'car', x: 1, y: 0, front: 'left' }] }), /겹칩니다/);
  assert.throws(() => createPuzzle({ size: 4, blocks: [[1, 0]], vehicles: [ok] }), /구조물/);
  assert.throws(() => createPuzzle({ size: 4, vehicles: [{ kind: 'bus', x: 2, y: 0, front: 'right' }] }), /판 밖/);
  assert.throws(() => createPuzzle({ size: 4, vehicles: [{ kind: 'truck', x: 0, y: 0, front: 'right' }] }), /종류/);
  assert.throws(() => createPuzzle({ size: 4, vehicles: [{ kind: 'car', x: 0, y: 0, front: 'north' }] }), /방향/);
  assert.throws(() => createPuzzle({ size: 4, blocks: [[0, 0], [0, 0]] }), /두 번/);
  assert.throws(() => createPuzzle({ size: 1 }), /판 크기/);
});
