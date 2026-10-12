// 솔버 — 판을 다 비우는 짧은 수순을 찾는다.
//
// ★ 핵심 관찰: 차가 n대면 '나가기'가 정확히 n번 필요하다. 그러니 최소 이동 = n + (필요한 '밀어 두기' 수)이고,
//   솔버가 실제로 줄여야 하는 것은 밀어 두기 횟수뿐이다.
//   그래서 상태마다 "지금 나갈 수 있는 차를 전부 내보낸 뒤(닫힘)"의 모양만 남기고, 그 사이를 밀어 두기 한 수로 잇는다.
//   기본(guided)은 '밀어 두기 수 + 남은 차 수'가 작은 상태부터 본다 — 큰 판에서도 빨리 답이 나온다.
//   guided를 끄면 밀어 두기 횟수 순서로만 훑어, 처음 만난 빈 판이 밀어 두기가 가장 적은 수순이 된다(작은 판용).
//
// ⚠️ 이 두 가지 줄이기는 '거의 언제나' 맞지만 증명된 것은 아니다.
//   1) 나갈 수 있는 차를 바로 내보낸다 — 드물게, 나갈 차를 잠깐 남겨 두면 다른 차가 그 앞에 '멈춰 설' 수 있어
//      밀어 두기 한 번을 아끼는 판이 있다.
//   2) 누군가의 탈출 경로 위에 있는 차만 밀어 본다 — 경로 밖의 차를 미는 것이 멈춤 자리를 바꿔 도움이 되는 판도 이론상 있다.
//   그래서 결과는 '최소'가 아니라 '충분히 짧은' 수순이고, 화면에는 "목표 이동 수"로 보여 준다.
//   플레이어가 이보다 적게 풀면 그대로 별 셋이다. 작은 판에서는 solveExact로 진짜 최소와 대조해 본다(테스트).
//
// ⚠️ 탐색 한도는 '시간'이 아니라 '상태 수'로 건다 — 시간으로 걸면 컴퓨터 빠르기에 따라 같은 시드에서 다른 판이 나온다.

import { EXITED, EMPTY, BLOCK, OFF_BOARD, buildGrid, travel } from './rules.js';

/** 상태 키 — 위치 하나를 글자 하나로 (EXITED = -1 → 1) */
function keyOf(pos) {
  let s = '';
  for (let i = 0; i < pos.length; i++) s += String.fromCharCode(pos[i] + 2);
  return s;
}

function setCells(puzzle, grid, i, p, value) {
  const v = puzzle.vehicles[i];
  const size = puzzle.size;
  if (v.axis === 'h') {
    const base = v.lane * size + p;
    for (let k = 0; k < v.len; k++) grid[base + k] = value;
  } else {
    for (let k = 0; k < v.len; k++) grid[(p + k) * size + v.lane] = value;
  }
}

/**
 * 나갈 수 있는 차를 더 없을 때까지 전부 내보낸다. pos와 grid를 직접 바꾼다.
 * 내보내기는 다른 차의 길을 넓히기만 하므로, 한 바퀴에서 아무도 못 나갈 때까지 돌면 된다.
 * @returns 내보낸 이동 목록 [{ vehicle, sign }]
 */
export function exitAll(puzzle, pos, grid, out = []) {
  const n = puzzle.vehicles.length;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < n; i++) {
      if (pos[i] === EXITED) continue;
      let sign = 0;
      if (travel(puzzle, grid, pos, i, -1) === OFF_BOARD) sign = -1;
      else if (travel(puzzle, grid, pos, i, +1) === OFF_BOARD) sign = +1;
      if (sign === 0) continue;
      setCells(puzzle, grid, i, pos[i], EMPTY);
      pos[i] = EXITED;
      out.push({ vehicle: i, sign });
      changed = true;
    }
  }
  return out;
}

/**
 * 밀어 볼 가치가 있는 차 — 남은 어떤 차의 '구조물 없는' 탈출 경로 위에 서 있는 차.
 * 구조물은 영영 안 비키므로 구조물이 낀 방향은 경로로 치지 않는다.
 * 양쪽이 모두 구조물에 막힌 차가 하나라도 있으면 그 판은 절대 못 비운다 → null.
 */
