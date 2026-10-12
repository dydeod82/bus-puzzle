// 하드 모드 난이도 측정용 솔버 — "랜덤 이동·새 차량이 없다고 가정하면, 최소 몇 수로 리무진을 다 빼는가".
//
// ★ 판 전체(차 100대)를 탐색하면 너무 크다. 그래서 '관련 차량'만 움직여 본다:
//     리무진 → 리무진 통로를 막는 차 → 그 차가 통로에서 비켜나려면 지나야 할 칸에 있는 차 → … (closureDepth 단계까지)
//   나머지 차는 구조물처럼 제자리에 둔다. 그래서 찾은 수순은 실제 게임에서도 그대로 둘 수 있는 수순이고(관련 없는 차를
//   안 움직였을 뿐), 길이는 진짜 최소의 상한이다. 관련 차량을 다 잡으면 진짜 최소다.
//
// ★ A* 휴리스틱 = '연쇄 하한' (chainBound).
//   통로를 막는 차는 모두 적어도 한 번 움직여야 한다. 그런데 그 차가 비켜날 길이 한쪽뿐이고(반대쪽은 구조물) 그 길에 다른 차가
//   있으면, 그 차도 적어도 한 번 움직여야 한다 — 이렇게 '반드시 움직여야 하는 차'를 연쇄로 모은다. 양쪽 다 트일 수 있는데
//   양쪽 모두 아직 안 센 차가 있으면 그중 적어도 한 대는 더 움직인다(서로 겹치지 않는 것끼리만 더한다).
//   서로 다른 차의 수가 하한이다 (한 수에 한 대만 움직이므로). 리무진도 나가려면 한 번씩 움직인다.
//   ⚠️ 예전 휴리스틱(막는 차 수 + 리무진 수)은 다른 리무진이 통로를 막고 있으면 그 리무진을 두 번 세어 과대평가할 수 있었다 —
//      지금은 '서로 다른 차'로 센다.
//
// ★ 빠르게: 자식 상태마다 판(625칸)을 새로 그리지 않고, 움직인 차 한 대만 지웠다 그렸다 한다.
//
// ⚠️ 판 생성에 쓰는 상한은 '탐색한 상태 수'다 (maxNodes). 시간으로 끊으면 같은 시드라도 컴퓨터 빠르기에 따라
//    다른 판이 나와, 기록에서 시드로 같은 판을 다시 하는 기능이 깨진다. 시간 상한(timeLimitMs)은 분석 도구에서만 쓴다.

import { EXITED, EMPTY, BLOCK, getMove, applyMove } from './rules.js';

export const HARD_SOLVER_DEFAULTS = Object.freeze({
  maxDepth: 40,          // 이보다 긴 수순은 찾지 않는다 (f = g + h가 넘으면 버린다)
  maxNodes: 120000,      // 펼쳐 볼 상태 수 상한 — 판 생성의 실제 상한
  timeLimitMs: Infinity, // 분석 도구에서만 1000 — 판 생성에서 쓰면 시드 재현이 깨진다
  closureDepth: 4,       // 관련 차량을 몇 단계까지 따라가는가
  chainDepth: 4,         // 연쇄 하한이 몇 단계까지 따라가는가
  jointNodes: 3000,      // 리무진 두 대를 함께 움직여 더 짧은 수순을 찾아볼 때의 상태 수 상한 (minEscapeMoves)
});

function cellIndex(N, v, c) {
  return v.axis === 'h' ? v.lane * N + c : c * N + v.lane;
}

/**
 * 리무진의 두 통로(뒤 −1 / 앞 +1). 통로 = 리무진 앞머리 다음 칸부터 판 끝까지.
 * @returns [{ limo, sign, cells: 칸 번호들, blockers: 막는 차 번호들(가까운 순, 중복 없음), dead: 구조물이 있어 영영 못 쓴다 }]
 */
export function passageInfo(puzzle, pos, grid, limoId) {
  const v = puzzle.vehicles[limoId];
  const N = puzzle.size;
  return [-1, 1].map((sign) => {
    const cells = [];
    const blockers = [];
    let dead = false;
    if (pos[limoId] !== EXITED) {
      for (let c = sign > 0 ? pos[limoId] + v.len : pos[limoId] - 1; c >= 0 && c < N; c += sign) {
        const k = cellIndex(N, v, c);
        cells.push(k);
        const g = grid[k];
        if (g === BLOCK) dead = true;
        else if (g > 0 && !blockers.includes(g - 1)) blockers.push(g - 1);
      }
    }
    return { limo: limoId, sign, cells, blockers, dead };
  });
}

/**
 * (옛 방식) 관련 차량 — seeds에서 시작해, 각 차가 앞뒤로 움직일 때 처음 부딪히는 차를 depth 단계까지 모은다.
 * 지금 솔버는 chainRelevant(비켜나는 데 필요한 칸만 본다)를 쓴다. 분석·시험용으로 남겨 둔다.
 * @returns { ids, depthOf: Map(차 → 몇 단계에서 들어왔나) }
 */
