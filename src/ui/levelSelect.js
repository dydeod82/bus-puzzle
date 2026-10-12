// 단계 선택 — 버스 노선도처럼 정류장(단계)을 한 줄로 잇는다. 이전 단계를 깨야 다음 정류장이 열린다.

import { LEVELS } from '../core/levels.js';
import { formatTime } from '../core/records.js';

export function starText(n) {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

/**
 * @param listEl <ol> 요소
 * @param save   loadSave() 결과
 * @param onPick 단계 번호를 받는 함수
 */
export function renderLevelSelect(listEl, save, onPick) {
  listEl.replaceChildren();
  LEVELS.forEach((lv, idx) => {
    const n = idx + 1;
    const rec = save.records[n];
    const unlocked = n <= save.unlocked;
    const current = unlocked && !rec;

    const li = document.createElement('li');
    li.className = `stop${rec ? ' cleared' : ''}${current ? ' current' : ''}${unlocked ? '' : ' locked'}`;
    li.style.setProperty('--i', idx);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stop-btn';
    btn.disabled = !unlocked;
    btn.addEventListener('click', () => onPick(n));

    const num = el('span', 'stop-num', String(n));
    const body = el('span', 'stop-body');
    const name = el('span', 'stop-name', `${n}단계`);
    name.append(el('small', '', ` ${lv.size}×${lv.size}`));
    body.append(name, el('span', 'stop-meta', `자동차 ${lv.cars} · 버스 ${lv.buses} · 구조물 ${lv.blocks}`));
    if (rec) {
      body.append(el('span', 'stop-best', `최소 ${rec.bestMoves.moves}수 · ${formatTime(rec.bestTime.timeMs)}`));
    }

    const score = el('span', 'stop-score');
    if (rec) {
      score.append(el('span', `stars-mini s${rec.stars}`, starText(rec.stars)));
    } else if (!unlocked) {
      score.append(el('span', 'lock', ''));
    } else {
      score.append(el('span', 'next-tag', '출발'));
    }

    btn.append(num, body, score);
    btn.setAttribute(
      'aria-label',
      `${n}단계, ${lv.size}×${lv.size}` + (rec ? `, 별 ${rec.stars}개` : unlocked ? ', 아직 안 깸' : ', 잠김'),
    );
    li.append(btn);
    listEl.append(li);
  });
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}
