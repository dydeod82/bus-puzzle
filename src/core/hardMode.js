// 하드 모드 규칙 — 일반 규칙(미끄러지기·탈출)에 두 가지를 더한다. 화면과 무관한 순수 로직.
//
//   1) 변화구역의 랜덤 이동 — 플레이어가 차를 실제로 움직일 때마다, 그 직후 변화구역의 차 1~4대가 저절로 움직인다
//   2) 새 차량 도착 — 차가 판 밖으로 나가면 카운트다운(3턴)이 시작되고, 끝나면 변화구역에 차 한 대가 새로 놓인다
//
// 구역: 정중앙 safeSize×safeSize가 안전구역, 나머지 전부가 변화구역 (25 = 9 + 7 + 9).
//   랜덤 이동은 '모든 칸이 변화구역에 있는 차'만 고르고, 판 끝과 안전구역 경계 앞에서 멈춘다.
//   플레이어의 이동은 일반 규칙 그대로다 — 안전구역도 지나가고 판 밖으로도 나간다.
//
// ★ 리무진(kind 'limo'): 안전구역에서 시작한다. 플레이어만 움직일 수 있고(랜덤 이동 대상이 아니다 — 변화구역에 나가 있어도),
//   리무진을 모두 판 밖으로 빼면 클리어다. 일반 차는 남아 있어도 된다. 리무진의 탈출도 탈출이라 카운트다운을 시작시킨다.
//   리무진이 없는 판(테스트의 작은 판)은 예전처럼 모든 차를 빼야 클리어다.
//
// ★ 난수 상태(숫자 4개)도 게임 상태에 들어 있다. 되돌리기는 상태 통째로 되돌리므로
//   같은 수를 다시 두면 같은 랜덤 결과가 나온다.
//
// ★ 한 턴의 순서 (시간 순서가 곧 규칙이다)
//   ① 플레이어 이동 → 판이 비면 즉시 클리어(카운트다운 취소, 이후 단계 없음)
//   ② 랜덤 이동
//   ③ 이 턴을 시작할 때 카운트다운 중이었으면 1 줄이고, 0이 되면 새 차량 도착
//   ④ ①이 탈출이었고 그 시점에 카운트다운이 없었으면 새 카운트다운 시작
//   ⚠️ 카운트다운 중의 탈출은 ④에서 무시된다 — 같은 턴에 차가 도착해도 그 탈출은 도착 '전'에 일어난 것이므로
//      새 카운트다운을 열지 않는다. "차량이 추가된 뒤 다음 탈출이 생기면 새 카운트다운"이 이 뜻이다.

import { createRng, rngFromState } from './random.js';
import {
  EXITED, EMPTY, BLOCK, OFF_BOARD, VEHICLE_LENGTH, buildGrid, travel, getMove, applyMove, remainingCount, withVehicle,
} from './rules.js';
import { generateHardBoard } from './hardGenerator.js';
import { HARD_MODE } from './levels.js';

export const HardStatus = Object.freeze({
  PLAYING: 'playing',
  CLEARED: 'cleared',
  STUCK: 'stuck',
});

// ── 구역 ────────────────────────────────────────────────

/** 안전구역은 정중앙 safeSize×safeSize. 나머지가 변화구역 */
export function zoneLayout(size, safeSize) {
  if (safeSize < 0 || safeSize > size || (size - safeSize) % 2 !== 0) {
    throw new Error(`안전구역(${safeSize})이 판(${size}) 가운데에 놓이지 않습니다 — 둘의 차이가 짝수여야 합니다`);
  }
  const lo = (size - safeSize) / 2;
  return Object.freeze({ size, safeSize, lo, hi: lo + safeSize - 1 });
}

export function isSafeCell(zone, x, y) {
  return zone.safeSize > 0 && x >= zone.lo && x <= zone.hi && y >= zone.lo && y <= zone.hi;
}

function cellXY(v, c) {
  return v.axis === 'h' ? [c, v.lane] : [v.lane, c];
}

