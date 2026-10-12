// 판 그리기 — Canvas 하나에 판·구조물·차량을 그리고 이동 애니메이션을 돌린다.
//
// ★ 그림은 '보이는 위치'(vis)를, 판정은 규칙 엔진의 '진짜 위치'(pos)를 쓴다.
//   이동하면 엔진 상태는 즉시 바뀌고, 여기서는 그 사이를 짧게 이어 그릴 뿐이다.
//   그래서 애니메이션 도중에 다른 차를 눌러도 판정이 어긋나지 않는다.
//
// ★ 차량마다 애니메이션 '줄'(anims)을 둔다. 하드 모드는 한 턴에 플레이어 이동 → 랜덤 이동 여러 대 → 새 차량이
//   차례로 일어나는데, 같은 차가 두 번 움직일 수도 있다. 줄에 시작 시각을 달아 넣어 두면 순서대로 이어진다.
//
// ★ 카메라(확대·이동)는 layout 계산 한 곳에만 들어간다 — 그리기·누른 자리 판정이 전부 layout을 거치므로
//   확대해도 따로 손볼 곳이 없다.
//
// 이미지 파일 없이 도형과 색으로만 그린다. 차량은 '오른쪽을 보는 모습'으로 한 번만 그리고 회전시킨다.

import { EXITED, vehicleCells } from '../core/rules.js';

const COLORS = {
  plate: '#262a33',
  grid: 'rgba(255,255,255,0.055)',
  exitDash: 'rgba(255,197,51,0.5)',
  concreteDark: '#5f646d',
  hazardA: '#ffc533',
  hazardB: '#24262b',
  bus: '#ffc533',
  busShade: '#e0a417',
  busGlass: '#1f2a36',
  busSign: '#ff9330',
  cars: ['#e5484d', '#3e8ef7', '#30a46c', '#8e4ec6', '#e93d82', '#12a594', '#6e56cf', '#00a2c7', '#d6409f', '#5b8def'],
  glass: '#c6dcee',
  headlight: '#fff4c2',
  taillight: '#ff4f56',
  select: '#ffffff',
  danger: '#ff5a5f',
  // 하드 모드 구역
  changeZone: '#30282b',
  safeZone: '#183a35',
  safeEdge: 'rgba(95,211,180,0.75)',
  // 강조
  random: '#ff9f43',
  spawn: '#4dd4ff',
};

export const HIGHLIGHT = Object.freeze({ RANDOM: COLORS.random, SPAWN: COLORS.spawn });

const MARGIN_CELLS = 0.35;         // 판 바깥 여백 (출구 점선·그림자가 보일 자리 — 넓히면 휴대폰에서 칸이 작아진다)
const MAX_CELL_PX = 52;            // 확대 상한 — 칸 하나가 이 크기가 될 때까지 (작은 판은 처음부터 이보다 커서 확대가 없다)
const ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const clamp01 = (t) => Math.max(0, Math.min(1, t));

export class BoardRenderer {
  /**
   * @param canvas 그릴 캔버스. 부모 요소 크기에 맞춰 스스로 크기를 바꾼다
   * ⚠️ 캔버스는 CSS로 부모 안에 position: absolute; inset: 0 으로 띄워 둘 것.
   *    흐름 안에 두면 부모가 캔버스 크기를 따라 커지고, 그 크기를 다시 캔버스가 따라가
   *    ResizeObserver가 끝없이 키운다 (규칙 창의 연습 판이 높이 1만 px까지 자랐다).
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.puzzle = null;
    this.pos = [];
    this.vis = [];
    this.zone = null;           // 하드 모드 구역 { lo, hi, safeSize } — 없으면 일반 판
    this.selected = -1;
    this.hover = null;          // { vehicle, sign }
    this.flashes = [];          // 막은 칸 깜빡임
    this.raf = 0;
    this.view = { zoom: 1, panX: 0, panY: 0 };
    this.layout = { cs: 0, cs0: 0, ox: 0, oy: 0, w: 0, h: 0 };

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  destroy() {
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.raf);
  }

  // ── 상태 ──────────────────────────────────────────────

  setPuzzle(puzzle, pos, { zone = null } = {}) {
    this.puzzle = puzzle;
    this.zone = zone;
    this.selected = -1;
    this.hover = null;
    this.flashes = [];
    this.view = { zoom: 1, panX: 0, panY: 0 };
    this.snapTo(pos);
    this.resize();
  }

  /** 애니메이션 없이 위치를 맞춘다 (재시작) */
  snapTo(pos) {
    this.pos = pos.slice();
    this.vis = pos.map((p) => newVis(p));
    this.requestDraw();
  }