function relevantMask(puzzle, pos, grid, mask) {
  const { size, vehicles } = puzzle;
  mask.fill(0);
  const found = [];
  for (let u = 0; u < vehicles.length; u++) {
    if (pos[u] === EXITED) continue;
    const v = vehicles[u];
    let deadSides = 0;
    for (let s = -1; s <= 1; s += 2) {
      found.length = 0;
      let dead = false;
      for (let c = s > 0 ? pos[u] + v.len : pos[u] - 1; c >= 0 && c < size; c += s) {
        const cell = v.axis === 'h' ? grid[v.lane * size + c] : grid[c * size + v.lane];
        if (cell === BLOCK) { dead = true; break; }
        if (cell > 0) found.push(cell - 1);
      }
      if (dead) { deadSides++; continue; }
      for (const w of found) mask[w] = 1;
    }
    if (deadSides === 2) return null;
  }
  return mask;
}

function countRemaining(pos) {
  let n = 0;
  for (const p of pos) if (p !== EXITED) n++;
  return n;
}

/**
 * 우선순위 큐 (작은 값 먼저, 같으면 먼저 넣은 것 먼저 — 결과가 언제나 같도록)
 */
class MinHeap {
  constructor() {
    this.prio = [];
    this.item = [];
  }

  get size() {
    return this.item.length;
  }