/** i번 차량이 위치 p에서 모든 칸이 변화구역에 있는가 */
export function inChangeZone(puzzle, zone, i, p) {
  const v = puzzle.vehicles[i];
  for (let k = 0; k < v.len; k++) {
    const [x, y] = cellXY(v, p + k);
    if (isSafeCell(zone, x, y)) return false;
  }
  return true;
}

// ── 랜덤 이동 ────────────────────────────────────────────

/**
 * 랜덤 이동 거리 — 막힐 때까지 가되 판 끝에서 멈추고(나가지 않는다) 안전구역 앞에서 멈춘다.
 */
export function randomTravel(puzzle, grid, zone, pos, i, sign) {
  const v = puzzle.vehicles[i];
  const N = puzzle.size;
  let dist = 0;
  for (let c = sign > 0 ? pos[i] + v.len : pos[i] - 1; c >= 0 && c < N; c += sign) {
    const [x, y] = cellXY(v, c);
    if (grid[y * N + x] !== EMPTY || isSafeCell(zone, x, y)) break;
    dist++;
  }
  return dist;
}

/** 지금 랜덤으로 움직일 수 있는 차량 (번호 순) */
export function randomMovable(puzzle, grid, zone, pos, exclude) {
  const out = [];
  for (let i = 0; i < puzzle.vehicles.length; i++) {
    if (pos[i] === EXITED || exclude?.has(i) || puzzle.vehicles[i].kind === 'limo') continue;   // 리무진은 플레이어만
    if (!inChangeZone(puzzle, zone, i, pos[i])) continue;
    if (randomTravel(puzzle, grid, zone, pos, i, -1) > 0 || randomTravel(puzzle, grid, zone, pos, i, 1) > 0) out.push(i);
  }
  return out;
}

function setCells(puzzle, grid, i, p, value) {
  const v = puzzle.vehicles[i];
  const N = puzzle.size;
  for (let k = 0; k < v.len; k++) {
    const [x, y] = cellXY(v, p + k);
    grid[y * N + x] = value;
  }
}

/**
 * 한 턴의 랜덤 이동. pos를 직접 바꾼다 (복사본을 넘길 것).
 * 대수를 먼저 정하고(randomMin~randomMax), 한 대씩 차례로 고른다 — 앞 차가 움직이면 뒤 차가 움직일 수 있는지가
 * 달라지므로 후보는 매번 다시 센다. 같은 차는 한 턴에 두 번 고르지 않는다.
 * 고른 차는 '실제로 움직이는 방향' 중에서 무작위로 방향을 정한다 (한쪽만 트였으면 그쪽).
 * @returns { requested, moves: [{ vehicle, sign, from, to, dist }] }
 */
export function runRandomPhase(puzzle, zone, pos, rng, config) {
  const requested = rng.range(config.randomMin, config.randomMax);
  const grid = buildGrid(puzzle, pos);
  const chosen = new Set();
  const moves = [];
  for (let t = 0; t < requested; t++) {
    const candidates = randomMovable(puzzle, grid, zone, pos, chosen);
    if (candidates.length === 0) break;
    const i = candidates[rng.int(candidates.length)];
    const back = randomTravel(puzzle, grid, zone, pos, i, -1);
    const fwd = randomTravel(puzzle, grid, zone, pos, i, 1);
    const sign = back > 0 && fwd > 0 ? (rng.chance(0.5) ? -1 : 1) : fwd > 0 ? 1 : -1;
    const dist = sign > 0 ? fwd : back;
    const from = pos[i];
    const to = from + sign * dist;
    setCells(puzzle, grid, i, from, EMPTY);
    pos[i] = to;
    setCells(puzzle, grid, i, to, i + 1);
    chosen.add(i);
    moves.push({ vehicle: i, sign, from, to, dist });
  }
  return { requested, moves };
}

// ── 새 차량 ─────────────────────────────────────────────