export function relevantVehicles(puzzle, pos, grid, seeds, depth) {
  const N = puzzle.size;
  const depthOf = new Map(seeds.map((i) => [i, 0]));
  let frontier = seeds.slice();
  for (let d = 1; d <= depth && frontier.length > 0; d++) {
    const next = [];
    for (const i of frontier) {
      if (pos[i] === EXITED) continue;
      const v = puzzle.vehicles[i];
      for (let s = -1; s <= 1; s += 2) {
        for (let c = s > 0 ? pos[i] + v.len : pos[i] - 1; c >= 0 && c < N; c += s) {
          const g = grid[cellIndex(N, v, c)];
          if (g === EMPTY) continue;
          if (g > 0 && !depthOf.has(g - 1)) {
            depthOf.set(g - 1, d);
            next.push(g - 1);
          }
          break;
        }
      }
    }
    frontier = next;
  }
  return { ids: [...depthOf.keys()], depthOf };
}

// ── 비켜나기 ─────────────────────────────────────────────
//   차 i가 자기 차선의 [t0, t1] 칸(자기 축 좌표)을 비우려면 +쪽으로 t1 − p + 1칸, −쪽으로 p + len − t0칸 가야 한다
//   ([t0, t1]이 i의 몸통보다 넓을 수도 있다 — 같은 차선의 다른 차가 지나갈 칸 전부를 비워 줘야 할 때).
//   그동안 지나는 칸(sweep)에 구조물이 있으면 그쪽은 영영 안 되고, 차가 있으면 그 차들이 먼저 비켜야 한다.
//   판 끝을 넘어가면 판 밖으로 나가는 것이다 — 판 끝까지의 칸만 본다.
//   exit 모드: 통로와 같은 방향으로 놓인 차는 통로 밖으로 나갈 길이 '판 밖' 하나뿐이다 (리무진을 지나칠 수 없다).

/**
 * 판·차 정보를 미리 펼쳐 둔 '비켜나기' 계산기.
 * @returns { options(pos, grid, i, t0, t1, exitDir) → [{ lo, hi, occ: 차 번호들 } | null(구조물), …] }
 */
function makeSweeper(puzzle) {
  const N = puzzle.size;
  const V = puzzle.vehicles.length;
  const H = new Uint8Array(V);
  const LANE = new Int16Array(V);
  const LEN = new Uint8Array(V);
  puzzle.vehicles.forEach((v, i) => {
    H[i] = v.axis === 'h' ? 1 : 0;
    LANE[i] = v.lane;
    LEN[i] = v.len;
  });
  const at = (i, c) => (H[i] ? LANE[i] * N + c : c * N + LANE[i]);

  /**
   * i의 차선에서 [a, b] 칸을 훑는다 — 구조물이 있으면 null, 아니면 그 칸에 있는 (i 아닌) 차들.
   * fp가 있으면 훑은 칸을 남긴다 (그 칸이 바뀌지 않으면 결과도 그대로다 — 자식 상태에서 다시 계산할지 가르는 데 쓴다)
   */
  function scan(grid, i, a, b, fp) {
    const lo = Math.max(0, a);
    const hi = Math.min(N - 1, b);
    const occ = [];
    for (let c = lo; c <= hi; c++) {
      const k = at(i, c);
      if (fp) fp.push(k);
      const g = grid[k];
      if (g === BLOCK) return null;
      if (g > 0 && g - 1 !== i && !occ.includes(g - 1)) occ.push(g - 1);
    }
    return { lo, hi, occ };
  }

  /** i가 [t0, t1]을 비우는 방법들 (exitDir이 있으면 그쪽으로 판 밖에 나가는 방법 하나) */
  function options(grid, p, i, t0, t1, exitDir, fp) {
    const len = LEN[i];
    if (exitDir) return [exitDir > 0 ? scan(grid, i, p + len, N - 1, fp) : scan(grid, i, 0, p - 1, fp)];
    const up = t1 - p + 1;          // +쪽으로 가야 할 칸 수
    const down = p + len - t0;      // −쪽으로 가야 할 칸 수
    return [scan(grid, i, p + len, p + len + up - 1, fp), scan(grid, i, p - down, p - 1, fp)];
  }

  /**
   * i가 opt 길로 비켜날 때, 그 길에 있던 차 o가 비워야 할 칸 → 대기열 항목 [o, t0, t1, exitDir, 단계, 요청한 차, 그 차가 가는 쪽]
   *   - 가로지른 차: i 차선의 한 칸
   *   - 같은 차선의 차: i가 지나갈 칸 전부 (i가 판 밖으로 나가는 길이면 o도 같은 쪽으로 나가야 한다 — i를 지나칠 수 없다)
   *     이때 o가 i 쪽으로 비키려면 i가 반대로 물러나 자리를 내줘야 한다 — 요청한 차와 방향을 함께 넘겨 retreatOk로 따진다
   */
  function next(o, i, opt, exitDir, depth, pi) {
    if (H[o] !== H[i]) return [o, LANE[i], LANE[i], 0, depth, -1, 0];
    if (exitDir) return [o, 0, 0, exitDir, depth, -1, 0];
    return [o, opt.lo, opt.hi, 0, depth, i, opt.lo > pi ? 1 : -1];
  }

  /**
   * 요청한 차 r(dir 쪽으로 비키려는 중)이 반대쪽으로 k칸 물러날 수 있는가 — 그 칸에 구조물이 없어야 한다 (판 밖은 괜찮다: 나가면 된다).
   * ★ 같은 차선에서 r이 지나갈 칸에 o가 있을 때, o가 r 쪽으로 비키는 길은 r이 o의 몸길이만큼 물러나야 열린다.
   *   r 뒤가 구조물이면 그 길은 영영 없다 — 이것을 빼면 'o는 r 쪽으로 비키면 된다'로 착각해 연쇄를 놓친다
   */
  function retreatOk(grid, pr, r, dir, k, fp) {
    return (dir > 0 ? scan(grid, r, pr - k, pr - 1, fp) : scan(grid, r, pr + LEN[r], pr + LEN[r] + k - 1, fp)) !== null;
  }

  /** 대기열 항목 하나의 비켜나는 방법들 (구조물에 막힌 쪽은 뺀다) */
  function itemOptions(grid, pos, item, fp) {
    const [i, t0, t1, exitDir, , req, reqDir] = item;
    const opts = options(grid, pos[i], i, t0, t1, exitDir, fp);
    if (req >= 0) {
      const toward = reqDir > 0 ? 1 : 0;   // r 쪽 = r이 가는 방향의 반대
      if (opts[toward] && !retreatOk(grid, pos[req], req, reqDir, LEN[i], fp)) opts[toward] = null;
    }
    return opts.filter(Boolean);
  }

  return { N, V, H, LANE, LEN, at, options, next, itemOptions, subMark: new Int32Array(V), subStamp: 0 };
}

