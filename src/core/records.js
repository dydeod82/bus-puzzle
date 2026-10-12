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