function clearToEdge(grid, N, axis, lane, p, len, sign) {
  for (let c = sign > 0 ? p + len : p - 1; c >= 0 && c < N; c += sign) {
    const k = axis === 'h' ? lane * N + c : c * N + lane;
    if (grid[k] !== EMPTY) return false;
  }
  return true;
}

/**
 * 변화구역의 빈 자리에 무작위 종류·방향의 차를 놓는다. 놓자마자 나갈 수 있는 자리는 피한다
 * (그런 자리밖에 없으면 그래도 놓는다). 그 종류가 들어갈 자리가 없으면 다른 종류로, 그것도 없으면 null.
 * @returns {{ puzzle, id, p, def, exitable } | null}
 */
export function spawnVehicle(puzzle, zone, pos, rng, config) {
  const grid = buildGrid(puzzle, pos);
  const N = puzzle.size;
  const first = rng.next() < config.busRatio ? 'bus' : 'car';
  for (const kind of [first, first === 'bus' ? 'car' : 'bus']) {
    const len = VEHICLE_LENGTH[kind];
    const blocked = [];
    const exitable = [];
    for (const axis of ['h', 'v']) {
      for (let lane = 0; lane < N; lane++) {
        for (let p = 0; p + len <= N; p++) {
          let ok = true;
          for (let k = 0; k < len && ok; k++) {
            const [x, y] = axis === 'h' ? [p + k, lane] : [lane, p + k];
            if (grid[y * N + x] !== EMPTY || isSafeCell(zone, x, y)) ok = false;
          }
          if (!ok) continue;
          const canExit = clearToEdge(grid, N, axis, lane, p, len, -1) || clearToEdge(grid, N, axis, lane, p, len, 1);
          (canExit ? exitable : blocked).push({ axis, lane, p });
        }
      }
    }
    const list = blocked.length > 0 ? blocked : exitable;
    if (list.length === 0) continue;
    const c = list[rng.int(list.length)];
    const front = c.axis === 'h' ? (rng.chance(0.5) ? 'right' : 'left') : (rng.chance(0.5) ? 'down' : 'up');
    const def = { kind, x: c.axis === 'h' ? c.p : c.lane, y: c.axis === 'h' ? c.lane : c.p, front };
    return { ...withVehicle(puzzle, def), def, exitable: list === exitable };
  }
  return null;
}

// ── 막힘 ────────────────────────────────────────────────

export const HardStuck = Object.freeze({ OK: 'ok', STUCK: 'stuck', UNKNOWN: 'unknown' });

/**
 * 막힘 — "리무진이 더 이상 탈출할 방법이 없다" (리무진이 없는 판은 "어느 차도 나갈 수 없다").
 *   - 남은 리무진 중 하나라도 자기 차선 양쪽에 구조물이 있으면 영영 못 나간다 → 막힘 (구조물은 움직이지 않는다)
 *   - 카운트다운 중이면 막힌 것이 아니다 (새 차가 온다 → 판이 바뀐다)
 *   - 플레이어가 미끄러뜨리기만으로 닿는 상태들을 훑어, 어디서든 나갈 차가 보이면 막힌 것이 아니다
 *     (리무진이 아닌 차가 나가도 길이 넓어지고 카운트다운이 돌아 판이 바뀐다)
 *   - 플레이어가 한 수를 두면 바로 랜덤 이동이 따라온다. 그 뒤에 움직일 수 있는 차가 하나라도 있으면
 *     판이 바뀔 수 있으므로 막힌 것이 아니다
 *   ⚠️ 그래서 리무진 차선이 막힌 경우 말고는, 실제로 막히는 경우가 거의 '플레이어가 아무 차도 못 움직이는 판'뿐이다
 * @param targets 탈출시켜야 할 차 번호 (리무진). 비었으면 모든 차
 */
