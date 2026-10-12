import { parseTextBoard } from '../src/core/textBoard.js';
import { createPuzzle } from '../src/core/rules.js';

/** 글자 그림으로 퍼즐을 만든다 */
export function board(text) {
  return createPuzzle(parseTextBoard(text));
}

/** 글자로 차량 번호 찾기 */
export function idOf(puzzle, label) {
  const v = puzzle.vehicles.find((x) => x.label === label);
  if (!v) throw new Error(`차량 '${label}'이 판에 없습니다`);
  return v.id;
}
