// 플레이 화면 — 한 판 진행(GameSession) + 판 그리기 + 입력 + 남은 차량·이동·시간 표시 + 막힘/나가기 안내.
//
// ★ 시계는 여기서 잰다. 탭을 다른 곳으로 옮기면 멈춘다 — 숨겨 둔 동안 흐른 시간이 기록을 망치지 않게.

import { GameSession, GameStatus } from '../core/game.js';
import { formatTime } from '../core/records.js';
import { BoardRenderer } from '../render/boardRenderer.js';
import { BoardInput } from './input.js';

export class GameScreen {
  /**
   * @param root 플레이 화면 요소 (data-screen="game")
   * @param handlers { onClear(result), onExit(), onRules() }
   */
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    this.$ = (id) => root.querySelector(`#${id}`);
    this.canvas = this.$('board');
    this.renderer = new BoardRenderer(this.canvas);
    this.input = new BoardInput(this.canvas, this.renderer, {
      push: (i, s) => this.push(i, s),
      undo: () => this.undo(),
      restart: () => this.restart(),
      exit: () => this.requestExit(),
    });
    this.session = null;
    this.overlay = null;       // 'stuck' | 'exit' | 'loading' | 'error'
    this.ending = false;
    this.clock = { spent: 0, since: null };
    this.tick = 0;

