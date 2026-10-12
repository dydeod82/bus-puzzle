// 판 그리기 — Canvas 하나에 판·구조물·차량을 그리고 이동 애니메이션을 돌린다.
//
// ★ 그림은 '보이는 위치'(vis)를, 판정은 규칙 엔진의 '진짜 위치'(pos)를 쓴다.
//   이동하면 엔진 상태는 즉시 바뀌고, 여기서는 그 사이를 짧게 이어 그릴 뿐이다.
//   그래서 애니메이션 도중에 다른 차를 눌러도 판정이 어긋나지 않는다.
//
// 이미지 파일 없이 도형과 색으로만 그린다. 차량은 '오른쪽을 보는 모습'으로 한 번만 그리고 회전시킨다.

import { EXITED, vehicleCells } from '../core/rules.js';

const COLORS = {
  plate: '#262a33',
  plateEdge: '#171a20',
  grid: 'rgba(255,255,255,0.055)',
  exitDash: 'rgba(255,197,51,0.5)',
  concrete: '#8d929c',
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
};

const MARGIN_CELLS = 0.35;         // 판 바깥 여백 (출구 점선·그림자가 보일 자리 — 넓히면 휴대폰에서 칸이 작아진다)
const ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
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
    this.selected = -1;
    this.hover = null;          // { vehicle, sign }
    this.flashes = [];          // 막은 칸 깜빡임 { cells, until }
    this.raf = 0;
    this.layout = { cs: 0, ox: 0, oy: 0, w: 0, h: 0 };

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  destroy() {
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.raf);
  }

  // ── 상태 ──────────────────────────────────────────────

  setPuzzle(puzzle, pos) {
    this.puzzle = puzzle;
    this.selected = -1;
    this.hover = null;
    this.flashes = [];
    this.snapTo(pos);
    this.resize();
  }

  /** 애니메이션 없이 위치를 맞춘다 (재시작) */
  snapTo(pos) {
    this.pos = pos.slice();
    this.vis = pos.map((p) => ({ p: p === EXITED ? 0 : p, alpha: p === EXITED ? 0 : 1, anim: null, shake: null }));
    this.requestDraw();
  }

  setSelected(i) {
    this.selected = i;
    this.requestDraw();
  }

  setHover(h) {
    const same = (h && this.hover && h.vehicle === this.hover.vehicle && h.sign === this.hover.sign) || (!h && !this.hover);
    if (same) return;
    this.hover = h;
    this.requestDraw();
  }

  /** 엔진이 둔 이동을 그린다 */
  animateMove(move, pos) {
    this.pos = pos.slice();
    const v = this.puzzle.vehicles[move.vehicle];
    const vis = this.vis[move.vehicle];
    const now = performance.now();
    const from = this.visualPos(move.vehicle, now);
    if (move.exits) {
      // 판 끝을 지나 몸길이만큼 더 나가며 사라진다
      const to = move.sign > 0 ? this.puzzle.size + 0.6 : -v.len - 0.6;
      const dist = Math.abs(to - from);
      vis.anim = { kind: 'exit', from, to, t0: now, dur: Math.min(900, 160 + dist * 60) };
    } else {
      vis.anim = { kind: 'move', from, to: move.to, t0: now, dur: Math.min(520, 110 + move.dist * 55) };
    }
    vis.shake = null;
    this.requestDraw();
  }

  /** 되돌리기 — 나갔던 차는 판 밖에서 다시 들어온다 */
  animateUndo(move, pos) {
    this.pos = pos.slice();
    const v = this.puzzle.vehicles[move.vehicle];
    const vis = this.vis[move.vehicle];
    const now = performance.now();
    let from = this.visualPos(move.vehicle, now);
    if (move.exits && vis.alpha === 0 && !vis.anim) {
      from = move.sign > 0 ? this.puzzle.size + 0.6 : -v.len - 0.6;   // 이미 다 나간 차 — 판 밖에서 들어온다
    }
    const dist = Math.abs(move.from - from);
    vis.anim = { kind: move.exits ? 'enter' : 'move', from, to: move.from, t0: now, dur: Math.min(700, 140 + dist * 50) };
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

  /** 진행 중인 애니메이션이 끝날 때까지 남은 시간(ms) */
  remainingAnimationMs() {
    const now = performance.now();
    let ms = 0;
    for (const v of this.vis) {
      if (v.anim) ms = Math.max(ms, v.anim.t0 + v.anim.dur - now);
    }
    return Math.max(0, ms);
  }

  // ── 좌표 ──────────────────────────────────────────────

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

    const n = this.puzzle?.size ?? 6;
    const cs = Math.min(w, h) / (n + MARGIN_CELLS * 2);
    this.layout = { cs, ox: (w - n * cs) / 2, oy: (h - n * cs) / 2, w, h };
    this.requestDraw();
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

  /** i번 차량의 화면상 중심 (CSS px) — 키보드 선택 이동에 쓴다 */
  vehicleCenter(i) {
    const v = this.puzzle.vehicles[i];
    const p = this.pos[i];
    const along = p + v.len / 2;
    return v.axis === 'h' ? { x: along, y: v.lane + 0.5 } : { x: v.lane + 0.5, y: along };
  }

  visualPos(i, now) {
    const vis = this.vis[i];
    const a = vis.anim;
    if (!a) return vis.p;
    const t = clamp01((now - a.t0) / a.dur);
    const e = a.kind === 'exit' ? easeInOutQuad(t) : easeOutCubic(t);
    return a.from + (a.to - a.from) * e;
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
    const order = this.puzzle.vehicles.map((_, i) => i)
      .sort((a, b) => (this.vis[a].anim?.kind === 'exit') - (this.vis[b].anim?.kind === 'exit'));
    for (const i of order) busy = this.drawVehicleAt(i, now) || busy;

    busy = this.drawFlashes(now) || busy;
    return busy;
  }

  drawPlate() {
    const { ctx } = this;
    const { cs, ox, oy } = this.layout;
    const n = this.puzzle.size;
    const size = n * cs;
    const r = cs * 0.3;

    // 판 그림자 + 바탕
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = cs * 0.6;
    ctx.shadowOffsetY = cs * 0.15;
    roundRect(ctx, ox, oy, size, size, r);
    ctx.fillStyle = COLORS.plate;
    ctx.fill();
    ctx.restore();

    // 가운데가 살짝 밝은 아스팔트
    const g = ctx.createRadialGradient(ox + size / 2, oy + size * 0.4, size * 0.1, ox + size / 2, oy + size / 2, size * 0.75);
    g.addColorStop(0, 'rgba(255,255,255,0.045)');
    g.addColorStop(1, 'rgba(0,0,0,0.18)');
    roundRect(ctx, ox, oy, size, size, r);
    ctx.fillStyle = g;
    ctx.fill();

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

    let p = vis.p;
    let alpha = vis.alpha;
    if (vis.anim) {
      const a = vis.anim;
      const t = clamp01((now - a.t0) / a.dur);
      p = this.visualPos(i, now);
      if (a.kind === 'exit') alpha = 1 - clamp01((t - 0.45) / 0.55);
      else if (a.kind === 'enter') alpha = clamp01(t / 0.4);
      if (t >= 1) {
        vis.p = a.to;
        vis.alpha = a.kind === 'exit' ? 0 : 1;
        vis.anim = null;
      } else {
        busy = true;
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

    const L = v.len * cs;
    const W = cs;
    const exiting = vis.anim?.kind === 'exit';
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
    if (this.hover?.vehicle === i && !vis.anim) {
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
