// 규칙 보기 — <dialog> 안에 설명과 직접 눌러 볼 수 있는 작은 연습 판.

import { createPuzzle } from '../core/rules.js';
import { parseTextBoard } from '../core/textBoard.js';
import { GameSession, GameStatus } from '../core/game.js';
import { BoardRenderer } from '../render/boardRenderer.js';
import { BoardInput } from './input.js';

// 버스(d)는 왼쪽이 구조물, 오른쪽이 자동차(c)에 막혀 있다 — c를 먼저 빼야 버스가 나간다.
const DEMO = `
  . . b . .
  # . B . .
  . . . . c
  # D d d C
  . . . . .
`;

export class RulesDialog {
  constructor(dialog, { onOpen, onClose } = {}) {
    this.dialog = dialog;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.puzzle = createPuzzle(parseTextBoard(DEMO));
    this.renderer = null;
    this.demoText = dialog.querySelector('#demo-status');

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) this.close();   // 바깥(배경) 누르면 닫기
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'rules-close') this.close();
      if (action === 'demo-reset') this.resetDemo();
    });
    dialog.addEventListener('close', () => {
      this.input?.disable();
      this.onClose?.();
    });
  }

  open() {
    this.onOpen?.();
    this.dialog.showModal();
    if (!this.renderer) {
      // 대화 상자가 열려 크기가 생긴 뒤에 만든다
      const canvas = this.dialog.querySelector('#demo-board');
      this.renderer = new BoardRenderer(canvas);
      this.session = new GameSession(this.puzzle);
      this.input = new BoardInput(canvas, this.renderer, {
        push: (i, s) => this.push(i, s),
        undo: () => {},
        restart: () => {},
        exit: () => {},
      }, { keyboard: false });
    }
    this.resetDemo();
    this.input.enable();
  }

  close() {
    if (this.dialog.open) this.dialog.close();
  }

  resetDemo() {
    this.session.restart();
    this.renderer.setPuzzle(this.puzzle, this.session.pos);
    this.demoText.textContent = '차를 눌러 보세요.';
  }

  push(i, sign) {
    const m = this.session.move(i, sign);
    if (!m) return;
    if (!m.moved) {
      this.renderer.animateBlocked(m);
      this.demoText.textContent = '막혀서 움직이지 못했어요 — 이동 횟수에 들어가지 않아요.';
      return;
    }
    this.renderer.animateMove(m, this.session.pos);
    if (this.session.status === GameStatus.CLEARED) this.demoText.textContent = `다 뺐어요! ${this.session.moveCount}수 만에.`;
    else if (m.exits) this.demoText.textContent = `나갔어요. 남은 차량 ${this.session.remaining}대`;
    else this.demoText.textContent = '막힌 곳 바로 앞에서 멈췄어요.';
  }
}