  setSelected(i) {
    this.selected = i;
    if (i >= 0) this.ensureVisible(i);
    this.requestDraw();
  }

  setHover(h) {
    const same = (h && this.hover && h.vehicle === this.hover.vehicle && h.sign === this.hover.sign) || (!h && !this.hover);
    if (same) return;
    this.hover = h;
    this.requestDraw();
  }

  /** 엔진이 둔 이동을 그린다 (지금 바로 시작 — 그 차가 하던 애니메이션은 끊고 이어 간다) */
  animateMove(move, pos) {
    this.pos = pos.slice();
    const now = performance.now();
    const from = this.visualPos(move.vehicle, now);
    const vis = this.vis[move.vehicle];
    vis.anims = [];
    vis.shake = null;
    if (move.exits) {
      vis.anims.push(this.exitAnim(move.vehicle, move.sign, from, now));
    } else {
      vis.anims.push({ kind: 'move', from, to: move.to, t0: now, dur: slideMs(move.to - from) });
    }
    this.requestDraw();
  }

  /**
   * 차례를 기다리는 미끄러짐을 줄 끝에 붙인다 (하드 모드의 랜덤 이동).
   * @param opts.delay 지금부터 몇 ms 뒤에 시작하는가, opts.dur 걸리는 시간, opts.highlight 강조 색
   * @returns 이 애니메이션이 끝나는 시각까지 남은 ms
   */
  queueSlide(i, from, to, { delay = 0, dur, highlight = null } = {}) {
    const now = performance.now();
    const vis = this.vis[i];
    const last = vis.anims[vis.anims.length - 1];
    const t0 = Math.max(now + delay, last ? last.t0 + last.dur : 0);
    const d = dur ?? slideMs(to - from);
    vis.anims.push({ kind: 'move', from, to, t0, dur: d });
    if (highlight) vis.highlight = { color: highlight, t0, until: t0 + d + 900 };
    this.requestDraw();
    return t0 + d - now;
  }

  /**
   * 판이 바뀌었다 (차량이 늘거나 줄었다 — 하드 모드의 새 차량·되돌리기).
   * 새로 생긴 차는 delay 뒤에 커지며 나타나고, 사라진 차는 지운다. 위치가 달라진 차는 그 자리로 미끄러진다.
   * @param opts.spawnDelay 새 차가 나타나기까지 ms, opts.animate false면 위치 차이는 바로 맞춘다
   */
  updatePuzzle(puzzle, pos, { spawnDelay = 0, animate = true } = {}) {
    const now = performance.now();
    const old = this.pos;
    this.puzzle = puzzle;
    this.vis.length = Math.min(this.vis.length, puzzle.vehicles.length);
    for (let i = 0; i < puzzle.vehicles.length; i++) {
      const p = pos[i];
      if (i >= this.vis.length) {
        const vis = newVis(p);
        vis.alpha = 0;
        if (p !== EXITED) {
          vis.anims.push({ kind: 'spawn', from: p, to: p, t0: now + spawnDelay, dur: 420 });
          vis.highlight = { color: COLORS.spawn, t0: now + spawnDelay, until: now + spawnDelay + 1600 };
        }
        this.vis[i] = vis;
        continue;
      }
      if (old[i] === p) continue;
      const vis = this.vis[i];
      if (!animate) {
        this.vis[i] = newVis(p);
      } else if (p === EXITED) {
        vis.anims = [this.exitAnim(i, this.nearestEdgeSign(i, old[i]), this.visualPos(i, now), now)];
      } else if (old[i] === EXITED || vis.alpha === 0) {
        // 나갔던 차가 돌아온다 (되돌리기) — 가까운 가장자리 밖에서 들어온다
        const v = puzzle.vehicles[i];
        const sign = this.nearestEdgeSign(i, p);
        const from = sign > 0 ? puzzle.size + 0.6 : -v.len - 0.6;
        vis.alpha = 1;
        vis.anims = [{ kind: 'enter', from, to: p, t0: now, dur: Math.min(700, 140 + Math.abs(p - from) * 50) }];
      } else {
        const from = this.visualPos(i, now);
        vis.anims = [{ kind: 'move', from, to: p, t0: now, dur: slideMs(p - from) }];
      }
    }
    this.pos = pos.slice();
    this.requestDraw();
  }