/**
 * 통로 하나를 쓰려면 반드시 움직여야 하는 차들 — 연쇄로 따라간다.
 * @returns null(이 통로는 영영 못 쓴다) | { must: 차 번호들, either: [[A쪽 차들], [B쪽 차들]] 목록 }
 */
function passageChain(sw, pos, grid, L, sign, depthLimit, mark, stamp, span = Infinity, fp = null) {
  const { N, H, LANE, LEN, at } = sw;
  const must = [];
  const either = [];
  const queue = [];   // [차, t0, t1, exitDir, 단계]
  const p = pos[L];
  if (fp) for (let j = 0; j < LEN[L]; j++) fp.push(at(L, p + j));   // 리무진이 움직여도 통로가 바뀐다
  const first = sign > 0 ? p + LEN[L] : p - 1;
  // span: 통로를 판 끝까지가 아니라 앞의 몇 칸만 본다 (안전구역을 벗어나는 데 필요한 칸)
  const last = Number.isFinite(span) ? Math.max(0, Math.min(N - 1, first + sign * (span - 1))) : (sign > 0 ? N - 1 : 0);
  for (let c = first; sign > 0 ? c <= last : c >= last; c += sign) {
    if (c < 0 || c >= N) break;
    if (fp) fp.push(at(L, c));
    const g = grid[at(L, c)];
    if (g === BLOCK) return null;
    if (g <= 0) continue;
    const b = g - 1;
    if (mark[b] === stamp) continue;
    mark[b] = stamp;
    must.push(b);
    if (H[b] !== H[L]) queue.push([b, LANE[L], LANE[L], 0, 1, -1, 0]);                       // 가로지른 차 — 리무진 차선 한 칸을 비운다
    else if (!Number.isFinite(span)) queue.push([b, 0, 0, sign, 1, -1, 0]);                   // 같은 방향 — 바깥으로 나가야 한다
    else queue.push([b, Math.min(first, last), Math.max(first, last), 0, 1, L, sign]);        // 같은 방향 — 그 몇 칸만 비우면 된다
  }
  for (let q = 0; q < queue.length; q++) {
    const [i, , , exitDir, depth] = queue[q];
    let opts = sw.itemOptions(grid, pos, queue[q], fp);
    if (opts.length === 0) {   // 어느 쪽으로도 못 비킨다 — 이 통로는 막혔다
      if (sw.trace) sw.trace.push({ why: 'stuck', item: queue[q] });
      return null;
    }
    if (opts.length === 2 && (opts[0].occ.length === 0 || opts[1].occ.length === 0)) continue;   // 그냥 비킬 수 있다
    if (opts.length === 2) {
      // 갈림길 — 쪽마다 '그쪽을 고르면 반드시 움직여야 하는 차'를 연쇄로 모은다.
      // 한쪽이 영영 안 되는 길이면(그 길의 차가 못 비킨다) 남은 쪽이 곧 외길이다
      const sub = opts.map((opt) => forcedClosure(sw, pos, grid, i, opt, exitDir, depthLimit - depth, fp));
      if (!sub[0] && !sub[1]) {
        if (sw.trace) sw.trace.push({ why: 'both-branches', item: queue[q] });
        return null;
      }
      if (sub[0] && sub[1]) {
        either.push(sub);
        continue;
      }
      opts = [sub[0] ? opts[0] : opts[1]];
    }
    // 길이 하나뿐 — 그 길에 있는 차는 모두 먼저 움직여야 한다
    for (const o of opts[0].occ) {
      if (mark[o] === stamp) continue;
      mark[o] = stamp;
      must.push(o);
      if (depth < depthLimit) queue.push(sw.next(o, i, opts[0], exitDir, depth + 1, pos[i]));
    }
  }
  return { must, either };
}

