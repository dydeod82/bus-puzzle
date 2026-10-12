// 판 생성 작업 — 워커와 화면 스레드(워커를 못 쓸 때)가 같은 함수를 부른다. 화면에 넘길 값만 골라 돌려준다.
//   'level' 일반 판 (generator.js) — params는 레벨·자유 모드 설정
//   'hard'  하드 모드 판 (hardGenerator.js) — params는 HARD_MODE
import { generatePuzzle } from '../core/generator.js';
import { generateHardBoard } from '../core/hardGenerator.js';

export function runJob(kind, params, seed) {
  if (kind === 'hard') {
    const r = generateHardBoard(params, seed);
    return { def: r.def, par: r.par };
  }
  const r = generatePuzzle(params, seed);
  return { def: r.def, par: r.par, slides: r.slides, optimal: r.optimal };
}