export function checkHardStuck(puzzle, zone, pos, countdown, { maxStates = 3000, targets = [] } = {}) {
  const goal = targets.length > 0 ? targets.filter((i) => pos[i] !== EXITED) : null;
  if (goal ? goal.length === 0 : remainingCount(pos) === 0) return HardStuck.OK;

  const grid0 = buildGrid(puzzle, pos);
  if (goal && goal.some((i) => laneDead(puzzle, grid0, pos, i))) return HardStuck.STUCK;
  if (countdown !== null) return HardStuck.OK;

  const n = puzzle.vehicles.length;
  const grid = new Int16Array(puzzle.size * puzzle.size);
  const seen = new Set([pos.join(',')]);
  const queue = [pos];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    buildGrid(puzzle, cur, grid);
    const children = [];
    for (let i = 0; i < n; i++) {
      if (cur[i] === EXITED) continue;
      for (let s = -1; s <= 1; s += 2) {
        const t = travel(puzzle, grid, cur, i, s);
        if (t === OFF_BOARD) return HardStuck.OK;
        if (t > 0) {
          const next = cur.slice();
          next[i] = cur[i] + s * t;
          children.push(next);
        }
      }
    }
    for (const next of children) {
      if (randomMovable(puzzle, buildGrid(puzzle, next), zone, next).length > 0) return HardStuck.OK;
      const key = next.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size > maxStates) return HardStuck.UNKNOWN;
      queue.push(next);
    }
  }
  return HardStuck.STUCK;
}

/** i번 차의 차선 양쪽 길에 구조물이 있는가 — 그러면 그 차는 영영 판 밖으로 못 나간다 */
export function laneDead(puzzle, grid, pos, i) {
  const v = puzzle.vehicles[i];
  const N = puzzle.size;
  let dead = 0;
  for (let s = -1; s <= 1; s += 2) {
    for (let c = s > 0 ? pos[i] + v.len : pos[i] - 1; c >= 0 && c < N; c += s) {
      const [x, y] = cellXY(v, c);
      if (grid[y * N + x] === BLOCK) {
        dead++;
        break;
      }
    }
  }
  return dead === 2;
}

// ── 한 판 진행 ───────────────────────────────────────────

/**
 * 하드 모드 한 판.
 *   state = { puzzle, pos, rng(난수 상태), countdown(null | 남은 턴), turn }
 *   상태는 매 턴 새 객체로 바꾼다 (바꾸지 않고 갈아끼운다) — 되돌리기는 이전 객체를 다시 끼우면 끝난다.
 */
export class HardSession {
  /**
   * @param puzzle 시작 판 (createPuzzle 결과)
   * @param seed   이 판의 시드 — 랜덤 이동·새 차량도 여기서 갈라진 난수를 쓴다
   * @param config HARD_MODE (테스트에서는 작은 판 설정을 넘긴다)
   */
  constructor(puzzle, seed, config = HARD_MODE, { stuckSearchLimit = 3000 } = {}) {
    this.config = config;
    this.seed = String(seed);
    this.zone = zoneLayout(puzzle.size, config.safeSize);
    this.stuckSearchLimit = stuckSearchLimit;
    // 탈출시켜야 할 차 — 리무진 (시작 판에만 있다. 새로 오는 차는 일반 차뿐)
    this.limoIds = puzzle.vehicles.filter((v) => v.kind === 'limo').map((v) => v.id);
    this.initial = Object.freeze({
      puzzle,
      pos: puzzle.start.slice(),
      rng: createRng(`${this.seed}:turns`).getState(),
      countdown: null,
      turn: 0,
    });
    this.restart();
  }

  restart() {
    this.state = this.initial;
    this.history = [];
    this.undoCount = 0;
    this.movesMade = 0;
    this.status = this.#evaluate();
  }

  get puzzle() {
    return this.state.puzzle;
  }

  get pos() {
    return this.state.pos;
  }