/**
 * i가 opt 길로 비켜난다고 정했을 때 반드시 움직여야 하는 차들 — 그 길의 차, 그 차가 외길로만 비킬 수 있으면 그 길의 차, …
 * (안의 갈림길은 더 따라가지 않는다). 그 길의 어떤 차가 영영 못 비키면 null (그 길은 없다).
 */
function forcedClosure(sw, pos, grid, i, opt, exitDir, depthLeft, fp) {
  const st = ++sw.subStamp;
  const out = [];
  const queue = [];
  for (const o of opt.occ) {
    sw.subMark[o] = st;
    out.push(o);
    if (depthLeft > 0) queue.push(sw.next(o, i, opt, exitDir, 1, pos[i]));
  }
  for (let q = 0; q < queue.length; q++) {
    const [j, , , jExit, d] = queue[q];
    const opts = sw.itemOptions(grid, pos, queue[q], fp);
    if (opts.length === 0) return null;
    if (opts.length === 2) continue;
    for (const o of opts[0].occ) {
      if (sw.subMark[o] === st || o === i) continue;
      sw.subMark[o] = st;
      out.push(o);
      if (d < depthLeft) queue.push(sw.next(o, j, opts[0], jExit, d + 1, pos[j]));
    }
  }
  return out;
}

/**
 * 통로 하나의 연쇄 (분석·시험용) — { must, either } | null. trace 배열을 넘기면 막힌 이유를 남긴다
 */
export function passageChainOf(puzzle, pos, limoId, sign, { depth = HARD_SOLVER_DEFAULTS.chainDepth, trace = null } = {}) {
  const sw = makeSweeper(puzzle);
  sw.trace = trace;
  return passageChain(sw, pos, buildFullGrid(puzzle, pos), limoId, sign, depth, new Int32Array(sw.V), 1);
}

/**
 * 리무진을 모두 빼는 데 필요한 수의 하한 (연쇄 하한). 휴리스틱으로 쓴다 — 절대 실제보다 크게 말하지 않는다.
 * @returns (pos, grid) → 하한 (영영 못 빼면 Infinity)
 */
export function makeChainBound(puzzle, limoIds, depthLimit = HARD_SOLVER_DEFAULTS.chainDepth) {
  const sw = makeSweeper(puzzle);
  const mark = new Int32Array(sw.V);
  const seen = new Int32Array(sw.V);
  let stamp = 0;
  let seenStamp = 0;
  const slots = limoIds.length * 2;   // (리무진, 쪽)마다 하나

  /** chains[slot] = 연쇄 결과 | null(막힘) — 그것으로 하한을 낸다 */
  const combine = (pos, chains) => {
    const per = [];
    for (let li = 0; li < limoIds.length; li++) {
      if (pos[limoIds[li]] === EXITED) continue;
      const choices = [chains[li * 2], chains[li * 2 + 1]].filter(Boolean);
      if (choices.length === 0) return Infinity;
      per.push(choices);
    }
    if (per.length === 0) return 0;
    let best = Infinity;
    const combo = (k, picked) => {
      if (k < per.length) {
        for (const c of per[k]) combo(k + 1, [...picked, c]);
        return;
      }
      best = Math.min(best, boundOf(picked, limoIds, pos, seen, ++seenStamp));
    };
    combo(0, []);
    return best;
  };
  const chainAt = (pos, grid, slot, fp) => {
    const L = limoIds[slot >> 1];
    if (pos[L] === EXITED) return null;
    return passageChain(sw, pos, grid, L, slot & 1 ? 1 : -1, depthLimit, mark, ++stamp, Infinity, fp);
  };

  const bound = (pos, grid) => {
    const chains = [];
    for (let slot = 0; slot < slots; slot++) chains.push(chainAt(pos, grid, slot, null));
    return combine(pos, chains);
  };

  // ★ 자식 상태는 부모와 차 한 대만 다르다. 부모의 연쇄를 계산할 때 '읽은 칸'(footprint)을 남겨 두고,
  //   자식에서 바뀐 칸이 그 안에 없으면 부모의 결과를 그대로 쓴다 — 대부분의 수는 통로 4개 중 하나에도 안 걸린다
  const fpMask = new Uint8Array(sw.N * sw.N);
  let fpCells = [];
  let parentChains = null;
  bound.prepare = (pos, grid) => {
    for (const k of fpCells) fpMask[k] = 0;
    fpCells = [];
    parentChains = [];
    for (let slot = 0; slot < slots; slot++) {
      const fp = [];
      parentChains.push(chainAt(pos, grid, slot, fp));
      for (const k of fp) {
        if (fpMask[k] === 0) fpCells.push(k);
        fpMask[k] |= 1 << slot;
      }
    }
  };
  bound.child = (pos, grid, changed) => {
    let hit = 0;
    for (const k of changed) hit |= fpMask[k];
    if (hit === 0) return combine(pos, parentChains);
    const chains = parentChains.slice();
    for (let slot = 0; slot < slots; slot++) if (hit & (1 << slot)) chains[slot] = chainAt(pos, grid, slot, null);
    return combine(pos, chains);
  };
  return bound;
}