    root.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      if (action === 'undo') this.undo();
      else if (action === 'restart') this.restart();
      else if (action === 'exit') this.requestExit();
      else if (action === 'rules') this.h.onRules();
      else if (action === 'stay') this.hideOverlay();
      else if (action === 'leave') this.leave();
    });

    document.addEventListener('visibilitychange', () => {
      if (!this.active || !this.session || this.ending) return;
      if (document.hidden) this.pauseClock();
      else this.runClock();
    });
  }

  // ── 시작·끝 ───────────────────────────────────────────

  /** 판을 만드는 동안 */
  showLoading(title, subtitle) {
    this.stop();
    this.session = null;
    this.$('game-title').textContent = title;
    this.$('game-sub').textContent = subtitle ?? '';
    this.renderer.setPuzzle(null, []);
    this.setStats('–', '–', '0:00');
    this.showOverlay('loading');
  }

  showError(message) {
    this.$('error-text').textContent = message;
    this.showOverlay('error');
  }

  /**
   * @param opts { puzzle, par, title, subtitle }
   */
  start({ puzzle, par, title, subtitle }) {
    this.session = new GameSession(puzzle);
    this.par = par;
    this.ending = false;
    this.active = true;
    this.$('game-title').textContent = title;
    this.$('game-sub').textContent = subtitle ?? '';
    this.hideOverlay();
    this.renderer.setPuzzle(puzzle, this.session.pos);
    this.input.reset();
    this.input.enable();
    this.clock = { spent: 0, since: null };
    this.runClock();
    this.updateHud();
    this.canvas.focus({ preventScroll: true });
  }

  /** 화면을 떠날 때 */
  stop() {
    this.active = false;
    this.input.disable();
    this.pauseClock();
    clearTimeout(this.pendingTimer);
  }

  // ── 조작 ──────────────────────────────────────────────

  push(i, sign) {
    if (!this.session || this.ending || this.overlay) return;
    const m = this.session.move(i, sign);
    if (!m) return;
    if (!m.moved) {
      this.renderer.animateBlocked(m);
      return;
    }
    this.renderer.animateMove(m, this.session.pos);
    this.updateHud();
    if (m.exits) this.announce(`나갔어요. 남은 차량 ${this.session.remaining}대`);

    const status = this.session.status;
    if (status === GameStatus.CLEARED) {
      this.ending = true;
      this.pauseClock();
      this.input.disable();
      const result = {
        moves: this.session.moveCount,
        undos: this.session.undoCount,
        timeMs: this.elapsed(),
        par: this.par,
      };
      this.pendingTimer = setTimeout(() => this.h.onClear(result), this.renderer.remainingAnimationMs() + 350);
    } else if (status === GameStatus.STUCK) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = setTimeout(() => {
        if (this.session?.status === GameStatus.STUCK) this.showOverlay('stuck');
      }, this.renderer.remainingAnimationMs() + 150);
    }
  }

  undo() {
    if (!this.session || this.ending) return;
    if (this.overlay && this.overlay !== 'stuck') return;
    const m = this.session.undo();
    if (!m) {
      this.nudge('undo');
      return;
    }
    clearTimeout(this.pendingTimer);
    this.hideOverlay();
    this.renderer.animateUndo(m, this.session.pos);
    this.updateHud();
  }

  restart() {
    if (!this.session || this.ending) return;
    if (this.overlay && this.overlay !== 'stuck') return;
    clearTimeout(this.pendingTimer);
    this.session.restart();
    this.hideOverlay();
    this.renderer.snapTo(this.session.pos);
    this.input.reset();
    this.clock = { spent: 0, since: null };
    this.runClock();
    this.updateHud();
    this.canvas.focus({ preventScroll: true });
  }

  requestExit() {
    if (this.overlay === 'exit') {
      this.hideOverlay();
      return;
    }
    if (!this.session || this.ending || this.session.moveCount === 0 || this.overlay === 'error') {
      this.leave();
      return;
    }
    this.showOverlay('exit');
  }

  leave() {
    this.stop();
    this.hideOverlay();
    this.h.onExit();
  }

  // ── 표시 ──────────────────────────────────────────────

  updateHud() {
    const s = this.session;
    this.setStats(String(s.remaining), String(s.moveCount), formatTime(this.elapsed()));
    this.$('undo-count').textContent = s.undoCount > 0 ? `되돌림 ${s.undoCount}` : '';
    // ⚠️ '막혔어요' 안내에도 되돌리기 버튼이 있다 — 그쪽(문서상 먼저 나온다)을 잡지 않도록 범위를 좁힌다
    this.root.querySelector('.game-actions [data-action="undo"]').disabled = s.moveCount === 0;
  }

  setStats(left, moves, time) {
    this.$('stat-left').textContent = left;
    this.$('stat-moves').textContent = moves;
    this.$('stat-time').textContent = time;
  }

  showOverlay(name) {
    this.overlay = name;
    for (const el of this.root.querySelectorAll('[data-overlay]')) el.hidden = el.dataset.overlay !== name;
    if (name === 'stuck') this.announce('막혔어요. 되돌리거나 다시 시작하세요.');
    const focusTarget = this.root.querySelector(`[data-overlay="${name}"] [data-autofocus]`);
    focusTarget?.focus({ preventScroll: true });
  }

  hideOverlay() {
    if (!this.overlay) return;
    this.overlay = null;
    for (const el of this.root.querySelectorAll('[data-overlay]')) el.hidden = true;
    this.canvas.focus({ preventScroll: true });
  }

  announce(text) {
    this.$('game-live').textContent = text;
  }

  /** 누를 수 없는 버튼을 눌렀을 때 살짝 흔든다 */
  nudge(action) {
    const btn = this.root.querySelector(`.game-actions [data-action="${action}"]`);
    btn?.classList.remove('nudge');
    void btn?.offsetWidth;
    btn?.classList.add('nudge');
  }

  // ── 시계 ──────────────────────────────────────────────

  elapsed() {
    const c = this.clock;
    return c.spent + (c.since == null ? 0 : performance.now() - c.since);
  }

  runClock() {
    if (this.clock.since == null) this.clock.since = performance.now();
    clearInterval(this.tick);
    this.tick = setInterval(() => {
      if (this.session) this.$('stat-time').textContent = formatTime(this.elapsed());
    }, 250);
  }

  pauseClock() {
    if (this.clock.since != null) {
      this.clock.spent += performance.now() - this.clock.since;
      this.clock.since = null;
    }
    clearInterval(this.tick);
  }
}
