// 하드 모드 난이도 보고서.
//   node tools/hard-report.js analyze 7KXN65   시드 하나의 리무진 통로 4개 분석
//   node tools/hard-report.js dist 30           무작위 시드 N개의 최소 클리어 수 분포
//   node tools/hard-report.js table 30          시드 N개의 표 — 최소 클리어 수·안전구역 벗어나기·통로별 막는 차·연쇄·생성 시간
//   node tools/hard-report.js sim 30 [--chance 0.2]
//                                               자동 플레이 시뮬레이션 — 랜덤 이동까지 넣고 실제로 몇 수에 깨는가
// ⚠️ 판은 지금의 생성기(hardGenerator.js)로 만든다. 개선 전(커밋 95deec4)의 판은 커밋 a8b9d4e의 이 도구에서 --deployed로 보던 것이다
// ⚠️ 시드 목록은 언제나 같다 (hard-report 난수에서 뽑는다) — 설정을 바꿔 가며 같은 판끼리 견줄 수 있다

import { HARD_MODE } from '../src/core/levels.js';
import {
  generateHardPuzzle, zoneLayout, isSafeCell, HardSession, HardStatus,
} from '../src/core/hardMode.js';
import { createPuzzle, EXITED, buildGrid, listMoves, applyMove } from '../src/core/rules.js';
import { createRng } from '../src/core/random.js';
import {
  passageInfo, passageChainOf, makeChainBound, chainRelevant, searchHard, minEscapeMoves, minClearPassageMoves, minLeaveSafeMoves,
  buildFullGrid,
} from '../src/core/hardSolver.js';

const [cmd, arg] = process.argv.slice(2);
const option = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const chance = option('chance', HARD_MODE.blockMove.chance);
const config = { ...HARD_MODE, blockMove: { ...HARD_MODE.blockMove, chance } };
const ANALYSIS = { timeLimitMs: 1000 };   // 분석 도구에서는 판당 1초 상한을 건다
const DIR = { h: ['왼쪽', '오른쪽'], v: ['위', '아래'] };

function seedsOf(count) {
  const rng = createRng('hard-report-dist');
  return Array.from({ length: count }, () => rng.int(36 ** 6).toString(36).toUpperCase().padStart(6, '0'));
}

function boardOf(seed) {
  const t0 = performance.now();
  const g = generateHardPuzzle(seed, config);
  return { g, puzzle: createPuzzle(g.def), ms: performance.now() - t0 };
}

const limosOf = (puzzle) => puzzle.vehicles.filter((v) => v.kind === 'limo').map((v) => v.id);
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

function fmtResult(r) {
  return r.solved ? `${r.length}수` : `못 찾음(${r.reason})`;
}

/** 통로(안전구역 밖 부분)마다 막는 차 수와 연쇄 단계 — 리무진 번호 순, 뒤(−) 먼저 */
function passageStats(puzzle) {
  const zone = zoneLayout(puzzle.size, config.safeSize);
  const grid = buildFullGrid(puzzle, puzzle.start);
  const out = [];
  for (const l of limosOf(puzzle)) {
    for (const ps of passageInfo(puzzle, puzzle.start, grid, l)) {
      const outside = ps.cells.filter((k) => !isSafeCell(zone, k % puzzle.size, Math.floor(k / puzzle.size)));
      const blockers = new Set(outside.map((k) => grid[k]).filter((x) => x > 0)).size;
      const chain = passageChainOf(puzzle, puzzle.start, l, ps.sign);
      out.push({ blockers, chain: chain ? chain.depth : null });
    }
  }
  return out;
}

/** 연쇄 하한을 가장 많이 줄이는 수 (같으면 리무진 → 앞에 나온 수) */
function greedyStep(s, live) {
  const bound = makeChainBound(s.puzzle, live);
  let best = null;
  for (const m of listMoves(s.puzzle, s.pos)) {
    const next = applyMove(s.pos, m);
    const h = bound(next, buildGrid(s.puzzle, next));
    const score = (Number.isFinite(h) ? h : 999) - (live.includes(m.vehicle) ? 0.5 : 0);
    if (!best || score < best.score) best = { vehicle: m.vehicle, sign: m.sign, score };
  }
  return best;
}

