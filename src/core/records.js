// 별점·최고 기록 — 화면과 무관한 순수 로직

/** 별 둘의 기준: 목표 이동 수의 몇 배까지인가 */
export const TWO_STAR_RATIO = 1.3;

/**
 * 별점 — 목표 이동 수(솔버가 구한 최소) 대비.
 *   ★★★ 목표 이하 · ★★ 목표의 1.3배 이하 · ★ 그 밖 (클리어만 하면 하나는 받는다)
 */
export function starsFor(moves, par) {
  if (moves <= par) return 3;
  if (moves <= Math.ceil(par * TWO_STAR_RATIO)) return 2;
  return 1;
}

/**
 * 한 판 결과를 이전 기록에 합친다.
 * @param old 이전 기록 (없으면 null)
 * @param run { moves, undos, timeMs, par }
 * @returns { record, stars, isNew: { first, moves, time, stars } }
 *   record.bestMoves — 가장 적은 이동 (같으면 되돌리기가 적은 쪽). 그때의 되돌리기·시간을 함께 남긴다
 *   record.bestTime  — 가장 짧은 시간. 그때의 이동·되돌리기를 함께 남긴다
 */
export function mergeRecord(old, run) {
  const stars = starsFor(run.moves, run.par);
  const entry = { moves: run.moves, undos: run.undos, timeMs: run.timeMs };
  if (!old) {
    return {
      record: { clears: 1, stars, par: run.par, bestMoves: entry, bestTime: entry },
      stars,
      isNew: { first: true, moves: false, time: false, stars: false },
    };
  }

  const bm = old.bestMoves;
  const movesBetter = run.moves < bm.moves || (run.moves === bm.moves && run.undos < bm.undos);
  const timeBetter = run.timeMs < old.bestTime.timeMs;
  const starsBetter = stars > old.stars;
  return {
    record: {
      clears: old.clears + 1,
      stars: Math.max(stars, old.stars),
      par: run.par,
      bestMoves: movesBetter ? entry : bm,
      bestTime: timeBetter ? entry : old.bestTime,
    },
    stars,
    isNew: { first: false, moves: movesBetter, time: timeBetter, stars: starsBetter },
  };
}

/** 밀리초 → "m:ss" (한 시간이 넘으면 "h:mm:ss") */
export function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// ── 하드 모드 기록 ──────────────────────────────────────────
// 일반 모드와 따로 저장한다. 단계가 없으므로 '판 하나 = 시도 하나'를 쌓는다.
//
// ★ 첫 수를 두는 순간 시도가 시작된다 (플레이 횟수 +1, 최근 기록에 '진행 중'으로 한 줄).
//   끝날 때 그 줄의 결과를 채운다 — 클리어 / 포기 / 막힘.
//   창을 닫아 끝을 못 적은 줄은 '진행 중'으로 남고, 화면에서는 '중단'으로 보인다.
//   판을 열자마자 나가는 것은 시도로 치지 않는다 (아직 아무것도 안 했다).

export const HARD_RECENT_LIMIT = 10;

/**
 * 하드 모드 규칙 판 — 규칙이 바뀌어 예전 기록과 견줄 수 없게 되면 올린다. 저장된 기록의 판이 다르면 불러올 때 비운다.
 *   1: 25×25 · 안전구역 5×5 · 모든 차를 빼면 클리어
 *   2: 안전구역 7×7 · 차량 200대 · 리무진 2대를 빼면 클리어 · 100점 점수제 (2026-10-12)
 */
export const HARD_RULES_VERSION = 2;
export const HardResult = Object.freeze({ PLAYING: 'playing', CLEAR: 'clear', QUIT: 'quit', STUCK: 'stuck' });

export function emptyHardRecord() {
  return { rules: HARD_RULES_VERSION, plays: 0, clears: 0, bestScore: null, bestTime: null, bestMoves: null, recent: [], nextId: 1 };
}

/**
 * 시도 시작.
 * @returns {{ record, id }} 새 기록과 이 시도의 번호 (끝낼 때 넘긴다)
 */
export function startHardAttempt(record, { seed, at }) {
  const r = record ?? emptyHardRecord();
  const id = r.nextId;
  const entry = { id, seed, result: HardResult.PLAYING, moves: 0, undos: 0, timeMs: 0, score: null, at };
  return {
    record: { ...r, plays: r.plays + 1, nextId: id + 1, recent: [entry, ...r.recent].slice(0, HARD_RECENT_LIMIT) },
    id,
  };
}

const NO_NEW = Object.freeze({ first: false, score: false, time: false, moves: false });

/**
 * 시도 끝. 최근 기록의 그 줄을 채우고, 클리어면 최고 점수·최단 시간·최소 이동을 견준다.
 * ★ 점수는 클리어했을 때만 남긴다 — 포기·막힘은 score가 null이다.
 * 그 줄이 이미 10판 밖으로 밀려났어도 횟수·최고 기록은 반영한다.
 * @param info { id, seed, result, moves, undos, timeMs, score }
 * @returns {{ record, isNew: { first, score, time, moves } }}
 */
export function finishHardAttempt(record, { id, seed: givenSeed, result, moves, undos, timeMs, score }) {
  const r = record ?? emptyHardRecord();
  const target = r.recent.find((e) => e.id === id);
  // ⚠️ 이미 끝난 시도는 다시 끝내지 않는다 — 클리어를 적은 뒤 화면을 떠나며 '포기'로 덮거나, 클리어를 두 번 세는 일을 막는다
  if (target && target.result !== HardResult.PLAYING) return { record: r, isNew: { ...NO_NEW } };
  const seed = givenSeed ?? target?.seed ?? null;
  const cleared = result === HardResult.CLEAR;
  const kept = cleared && Number.isFinite(score) ? score : null;
  const recent = r.recent.map((e) => (e.id === id ? { ...e, result, moves, undos, timeMs, score: kept } : e));
  const isNew = { ...NO_NEW };
  let { clears, bestScore, bestTime, bestMoves } = r;

  if (cleared) {
    isNew.first = clears === 0;
    clears += 1;
    const entry = { score: kept, timeMs, moves, undos, seed };
    if (kept != null && (!bestScore || kept > bestScore.score || (kept === bestScore.score && timeMs < bestScore.timeMs))) {
      isNew.score = !isNew.first;
      bestScore = entry;
    }
    if (!bestTime || timeMs < bestTime.timeMs) {
      isNew.time = !isNew.first;
      bestTime = entry;
    }
    if (!bestMoves || moves < bestMoves.moves || (moves === bestMoves.moves && timeMs < bestMoves.timeMs)) {
      isNew.moves = !isNew.first;
      bestMoves = entry;
    }
  }
  return { record: { ...r, clears, bestScore: bestScore ?? null, bestTime, bestMoves, recent }, isNew };
}