  #less(a, b) {
    return this.prio[a] < this.prio[b] || (this.prio[a] === this.prio[b] && this.item[a] < this.item[b]);
  }

  #swap(a, b) {
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
    [this.item[a], this.item[b]] = [this.item[b], this.item[a]];
  }

  push(prio, item) {
    this.prio.push(prio);
    this.item.push(item);
    for (let k = this.item.length - 1; k > 0;) {
      const parent = (k - 1) >> 1;
      if (!this.#less(k, parent)) break;
      this.#swap(k, parent);
      k = parent;
    }
  }

  pop() {
    const top = this.item[0];
    const last = this.item.length - 1;
    this.#swap(0, last);
    this.prio.pop();
    this.item.pop();
    for (let k = 0; ;) {
      const l = 2 * k + 1;
      const r = l + 1;
      let m = k;
      if (l < this.item.length && this.#less(l, m)) m = l;
      if (r < this.item.length && this.#less(r, m)) m = r;
      if (m === k) break;
      this.#swap(k, m);
      k = m;
    }
    return top;
  }
}

/**
 * @param startPos 시작 위치 (기본: 퍼즐의 처음 위치). 게임 도중의 위치를 넘겨도 된다
 * @param options.goal   다 됐는지 판단하는 함수 (기본: 모든 차가 나갔다)
 * @param options.guided true(기본)면 '남은 차가 적은 상태'를 먼저 본다 — 큰 판에서도 빨리 답을 찾지만
 *        밀어 두기가 최소라는 보장은 없다. false면 밀어 두기 횟수 순서대로 훑어 그 안에서는 최소를 찾는다(느리다).
 * @returns {{ solved, moves, length, slides, explored, reason? }}
 *   moves  — [{ vehicle, sign }] 순서대로 두면 판이 빈다
 *   length — 전체 이동 수 (= 목표 이동 수), slides — 그중 밀어 두기 수
 *   reason — 못 풀었을 때 'limit'(한도 초과) 또는 'exhausted'(더 볼 상태가 없음)
 */
export function solve(puzzle, startPos = puzzle.start, { maxStates = 30000, guided = true, goal = null } = {}) {
  // goal(pos) — 이 상태면 다 된 것인가 (기본: 판이 비었다). 하드 모드는 '리무진이 모두 나갔다'를 넘긴다
  const done = goal ?? ((pos) => countRemaining(pos) === 0);
  const { size, vehicles } = puzzle;
  const n = vehicles.length;
  const grid = new Int16Array(size * size);
  const mask = new Uint8Array(n);

  const root = Array.from(startPos);
  buildGrid(puzzle, root, grid);
  const rootExits = exitAll(puzzle, root, grid);

  const states = [root];
  const parents = [-1];
  const steps = [rootExits];      // 그 상태로 오기까지의 이동 (밀어 두기 1개 + 이어진 나가기들)
  const depth = [0];
  const seen = new Set([keyOf(root)]);

  const finish = (idx) => {
    const chain = [];
    for (let k = idx; k !== -1; k = parents[k]) chain.push(steps[k]);
    const moves = chain.reverse().flat();
    return { solved: true, moves, length: moves.length, slides: depth[idx], explored: states.length };
  };

  if (done(root)) return finish(0);

  // 우선순위: 밀어 두기 수 (+ guided면 남은 차 수). 밀어 두기 한 번으로 고리 하나가 풀리면 남은 차가 확 줄어든다
  const priority = (idx, remaining) => (guided ? depth[idx] + remaining : depth[idx]);
  const open = new MinHeap();
  open.push(priority(0, countRemaining(root)), 0);

  while (open.size > 0) {
    const head = open.pop();
    const cur = states[head];
    buildGrid(puzzle, cur, grid);
    if (!relevantMask(puzzle, cur, grid, mask)) continue;   // 영영 못 나가는 차가 있다

    for (let i = 0; i < n; i++) {
      if (cur[i] === EXITED || !mask[i]) continue;
      for (let s = -1; s <= 1; s += 2) {
        const t = travel(puzzle, grid, cur, i, s);
        if (t === 0 || t === OFF_BOARD) continue;   // 닫힌 상태라 OFF_BOARD는 없지만 방어

        const next = cur.slice();
        const g2 = grid.slice();
        setCells(puzzle, g2, i, cur[i], EMPTY);
        next[i] = cur[i] + s * t;
        setCells(puzzle, g2, i, next[i], i + 1);
        const exits = exitAll(puzzle, next, g2, []);

        const key = keyOf(next);
        if (seen.has(key)) continue;
        seen.add(key);
        states.push(next);
        parents.push(head);
        steps.push([{ vehicle: i, sign: s }, ...exits]);
        depth.push(depth[head] + 1);
        const idx = states.length - 1;

        const remaining = countRemaining(next);
        if (done(next)) return finish(idx);
        if (states.length > maxStates) return { solved: false, reason: 'limit', explored: states.length };
        open.push(priority(idx, remaining), idx);
      }
    }
  }
  return { solved: false, reason: 'exhausted', explored: states.length };
}

/**
 * 진짜 최소 이동 수 — 줄이기 없이 모든 수를 너비 우선으로 훑는다. 작은 판 전용(테스트에서 solve와 대조).
 * @returns 최소 이동 수, 한도를 넘거나 못 풀면 null
 */
export function solveExact(puzzle, startPos = puzzle.start, { maxStates = 200000 } = {}) {
  const { size, vehicles } = puzzle;
  const n = vehicles.length;
  const grid = new Int16Array(size * size);
  const start = Array.from(startPos);
  if (countRemaining(start) === 0) return 0;

  let frontier = [start];
  const seen = new Set([keyOf(start)]);
  for (let d = 1; frontier.length > 0; d++) {
    const nextFrontier = [];
    for (const cur of frontier) {
      buildGrid(puzzle, cur, grid);
      for (let i = 0; i < n; i++) {
        if (cur[i] === EXITED) continue;
        for (let s = -1; s <= 1; s += 2) {
          const t = travel(puzzle, grid, cur, i, s);
          if (t === 0) continue;
          const next = cur.slice();
          next[i] = t === OFF_BOARD ? EXITED : cur[i] + s * t;
          if (countRemaining(next) === 0) return d;
          const key = keyOf(next);
          if (seen.has(key)) continue;
          seen.add(key);
          if (seen.size > maxStates) return null;
          nextFrontier.push(next);
        }
      }
    }
    frontier = nextFrontier;
  }
  return null;
}