/**
 * 통로를 하나씩 고른 조합의 하한 — 남은 리무진 + 반드시 움직일 차(서로 다른 차만) + 겹치지 않는 갈림길 수.
 * seen은 stamp로 표시한다 (같은 배열을 '센 차'와 '갈림길에 쓴 차'에 stamp·−stamp로 함께 쓴다)
 */
function boundOf(picked, limoIds, pos, seen, st) {
  let count = 0;
  for (const L of limoIds) {
    if (pos[L] === EXITED || seen[L] === st) continue;
    seen[L] = st;
    count++;
  }
  for (const c of picked) {
    for (const v of c.must) {
      if (seen[v] === st) continue;
      seen[v] = st;
      count++;
    }
  }
  // 양쪽 다 아직 안 센 차가 있는 갈림길 — 어느 쪽을 골라도 그쪽 차는 모두 움직여야 하므로 '작은 쪽의 안 센 차 수'만큼.
  // 서로 겹치지 않는 갈림길끼리만 더한다 (겹치면 같은 차를 두 번 셀 수 있다)
  for (const c of picked) {
    for (const [a, b] of c.either) {
      const na = a.filter((v) => seen[v] !== st);
      const nb = b.filter((v) => seen[v] !== st);
      if (na.length === 0 || nb.length === 0) continue;
      const extra = [...na, ...nb];
      if (extra.some((v) => seen[v] === -st)) continue;
      for (const v of extra) seen[v] = -st;
      count += Math.min(na.length, nb.length);
    }
  }
  return count;
}

/**
 * 관련 차량 — 리무진과 살아 있는 통로를 막는 차에서 시작해, 각 차가 비켜나려면 지나야 할 칸(양쪽 다)에 있는 차를 depth 단계까지.
 * @returns { ids, depthOf: Map(차 → 몇 단계에서 들어왔나) }
 */
export function chainRelevant(puzzle, pos, grid, limoIds, depth, span = Infinity) {
  const sw = makeSweeper(puzzle);
  const depthOf = new Map();
  const queue = [];
  for (const L of limoIds) {
    if (pos[L] === EXITED) continue;
    if (!depthOf.has(L)) depthOf.set(L, 0);
    for (const ps of passageInfo(puzzle, pos, grid, L)) {
      // span: 앞의 몇 칸만 (안전구역을 벗어나는 데 필요한 칸) — 그 안에 구조물이 없으면 산 통로로 친다
      const cells = Number.isFinite(span) ? ps.cells.slice(0, span) : ps.cells;
      if (cells.some((k) => grid[k] === BLOCK)) continue;
      const lo = Math.min(...cells.map((k) => (sw.H[L] ? k % sw.N : Math.floor(k / sw.N))));
      const hi = Math.max(...cells.map((k) => (sw.H[L] ? k % sw.N : Math.floor(k / sw.N))));
      for (const k of cells) {
        const b = grid[k] - 1;
        if (b < 0 || depthOf.has(b)) continue;
        depthOf.set(b, 0);
        if (sw.H[b] !== sw.H[L]) queue.push([b, sw.LANE[L], sw.LANE[L], 0, 0, -1, 0]);
        else if (!Number.isFinite(span)) queue.push([b, 0, 0, ps.sign, 0, -1, 0]);
        else queue.push([b, lo, hi, 0, 0, L, ps.sign]);
      }
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const [i, , , exitDir, d] = queue[q];
    if (d >= depth) continue;
    for (const o of sw.itemOptions(grid, pos, queue[q], null)) {
      for (const v of o.occ) {
        if (depthOf.has(v)) continue;
        depthOf.set(v, d + 1);
        queue.push(sw.next(v, i, o, exitDir, d + 1, pos[i]));
      }
    }
  }
  return { ids: [...depthOf.keys()], depthOf };
}

/** 우선순위 큐 — f가 작은 것 먼저, 같으면 g가 큰 것(목표에 더 다가간 것) 먼저, 그다음 넣은 순서 */
class Heap {
  constructor() {
    this.a = [];
  }

  get size() {
    return this.a.length;
  }

  #less(x, y) {
    return x.f < y.f || (x.f === y.f && (x.g > y.g || (x.g === y.g && x.n < y.n)));
  }

  push(e) {
    const a = this.a;
    a.push(e);
    for (let k = a.length - 1; k > 0;) {
      const p = (k - 1) >> 1;
      if (!this.#less(a[k], a[p])) break;
      [a[k], a[p]] = [a[p], a[k]];
      k = p;
    }
  }

  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      for (let k = 0; ;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && this.#less(a[l], a[m])) m = l;
        if (r < a.length && this.#less(a[r], a[m])) m = r;
        if (m === k) break;
        [a[k], a[m]] = [a[m], a[k]];
        k = m;
      }
    }
    return top;
  }
}

