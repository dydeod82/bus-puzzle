// 기록 화면 — 단계별 클리어 여부·별점·최소 이동(그때 되돌린 횟수)·최단 시간
// ⚠️ 휴대폰 폭에서도 별점과 시간이 잘리지 않도록 열은 넷만 둔다 (되돌림 수는 최소 이동 칸에 함께 적는다)

import { LEVELS } from '../core/levels.js';
import { formatTime } from '../core/records.js';
import { starText } from './levelSelect.js';

export function renderRecords(root, save) {
  const tbody = root.querySelector('#records-body');
  tbody.replaceChildren();
  let totalStars = 0;
  let cleared = 0;

  LEVELS.forEach((lv, idx) => {
    const n = idx + 1;
    const rec = save.records[n];
    const open = n <= save.unlocked;
    const tr = document.createElement('tr');
    if (!rec) tr.className = open ? 'open' : 'locked';

    const th = document.createElement('th');
    th.scope = 'row';
    th.append(`${n}단계`, Object.assign(document.createElement('small'), { textContent: `${lv.size}×${lv.size}` }));

    const stars = document.createElement('td');
    if (rec) {
      stars.className = `stars-mini s${rec.stars}`;
      stars.textContent = starText(rec.stars);
      stars.setAttribute('aria-label', `클리어, 별 ${rec.stars}개`);
    } else {
      stars.textContent = open ? '도전 중' : '잠김';
    }

    const moves = document.createElement('td');
    if (rec) {
      moves.append(`${rec.bestMoves.moves}수`);
      const note = document.createElement('small');
      note.textContent = rec.bestMoves.undos > 0 ? `되돌림 ${rec.bestMoves.undos}회` : '되돌림 없음';
      moves.append(note);
    } else {
      moves.textContent = '–';
    }

    const time = document.createElement('td');
    time.textContent = rec ? formatTime(rec.bestTime.timeMs) : '–';

    tr.append(th, stars, moves, time);
    tbody.append(tr);
    if (rec) {
      totalStars += rec.stars;
      cleared++;
    }
  });

  root.querySelector('#records-summary').textContent =
    `클리어 ${cleared} / ${LEVELS.length} · 별 ${totalStars} / ${LEVELS.length * 3}`;
}