/**
 * 막는 차 하나 빼기 — 연쇄 하한이 가장 작은 통로를 골라, 그 통로의 막는 차(리무진에서 가까운 차부터) 하나가 통로 칸을 다 비우는
 * 가장 짧은 수순을 구해 첫 수를 둔다. 큰 문제를 작은 문제 여러 개로 — 사람이 막막할 때 하는 방식이다
 */
function subgoalStep(s, live) {
  const grid = buildFullGrid(s.puzzle, s.pos);
  let target = null;
  for (const l of live) {
    for (const ps of passageInfo(s.puzzle, s.pos, grid, l)) {
      const chain = passageChainOf(s.puzzle, s.pos, l, ps.sign);
      if (!chain || ps.blockers.length === 0) continue;
      const cost = chain.must.length;
      if (!target || cost < target.cost) target = { ps, cost, limo: l };
    }
  }
  if (!target) return null;
  const cells = new Set(target.ps.cells);
  const { ids } = chainRelevant(s.puzzle, s.pos, grid, [target.limo], 4);
  for (const b of target.ps.blockers) {
    const v = s.puzzle.vehicles[b];
    const out = (p) => {
      if (p[b] === EXITED) return true;
      for (let k = 0; k < v.len; k++) {
        const c = p[b] + k;
        if (cells.has(v.axis === 'h' ? v.lane * s.puzzle.size + c : c * s.puzzle.size + v.lane)) return false;
      }
      return true;
    };
    const r = searchHard(s.puzzle, s.pos, ids.filter((i) => i !== target.limo), out, () => 1, { maxNodes: 5000, maxDepth: 12 });
    if (r.solved && r.moves.length > 0) return r.moves[0];
  }
  return null;
}

/**
 * 자동 플레이 한 판 — 매 수 다시 계획하는 탐욕 플레이어.
 * @returns { seed, par, cleared, moves, turns, blockTurns }
 */
function autoPlay(seed, maxMoves) {
  const { g, puzzle } = boardOf(seed);
  const s = new HardSession(puzzle, seed, config);
  let blockTurns = 0;
  let turns = 0;
  let greedyTurns = 0;
  let subgoalTurns = 0;
  while (s.status === HardStatus.PLAYING && s.moveCount < maxMoves) {
    const live = s.limoIds.filter((l) => s.pos[l] !== EXITED);
    // 최소 수순은 대개 3천 상태 안에 나온다. 랜덤 이동이 통로를 겹겹이 막아 못 구하면 사람처럼 한 대씩 —
    // 가장 쉬운 통로에서 막는 차 하나를 통로 밖으로 빼는 수순을 구한다. 그것도 없으면 탐욕 한 수
    const plan = minEscapeMoves(s.puzzle, s.pos, live, { maxNodes: 3000, jointNodes: 0 });
    let m = plan.solved && plan.moves.length > 0 ? plan.moves[0] : null;
    if (!m) {
      subgoalTurns++;
      m = subgoalStep(s, live);
    }
    if (!m) {
      greedyTurns++;
      m = greedyStep(s, live);
    }
    let r = m ? s.move(m.vehicle, m.sign) : null;
    if (!r?.moved) {
      m = greedyStep(s, live);
      r = m ? s.move(m.vehicle, m.sign) : null;
    }
    if (!r?.moved) break;
    turns++;
    if (r.random?.blocked) blockTurns++;
  }
  return { seed, par: g.par, cleared: s.status === HardStatus.CLEARED, stuck: s.status === HardStatus.STUCK, moves: s.moveCount, turns, blockTurns, greedyTurns, subgoalTurns };
}