/**
 * 관련 차량만 움직이는 A*. goal·heuristic은 (pos, grid)를 받는다 — pos는 판 전체 위치 배열(관련 없는 차는 늘 제자리).
 * @returns {{ solved, length, moves, explored, relevant, reason?, ms }}
 *   reason: 'depth'(상한 안에 답이 없다) · 'nodes'(상태 수 상한) · 'time'(시간 상한) · 'impossible'(휴리스틱이 무한대)
 */
export function searchHard(puzzle, startPos, relIds, goal, heuristic, opts = {}) {
  const o = { ...HARD_SOLVER_DEFAULTS, ...opts };
  const t0 = Date.now();
  const N = puzzle.size;
  const rel = relIds.filter((i) => startPos[i] !== EXITED);
  const R = rel.length;
  const isRel = new Uint8Array(puzzle.vehicles.length);
  for (const i of rel) isRel[i] = 1;
  const H = rel.map((i) => puzzle.vehicles[i].axis === 'h');
  const LANE = rel.map((i) => puzzle.vehicles[i].lane);
  const LEN = rel.map((i) => puzzle.vehicles[i].len);
  const at = (k, c) => (H[k] ? LANE[k] * N + c : c * N + LANE[k]);

  // 움직이지 않는 것: 구조물 + 관련 없는 차
  const base = new Int16Array(N * N);
  for (const b of puzzle.blocks) base[b.y * N + b.x] = BLOCK;
  puzzle.vehicles.forEach((v, i) => {
    if (isRel[i] || startPos[i] === EXITED) return;
    for (let k = 0; k < v.len; k++) base[cellIndex(N, v, startPos[i] + k)] = i + 1;
  });
  // 상태 = 관련 차들의 위치만 (Int8Array). 판 전체 위치(work)와 판(grid)은 하나씩 두고 덮어쓴다
  const work = Array.from(startPos);
  const grid = new Int16Array(N * N);
  const paint = (k, p, value) => {
    for (let j = 0; j < LEN[k]; j++) grid[at(k, p + j)] = value;
  };
  const load = (st) => {
    grid.set(base);
    for (let k = 0; k < R; k++) {
      work[rel[k]] = st[k];
      if (st[k] !== EXITED) paint(k, st[k], rel[k] + 1);
    }
  };
  const codes = new Uint16Array(R);
  const changed = [];
  const keyOf = (st) => {
    for (let k = 0; k < R; k++) codes[k] = st[k] + 2;
    return String.fromCharCode.apply(null, codes);
  };

  const start = Int8Array.from(rel.map((i) => startPos[i]));
  load(start);
  const result = (extra) => ({ explored: 0, relevant: R, ...extra, ms: Date.now() - t0 });
  if (goal(work, grid)) return result({ solved: true, length: 0, moves: [] });
  const h0 = heuristic(work, grid);
  if (!Number.isFinite(h0)) return result({ solved: false, reason: 'impossible' });

  const best = new Map([[keyOf(start), 0]]);
  const open = new Heap();
  let counter = 0;
  open.push({ st: start, g: 0, f: h0, n: counter++, parent: null, move: null });
  let explored = 0;

  while (open.size > 0) {
    const node = open.pop();
    const st = node.st;
    if (best.get(keyOf(st)) < node.g) continue;   // 더 짧은 길로 이미 왔다
    explored++;
    if (explored > o.maxNodes) return result({ solved: false, reason: 'nodes', explored });
    if ((explored & 1023) === 0 && Date.now() - t0 > o.timeLimitMs) return result({ solved: false, reason: 'time', explored });

    load(st);
    heuristic.prepare?.(work, grid);
    const g = node.g + 1;
    for (let k = 0; k < R; k++) {
      const p = st[k];
      if (p === EXITED) continue;
      for (let s = -1; s <= 1; s += 2) {
        let dist = 0;
        let exits = true;
        for (let c = s > 0 ? p + LEN[k] : p - 1; c >= 0 && c < N; c += s) {
          if (grid[at(k, c)] !== EMPTY) {
            exits = false;
            break;
          }
          dist++;
        }
        if (!exits && dist === 0) continue;
        const to = exits ? EXITED : p + s * dist;

        st[k] = to;
        const key = keyOf(st);
        st[k] = p;
        const prev = best.get(key);
        if (prev !== undefined && prev <= g) continue;

        // 판에 이 한 수만 반영해 재고, 되돌린다
        paint(k, p, EMPTY);
        if (to !== EXITED) paint(k, to, rel[k] + 1);
        work[rel[k]] = to;
        const move = { vehicle: rel[k], sign: s };
        const done = goal(work, grid);
        let h = 0;
        if (!done) {
          if (heuristic.child) {
            changed.length = 0;
            for (let j = 0; j < LEN[k]; j++) {
              changed.push(at(k, p + j));
              if (to !== EXITED) changed.push(at(k, to + j));
            }
            h = heuristic.child(work, grid, changed);
          } else h = heuristic(work, grid);
        }
        if (to !== EXITED) paint(k, to, EMPTY);
        paint(k, p, rel[k] + 1);
        work[rel[k]] = p;

        if (done) {
          const path = [move];
          for (let q = node; q.parent; q = q.parent) path.push(q.move);
          path.reverse();
          return result({ solved: true, length: g, moves: path, explored });
        }
        if (!Number.isFinite(h) || g + h > o.maxDepth) continue;
        const next = Int8Array.from(st);
        next[k] = to;
        best.set(key, g);
        open.push({ st: next, g, f: g + h, n: counter++, parent: node, move });
      }
    }
  }
  return result({ solved: false, reason: 'depth', explored });
}