  /**
   * 이동 횟수 — 플레이어가 실제로 차를 움직인 횟수. 점수가 이것으로 정해진다.
   * ⚠️ 되돌려도 줄지 않는다 (되돌리기로 점수를 되살릴 수 없게). 랜덤 이동과 막혀서 못 움직인 시도는 세지 않는다.
   *    판의 '지금 몇 번째 턴인가'는 turn이다 — 그쪽은 되돌리면 함께 돌아간다.
   */
  get moveCount() {
    return this.movesMade;
  }

  /** 지금 판 상태까지 둔 턴 수 (되돌리면 줄어든다) */
  get turn() {
    return this.state.turn;
  }

  /** 되돌릴 수 있는 턴이 있는가 */
  get canUndo() {
    return this.history.length > 0;
  }

  /** 지금 클리어하면 받을 점수 */
  get expectedScore() {
    return hardScore(this.movesMade, this.config.score);
  }

  get remaining() {
    return remainingCount(this.state.pos);
  }

  get countdown() {
    return this.state.countdown;
  }

  /** 리무진 수와 그중 나간 수 (리무진이 없는 판은 0/0) */
  get limosTotal() {
    return this.limoIds.length;
  }

  get limosOut() {
    return this.limoIds.filter((i) => this.state.pos[i] === EXITED).length;
  }

  /** 클리어인가 — 리무진이 있으면 리무진이 모두 나갔는가, 없으면 판이 비었는가 */
  isCleared(pos = this.state.pos) {
    return this.limoIds.length > 0 ? this.limoIds.every((i) => pos[i] === EXITED) : remainingCount(pos) === 0;
  }

  preview(i, sign) {
    return getMove(this.state.puzzle, this.state.pos, i, sign);
  }

  /**
   * i번 차량을 sign 방향으로 민다.
   * - 한 칸도 못 움직이면 아무것도 바뀌지 않는다 (턴도 아니다) → { moved: false, move }
   * - 클리어·막힘 상태거나 이미 나간 차량이면 null
   * @returns {{ moved, move, random: { requested, moves }, spawned, countdown, countdownStarted, cleared }}
   */
  move(i, sign) {
    if (this.status !== HardStatus.PLAYING) return null;
    const s0 = this.state;
    const m = getMove(s0.puzzle, s0.pos, i, sign);
    if (!m) return null;
    if (!m.moved) return { moved: false, move: m };

    this.history.push(s0);
    this.movesMade += 1;
    const rng = rngFromState(s0.rng);
    let puzzle = s0.puzzle;
    let pos = applyMove(s0.pos, m);
    const turn = s0.turn + 1;

    // ① 리무진이 모두 나갔으면(리무진 없는 판은 판이 비면) 즉시 클리어 — 진행 중이던 카운트다운은 취소
    if (this.isCleared(pos)) {
      this.state = Object.freeze({ puzzle, pos, rng: rng.getState(), countdown: null, turn });
      this.status = HardStatus.CLEARED;
      return {
        moved: true, move: m, random: { requested: 0, moves: [] }, spawned: null,
        countdown: null, countdownStarted: false, cleared: true,
      };
    }

    // ② 랜덤 이동
    const random = runRandomPhase(puzzle, this.zone, pos, rng, this.config);

    // ③ 카운트다운 — 이 턴을 시작할 때 이미 돌고 있었을 때만 줄인다
    let countdown = s0.countdown;
    let spawned = null;
    if (countdown !== null) {
      countdown -= 1;
      if (countdown <= 0) {
        spawned = spawnVehicle(puzzle, this.zone, pos, rng, this.config);
        if (spawned) {
          puzzle = spawned.puzzle;
          pos = [...pos, spawned.p];
        }
        countdown = null;
      }
    }

    // ④ 이번 수가 탈출이었고, 이 턴을 시작할 때 카운트다운이 없었으면 새로 시작
    let countdownStarted = false;
    if (m.exits && s0.countdown === null) {
      countdown = this.config.spawnDelay;
      countdownStarted = true;
    }

    this.state = Object.freeze({ puzzle, pos, rng: rng.getState(), countdown, turn });
    this.status = this.#evaluate();
    return {
      moved: true,
      move: m,
      random,
      spawned: spawned && { id: spawned.id, def: spawned.def, exitable: spawned.exitable },
      countdown,
      countdownStarted,
      cleared: false,
    };
  }

