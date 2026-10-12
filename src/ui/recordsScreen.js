// 기록 화면 — [일반] / [하드] 탭.
//   일반: 단계별 클리어 여부·별점·최소 이동(그때 되돌린 횟수)·최단 시간
//   하드: 플레이·클리어 횟수, 최단 클리어 시간, 최소 이동, 최근 10판 (시드를 누르면 같은 판)
// ⚠️ 휴대폰 폭에서도 별점과 시간이 잘리지 않도록 일반 표는 열을 넷만 둔다 (되돌림 수는 최소 이동 칸에 함께 적는다)

import { LEVELS } from '../core/levels.js';
import { formatTime, HardResult } from '../core/records.js';
import { starText } from './levelSelect.js';

const RESULT_TEXT = {
  [HardResult.CLEAR]: '클리어',
  [HardResult.QUIT]: '포기',
  [HardResult.STUCK]: '막힘',
  [HardResult.PLAYING]: '중단',      // 끝을 적지 못한 판 (창을 닫았다)
};

/**
 * 한 번만 — 탭 전환과 '시드로 다시 하기' 클릭을 건다.
 * @param onPlaySeed 하드 최근 기록의 시드를 눌렀을 때
 */
export function setupRecords(root, { onPlaySeed }) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      root.querySelector(`#${t.getAttribute('aria-controls')}`).hidden = !on;
    }
  };
  for (const t of tabs) t.addEventListener('click', () => select(t));
  // 탭끼리는 화살표로 (탭 목록의 일반적인 키보드 조작)
  root.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    select(next);
    next.focus();
  });
  root.querySelector('#hard-recent-body').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-seed]');
    if (btn) onPlaySeed(btn.dataset.seed);
  });
  return { select: (name) => select(tabs.find((t) => t.dataset.tab === name)) };
}

export function renderRecords(root, save) {
  renderNormal(root, save);
  renderHard(root, save.hard);
}

function renderNormal(root, save) {
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
    th.append(`${n}단계`, small(`${lv.size}×${lv.size}`));

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
      moves.append(small(rec.bestMoves.undos > 0 ? `되돌림 ${rec.bestMoves.undos}회` : '되돌림 없음'));
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

function renderHard(root, hard) {
  const $ = (id) => root.querySelector(`#${id}`);
  $('hard-rec-plays').textContent = `${hard.plays}판`;
  $('hard-rec-clears').textContent = `${hard.clears}판`;
  setBest($('hard-rec-time'), hard.bestTime, (b) => formatTime(b.timeMs));
  setBest($('hard-rec-moves'), hard.bestMoves, (b) => `${b.moves}수`);

  const tbody = $('hard-recent-body');
  tbody.replaceChildren();
  for (const e of hard.recent) {
    const done = e.result !== HardResult.PLAYING;
    const tr = document.createElement('tr');
    tr.className = `r-${e.result}`;

    const seedCell = document.createElement('th');
    seedCell.scope = 'row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seed-btn';
    btn.dataset.seed = e.seed;
    btn.textContent = e.seed;
    btn.setAttribute('aria-label', `시드 ${e.seed} 다시 하기`);
    seedCell.append(btn, small(when(e.at)));

    const result = document.createElement('td');
    result.textContent = RESULT_TEXT[e.result];
    const time = document.createElement('td');
    time.textContent = done ? formatTime(e.timeMs) : '–';
    const moves = document.createElement('td');
    moves.textContent = done ? `${e.moves}수` : '–';
    if (done && e.undos > 0) moves.append(small(`되돌림 ${e.undos}회`));

    tr.append(seedCell, result, time, moves);
    tbody.append(tr);
  }
  $('hard-recent-empty').hidden = hard.recent.length > 0;
}

function setBest(el, best, fmt) {
  el.replaceChildren();
  if (!best) {
    el.textContent = '–';
    return;
  }
  el.append(fmt(best));
  if (best.seed) el.append(small(`시드 ${best.seed}`));
}

function small(text) {
  const s = document.createElement('small');
  s.textContent = text;
  return s;
}

/** 언제 한 판인가 — "10월 12일 14:03" */
function when(at) {
  if (!at) return '';
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${hh}:${mm}`;
}
