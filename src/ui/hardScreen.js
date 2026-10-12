// 하드 모드 플레이 화면 — HardSession + 판 그리기(구역·확대) + 입력 + 표시(시드·남은 차량·이동·시간·카운트다운).
//
// ★ 한 턴을 차례로 보여 준다: 플레이어 이동 → 랜덤 이동 한 대씩(주황 강조) → 새 차량(하늘색 강조).
//   엔진 상태는 이미 끝까지 바뀌어 있고 화면만 순서대로 따라간다. 그 사이에 다음 수를 두면 남은 애니메이션을
//   건너뛰고 바로 받는다 — 25×25에서 백 수 넘게 두는 판이라 기다리게 하면 답답하다.

import { HardSession, HardStatus, zoneLayout } from '../core/hardMode.js';
import { applyMove } from '../core/rules.js';
import { formatTime } from '../core/records.js';
import { BoardRenderer, HIGHLIGHT } from '../render/boardRenderer.js';
import { BoardInput } from './input.js';

const RANDOM_GAP_MS = 80;      // 랜덤 이동 사이 간격
const ZOOM_STEP = 1.6;

export class HardScreen {
  /**
   * @param root data-screen="hard"
   * @param handlers { onClear(result), onExit(), onRules(), onNewBoard(), onSeed(seed),
   *                   onAttemptStart({ seed }) → 시도 번호, onAttemptEnd({ id, seed, result, moves, undos, timeMs }) }
   *   ★ 첫 수를 두면 시도가 시작되고, 클리어가 아닌 이유로 판을 떠나면(나가기·새 판·같은 판·다른 시드) 포기/막힘으로 끝난다
   */
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    this.$ = (id) => root.querySelector(`#${id}`);
    this.canvas = this.$('hard-board');
    this.renderer = new BoardRenderer(this.canvas);
    this.input = new BoardInput(this.canvas, this.renderer, {
      push: (i, s) => this.push(i, s),
      undo: () => this.undo(),
      restart: () => this.restart(),
      exit: () => this.requestExit(),
    }, { zoom: true });
    this.session = null;
    this.overlay = null;
    this.ending = false;
    this.active = false;
    this.clock = { spent: 0, since: null };
    this.tick = 0;

