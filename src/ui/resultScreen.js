// 결과 화면 — 승차권 모양. 이동·목표·시간·되돌리기, 별점, 최고 기록 갱신 여부.

import { formatTime } from '../core/records.js';

/**
 * @param root data-screen="result"
 * @param info {
 *   kicker, title,
 *   run: { moves, undos, timeMs, par }, stars,
 *   isNew: { first, moves, time, stars } | null   (자유 모드는 null)
 *   nextLabel: 다음 버튼 글자 (없으면 숨김), seed: 자유 모드 시드
 * }
 */
export function renderResult(root, info) {
  const $ = (id) => root.querySelector(`#${id}`);
  const { run } = info;
  $('result-kicker').textContent = info.kicker;
  $('result-title').textContent = info.title;
  $('result-moves').textContent = `${run.moves}수`;
  // 하드 모드는 랜덤 요소 때문에 '목표 이동 수'와 별점이 없다
  $('result-par-row').hidden = run.par == null;
  $('result-par').textContent = run.par == null ? '' : `${run.par}수`;
  $('result-time').textContent = formatTime(run.timeMs);
  $('result-undos').textContent = `${run.undos}회`;

  const stars = $('result-stars');
  stars.replaceChildren();
  stars.hidden = info.stars == null;
  stars.setAttribute('aria-label', `별 ${info.stars}개`);
  for (let k = 0; k < (info.stars == null ? 0 : 3); k++) {
    const s = document.createElement('span');
    s.className = `stamp${k < info.stars ? ' on' : ''}`;
    s.style.setProperty('--d', `${0.25 + k * 0.22}s`);
    s.textContent = '★';
    stars.append(s);
  }

  // 하드 모드 점수 (info.score가 있을 때만) — 별점 자리에 크게
  const scoreEl = $('result-score');
  scoreEl.hidden = info.score == null;
  if (info.score != null) {
    scoreEl.querySelector('strong').textContent = String(info.score);
    scoreEl.querySelector('small').textContent = info.scoreBase ? ` / ${info.scoreBase}` : '';
  }

  const badges = $('result-badges');
  badges.replaceChildren();
  const add = (text, tone = '') => {
    const li = document.createElement('li');
    li.className = `badge ${tone}`;
    li.textContent = text;
    badges.append(li);
  };
  if (run.par != null && run.moves < run.par) add('목표보다 적게 풀었어요!', 'hot');
  else if (run.par != null && run.moves === run.par) add('최소 이동으로 풀었어요', 'hot');
  if (info.isNew) {
    if (info.isNew.first) add('첫 클리어');
    if (info.isNew.moves) add('최소 이동 갱신', 'hot');
    if (info.isNew.time) add('최단 시간 갱신', 'hot');
    if (info.isNew.stars) add('별점 갱신', 'hot');
    if (info.isNew.score) add('최고 점수 갱신', 'hot');
  }
  if (info.seed) add(`시드 ${info.seed}`, 'plain');

  const next = root.querySelector('[data-action="next"]');
  next.hidden = !info.nextLabel;
  next.textContent = info.nextLabel ?? '';
}
