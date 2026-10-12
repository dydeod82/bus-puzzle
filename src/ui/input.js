// 입력 — 마우스·터치·키보드를 "i번 차를 sign 방향으로 밀어라" 같은 명령으로 바꾼다.
//
//   누르기   차의 어느 쪽 절반을 눌렀는지로 방향이 정해진다 (앞쪽 절반 = 앞으로, 뒤쪽 절반 = 뒤로)
//   밀기     차를 누른 채 길이 방향으로 끌면 그쪽으로 (휴대폰에서 자연스럽다)
//   키보드   방향키·WASD — 차 길이 방향이면 밀고, 그와 수직이면 그쪽에 있는 다른 차를 고른다.
//            Tab(판에 초점이 있을 때)으로 차례로 고르기, Z 되돌리기, R 재시작, Esc 나가기
//
// ⚠️ 마우스·터치로 조작하는 동안에는 선택 테두리를 숨긴다 — 누를 때마다 테두리가 따라다니면 시끄럽다.
//    방향키를 누르는 순간부터 보인다.

import { EXITED, signForDir } from '../core/rules.js';

const DRAG_THRESHOLD = 12;   // px — 이보다 적게 움직이고 떼면 '누르기'
const KEY_DIRS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  a: 'left', d: 'right', w: 'up', s: 'down', A: 'left', D: 'right', W: 'up', S: 'down',
};
const DIR_VEC = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

export class BoardInput {
  /**
   * @param handlers { push(i, sign), undo(), restart(), exit() }
   * @param options.keyboard false면 키보드를 받지 않는다 (규칙 창의 작은 연습 판)
   */
  constructor(canvas, renderer, handlers, { keyboard = true } = {}) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.h = handlers;
    this.keyboard = keyboard;
    this.enabled = false;
    this.down = null;
    this.selected = -1;
    this.keyboardMode = false;

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', () => { this.down = null; });
    canvas.addEventListener('pointerleave', () => this.renderer.setHover(null));
    if (keyboard) window.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
    this.down = null;
    this.renderer.setHover(null);
  }

  /** 새 판을 시작할 때 */
  reset() {
    this.selected = -1;
    this.keyboardMode = false;
    this.renderer.setSelected(-1);
  }

  // ── 포인터 ────────────────────────────────────────────

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onPointerDown(e) {
    if (!this.enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const pt = this.local(e);
    this.down = { id: e.pointerId, ...pt, hit: this.renderer.hitTest(pt.x, pt.y) };
    // 판 밖으로 끌고 나가 손을 떼도 pointerup을 받도록. 이미 끝난 포인터면 예외를 던지므로 삼킨다
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 무시 */
    }
    if (this.keyboardMode) {
      this.keyboardMode = false;
      this.renderer.setSelected(-1);
    }
  }

  onPointerMove(e) {
    if (!this.enabled) return;
    if (e.pointerType !== 'mouse' || this.down) return;
    const pt = this.local(e);
    const hit = this.renderer.hitTest(pt.x, pt.y);
    this.renderer.setHover(hit ? { vehicle: hit.vehicle, sign: hit.sign } : null);
    this.canvas.style.cursor = hit ? 'pointer' : 'default';
  }

  onPointerUp(e) {
    const d = this.down;
    this.down = null;
    if (!this.enabled || !d || d.id !== e.pointerId || !d.hit) return;
    const pt = this.local(e);
    const dx = pt.x - d.x;
    const dy = pt.y - d.y;
    const i = d.hit.vehicle;
    this.selected = i;

    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) {
      this.h.push(i, d.hit.sign);
    } else {
      // 밀기 — 차 길이 방향 성분이 충분히 클 때만 (비스듬히 문지른 것은 무시)
      const v = this.renderer.puzzle.vehicles[i];
      const along = v.axis === 'h' ? dx : dy;
      const across = v.axis === 'h' ? dy : dx;
      if (Math.abs(along) >= DRAG_THRESHOLD && Math.abs(along) > Math.abs(across) * 0.7) {
        this.h.push(i, Math.sign(along));
      }
    }
    if (e.pointerType === 'mouse') {
      const hit = this.renderer.hitTest(pt.x, pt.y);
      this.renderer.setHover(hit ? { vehicle: hit.vehicle, sign: hit.sign } : null);
    }
  }

  // ── 키보드 ────────────────────────────────────────────

  onKeyDown(e) {
    if (!this.enabled || e.altKey || e.metaKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.closest('input, textarea, select, dialog[open]') || t.isContentEditable)) return;

    if ((e.key === 'z' || e.key === 'Z') || e.key === 'Backspace') {
      e.preventDefault();
      this.h.undo();
      return;
    }
    if (e.ctrlKey) return;
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      this.h.restart();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this.h.exit();
      return;
    }
    if (e.key === 'Tab' && document.activeElement === this.canvas) {
      e.preventDefault();
      this.cycle(e.shiftKey ? -1 : 1);
      return;
    }

    const dir = KEY_DIRS[e.key];
    if (!dir) return;
    e.preventDefault();
    this.keyboardMode = true;

    // 고른 차가 없거나 이미 나갔으면 먼저 하나 고르기만 한다
    if (!this.isOnBoard(this.selected)) {
      this.select(this.nearestTo(this.renderer.puzzle.size / 2, this.renderer.puzzle.size / 2));
      return;
    }
    const v = this.renderer.puzzle.vehicles[this.selected];
    const sign = signForDir(v, dir);
    if (sign !== 0) {
      const before = this.renderer.vehicleCenter(this.selected);
      this.h.push(this.selected, sign);
      // 고른 차가 나가 버렸으면 원래 있던 자리에서 가장 가까운 차로 옮긴다
      if (!this.isOnBoard(this.selected)) this.select(this.nearestTo(before.x, before.y));
      else this.renderer.setSelected(this.selected);
    } else {
      const next = this.neighbor(this.selected, dir);
      if (next >= 0) this.select(next);
    }
  }

  isOnBoard(i) {
    return i >= 0 && this.renderer.pos[i] !== undefined && this.renderer.pos[i] !== EXITED;
  }

  select(i) {
    this.selected = i;
    this.renderer.setSelected(this.keyboardMode ? i : -1);
  }

  cycle(step) {
    this.keyboardMode = true;
    const n = this.renderer.puzzle.vehicles.length;
    for (let k = 1; k <= n; k++) {
      const i = (((this.selected < 0 ? (step > 0 ? -1 : 0) : this.selected) + step * k) % n + n) % n;
      if (this.isOnBoard(i)) {
        this.select(i);
        return;
      }
    }
  }

  nearestTo(x, y) {
    let best = -1;
    let bestD = Infinity;
    this.renderer.puzzle.vehicles.forEach((_, i) => {
      if (!this.isOnBoard(i)) return;
      const c = this.renderer.vehicleCenter(i);
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  /** dir 쪽에 있는 차 중 가장 가까운 것 (옆으로 벗어난 거리는 두 배로 친다) */
  neighbor(i, dir) {
    const [vx, vy] = DIR_VEC[dir];
    const c = this.renderer.vehicleCenter(i);
    let best = -1;
    let bestScore = Infinity;
    this.renderer.puzzle.vehicles.forEach((_, j) => {
      if (j === i || !this.isOnBoard(j)) return;
      const o = this.renderer.vehicleCenter(j);
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      const along = dx * vx + dy * vy;
      if (along <= 0.01) return;
      const score = along + Math.abs(dx * vy - dy * vx) * 2;
      if (score < bestScore) {
        bestScore = score;
        best = j;
      }
    });
    return best;
  }
}
