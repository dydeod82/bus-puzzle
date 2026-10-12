// 시작점 — 화면들을 잇고, 한 판을 시작·마무리하고, 기록을 저장한다.

import { LEVELS, LEVEL_COUNT, HARD_MODE, freeModeParams } from './core/levels.js';
import { describeHardScore } from './core/hardMode.js';
import { createPuzzle } from './core/rules.js';
import { mergeRecord, starsFor, startHardAttempt, finishHardAttempt, HardResult } from './core/records.js';
import { randomSeedString } from './core/random.js';
import { loadSave, writeSave } from './storage/save.js';
import { loadPuzzle, loadHardPuzzle } from './ui/puzzleLoader.js';
import { Screens } from './ui/screens.js';
import { GameScreen } from './ui/gameScreen.js';
import { HardScreen } from './ui/hardScreen.js';
import { renderLevelSelect } from './ui/levelSelect.js';
import { renderResult } from './ui/resultScreen.js';
import { renderRecords, setupRecords } from './ui/recordsScreen.js';
import { FreeModeScreen } from './ui/freeMode.js';
import { RulesDialog } from './ui/rulesDialog.js';

document.getElementById('boot-fallback')?.remove();

const save = loadSave(LEVEL_COUNT);
const app = document.getElementById('app');
const screens = new Screens(app);

/** 지금 하는 판 — { mode: 'level' | 'free' | 'hard', level, settings, seed, data, title, subtitle } */
let play = null;
let loadToken = 0;

const freeUnlocked = () => Boolean(save.records[LEVEL_COUNT]);

const rules = new RulesDialog(document.getElementById('rules'));
document.getElementById('rules-hard-score').textContent = describeHardScore(HARD_MODE.score);

// 하드 모드 안내문 — 시작 안내 창과 규칙 창이 같은 글을 쓴다 (한 곳에서만 고치면 되도록 template 하나에서 복제)
const guideTpl = document.getElementById('hard-guide-tpl');
for (const slot of document.querySelectorAll('[data-hard-guide]')) slot.replaceChildren(guideTpl.content.cloneNode(true));

const intro = document.getElementById('hard-intro');
intro.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="intro-close"]')) intro.close();
});
// '다음부터 안 보기'는 체크하는 순간 저장한다.
// ⚠️ 창의 close 이벤트에 기대지 말 것 — 브라우저에 따라 close 이벤트가 화면을 다시 그릴 때까지 미뤄진다 (뒤에 깔린 탭에서 실제로 안 왔다)
document.getElementById('hard-intro-hide').addEventListener('change', (e) => {
  save.settings.hideHardIntro = e.target.checked;
  writeSave(save);
});
intro.addEventListener('close', () => hard.canvas.focus({ preventScroll: true }));

/** 하드 모드에 들어올 때의 안내 — '다음부터 안 보기'를 고르기 전까지 매번 */
function showHardIntro() {
  if (save.settings.hideHardIntro || intro.open) return;
  document.getElementById('hard-intro-hide').checked = false;
  intro.showModal();
}

const game = new GameScreen(screens.el('game'), {
  onClear: (run) => finishPlay(run),
  onExit: () => screens.show(play?.mode === 'free' ? 'free' : 'levels'),
  onRules: () => rules.open(),
});

const hard = new HardScreen(screens.el('hard'), {
  onClear: (run) => finishHard(run),
  onExit: () => screens.show('title'),
  onRules: () => rules.open(),
  onNewBoard: () => playHard(randomSeedString()),
  onSeed: (seed) => playHard(seed),
  // 하드 모드 기록 — 일반 모드와 따로 (save.hard)
  onAttemptStart: ({ seed }) => {
    const r = startHardAttempt(save.hard, { seed, at: Date.now() });
    save.hard = r.record;
    writeSave(save);
    return r.id;
  },
  onAttemptEnd: (info) => {
    save.hard = finishHardAttempt(save.hard, info).record;
    writeSave(save);
  },
});

const recordsUi = setupRecords(screens.el('records'), { onPlaySeed: (seed) => playHard(seed, { entering: true }) });

const free = new FreeModeScreen(screens.el('free'), {
  onChange: (s) => {
    save.free = s;
    writeSave(save);
  },
  onPlay: (s) => playFree(s),
});

screens.on('title', { show: updateTitle });
screens.on('levels', { show: () => renderLevelSelect(document.getElementById('route'), save, playLevel) });
screens.on('records', { show: (tab = 'normal') => {
  renderRecords(screens.el('records'), save);
  recordsUi.select(tab);
} });
screens.on('free', { show: () => free.load(save.free) });
screens.on('game', { hide: () => game.stop() });
screens.on('hard', { hide: () => hard.stop() });

// ── 버튼 ────────────────────────────────────────────────

app.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  switch (btn.dataset.action) {
    case 'start': screens.show('levels'); break;
    case 'hard': playHard(randomSeedString(), { entering: true }); break;
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

/**
 * 하드 모드 — 시작할 때마다 새 시드 (시드를 넣으면 그 판). 바깥(시작 화면·기록)에서 들어올 때만 안내를 띄운다 (entering).
 * ⚠️ 판은 generateHardPuzzle(테스트)과 같은 생성기·같은 시드로 만든다 — 다르면 같은 시드라도 Node(테스트)와 화면의 판이 갈린다
 */
async function playHard(seed, { entering = false } = {}) {
  const token = ++loadToken;
  play = { mode: 'hard', seed };
  screens.show('hard');
  hard.showLoading(seed);
  if (entering) showHardIntro();   // 판을 만드는 동안 안내를 읽는다
  try {
    const data = await loadHardPuzzle(seed, HARD_MODE);
    if (token !== loadToken || screens.current !== 'hard') return;
    play.data = data;
    hard.start({ puzzle: createPuzzle(data.def), seed, config: HARD_MODE });
  } catch (err) {
    if (token !== loadToken || screens.current !== 'hard') return;
    hard.showError(err?.message ?? '판을 만들지 못했어요.');
  }
}

function finishHard(run) {
  const r = finishHardAttempt(save.hard, {
    id: run.attemptId, seed: run.seed, result: HardResult.CLEAR, moves: run.moves, undos: run.undos, timeMs: run.timeMs, score: run.score,
  });
  save.hard = r.record;
  writeSave(save);
  renderResult(screens.el('result'), {
    kicker: '하드 모드 클리어',
    title: `시드 ${run.seed}`,
    run: { ...run, par: null },
    stars: null,
    score: run.score,
    scoreBase: HARD_MODE.score.base,
    isNew: { first: r.isNew.first, score: r.isNew.score, moves: r.isNew.moves, time: r.isNew.time, stars: false },
    nextLabel: '새 판',
  });
  screens.show('result');
}

function begin() {
  game.start({ puzzle: createPuzzle(play.data.def), par: play.data.par, title: play.title, subtitle: play.subtitle });
}

function replay() {
  if (play?.mode === 'hard') {
    playHard(play.seed);   // 같은 시드 — 만들어 둔 판을 기억하고 있어 바로 열린다
    return;
  }
  if (!play?.data) return;
  screens.show('game');
  begin();
}

function next() {
  if (play?.mode === 'level') {
    if (play.level < LEVEL_COUNT) playLevel(play.level + 1);
    else screens.show('free');
  } else if (play?.mode === 'hard') {
    playHard(randomSeedString());
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

// 이 PC에서 열었을 때만 — 브라우저 콘솔에서 상태를 들여다보는 손잡이 (배포한 페이지에는 생기지 않는다)
if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__busPuzzle = { screens, game, hard, save };

screens.show('title');