if (cmd === 'analyze') {
  const seed = arg ?? '7KXN65';
  const { g, puzzle } = boardOf(seed);
  const pos = puzzle.start.slice();
  const grid = buildFullGrid(puzzle, pos);
  const limos = limosOf(puzzle);
  const zone = zoneLayout(config.size, config.safeSize);
  console.log(`시드 ${seed} — 차 ${puzzle.vehicles.length - limos.length}대 + 리무진 ${limos.length}대, 구조물 ${puzzle.blocks.length}개`);
  console.log(`생성: ${g.stage + 1}단계 · ${g.attempts}번째 판 (모두 ${g.tried}번 지음)${g.met ? '' : ' · 목표 범위 못 맞춤'}\n`);
  limos.forEach((l, n) => {
    const v = puzzle.vehicles[l];
    console.log(`리무진 ${n + 1} (${v.axis === 'h' ? '가로' : '세로'}, ${v.axis === 'h' ? `${pos[l]}~${pos[l] + 1}열 · ${v.lane}행` : `${v.lane}열 · ${pos[l]}~${pos[l] + 1}행`})`);
    for (const ps of passageInfo(puzzle, pos, grid, l)) {
      const name = DIR[v.axis][ps.sign > 0 ? 1 : 0];
      if (ps.dead) {
        console.log(`  ${name} 통로: 구조물에 막혀 쓸 수 없음 (막는 차 ${ps.blockers.length}대)`);
        continue;
      }
      const r = minClearPassageMoves(puzzle, pos, ps, ANALYSIS);
      const chain = passageChainOf(puzzle, pos, l, ps.sign);
      console.log(`  ${name} 통로: 막는 차 ${ps.blockers.length}대 · 연쇄 ${chain ? chain.depth : '막힘'} → 통로를 비우는 최소 ${fmtResult(r)} (+ 리무진 1수)`);
    }
    const leave = minLeaveSafeMoves(puzzle, pos, l, (x, y) => isSafeCell(zone, x, y), ANALYSIS);
    console.log(`  안전구역을 벗어나는 최소: ${fmtResult(leave)}`);
  });
  const all = minEscapeMoves(puzzle, pos, limos, ANALYSIS);
  console.log(`\n리무진 2대를 모두 빼는 최소 (랜덤 이동 없음): ${fmtResult(all)}${all.exact ? '' : ' (상한)'} — 하한 ${all.bound}, 관련 차량 ${all.relevant}대, 탐색 ${all.explored}상태, ${all.ms}ms`);
} else if (cmd === 'dist') {
  const count = Number(arg ?? 30);
  const rows = seedsOf(count).map((seed) => {
    const { g, ms } = boardOf(seed);
    return { seed, moves: g.par, ms };
  });
  const ok = rows.map((r) => r.moves);
  console.log(`무작위 시드 ${count}개 — 최소 클리어 수 (랜덤 이동 없음)`);
  console.log(rows.map((r) => `${r.seed}:${r.moves}`).join('  '));
  console.log(`최소 ${Math.min(...ok)} / 평균 ${avg(ok).toFixed(1)} / 최대 ${Math.max(...ok)}`);
} else if (cmd === 'table') {
  const count = Number(arg ?? 30);
  const [lo, hi] = config.targetMoves;
  console.log(`시드 ${count}개 — 최소 클리어 수는 랜덤 이동이 없다고 가정 (목표 ${lo}~${hi}수)`);
  console.log('통로는 리무진 번호 순으로 [뒤, 앞] — 가로 리무진은 [왼쪽, 오른쪽], 세로 리무진은 [위, 아래]. 막는 차는 안전구역 밖 부분\n');
  const head = ['시드', '최소 클리어', '안전구역 벗어나기', '통로별 막는 차', '통로별 연쇄', '최대 연쇄', '생성'];
  console.log(`| ${head.join(' | ')} |`);
  console.log(`|${head.map(() => '---').join('|')}|`);
  const rows = [];
  for (const seed of seedsOf(count)) {
    const { g, puzzle, ms } = boardOf(seed);
    const ps = passageStats(puzzle);
    const chains = ps.map((p) => p.chain ?? 0);
    rows.push({ par: g.par, ms, met: g.met, exact: g.exact });
    console.log(`| ${seed} | ${g.par}수${g.exact ? '' : '*'} | ${g.leaveSafe.join(' / ')}수 | ${ps.map((p) => p.blockers).join(' · ')} | ${ps.map((p) => p.chain ?? '막힘').join(' · ')} | ${Math.max(...chains)} | ${Math.round(ms)}ms |`);
  }
  const pars = rows.map((r) => r.par);
  const times = rows.map((r) => r.ms);
  console.log(`\n최소 클리어 수: 최소 ${Math.min(...pars)} · 평균 ${avg(pars).toFixed(1)} · 최대 ${Math.max(...pars)} — 범위 ${lo}~${hi} 안 ${rows.filter((r) => r.par >= lo && r.par <= hi).length}/${count}`);
  console.log(`최소임이 증명된 판 ${rows.filter((r) => r.exact).length}/${count} (* = 리무진을 한 대씩 뺀 수순의 길이 — 실제 최소의 상한)`);
  console.log(`생성 시간: 평균 ${avg(times).toFixed(0)}ms · 중앙 ${median(times).toFixed(0)}ms · 최대 ${Math.max(...times).toFixed(0)}ms`);
} else if (cmd === 'sim') {
  const count = Number(arg ?? 30);
  const maxMoves = 200;
  console.log(`자동 플레이 ${count}판 — 길막기 확률 ${chance} (최대 ${maxMoves}수까지)`);
  console.log('플레이어: 매 수마다 지금 판에서 리무진을 빼는 최소 수순(랜덤 이동 없다고 가정)을 다시 구해 그 첫 수를 둔다.');
  console.log('          최소 수순을 못 구하면(랜덤 이동이 통로를 겹겹이 막았을 때) 가장 쉬운 통로의 막는 차를 하나씩 빼는 수순,');
  console.log('          그것도 없으면 연쇄 하한을 가장 많이 줄이는 수 (탐욕). 되돌리기는 쓰지 않는다');
  console.log('          막힘 = 게임이 막힘 판정, 실패 = 200수 안에 못 깸 (게임은 진행 중)\n');
  const rows = seedsOf(count).map((seed) => autoPlay(seed, maxMoves));
  console.log(rows.map((r) => `${r.seed}:${r.cleared ? r.moves : r.stuck ? `막힘(${r.moves})` : `실패(${r.moves})`}`).join('  '));
  const cleared = rows.filter((r) => r.cleared);
  const moves = cleared.map((r) => r.moves);
  console.log(`\n클리어 ${cleared.length}/${count}`);
  if (moves.length > 0) {
    console.log(`클리어까지 이동 수: 최소 ${Math.min(...moves)} · 평균 ${avg(moves).toFixed(1)} · 중앙 ${median(moves)} · 최대 ${Math.max(...moves)}`);
    console.log(`랜덤 이동 없는 최소 대비: 평균 +${avg(cleared.map((r) => r.moves - r.par)).toFixed(1)}수`);
    const buckets = new Map();
    for (const m of moves) {
      const lo = Math.floor(m / 5) * 5;
      buckets.set(lo, (buckets.get(lo) ?? 0) + 1);
    }
    console.log(`분포: ${[...buckets].sort((a, b) => a[0] - b[0]).map(([lo, n]) => `${lo}~${lo + 4}수 ${'■'.repeat(n)} ${n}`).join(' | ')}`);
  }
  console.log(`턴당 길막기 비율: ${(avg(rows.map((r) => r.blockTurns / Math.max(1, r.turns))) * 100).toFixed(1)}% · 최소 수순을 못 구해 '막는 차 하나 빼기'로 둔 수 ${rows.reduce((a, r) => a + r.subgoalTurns, 0)}번, 탐욕으로 둔 수 ${rows.reduce((a, r) => a + r.greedyTurns, 0)}번`);
} else {
  console.log('사용법: node tools/hard-report.js analyze <시드> | dist <개수> | table <개수> | sim <개수> [--chance 0.2]');
}