  /** 되돌리기 — 나갔던 차는 판 밖에서 다시 들어온다 */
  animateUndo(move, pos) {
    this.pos = pos.slice();
    const v = this.puzzle.vehicles[move.vehicle];
    const vis = this.vis[move.vehicle];
    const now = performance.now();
    let from = this.visualPos(move.vehicle, now);
    if (move.exits && vis.alpha === 0 && vis.anims.length === 0) {
      from = move.sign > 0 ? this.puzzle.size + 0.6 : -v.len - 0.6;   // 이미 다 나간 차 — 판 밖에서 들어온다
    }
    const dist = Math.abs(move.from - from);
    vis.anims = [{ kind: move.exits ? 'enter' : 'move', from, to: move.from, t0: now, dur: Math.min(700, 140 + dist * 50) }];
    vis.alpha = 1;
    this.requestDraw();
  }

  /** 못 움직일 때 — 막힌 쪽으로 툭 부딪히고, 막은 것을 붉게 깜빡인다 */
  animateBlocked(move) {
    const now = performance.now();
    this.vis[move.vehicle].shake = { sign: move.sign, t0: now, dur: 300 };
    if (move.blocker) {
      const cells = move.blocker.vehicle == null
        ? [{ x: move.blocker.x, y: move.blocker.y }]
        : vehicleCells(this.puzzle, move.blocker.vehicle, this.pos[move.blocker.vehicle]);
      this.flashes.push({ cells, t0: now, dur: 450 });
    }
    this.requestDraw();
  }

  /** 기다리는 애니메이션을 전부 끝낸 모습으로 건너뛴다 (애니메이션 도중에 다음 수를 둘 때) */
  finishAnimations() {
    for (const vis of this.vis) {
      if (vis.anims.length === 0) continue;
      const last = vis.anims[vis.anims.length - 1];
      vis.p = last.to;
      vis.alpha = last.kind === 'exit' ? 0 : 1;
      vis.anims = [];
    }
    this.requestDraw();
  }

  /** 진행 중이거나 기다리는 애니메이션이 끝날 때까지 남은 시간(ms) */
  remainingAnimationMs() {
    const now = performance.now();
    let ms = 0;
    for (const v of this.vis) {
      const last = v.anims[v.anims.length - 1];
      if (last) ms = Math.max(ms, last.t0 + last.dur - now);
    }
    return Math.max(0, ms);
  }

  exitAnim(i, sign, from, now) {
    const v = this.puzzle.vehicles[i];
    const to = sign > 0 ? this.puzzle.size + 0.6 : -v.len - 0.6;   // 판 끝을 지나 몸길이만큼 더 나가며 사라진다
    return { kind: 'exit', from, to, t0: now, dur: Math.min(900, 160 + Math.abs(to - from) * 60) };
  }

  nearestEdgeSign(i, p) {
    const v = this.puzzle.vehicles[i];
    return p + v.len / 2 > this.puzzle.size / 2 ? 1 : -1;
  }

