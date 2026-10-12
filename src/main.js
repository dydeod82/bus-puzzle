// 시작점 — 화면들을 잇고, 한 판을 시작·마무리하고, 기록을 저장한다.

import { LEVELS, LEVEL_COUNT, freeModeParams } from './core/levels.js';
import { createPuzzle } from './core/rules.js';
import { mergeRecord, starsFor } from './core/records.js';
import { randomSeedString } from './core/random.js';
import { loadSave, writeSave } from './storage/save.js';
import { loadPuzzle } from './ui/puzzleLoader.js';
import { Screens } from './ui/screens.js';
import { GameScreen } from './ui/gameScreen.js';
import { renderLevelSelect } from './ui/levelSelect.js';
import { renderResult } from './ui/resultScreen.js';
import { renderRecords } from './ui/recordsScreen.js';
import { FreeModeScreen } from './ui/freeMode.js';
import { RulesDialog } from './ui/rulesDialog.js';

document.getElementById('boot-fallback')?.remove();

const save = loadSave(LEVEL_COUNT);
const app = document.getElementById('app');
const screens = new Screens(app);

/** 지금 하는 판 — { mode: 'level' | 'free', level, settings, seed, data, title, subtitle } */
let play = null;
let loadToken = 0;

const freeUnlocked = () => Boolean(save.records[LEVEL_COUNT]);

const rules = new RulesDialog(document.getElementById('rules'));

const game = new GameScreen(screens.el('game'), {
  onClear: (run) => finishPlay(run),
  onExit: () => screens.show(play?.mode === 'free' ? 'free' : 'levels'),
  onRules: () => rules.open(),
});

const free = new FreeModeScreen(screens.el('free'), {
  onChange: (s) => {
    save.free = s;
    writeSave(save);
  },
  onPlay: (s) => playFree(s),
});

screens.on('title', { show: updateTitle });
screens.on('levels', { show: () => renderLevelSelect(document.getElementById('route'), save, playLevel) });
screens.on('records', { show: () => renderRecords(screens.el('records'), save) });
screens.on('free', { show: () => free.load(save.free) });
screens.on('game', { hide: () => game.stop() });

// ── 버튼 ────────────────────────────────────────────────

app.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  switch (btn.dataset.action) {
    case 'start': screens.show('levels'); break;
    case 'records': screens.show('records'); break;
    case 'free': if (freeUnlocked()) screens.show('free'); break;
    case 'rules-open': rules.open(); break;
    case 'home': screens.show('title'); break;
    case 'retry': replay(); break;
    case 'next': next(); break;
    default: break;
  }
});

// 메뉴 화면에서 Esc = 뒤로
// ⚠️ 플레이 화면의 Esc(나가기)가 같은 키 입력으로 '단계 선택'에 온 직후 여기서 또 처리되면 메인까지 두 칸을 간다.
//    입력 처리가 먼저 preventDefault 해 두므로 그것을 보고 건너뛴다.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return;
  if (['levels', 'records', 'free', 'result'].includes(screens.current)) {
    e.preventDefault();
    screens.show('title');
  }
});

// ── 흐름 ────────────────────────────────────────────────

function updateTitle() {
  const btn = document.getElementById('btn-free');
  const open = freeUnlocked();
  btn.disabled = !open;
  btn.querySelector('.btn-note').textContent = open ? '' : '10단계를 깨면 열려요';
  const stars = Object.values(save.records).reduce((s, r) => s + r.stars, 0);
  const cleared = Object.keys(save.records).length;
  document.getElementById('title-progress').textContent = cleared === 0
    ? '1단계부터 출발해요'
    : `${cleared}개 노선 완주 · 별 ${stars} / ${LEVEL_COUNT * 3}`;
}

function playLevel(n) {
  const lv = LEVELS[n - 1];
  play = { mode: 'level', level: n };
  startPuzzle(lv, lv.seed, `${n}단계`, (data) => `목표 ${data.par}수 · ${lv.size}×${lv.size}`);
}

function playFree(settings) {
  const seed = settings.seed || randomSeedString();
  play = { mode: 'free', settings: { ...settings, seed }, seed };
  startPuzzle(freeModeParams(settings), seed, '자유 모드', (data) => `목표 ${data.par}수 · 시드 ${seed}`);
}

async function startPuzzle(params, seed, title, subtitleOf) {
  const token = ++loadToken;
  screens.show('game');
  game.showLoading(title, '판을 준비하는 중…');
  try {
    const data = await loadPuzzle(params, seed);
    if (token !== loadToken || screens.current !== 'game') return;   // 기다리는 사이 다른 화면으로 갔다
    play.data = data;
    play.title = title;
    play.subtitle = subtitleOf(data);
    begin();
  } catch (err) {
    if (token !== loadToken || screens.current !== 'game') return;
    game.showError(err?.message ?? '판을 만들지 못했어요.');
  }
}

function begin() {
  game.start({ puzzle: createPuzzle(play.data.def), par: play.data.par, title: play.title, subtitle: play.subtitle });
}

function replay() {
  if (!play?.data) return;
  screens.show('game');
  begin();
}

function next() {
  if (play?.mode === 'level') {
    if (play.level < LEVEL_COUNT) playLevel(play.level + 1);
    else screens.show('free');
  } else if (play?.mode === 'free') {
    const settings = { ...play.settings, seed: randomSeedString() };
    save.free = settings;
    writeSave(save);
    playFree(settings);
  }
}

function finishPlay(run) {
  const resultEl = screens.el('result');
  if (play.mode === 'level') {
    const n = play.level;
    const merged = mergeRecord(save.records[n] ?? null, run);
    save.records[n] = merged.record;
    if (n === save.unlocked && n < LEVEL_COUNT) save.unlocked = n + 1;
    writeSave(save);
    const openedFree = n === LEVEL_COUNT && merged.isNew.first;
    renderResult(resultEl, {
      kicker: openedFree ? '전 노선 완주 · 자유 모드가 열렸어요' : '운행 완료',
      title: `${n}단계`,
      run,
      stars: merged.stars,
      isNew: merged.isNew,
      nextLabel: n < LEVEL_COUNT ? '다음 단계' : '자유 모드',
    });
  } else {
    const { size } = play.settings;
    renderResult(resultEl, {
      kicker: '자유 운행 완료',
      title: `${size}×${size}`,
      run,
      stars: starsFor(run.moves, run.par),
      isNew: null,
      nextLabel: '새 판',
      seed: play.seed,
    });
  }
  screens.show('result');
}

screens.show('title');