// ── 목표별 묶음 ──────────────────────────────────────────

export function buildFullGrid(puzzle, pos) {
  const N = puzzle.size;
  const grid = new Int16Array(N * N);
  for (const b of puzzle.blocks) grid[b.y * N + b.x] = BLOCK;
  puzzle.vehicles.forEach((v, i) => {
    if (pos[i] === EXITED) return;
    for (let k = 0; k < v.len; k++) grid[cellIndex(N, v, pos[i] + k)] = i + 1;
  });
  return grid;
}

/** 리무진들을 '함께' 빼는 A* (관련 차량 = 그 리무진들의 연쇄) */
function jointEscape(puzzle, pos, limoIds, o) {
  const grid0 = buildFullGrid(puzzle, pos);
  const { ids, depthOf } = chainRelevant(puzzle, pos, grid0, limoIds, o.closureDepth);
  const heuristic = makeChainBound(puzzle, limoIds, o.chainDepth);
  const goal = (p) => limoIds.every((l) => p[l] === EXITED);
  const r = searchHard(puzzle, pos, ids, goal, heuristic, o);
  return { ...r, relevantDepth: Math.max(0, ...depthOf.values()), bound: heuristic(pos, grid0) };
}

function permutations(a) {
  if (a.length <= 1) return [a];
  return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((rest) => [x, ...rest]));
}

/** 정해진 순서대로 한 대씩 — 앞 리무진의 최소 수순을 둔 판에서 다음 리무진을 뺀다. 실제로 둘 수 있는 수순이다 */
function sequentialEscape(puzzle, pos, order, o) {
  let cur = pos.slice();
  const moves = [];
  let explored = 0;
  let relevant = 0;
  let relevantDepth = 0;
  for (const l of order) {
    if (cur[l] === EXITED) continue;   // 앞 리무진의 수순이 이 리무진까지 뺐다
    const r = jointEscape(puzzle, cur, [l], o);
    explored += r.explored;
    relevant = Math.max(relevant, r.relevant);
    relevantDepth = Math.max(relevantDepth, r.relevantDepth);
    if (!r.solved) return { solved: false, reason: r.reason, explored, relevant, relevantDepth };
    for (const m of r.moves) {
      cur = applyMove(cur, getMove(puzzle, cur, m.vehicle, m.sign));
      moves.push(m);
    }
  }
  return { solved: true, length: moves.length, moves, explored, relevant, relevantDepth };
}

/**
 * 리무진을 모두 빼는 최소 수 (랜덤 이동·새 차량 없음).
 *
 * ★ 리무진 두 대를 한꺼번에 탐색하면 상태 수가 (한 대의 상태 수)²으로 불어난다 — 판 생성의 상한(12만)에 자주 걸렸다.
 *   그래서 ① 한 대씩 차례로 빼 보고(두 순서 중 짧은 쪽) 그 길이를 상한으로 삼는다 — 실제로 둘 수 있는 수순이다.
 *   ② 상한이 연쇄 하한과 같으면 그것이 최소다 (증명 끝). ③ 아니면 함께 움직이는 A*로 상한보다 짧은 수순이 있는지
 *   jointNodes 상태까지만 찾아본다 — 찾으면 그것이 최소, 상한−1 안에 답이 없다고 끝나면 상한이 최소다.
 *   통로가 서로 겹치지 않게 지은 판(하드 모드)에서는 대개 ①이 곧 최소다.
 * @returns {{ solved, length, moves, explored, relevant, relevantDepth, bound, exact, reason?, ms }}
 *   bound — 시작 판의 연쇄 하한 / exact — length가 최소임이 증명됐는가
 */
