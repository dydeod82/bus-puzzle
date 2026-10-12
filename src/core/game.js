// 한 판 진행 — 이동 횟수·되돌리기·재시작·클리어/막힘 상태. 화면과 무관한 순수 로직이다.
// 경과 시간은 여기 두지 않는다: 시계는 바깥 세상(화면)의 일이라, 여기에 두면 테스트가 시간에 묶인다.

import {
  EXITED, getMove, applyMove, isCleared, remainingCount, checkStuck, StuckCheck,
} from './rules.js';

export const GameStatus = Object.freeze({
  PLAYING: 'playing',
  CLEARED: 'cleared',
  STUCK: 'stuck',
});

export class GameSession {
  /**
   * @param puzzle createPuzzle()의 결과
   * @param options.stuckSearchLimit 막힘 판정 탐색 한도. 넘으면 막히지 않은 것으로 친다
   */
  constructor(puzzle, { stuckSearchLimit = 20000 } = {}) {
    this.puzzle = puzzle;
    this.stuckSearchLimit = stuckSearchLimit;
    this.restart();
  }

  /** 처음 상태로. 이동 횟수와 되돌리기 횟수도 함께 0이 된다 — 새로 도전하는 것이므로 */
  restart() {
    this.pos = this.puzzle.start.slice();
    this.history = [];
    this.undoCount = 0;
    this.status = this.#evaluate();
  }

  /** 이동 횟수 = 지금 쌓여 있는 이동 수. 되돌리면 줄어들고, 그 대신 undoCount가 남는다 */
  get moveCount() {
    return this.history.length;
  }

  get remaining() {
    return remainingCount(this.pos);
  }

  isOnBoard(i) {
    return this.pos[i] !== EXITED;
  }

  /** 상태를 바꾸지 않고 결과만 본다 (미리보기·흔들림 판정용) */
  preview(i, sign) {
    return getMove(this.puzzle, this.pos, i, sign);
  }

  /**
   * i번 차량을 sign(+1/-1) 방향으로 민다.
   * - 한 칸도 못 움직이면 상태·이동 횟수를 건드리지 않고 moved=false인 결과를 돌려준다 (흔들림 연출용)
   * - 이미 나간 차량이거나, 클리어·막힘 상태면 null
   *   ⚠️ 막힘 상태에서 움직이지 못하게 하는 이유: 막힘은 "어떻게 움직여도 나갈 수 없다"는 판정이라
   *   여기서 더 미는 수는 이동 횟수만 늘린다. 되돌리기·재시작만 받는다.
   */
  move(i, sign) {
    if (this.status !== GameStatus.PLAYING) return null;
    const m = getMove(this.puzzle, this.pos, i, sign);
    if (!m || !m.moved) return m;
    this.history.push(m);
    this.pos = applyMove(this.pos, m);
    this.status = this.#evaluate();
    return m;
  }

  /** 마지막 이동을 되돌린다. 되돌릴 것이 없으면 null이고 횟수도 세지 않는다 */
  undo() {
    const m = this.history.pop();
    if (!m) return null;
    this.pos = this.pos.slice();
    this.pos[m.vehicle] = m.from;
    this.undoCount++;
    this.status = this.#evaluate();
    return m;
  }

  #evaluate() {
    if (isCleared(this.pos)) return GameStatus.CLEARED;
    const r = checkStuck(this.puzzle, this.pos, { maxStates: this.stuckSearchLimit });
    return r === StuckCheck.STUCK ? GameStatus.STUCK : GameStatus.PLAYING;
  }
}