    root.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      switch (action) {
        case 'undo': this.undo(); break;
        case 'restart': this.restart(); break;
        case 'new-board': this.newBoard(); break;
        case 'new-confirm':
          this.hideOverlay();
          this.stop();
          this.h.onNewBoard();
          break;
        case 'exit': this.requestExit(); break;
        case 'rules': this.h.onRules(); break;
        case 'stay': this.hideOverlay(); break;
        case 'leave': this.leave(); break;
        case 'seed-open': this.openSeed(); break;
        case 'zoom-in': this.zoomBy(ZOOM_STEP); break;
        case 'zoom-out': this.zoomBy(1 / ZOOM_STEP); break;
        case 'zoom-fit': this.renderer.resetView(); break;
        default: break;
      }
    });
    this.$('hard-seed-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const seed = this.$('hard-seed-input').value.trim().slice(0, 40);
      if (!seed) return;
      this.hideOverlay();
      this.stop();
      this.h.onSeed(seed);
    });

    document.addEventListener('visibilitychange', () => {
      if (!this.active || !this.session || this.ending) return;
      if (document.hidden) this.pauseClock();
      else this.runClock();
    });
  }

  // ── 시작·끝 ───────────────────────────────────────────

  showLoading(seed) {
    this.stop();
    this.session = null;
    this.seed = seed;
    this.$('hard-seed').textContent = seed;
    this.$('hard-sub').textContent = `시드 ${seed}`;
    this.renderer.setPuzzle(null, []);
    this.setStats({ left: '–', moves: '–', time: '0:00', countdown: '–', score: '–', limos: '–' });
    this.showOverlay('loading');
  }

  showError(message) {
    this.$('hard-error-text').textContent = message;
    this.showOverlay('error');
  }

  /** @param opts { puzzle, seed, config } */
  start({ puzzle, seed, config }) {
    this.session = new HardSession(puzzle, seed, config);
    this.seed = seed;
    this.attemptId = null;
    this.ending = false;
    this.active = true;
    this.lastRandom = null;
    this.$('hard-seed').textContent = seed;
    this.$('hard-sub').textContent = `시드 ${seed}`;
    this.hideOverlay();
    this.renderer.setPuzzle(puzzle, this.session.pos, { zone: zoneLayout(puzzle.size, this.session.config.safeSize) });
    this.input.reset();
    this.input.enable();
    this.clock = { spent: 0, since: null };
    this.runClock();
    this.updateHud();
    this.canvas.focus({ preventScroll: true });
  }

  stop() {
    this.endAttempt();
    this.active = false;
    this.input.disable();
    this.pauseClock();
    clearTimeout(this.pendingTimer);
    clearTimeout(this.toastTimer);
  }

  // ── 조작 ──────────────────────────────────────────────

  push(i, sign) {
    if (!this.session || this.ending || this.overlay) return;
    if (this.renderer.remainingAnimationMs() > 0) this.renderer.finishAnimations();   // 지난 턴 연출을 건너뛴다

    const before = this.session.state;
    const r = this.session.move(i, sign);
    if (!r) return;
    if (!r.moved) {
      this.renderer.animateBlocked(r.move);
      return;
    }

    if (this.attemptId == null) this.attemptId = this.h.onAttemptStart?.({ seed: this.seed }) ?? null;

    // ① 플레이어 이동
    const afterPlayer = applyMove(before.pos, r.move);
    this.renderer.animateMove(r.move, afterPlayer);
    let t = this.renderer.remainingAnimationMs();

    if (r.cleared) {
      this.ending = true;
      this.pauseClock();
      this.input.disable();
      this.updateHud();
      const result = {
        moves: this.session.moveCount,
        undos: this.session.undoCount,
        timeMs: this.elapsed(),
        score: this.session.expectedScore,
        seed: this.seed,
        attemptId: this.attemptId,
      };
      this.attemptId = null;   // 클리어로 끝난 시도 — 화면을 떠날 때 '포기'로 다시 적지 않게
      this.pendingTimer = setTimeout(() => this.h.onClear(result), t + 350);
      return;
    }

    // ② 랜덤 이동 — 한 대씩 차례로, 주황 강조
    t += RANDOM_GAP_MS;
    const afterRandom = afterPlayer.slice();
    for (const m of r.random.moves) {
      const end = this.renderer.queueSlide(m.vehicle, m.from, m.to, {
        delay: t,
        dur: Math.min(380, 120 + m.dist * 45),
        highlight: HIGHLIGHT.RANDOM,
      });
      t = end + RANDOM_GAP_MS;
      afterRandom[m.vehicle] = m.to;
    }
    this.renderer.pos = afterRandom;

    // ③ 새 차량 — 랜덤 이동이 끝난 뒤 하늘색으로 나타난다
    if (r.spawned) this.renderer.updatePuzzle(this.session.puzzle, this.session.pos, { spawnDelay: t });

    this.lastRandom = r.random;
    this.updateHud();
    const n = r.random.moves.length;
    const limoOut = r.move.exits && this.session.puzzle.vehicles[r.move.vehicle].kind === 'limo';
    const parts = [n > 0 ? `이번 턴 ${n}대 이동` : '움직일 수 있는 차가 없어 랜덤 이동 없음'];
    if (limoOut) parts.unshift(`👑 리무진 탈출! (${this.session.limosOut}/${this.session.limosTotal})`);
    if (r.spawned) parts.push('새 차량 도착!');
    else if (r.countdownStarted) parts.push(`${r.countdown}턴 뒤 새 차량`);
    this.toast(parts.join(' · '), !!r.spawned || limoOut);
    this.announce(`${parts.join('. ')}. 남은 차량 ${this.session.remaining}대`);

    if (this.session.status === HardStatus.STUCK) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = setTimeout(() => {
        if (this.session?.status === HardStatus.STUCK) this.showOverlay('stuck');
      }, this.renderer.remainingAnimationMs() + 150);
    }
  }

  undo() {
    if (!this.session || this.ending) return;
    if (this.overlay && this.overlay !== 'stuck') return;
    const r = this.session.undo();
    if (!r) {
      this.nudge('undo');
      return;
    }
    clearTimeout(this.pendingTimer);
    this.hideOverlay();
    this.renderer.finishAnimations();
    this.renderer.updatePuzzle(r.after.puzzle, r.after.pos);
    this.lastRandom = null;
    this.updateHud();
    this.toast('한 턴 되돌렸어요 (랜덤 이동·새 차량 포함)');
  }

  /** 같은 판 다시하기 — 같은 시드의 처음 상태로 */
  restart() {
    if (!this.session || this.ending) return;
    if (this.overlay && this.overlay !== 'stuck') return;
    clearTimeout(this.pendingTimer);
    this.endAttempt();   // 같은 판을 처음부터 — 지금 시도는 포기로 끝나고, 첫 수를 두면 새 시도
    this.session.restart();
    this.hideOverlay();
    this.renderer.snapTo(this.session.pos);
    this.renderer.updatePuzzle(this.session.puzzle, this.session.pos, { animate: false });
    this.input.reset();
    this.lastRandom = null;
    this.clock = { spent: 0, since: null };
    this.runClock();
    this.updateHud();
    this.canvas.focus({ preventScroll: true });
  }

  newBoard() {
    if (this.overlay && !['stuck', 'error'].includes(this.overlay)) return;
    if (this.session && !this.ending && this.session.moveCount > 0 && this.overlay !== 'stuck') {
      this.showOverlay('new');
      return;
    }
    this.stop();
    this.h.onNewBoard();
  }

  requestExit() {
    if (this.overlay === 'exit' || this.overlay === 'seed' || this.overlay === 'new') {
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

  openSeed() {
    if (this.ending) return;
    this.$('hard-seed-input').value = '';
    this.showOverlay('seed');
  }

  zoomBy(factor) {
    const { w, h } = this.renderer.layout;
    this.renderer.zoomAt(factor, w / 2, h / 2);
  }

  /** 진행 중인 시도를 클리어가 아닌 이유로 끝낸다 (막힘 상태면 '막힘', 아니면 '포기') */
  endAttempt() {
    if (this.attemptId == null || !this.session) return;
    this.h.onAttemptEnd?.({
      id: this.attemptId,
      seed: this.seed,
      result: this.session.status === HardStatus.STUCK ? 'stuck' : 'quit',
      moves: this.session.moveCount,
      undos: this.session.undoCount,
      timeMs: this.elapsed(),
    });
    this.attemptId = null;
  }

  // ── 표시 ──────────────────────────────────────────────

  updateHud() {
    const s = this.session;
    const cd = s.countdown;
    this.setStats({
      left: String(s.remaining),
      moves: String(s.moveCount),
      time: formatTime(this.elapsed()),
      countdown: cd == null ? '없음' : `${cd}턴 뒤`,
      score: `${s.expectedScore}점`,
      limos: `${s.limosOut}/${s.limosTotal}`,
    });
    this.$('hard-countdown').closest('.stat').classList.toggle('alert', cd != null && cd <= 1);
    this.$('hard-undo-count').textContent = s.undoCount > 0 ? `되돌림 ${s.undoCount}` : '';
    // ⚠️ 이동 횟수는 되돌려도 줄지 않으므로, 되돌릴 수 있는지는 이동 횟수가 아니라 기록된 턴으로 본다
    this.root.querySelector('.game-actions [data-action="undo"]').disabled = !s.canUndo;
  }

  setStats({ left, moves, time, countdown, score, limos }) {
    this.$('hard-left').textContent = left;
    this.$('hard-moves').textContent = moves;
    this.$('hard-time').textContent = time;
    this.$('hard-countdown').textContent = countdown;
    this.$('hard-score').textContent = score;
    this.$('hard-limos').textContent = limos;
  }

  toast(text, hot = false) {
    const el = this.$('hard-toast');
    el.textContent = text;
    el.classList.toggle('hot', hot);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  showOverlay(name) {
    this.overlay = name;
    for (const el of this.root.querySelectorAll('[data-overlay]')) el.hidden = el.dataset.overlay !== name;
    if (name === 'stuck') this.announce('막혔어요. 되돌리거나 다시 시작하세요.');
    this.root.querySelector(`[data-overlay="${name}"] [data-autofocus]`)?.focus({ preventScroll: true });
  }

  hideOverlay() {
    if (!this.overlay) return;
    this.overlay = null;
    for (const el of this.root.querySelectorAll('[data-overlay]')) el.hidden = true;
    this.canvas.focus({ preventScroll: true });
  }

  announce(text) {
    this.$('hard-live').textContent = text;
  }

  nudge(action) {
    const btn = this.root.querySelector(`.game-actions [data-action="${action}"]`);
    btn?.classList.remove('nudge');
    void btn?.offsetWidth;
    btn?.classList.add('nudge');
  }

  // ── 시계 (탭을 숨기면 멈춘다) ─────────────────────────────

  elapsed() {
    const c = this.clock;
    return c.spent + (c.since == null ? 0 : performance.now() - c.since);
  }

  runClock() {
    if (this.clock.since == null) this.clock.since = performance.now();
    clearInterval(this.tick);
    this.tick = setInterval(() => {
      if (this.session) this.$('hard-time').textContent = formatTime(this.elapsed());
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