  /**
   * 마지막 턴을 통째로 되돌린다 (플레이어 이동·랜덤 이동·새 차량·카운트다운·난수 상태 모두).
   * @returns {{ before, after }} 되돌리기 전후의 상태 (화면이 무엇이 바뀌었는지 비교하는 데 쓴다), 없으면 null
   */
  undo() {
    const prev = this.history.pop();
    if (!prev) return null;
    const before = this.state;
    this.state = prev;
    this.undoCount++;
    this.status = this.#evaluate();
    return { before, after: prev };
  }

  #evaluate() {
    const { puzzle, pos, countdown } = this.state;
    if (this.isCleared(pos)) return HardStatus.CLEARED;
    const r = checkHardStuck(puzzle, this.zone, pos, countdown, { maxStates: this.stuckSearchLimit, targets: this.limoIds });
    return r === HardStuck.STUCK ? HardStatus.STUCK : HardStatus.PLAYING;
  }
}

// ── 점수 ────────────────────────────────────────────────

/**
 * 클리어 점수 — base에서 이동 횟수만큼 깎는다. 구간마다 '몇 회에 1점'이 다르다 (HARD_MODE.score).
 *   기본값: 1~40번째 이동은 1회당 1점, 41~70번째는 2회당 1점, 71번째부터는 3회당 1점. 최저 10점.
 * ★ 구간 안에서는 1회마다 1/movesPerPoint점씩 깎고, 소수점은 마지막에 한 번 버린다
 *   (41회 → 100 − 40.5 = 59.5 → 59점). 구간을 다 채웠을 때만 깎으면 홀수 횟수가 짝수 횟수와 같은 점수가 된다.
 */
export function hardScore(moves, cfg = HARD_MODE.score) {
  let penalty = 0;
  let prev = 0;
  for (const t of cfg.tiers) {
    const end = t.upTo ?? Infinity;
    penalty += Math.max(0, Math.min(moves, end) - prev) / t.movesPerPoint;
    if (moves <= end) break;
    prev = end;
  }
  // 1e-9: 3으로 나눈 값들의 합이 34.99999…처럼 떨어져 1점이 덜 나오는 것을 막는다
  return Math.max(cfg.min, Math.floor(cfg.base - penalty + 1e-9));
}

/** 규칙 창에 쓸 설명 — 설정 숫자를 바꾸면 설명도 따라 바뀐다 */
export function describeHardScore(cfg = HARD_MODE.score) {
  let from = 1;
  const parts = cfg.tiers.map((t) => {
    const range = t.upTo == null ? `${from}번째부터` : `${from}~${t.upTo}번째`;
    from = (t.upTo ?? 0) + 1;
    return `${range} ${t.movesPerPoint === 1 ? '1회마다' : `${t.movesPerPoint}회당`} 1점`;
  });
  return `클리어하면 ${cfg.base}점에서 이동 횟수만큼 깎여요 — ${parts.join(', ')}. 최저 ${cfg.min}점. 되돌려도 이동 횟수는 줄지 않아요.`;
}

// ── 판 만들기 ───────────────────────────────────────────

/**
 * 하드 모드 판 (전용 생성기 hardGenerator.js). 랜덤 요소 때문에 풀이를 보장할 수는 없으므로
 * "랜덤 이동이 없다고 가정하면 리무진을 모두 뺄 수 있는 판"만 만든다 (하드 솔버로 재어 보고, 못 풀면 다시 짓는다).
 * @returns {{ def, par, solution, leaveSafe, attempts, ms }}
 */
export function generateHardPuzzle(seed, config = HARD_MODE) {
  return generateHardBoard(config, seed);
}
