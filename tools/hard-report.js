// 하드 모드 난이도 보고서.
//   node tools/hard-report.js analyze 7KXN65   시드 하나의 리무진 통로 4개 분석
//   node tools/hard-report.js dist 30           무작위 시드 N개의 최소 클리어 수 분포
// ⚠️ 판은 지금의 생성기(hardGenerator.js)로 만든다. 개선 전(커밋 95deec4)의 판은 커밋 a8b9d4e의 이 도구에서 --deployed로 보던 것이다

import { HARD_MODE } from '../src/core/levels.js';
import { generateHardPuzzle, zoneLayout, isSafeCell } from '../src/core/hardMode.js';
import { createPuzzle } from '../src/core/rules.js';
import { createRng } from '../src/core/random.js';
import {
  passageInfo, minEscapeMoves, minClearPassageMoves, minLeaveSafeMoves, buildFullGrid,
} from '../src/core/hardSolver.js';

const [cmd, arg] = process.argv.slice(2);
const config = HARD_MODE;
const ANALYSIS = { timeLimitMs: 1000 };   // 분석 도구에서는 판당 1초 상한을 건다
const DIR = { h: ['왼쪽', '오른쪽'], v: ['위', '아래'] };

function boardOf(seed) {
  const t0 = performance.now();
  const g = generateHardPuzzle(seed, config);
  const puzzle = createPuzzle(g.def);
  return { puzzle, ms: performance.now() - t0 };
}

function fmtResult(r) {
  return r.solved ? `${r.length}수` : `못 찾음(${r.reason})`;
}

if (cmd === 'analyze') {
  const seed = arg ?? '7KXN65';
  const { puzzle } = boardOf(seed);
  const pos = puzzle.start.slice();
  const grid = buildFullGrid(puzzle, pos);
  const limos = puzzle.vehicles.filter((v) => v.kind === 'limo').map((v) => v.id);
  const zone = zoneLayout(config.size, config.safeSize);
  console.log(`시드 ${seed} — 차 ${puzzle.vehicles.length - limos.length}대 + 리무진 ${limos.length}대, 구조물 ${puzzle.blocks.length}개\n`);
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
      console.log(`  ${name} 통로: 막는 차 ${ps.blockers.length}대 → 통로를 비우는 최소 ${fmtResult(r)} (+ 리무진 1수)`);
    }
    const leave = minLeaveSafeMoves(puzzle, pos, l, (x, y) => isSafeCell(zone, x, y), ANALYSIS);
    console.log(`  안전구역을 벗어나는 최소: ${fmtResult(leave)}`);
  });
  const all = minEscapeMoves(puzzle, pos, limos, ANALYSIS);
  console.log(`\n리무진 2대를 모두 빼는 최소 (랜덤 이동 없음): ${fmtResult(all)} — 관련 차량 ${all.relevant}대, 탐색 ${all.explored}상태, ${all.ms}ms`);
} else if (cmd === 'dist') {
  const count = Number(arg ?? 30);
  const rng = createRng('hard-report-dist');
  const rows = [];
  for (let k = 0; k < count; k++) {
    const seed = rng.int(36 ** 6).toString(36).toUpperCase().padStart(6, '0');
    const { puzzle, ms } = boardOf(seed);
    const limos = puzzle.vehicles.filter((v) => v.kind === 'limo').map((v) => v.id);
    const r = minEscapeMoves(puzzle, puzzle.start.slice(), limos, ANALYSIS);
    rows.push({ seed, moves: r.solved ? r.length : null, reason: r.reason, gen: ms, solve: r.ms });
  }
  const ok = rows.filter((r) => r.moves != null).map((r) => r.moves);
  console.log(`무작위 시드 ${count}개 — 최소 클리어 수 (랜덤 이동 없음)`);
  console.log(rows.map((r) => `${r.seed}:${r.moves ?? `?(${r.reason})`}`).join('  '));
  if (ok.length > 0) {
    const avg = ok.reduce((a, b) => a + b, 0) / ok.length;
    console.log(`최소 ${Math.min(...ok)} / 평균 ${avg.toFixed(1)} / 최대 ${Math.max(...ok)} (구한 판 ${ok.length}/${count})`);
  }
} else {
  console.log('사용법: node tools/hard-report.js analyze <시드> | dist <개수>');
}