export function minEscapeMoves(puzzle, pos, limoIds, opts = {}) {
  const o = { ...HARD_SOLVER_DEFAULTS, ...opts };
  const t0 = Date.now();
  const live = limoIds.filter((l) => pos[l] !== EXITED);
  const bound = makeChainBound(puzzle, live, o.chainDepth)(pos, buildFullGrid(puzzle, pos));
  const done = (r) => ({ ...r, bound, ms: Date.now() - t0 });
  if (live.length <= 1 || !Number.isFinite(bound)) {
    const r = jointEscape(puzzle, pos, live, o);
    return done({ ...r, exact: r.solved });
  }

  let best = null;
  let explored = 0;
  let relevant = 0;
  let relevantDepth = 0;
  let failure = null;
  for (const order of permutations(live)) {
    const r = sequentialEscape(puzzle, pos, order, o);
    explored += r.explored;
    relevant = Math.max(relevant, r.relevant);
    relevantDepth = Math.max(relevantDepth, r.relevantDepth);
    if (!r.solved) failure ??= r.reason;
    else if (!best || r.length < best.length) best = r;
  }
  if (!best) return done({ solved: false, reason: failure, explored, relevant, relevantDepth, exact: false });
  if (best.length <= bound) return done({ ...best, explored, relevant, relevantDepth, exact: true });

  // 함께 움직이면 더 짧아지는가 — 상한보다 짧은 수순만 찾는다
  const j = jointEscape(puzzle, pos, live, { ...o, maxDepth: best.length - 1, maxNodes: o.jointNodes });
  explored += j.explored;
  if (j.solved) return done({ ...j, explored, relevant: Math.max(relevant, j.relevant), relevantDepth, exact: true });
  return done({ ...best, explored, relevant, relevantDepth, exact: j.reason === 'depth' });
}

/**
 * 리무진 한 대가 안전구역을 벗어나는 최소 수 — 리무진의 두 칸이 모두 안전구역 밖이거나 판 밖이면 벗어난 것.
 * @param inSafe (x, y) → 안전구역인가
 */
export function minLeaveSafeMoves(puzzle, pos, limoId, inSafe, opts = {}) {
  const o = { ...HARD_SOLVER_DEFAULTS, ...opts };
  const N = puzzle.size;
  const v = puzzle.vehicles[limoId];
  const outside = (p) => {
    if (p[limoId] === EXITED) return true;
    for (let k = 0; k < v.len; k++) {
      const idx = cellIndex(N, v, p[limoId] + k);
      if (inSafe(idx % N, Math.floor(idx / N))) return false;
    }
    return true;
  };
  // 리무진이 안전구역 밖까지 가는 데 지나갈 칸 — 경계까지 + 몸길이 (판 끝에서 잘린다)
  const spans = (p, g) => passageInfo(puzzle, p, g, limoId).map((ps) => {
    let need = 0;
    while (need < ps.cells.length) {
      const idx = ps.cells[need];
      need++;
      if (!inSafe(idx % N, Math.floor(idx / N))) break;   // 경계를 막 넘은 칸
    }
    return ps.cells.slice(0, Math.min(ps.cells.length, need + v.len - 1));
  });
  // 관련 차량은 그 칸들을 막는 차에서 출발한다 — 통로 전체(판 끝까지)에서 출발하면 멀리 있는 차까지 끌려 들어와 느려진다.
  // ⚠️ 두 쪽의 칸 수가 다를 수 있으니 긴 쪽에 맞춘다 (짧은 쪽은 몇 칸 더 보는 것뿐이다)
  const grid0 = buildFullGrid(puzzle, pos);
  const spanLen = Math.max(...spans(pos, grid0).map((sp) => sp.length));
  const { ids } = chainRelevant(puzzle, pos, grid0, [limoId], o.closureDepth, spanLen);
  // 휴리스틱: 그 칸들에 대한 연쇄 하한 + 1 (리무진)
  const sw = makeSweeper(puzzle);
  const mark = new Int32Array(sw.V);
  const seen = new Int32Array(sw.V);
  let stamp = 0;
  const heuristic = (p, g) => {
    let bestCount = Infinity;
    spans(p, g).forEach((span, side) => {
      const c = passageChain(sw, p, g, limoId, side === 0 ? -1 : 1, o.chainDepth, mark, ++stamp, span.length);
      if (c) bestCount = Math.min(bestCount, boundOf([c], [limoId], p, seen, ++stamp));
    });
    return bestCount;
  };
  return searchHard(puzzle, pos, ids, outside, heuristic, o);
}

/**
 * 통로 하나를 비우는 최소 수 (리무진은 움직이지 않는다) — 분석용.
 * @param passage passageInfo의 한 항목
 */
export function minClearPassageMoves(puzzle, pos, passage, opts = {}) {
  const o = { ...HARD_SOLVER_DEFAULTS, ...opts };
  const grid0 = buildFullGrid(puzzle, pos);
  const { ids } = relevantVehicles(puzzle, pos, grid0, passage.blockers, o.closureDepth);
  const cells = passage.cells;
  const clear = (p, g) => cells.every((k) => g[k] <= 0);
  const heuristic = (p, g) => (cells.some((k) => g[k] === BLOCK) ? Infinity : new Set(cells.map((k) => g[k]).filter((x) => x > 0)).size);
  return searchHard(puzzle, pos, ids.filter((i) => i !== passage.limo), clear, heuristic, o);
}
