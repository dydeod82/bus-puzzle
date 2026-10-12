// 1~10단계를 실제로 만들어 보고 표로 보여 준다. 레벨 숫자를 바꾼 뒤 돌려 볼 것.
//   node tools/levels-report.js          표만
//   node tools/levels-report.js --show   판 그림까지

import { LEVELS } from '../src/core/levels.js';
import { generatePuzzle } from '../src/core/generator.js';
import { createPuzzle, getMove, applyMove, isCleared } from '../src/core/rules.js';
import { toTextBoard } from '../src/core/textBoard.js';

const show = process.argv.includes('--show');
let allOk = true;

console.log('단계 | 판    | 차량 | 목표 | 밀기 | 바로나감 | 시도 | 시간    | 결과');
console.log('-----|-------|------|------|------|----------|------|---------|------');

LEVELS.forEach((lv, idx) => {
  const t0 = performance.now();
  const g = generatePuzzle(lv, lv.seed);
  const ms = performance.now() - t0;
  const puzzle = createPuzzle(g.def);

  // 솔버의 수순을 규칙 엔진으로 처음부터 다시 둬 본다 — 솔버 내부를 믿지 않고 따로 검증
  let pos = puzzle.start.slice();
  let replayOk = true;
  for (const m of g.solution) {
    const move = getMove(puzzle, pos, m.vehicle, m.sign);
    if (!move || !move.moved) { replayOk = false; break; }
    pos = applyMove(pos, move);
  }
  replayOk = replayOk && isCleared(pos) && g.solution.length === g.par;

  const ok = replayOk && g.met;
  allOk &&= ok;
  const status = !replayOk ? '수순 오류' : g.met ? 'OK' : '조건 미달';
  console.log(
    `${String(idx + 1).padStart(4)} | ${`${lv.size}×${lv.size}`.padEnd(5)} | ${String(puzzle.vehicles.length).padStart(4)} | ` +
    `${String(g.par).padStart(4)} | ${String(g.slides).padStart(4)} | ${String(g.exitableAtStart).padStart(8)} | ` +
    `${String(g.attempts).padStart(4)} | ${ms.toFixed(0).padStart(5)}ms | ${status}`,
  );
  if (show) console.log(`\n${toTextBoard(puzzle, puzzle.start)}\n`);
});

if (!allOk) {
  console.log('\n일부 단계가 조건을 맞추지 못했습니다.');
  process.exitCode = 1;
}
