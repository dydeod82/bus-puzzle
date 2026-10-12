import { test } from 'node:test';
import assert from 'node:assert/strict';

import { emptyHardRecord, startHardAttempt, finishHardAttempt, HardResult, HARD_RECENT_LIMIT } from '../src/core/records.js';
import { loadSave, writeSave } from '../src/storage/save.js';
import { hardScore } from '../src/core/hardMode.js';

test('하드 기록: 첫 수에 플레이 +1, 끝나면 결과가 채워진다', () => {
  let rec = emptyHardRecord();
  const a = startHardAttempt(rec, { seed: 'AAA', at: 100 });
  rec = a.record;
  assert.equal(rec.plays, 1);
  assert.equal(rec.recent[0].result, HardResult.PLAYING);

  rec = finishHardAttempt(rec, { id: a.id, result: HardResult.QUIT, moves: 12, undos: 1, timeMs: 30000 }).record;
  assert.equal(rec.clears, 0);
  assert.equal(rec.bestTime, null);
  assert.deepEqual(
    { result: rec.recent[0].result, moves: rec.recent[0].moves, timeMs: rec.recent[0].timeMs, seed: rec.recent[0].seed },
    { result: 'quit', moves: 12, timeMs: 30000, seed: 'AAA' },
  );
});

test('하드 기록: 클리어 횟수·최단 시간·최소 이동은 클리어한 판만 견준다', () => {
  let rec = emptyHardRecord();
  const play = (seed, result, moves, timeMs) => {
    const a = startHardAttempt(rec, { seed, at: 1 });
    const f = finishHardAttempt(a.record, { id: a.id, result, moves, undos: 0, timeMs, score: hardScore(moves) });
    rec = f.record;
    return f.isNew;
  };
  assert.deepEqual(play('A', HardResult.CLEAR, 120, 600000), { first: true, score: false, time: false, moves: false });
  assert.deepEqual(play('B', HardResult.CLEAR, 100, 700000), { first: false, score: true, time: false, moves: true });
  assert.deepEqual(play('C', HardResult.CLEAR, 130, 400000), { first: false, score: false, time: true, moves: false });
  play('D', HardResult.STUCK, 5, 1000);          // 막힌 판은 최고 기록에 들어가지 않는다
  play('E', HardResult.QUIT, 3, 500);

  assert.equal(rec.plays, 5);
  assert.equal(rec.clears, 3);
  assert.deepEqual([rec.bestScore.score, rec.bestScore.seed], [35, 'B']);   // 100회 → 35점
  assert.deepEqual([rec.bestTime.timeMs, rec.bestTime.seed], [400000, 'C']);
  assert.deepEqual([rec.bestMoves.moves, rec.bestMoves.seed], [100, 'B']);
});

test('하드 기록: 점수는 클리어했을 때만 남는다 (포기·막힘은 점수 없음)', () => {
  let rec = emptyHardRecord();
  for (const [seed, result] of [['Q', HardResult.QUIT], ['S', HardResult.STUCK]]) {
    const a = startHardAttempt(rec, { seed, at: 1 });
    rec = finishHardAttempt(a.record, { id: a.id, result, moves: 10, undos: 0, timeMs: 1000, score: hardScore(10) }).record;
  }
  assert.deepEqual(rec.recent.map((e) => e.score), [null, null]);
  assert.equal(rec.bestScore, null);
  const a = startHardAttempt(rec, { seed: 'C', at: 1 });
  rec = finishHardAttempt(a.record, { id: a.id, result: HardResult.CLEAR, moves: 30, undos: 2, timeMs: 1000, score: hardScore(30) }).record;
  assert.equal(rec.recent[0].score, 70);
  assert.equal(rec.bestScore.score, 70);
});