  // ── 좌표 · 카메라 ─────────────────────────────────────

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.dpr = dpr;
    this.layout.w = w;
    this.layout.h = h;
    this.applyView();
  }

  /** 확대 배율·이동을 받아 layout을 다시 잡는다. 판이 화면보다 크면 판 밖 빈 곳이 보이지 않게 이동을 자른다 */
  applyView() {
    const { w, h } = this.layout;
    const n = this.puzzle?.size ?? 6;
    const cs0 = Math.min(w, h) / (n + MARGIN_CELLS * 2);
    const zoom = Math.min(Math.max(1, this.view.zoom), this.maxZoom(cs0));
    const cs = cs0 * zoom;
    const size = n * cs;
    const m = MARGIN_CELLS * cs0;
    const clampAxis = (pan, span) => {
      if (size + 2 * m <= span) return 0;              // 다 보인다 — 가운데 고정
      const limit = (size + 2 * m - span) / 2;
      return Math.max(-limit, Math.min(limit, pan));
    };
    this.view = { zoom, panX: clampAxis(this.view.panX, w), panY: clampAxis(this.view.panY, h) };
    this.layout = { w, h, cs0, cs, ox: (w - size) / 2 + this.view.panX, oy: (h - size) / 2 + this.view.panY };
    this.requestDraw();
  }

  maxZoom(cs0 = this.layout.cs0) {
    return cs0 > 0 ? Math.max(1, MAX_CELL_PX / cs0) : 1;
  }

  get canZoom() {
    return this.maxZoom() > 1.01;
  }

  /** (px, py) 아래의 판 위 지점을 그대로 둔 채 배율을 factor배 한다 */
  zoomAt(factor, px, py) {
    const before = this.toBoard(px, py);
    this.view.zoom *= factor;
    this.applyView();
    const { cs, ox, oy } = this.layout;
    this.view.panX += px - (ox + before.x * cs);
    this.view.panY += py - (oy + before.y * cs);
    this.applyView();
  }

  panBy(dx, dy) {
    this.view.panX += dx;
    this.view.panY += dy;
    this.applyView();
  }

  resetView() {
    this.view = { zoom: 1, panX: 0, panY: 0 };
    this.applyView();
  }

  /** 확대한 상태에서 i번 차량이 화면 밖이면 보이도록 옮긴다 (키보드로 고를 때) */
  ensureVisible(i) {
    if (!this.puzzle || this.view.zoom <= 1.01 || this.pos[i] === EXITED) return;
    const c = this.vehicleCenter(i);
    const { cs, ox, oy, w, h } = this.layout;
    const x = ox + c.x * cs;
    const y = oy + c.y * cs;
    const pad = cs * 2;
    let dx = 0;
    let dy = 0;
    if (x < pad) dx = pad - x;
    else if (x > w - pad) dx = w - pad - x;
    if (y < pad) dy = pad - y;
    else if (y > h - pad) dy = h - pad - y;
    if (dx || dy) this.panBy(dx, dy);
  }

  /** 화면 좌표(캔버스 기준 CSS px) → 칸 좌표 (실수) */
  toBoard(px, py) {
    const { cs, ox, oy } = this.layout;
    return { x: (px - ox) / cs, y: (py - oy) / cs };
  }

  /**
   * 누른 자리의 차량과 밀 방향. 차량의 어느 쪽 절반을 눌렀는지로 방향이 정해진다
   * (앞쪽 절반 = 앞으로, 뒤쪽 절반 = 뒤로 — 결국 '누른 쪽 끝 방향'과 같다).
   */
  hitTest(px, py) {
    if (!this.puzzle) return null;
    const b = this.toBoard(px, py);
    const cx = Math.floor(b.x);
    const cy = Math.floor(b.y);
    const n = this.puzzle.size;
    if (cx < 0 || cy < 0 || cx >= n || cy >= n) return null;
    for (let i = 0; i < this.puzzle.vehicles.length; i++) {
      const p = this.pos[i];
      if (p === EXITED) continue;
      const v = this.puzzle.vehicles[i];
      const along = v.axis === 'h' ? b.x : b.y;
      const lane = v.axis === 'h' ? cy : cx;
      const c = v.axis === 'h' ? cx : cy;
      if (lane !== v.lane || c < p || c >= p + v.len) continue;
      const fraction = (along - p) / v.len;
      return { vehicle: i, sign: fraction >= 0.5 ? 1 : -1, fraction };
    }
    return null;
  }

  /** i번 차량의 중심 (칸 좌표) — 키보드 선택 이동에 쓴다 */
  vehicleCenter(i) {
    const v = this.puzzle.vehicles[i];
    const p = this.pos[i];
    const along = p + v.len / 2;
    return v.axis === 'h' ? { x: along, y: v.lane + 0.5 } : { x: v.lane + 0.5, y: along };
  }

  visualPos(i, now) {
    const vis = this.vis[i];
    let p = vis.p;
    for (const a of vis.anims) {
      if (now < a.t0) return a.from;
      if (now < a.t0 + a.dur) {
        const t = clamp01((now - a.t0) / a.dur);
        const e = a.kind === 'exit' ? easeInOutQuad(t) : easeOutCubic(t);
        return a.from + (a.to - a.from) * e;
      }
      p = a.to;
    }
    return p;
  }

  // ── 그리기 ────────────────────────────────────────────

  requestDraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame((t) => {
      this.raf = 0;
      const busy = this.draw(t);
      if (busy) this.requestDraw();
    });
  }

  /** @returns 애니메이션이 아직 남았는가 */
  draw(now = performance.now()) {
    const { ctx } = this;
    const { w, h } = this.layout;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.puzzle) return false;

    this.drawPlate();
    for (const b of this.puzzle.blocks) this.drawBlock(b.x, b.y);

    let busy = false;
    // 나가는 차를 맨 위에 — 판 가장자리 너머로 미끄러질 때 다른 차 밑으로 들어가 보이지 않게
    const exiting = (i) => this.vis[i].anims.some((a) => a.kind === 'exit');
    const order = this.puzzle.vehicles.map((_, i) => i).sort((a, b) => exiting(a) - exiting(b));
    for (const i of order) busy = this.drawVehicleAt(i, now) || busy;

    busy = this.drawFlashes(now) || busy;
    return busy;
  }

  drawPlate() {
    const { ctx } = this;
    const { cs, ox, oy } = this.layout;
    const n = this.puzzle.size;
    const size = n * cs;
    const r = cs * (this.zone ? 0.6 : 0.3);

    // 판 그림자 + 바탕 (하드 모드는 바탕 전체가 변화구역 색)
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = cs * 0.6;
    ctx.shadowOffsetY = cs * 0.15;
    roundRect(ctx, ox, oy, size, size, r);
    ctx.fillStyle = this.zone ? COLORS.changeZone : COLORS.plate;
    ctx.fill();
    ctx.restore();

    // 가운데가 살짝 밝은 아스팔트
    const g = ctx.createRadialGradient(ox + size / 2, oy + size * 0.4, size * 0.1, ox + size / 2, oy + size / 2, size * 0.75);
    g.addColorStop(0, 'rgba(255,255,255,0.045)');
    g.addColorStop(1, 'rgba(0,0,0,0.18)');
    roundRect(ctx, ox, oy, size, size, r);
    ctx.fillStyle = g;
    ctx.fill();

    if (this.zone) this.drawSafeZone();

    // 주차 칸 선
    ctx.save();
    roundRect(ctx, ox, oy, size, size, r);
    ctx.clip();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = Math.max(1, cs * 0.03);
    ctx.beginPath();
    for (let k = 1; k < n; k++) {
      ctx.moveTo(ox + k * cs, oy);
      ctx.lineTo(ox + k * cs, oy + size);
      ctx.moveTo(ox, oy + k * cs);
      ctx.lineTo(ox + size, oy + k * cs);
    }
    ctx.stroke();
    ctx.restore();

    // 사방이 출구 — 판 둘레에 노란 점선
    const inset = -cs * 0.16;
    ctx.save();
    ctx.setLineDash([cs * 0.28, cs * 0.22]);
    ctx.lineWidth = Math.max(1.5, cs * 0.05);
    ctx.strokeStyle = COLORS.exitDash;
    roundRect(ctx, ox + inset, oy + inset, size - inset * 2, size - inset * 2, r - inset);
    ctx.stroke();
    ctx.restore();
  }

  /** 하드 모드 — 정중앙 안전구역을 청록으로 칠하고 점선으로 두른다 */
  drawSafeZone() {
    const { ctx } = this;
    const { cs, ox, oy } = this.layout;
    const z = this.zone;
    if (!z.safeSize) return;
    const x = ox + z.lo * cs;
    const y = oy + z.lo * cs;
    const s = z.safeSize * cs;
    ctx.save();
    ctx.fillStyle = COLORS.safeZone;
    ctx.fillRect(x, y, s, s);
    ctx.setLineDash([cs * 0.3, cs * 0.2]);
    ctx.lineWidth = Math.max(1.5, cs * 0.08);
    ctx.strokeStyle = COLORS.safeEdge;
    ctx.strokeRect(x, y, s, s);
    ctx.restore();
  }

  drawBlock(cx, cy) {
    const { ctx } = this;
    const { cs, ox, oy } = this.layout;
    const x = ox + cx * cs;
    const y = oy + cy * cs;
    const pad = cs * 0.1;
    const s = cs - pad * 2;
    const r = cs * 0.14;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = cs * 0.15;
    ctx.shadowOffsetY = cs * 0.06;
    roundRect(ctx, x + pad, y + pad, s, s, r);
    ctx.fillStyle = COLORS.concreteDark;
    ctx.fill();
    ctx.restore();

    // 윗면 — 노랑·검정 사선 경고 띠
    const top = cs * 0.06;
    ctx.save();
    roundRect(ctx, x + pad + top, y + pad + top * 0.6, s - top * 2, s - top * 2, r * 0.8);
    ctx.clip();
    ctx.fillStyle = COLORS.hazardB;
    ctx.fillRect(x, y, cs, cs);
    ctx.strokeStyle = COLORS.hazardA;
    ctx.lineWidth = cs * 0.13;
    ctx.beginPath();
    for (let k = -2; k <= 4; k++) {
      const off = k * cs * 0.28;
      ctx.moveTo(x + off, y + cs);
      ctx.lineTo(x + off + cs, y);
    }
    ctx.stroke();
    ctx.restore();

    // 가운데 볼트 자국 — 움직이지 않는 물건이라는 표시
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(x + cs / 2, y + cs / 2, cs * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }

  /** @returns 애니메이션 중인가 */
  drawVehicleAt(i, now) {
    const vis = this.vis[i];
    const v = this.puzzle.vehicles[i];
    let busy = false;

    // 끝난 애니메이션을 줄에서 걷어 내고 결과를 굳힌다
    while (vis.anims.length && now >= vis.anims[0].t0 + vis.anims[0].dur) {
      const a = vis.anims.shift();
      vis.p = a.to;
      vis.alpha = a.kind === 'exit' ? 0 : 1;
    }

    let p = vis.p;
    let alpha = vis.alpha;
    let scale = 1;
    const a = vis.anims[0];
    if (a) {
      busy = true;
      if (now < a.t0) {
        p = a.from;
        if (a.kind === 'spawn' || a.kind === 'enter') alpha = 0;
      } else {
        const t = clamp01((now - a.t0) / a.dur);
        p = this.visualPos(i, now);
        if (a.kind === 'exit') alpha = 1 - clamp01((t - 0.45) / 0.55);
        else if (a.kind === 'enter') alpha = clamp01(t / 0.4);
        else if (a.kind === 'spawn') {
          alpha = clamp01(t / 0.35);
          scale = 0.55 + 0.45 * easeOutBack(t);
        } else alpha = 1;
      }
    }

    let bump = 0;
    if (vis.shake) {
      const t = clamp01((now - vis.shake.t0) / vis.shake.dur);
      bump = vis.shake.sign * Math.sin(t * Math.PI * 3) * (1 - t) * 0.14;
      if (t >= 1) vis.shake = null;
      else busy = true;
    }

    if (alpha <= 0.01) return busy;

    const { cs, ox, oy } = this.layout;
    const along = p + bump;
    const x = v.axis === 'h' ? ox + along * cs : ox + v.lane * cs;
    const y = v.axis === 'h' ? oy + v.lane * cs : oy + along * cs;
    const wPx = v.axis === 'h' ? v.len * cs : cs;
    const hPx = v.axis === 'h' ? cs : v.len * cs;

    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x + wPx / 2, y + hPx / 2);
    ctx.rotate(ANGLE[v.frontDir]);
    if (scale !== 1) ctx.scale(scale, scale);

    const L = v.len * cs;
    const W = cs;
    const exiting = a?.kind === 'exit' && now >= a.t0;

    // 강조 (랜덤 이동·새 차량) — 차 밑에 번지는 빛 + 테두리
    const hl = vis.highlight;
    if (hl && now >= hl.t0) {
      if (now >= hl.until) {
        vis.highlight = null;
      } else {
        busy = true;
        const fade = clamp01((hl.until - now) / 400);
        ctx.save();
        ctx.globalAlpha = alpha * fade;
        ctx.shadowColor = hl.color;
        ctx.shadowBlur = cs * 0.6;
        ctx.lineWidth = Math.max(2, cs * 0.1);
        ctx.strokeStyle = hl.color;
        roundRect(ctx, -L / 2 + cs * 0.03, -W / 2 + cs * 0.03, L - cs * 0.06, W - cs * 0.06, cs * 0.24);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (exiting) drawSpeedLines(ctx, L, W, cs);
    if (v.kind === 'bus') drawBus(ctx, L, W, cs);
    else drawCar(ctx, L, W, cs, COLORS.cars[i % COLORS.cars.length]);

    // 키보드 선택
    if (i === this.selected && !exiting) {
      ctx.save();
      ctx.setLineDash([cs * 0.18, cs * 0.12]);
      ctx.lineDashOffset = -now / 40;
      ctx.lineWidth = Math.max(2, cs * 0.06);
      ctx.strokeStyle = COLORS.select;
      roundRect(ctx, -L / 2 + cs * 0.02, -W / 2 + cs * 0.02, L - cs * 0.04, W - cs * 0.04, cs * 0.24);
      ctx.stroke();
      ctx.restore();
      busy = true;   // 점선이 돈다
    }
    ctx.restore();

    // 마우스를 올린 쪽 — 그 방향 화살표 (회전 없이 판 좌표로)
    if (this.hover?.vehicle === i && vis.anims.length === 0) {
      this.drawHoverArrow(v, p, this.hover.sign);
    }
    return busy;
  }

  drawHoverArrow(v, p, sign) {
    const { ctx } = this;
    const { cs, ox, oy } = this.layout;
    const half = v.len / 2;
    const along = sign > 0 ? p + half + half / 2 : p + half / 2;
    const cx = v.axis === 'h' ? ox + along * cs : ox + (v.lane + 0.5) * cs;
    const cy = v.axis === 'h' ? oy + (v.lane + 0.5) * cs : oy + along * cs;
    const angle = v.axis === 'h' ? (sign > 0 ? 0 : Math.PI) : (sign > 0 ? Math.PI / 2 : -Math.PI / 2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = cs * 0.03;
    const s = cs * 0.2;
    ctx.beginPath();
    ctx.moveTo(s * 1.1, 0);
    ctx.lineTo(-s * 0.6, -s * 0.9);
    ctx.lineTo(-s * 0.6, s * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawFlashes(now) {
    const { ctx } = this;
    const { cs, ox, oy } = this.layout;
    this.flashes = this.flashes.filter((f) => now - f.t0 < f.dur);
    for (const f of this.flashes) {
      const t = (now - f.t0) / f.dur;
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.strokeStyle = COLORS.danger;
      ctx.lineWidth = Math.max(2, cs * 0.08);
      for (const c of f.cells) {
        roundRect(ctx, ox + c.x * cs + cs * 0.06, oy + c.y * cs + cs * 0.06, cs * 0.88, cs * 0.88, cs * 0.18);
        ctx.stroke();
      }
      ctx.restore();
    }
    return this.flashes.length > 0;
  }
}

function newVis(p) {
  return { p: p === EXITED ? 0 : p, alpha: p === EXITED ? 0 : 1, anims: [], shake: null, highlight: null };
}

/** 미끄러지는 시간 — 거리에 비례하되 상한을 둔다 */
function slideMs(dist) {
  return Math.min(520, 110 + Math.abs(dist) * 55);
}

// ── 차량 그림 (오른쪽을 보는 모습, 가운데가 원점) ─────────────────

function drawCar(ctx, L, W, cs, color) {
  const pad = cs * 0.09;
  const x0 = -L / 2 + pad;
  const y0 = -W / 2 + pad;
  const bw = L - pad * 2;
  const bh = W - pad * 2;

  // 그림자
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = cs * 0.18;
  ctx.shadowOffsetY = cs * 0.07;
  roundRect(ctx, x0, y0, bw, bh, cs * 0.24);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  // 몸통 음영 (위가 밝고 아래가 어둡게)
  const g = ctx.createLinearGradient(0, y0, 0, y0 + bh);
  g.addColorStop(0, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.22)');
  roundRect(ctx, x0, y0, bw, bh, cs * 0.24);
  ctx.fillStyle = g;
  ctx.fill();

  // 지붕 + 앞유리 + 뒷유리
  const roofX = x0 + bw * 0.3;
  const roofW = bw * 0.36;
  const roofY = y0 + bh * 0.16;
  const roofH = bh * 0.68;
  roundRect(ctx, roofX - bw * 0.1, roofY, roofW + bw * 0.24, roofH, cs * 0.14);
  ctx.fillStyle = COLORS.glass;
  ctx.fill();
  roundRect(ctx, roofX, roofY + bh * 0.02, roofW, roofH - bh * 0.04, cs * 0.1);
  ctx.fillStyle = shade(color, -0.12);
  ctx.fill();
  // 앞유리 반사
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(roofX + roofW + bw * 0.035, roofY + roofH * 0.18, bw * 0.025, roofH * 0.3);

  // 전조등 · 후미등
  const lightW = cs * 0.07;
  const lightH = bh * 0.2;
  ctx.fillStyle = COLORS.headlight;
  roundRect(ctx, x0 + bw - lightW - cs * 0.03, y0 + bh * 0.1, lightW, lightH, lightW / 2);
  ctx.fill();
  roundRect(ctx, x0 + bw - lightW - cs * 0.03, y0 + bh * 0.7, lightW, lightH, lightW / 2);
  ctx.fill();
  ctx.fillStyle = COLORS.taillight;
  ctx.fillRect(x0 + cs * 0.02, y0 + bh * 0.12, cs * 0.05, lightH * 0.85);
  ctx.fillRect(x0 + cs * 0.02, y0 + bh * 0.88 - lightH * 0.85, cs * 0.05, lightH * 0.85);

  // 지붕 위 방향 표시 ›
  drawChevron(ctx, roofX + roofW * 0.5, 0, cs * 0.13, 'rgba(255,255,255,0.75)', cs);
}

function drawBus(ctx, L, W, cs) {
  const pad = cs * 0.07;
  const x0 = -L / 2 + pad;
  const y0 = -W / 2 + pad;
  const bw = L - pad * 2;
  const bh = W - pad * 2;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = cs * 0.2;
  ctx.shadowOffsetY = cs * 0.08;
  roundRect(ctx, x0, y0, bw, bh, cs * 0.14);
  ctx.fillStyle = COLORS.bus;
  ctx.fill();
  ctx.restore();

  const g = ctx.createLinearGradient(0, y0, 0, y0 + bh);
  g.addColorStop(0, 'rgba(255,255,255,0.28)');
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(120,70,0,0.25)');
  roundRect(ctx, x0, y0, bw, bh, cs * 0.14);
  ctx.fillStyle = g;
  ctx.fill();

  // 양옆 창문 줄 — 버스라는 것을 한눈에
  const winY1 = y0 + bh * 0.07;
  const winY2 = y0 + bh * 0.79;
  const winH = bh * 0.14;
  const winStart = x0 + bw * 0.08;
  const winEnd = x0 + bw * 0.8;
  const count = 6;
  const step = (winEnd - winStart) / count;
  ctx.fillStyle = COLORS.busGlass;
  for (let k = 0; k < count; k++) {
    const wx = winStart + k * step + step * 0.12;
    roundRect(ctx, wx, winY1, step * 0.76, winH, winH * 0.35);
    ctx.fill();
    roundRect(ctx, wx, winY2, step * 0.76, winH, winH * 0.35);
    ctx.fill();
  }

  // 지붕 — 환기구 두 개
  ctx.fillStyle = COLORS.busShade;
  roundRect(ctx, x0 + bw * 0.18, y0 + bh * 0.33, bw * 0.14, bh * 0.34, cs * 0.05);
  ctx.fill();
  roundRect(ctx, x0 + bw * 0.46, y0 + bh * 0.33, bw * 0.14, bh * 0.34, cs * 0.05);
  ctx.fill();

  // 앞유리 + 행선지 표시
  roundRect(ctx, x0 + bw - cs * 0.2, y0 + bh * 0.1, cs * 0.14, bh * 0.8, cs * 0.06);
  ctx.fillStyle = COLORS.busGlass;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x0 + bw - cs * 0.17, y0 + bh * 0.18, cs * 0.03, bh * 0.25);
  roundRect(ctx, x0 + bw - cs * 0.32, y0 + bh * 0.3, cs * 0.08, bh * 0.4, cs * 0.03);
  ctx.fillStyle = COLORS.busSign;
  ctx.fill();

  // 전조등 · 후미등
  ctx.fillStyle = COLORS.headlight;
  ctx.fillRect(x0 + bw - cs * 0.045, y0 + bh * 0.06, cs * 0.04, bh * 0.16);
  ctx.fillRect(x0 + bw - cs * 0.045, y0 + bh * 0.78, cs * 0.04, bh * 0.16);
  ctx.fillStyle = COLORS.taillight;
  ctx.fillRect(x0 + cs * 0.015, y0 + bh * 0.08, cs * 0.045, bh * 0.16);
  ctx.fillRect(x0 + cs * 0.015, y0 + bh * 0.76, cs * 0.045, bh * 0.16);

  // 방향 표시 »
  drawChevron(ctx, x0 + bw * 0.72, 0, cs * 0.13, 'rgba(60,40,0,0.55)', cs);
  drawChevron(ctx, x0 + bw * 0.8, 0, cs * 0.13, 'rgba(60,40,0,0.55)', cs);
}

function drawChevron(ctx, x, y, s, color, cs) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, cs * 0.055);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - s * 0.5, y - s);
  ctx.lineTo(x + s * 0.5, y);
  ctx.lineTo(x - s * 0.5, y + s);
  ctx.stroke();
  ctx.restore();
}

function drawSpeedLines(ctx, L, W, cs) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = Math.max(1, cs * 0.035);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const f of [0.25, 0.5, 0.75]) {
    const y = -W / 2 + W * f;
    ctx.moveTo(-L / 2 - cs * 0.15, y);
    ctx.lineTo(-L / 2 - cs * (0.45 + f * 0.3), y);
  }
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** #rrggbb를 amount(-1~1)만큼 밝게/어둡게 */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const t = amount < 0 ? 0 : 255;
    return Math.round(c + (t - c) * Math.abs(amount));
  });
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}
