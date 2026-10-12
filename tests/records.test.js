import { test } from 'node:test';
import assert from 'node:assert/strict';

import { starsFor, mergeRecord, formatTime } from '../src/core/records.js';
import { loadSave, writeSave, FREE_DEFAULTS } from '../src/storage/save.js';
import { freeModeParams, freeSettingsProblem, freeLimits } from '../src/core/levels.js';

test('별점: 목표 이하 셋, 1.3배 이하 둘, 그 밖 하나', () => {
  assert.equal(starsFor(10, 10), 3);
  assert.equal(starsFor(9, 10), 3);
  assert.equal(starsFor(13, 10), 2);   // ceil(10 × 1.3) = 13
  assert.equal(starsFor(14, 10), 1);
  assert.equal(starsFor(7, 5), 2);     // ceil(5 × 1.3) = 7
  assert.equal(starsFor(8, 5), 1);
});

test('기록 합치기: 첫 클리어 → 갱신 → 그대로', () => {
  const first = mergeRecord(null, { moves: 12, undos: 3, timeMs: 60000, par: 10 });
  assert.equal(first.isNew.first, true);
  assert.equal(first.record.clears, 1);
  assert.equal(first.stars, 2);

  // 이동은 같고 되돌리기가 적다 → 최소 이동 갱신, 시간은 느려서 그대로
  const second = mergeRecord(first.record, { moves: 12, undos: 1, timeMs: 90000, par: 10 });
  assert.deepEqual(second.isNew, { first: false, moves: true, time: false, stars: false });
  assert.deepEqual(second.record.bestMoves, { moves: 12, undos: 1, timeMs: 90000 });
  assert.equal(second.record.bestTime.timeMs, 60000);
  assert.equal(second.record.clears, 2);

  // 별 셋 — 별점·이동·시간 모두 갱신
  const third = mergeRecord(second.record, { moves: 10, undos: 0, timeMs: 30000, par: 10 });
  assert.deepEqual(third.isNew, { first: false, moves: true, time: true, stars: true });
  assert.equal(third.record.stars, 3);

  // 더 나쁜 판 — 기록은 그대로, 별점도 내려가지 않는다
  const fourth = mergeRecord(third.record, { moves: 20, undos: 5, timeMs: 99000, par: 10 });
  assert.deepEqual(fourth.isNew, { first: false, moves: false, time: false, stars: false });
  assert.equal(fourth.record.stars, 3);
  assert.equal(fourth.stars, 1);
});

test('시간 표시', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(61_500), '1:01');
  assert.equal(formatTime(3_725_000), '1:02:05');
});

test('저장: 쓰고 읽으면 그대로, 깨진 값은 걸러낸다 (Node에서는 메모리에 저장된다)', () => {
  const empty = loadSave(10);
  assert.equal(empty.unlocked, 1);
  assert.deepEqual(empty.records, {});
  assert.deepEqual(empty.free, { ...FREE_DEFAULTS });

  const rec = { clears: 1, stars: 3, par: 5, bestMoves: { moves: 5, undos: 0, timeMs: 1000 }, bestTime: { moves: 5, undos: 0, timeMs: 1000 } };
  writeSave({ unlocked: 3, records: { 1: rec, 2: { stars: 'x' } }, free: { size: 8, cars: 6, buses: 2, blocks: 3, seed: 'ABC' } });
  const back = loadSave(10);
  assert.equal(back.unlocked, 3);
  assert.deepEqual(back.records, { 1: rec });            // 깨진 2단계 기록은 버린다
  assert.equal(back.free.seed, 'ABC');

  writeSave({ unlocked: 99, records: {}, free: {} });
  assert.equal(loadSave(10).unlocked, 10);               // 단계 수를 넘지 않는다
});

test('자유 모드: 고리 수는 구조물·차량 수에서 정하고, 빽빽하면 거절한다', () => {
  assert.equal(freeModeParams({ size: 10, cars: 12, buses: 5, blocks: 8 }).minSlides, 2);
  assert.equal(freeModeParams({ size: 10, cars: 12, buses: 5, blocks: 2 }).minSlides, 0);
  assert.equal(freeModeParams({ size: 14, cars: 40, buses: 10, blocks: 30 }).minSlides, 4);
  assert.equal(freeSettingsProblem({ size: 6, cars: 1, buses: 0, blocks: 0 }) !== null, true);
  assert.equal(freeSettingsProblem({ size: 6, cars: 12, buses: 4, blocks: 5 }) !== null, true);
  assert.equal(freeSettingsProblem({ size: 10, cars: 12, buses: 5, blocks: 8 }), null);
  assert.ok(freeLimits(14).cars.max > freeLimits(6).cars.max);
});