test('하드 기록: 이미 끝난 시도는 다시 끝낼 수 없다 (클리어를 포기로 덮지 않는다)', () => {
  const a = startHardAttempt(emptyHardRecord(), { seed: 'Z', at: 1 });
  const cleared = finishHardAttempt(a.record, { id: a.id, result: HardResult.CLEAR, moves: 50, undos: 0, timeMs: 9000 }).record;
  const again = finishHardAttempt(cleared, { id: a.id, result: HardResult.QUIT, moves: 50, undos: 0, timeMs: 9999 });
  assert.equal(again.record, cleared);
  assert.equal(again.record.recent[0].result, HardResult.CLEAR);
  assert.equal(finishHardAttempt(cleared, { id: a.id, result: HardResult.CLEAR, moves: 1, undos: 0, timeMs: 1 }).record.clears, 1);
});

test('하드 기록: 최근 기록은 10판까지, 최신이 위', () => {
  let rec = emptyHardRecord();
  for (let k = 1; k <= 13; k++) {
    const a = startHardAttempt(rec, { seed: `S${k}`, at: k });
    rec = finishHardAttempt(a.record, { id: a.id, result: HardResult.QUIT, moves: k, undos: 0, timeMs: k }).record;
  }
  assert.equal(rec.plays, 13);
  assert.equal(rec.recent.length, HARD_RECENT_LIMIT);
  assert.equal(rec.recent[0].seed, 'S13');
  assert.equal(rec.recent.at(-1).seed, 'S4');
});

test('하드 기록: 일반 기록과 따로 저장되고, 깨진 값은 걸러낸다', () => {
  let hard = emptyHardRecord();
  const a = startHardAttempt(hard, { seed: 'X1', at: 5 });
  hard = finishHardAttempt(a.record, { id: a.id, result: HardResult.CLEAR, moves: 90, undos: 2, timeMs: 1000, score: hardScore(90) }).record;
  hard.recent.push({ id: 'oops', seed: 3, result: '??' });   // 깨진 줄

  const rec = { clears: 1, stars: 3, par: 5, bestMoves: { moves: 5, undos: 0, timeMs: 1000 }, bestTime: { moves: 5, undos: 0, timeMs: 1000 } };
  writeSave({ unlocked: 2, records: { 1: rec }, free: {}, hard });
  const back = loadSave(10);
  assert.deepEqual(back.records, { 1: rec });               // 일반 기록 그대로
  assert.equal(back.hard.plays, 1);
  assert.equal(back.hard.clears, 1);
  assert.equal(back.hard.recent.length, 1);                 // 깨진 줄은 버린다
  assert.equal(back.hard.bestMoves.moves, 90);
  assert.equal(back.hard.bestScore.score, hardScore(90));
  assert.equal(back.hard.recent[0].score, hardScore(90));
  assert.ok(back.hard.nextId > 1);

  writeSave({ unlocked: 1, records: {}, free: {} });        // 하드 기록이 없던 옛 저장
  assert.deepEqual(loadSave(10).hard, emptyHardRecord());
});

test('하드 기록: 규칙이 바뀌기 전(규칙 판 없음·1판)의 기록은 불러올 때 비운다 — 일반 기록은 그대로', () => {
  const rec = { clears: 1, stars: 2, par: 8, bestMoves: { moves: 9, undos: 0, timeMs: 5000 }, bestTime: { moves: 9, undos: 0, timeMs: 5000 } };
  const old = { plays: 7, clears: 3, bestTime: { timeMs: 1, moves: 1, undos: 0, seed: 'X' }, bestMoves: null, recent: [], nextId: 8 };
  writeSave({ unlocked: 3, records: { 2: rec }, free: {}, hard: old });
  const back = loadSave(10);
  assert.deepEqual(back.hard, emptyHardRecord());
  assert.deepEqual(back.records, { 2: rec });
  writeSave({ unlocked: 3, records: {}, free: {}, hard: { ...old, rules: 1 } });
  assert.deepEqual(loadSave(10).hard, emptyHardRecord());
});

test('설정: 하드 모드 안내 \'다음부터 안 보기\'가 저장된다', () => {
  writeSave({ unlocked: 1, records: {}, free: {}, settings: { hideHardIntro: true } });
  assert.equal(loadSave(10).settings.hideHardIntro, true);
  writeSave({ unlocked: 1, records: {}, free: {} });
  assert.equal(loadSave(10).settings.hideHardIntro, false);
});
