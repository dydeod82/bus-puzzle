// 저장 — localStorage. 해금 단계·단계별 기록·자유 모드 설정·하드 모드 기록(따로), 그리고 만들어 둔 판(캐시).
//
// ⚠️ localStorage는 사생활 보호 모드·저장 공간 꽉 참·itch.io 같은 iframe의 제3자 저장 차단에서
//    읽기·쓰기가 예외를 던질 수 있다. 전부 try/catch로 감싸고, 못 쓰면 이번 방문 동안만 기억한다.
// ⚠️ 저장된 값은 사용자가 손댈 수 있으므로 읽을 때 모양을 다시 확인한다 (깨진 값으로 화면이 멈추지 않게).

import { emptyHardRecord, HardResult, HARD_RECENT_LIMIT, HARD_RULES_VERSION } from '../core/records.js';

const SAVE_KEY = 'bus-puzzle:save:v1';
const CACHE_KEY = 'bus-puzzle:puzzles:v1';
const CACHE_LIMIT = 24;

export const FREE_DEFAULTS = Object.freeze({ size: 10, cars: 12, buses: 5, blocks: 8, seed: '' });

let memoryFallback = null;   // localStorage를 못 쓸 때

function store() {
  try {
    const s = window.localStorage;
    const probe = '__bus_puzzle_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function readJson(key) {
  const s = store();
  if (!s) return memoryFallback?.[key] ?? null;
  try {
    const raw = s.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  const s = store();
  if (!s) {
    memoryFallback ??= {};
    memoryFallback[key] = value;
    return false;
  }
  try {
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const isInt = (v) => Number.isInteger(v);

function cleanRecord(r) {
  if (!r || typeof r !== 'object') return null;
  const entry = (e) => (e && isInt(e.moves) && isInt(e.undos) && Number.isFinite(e.timeMs) ? e : null);
  const bestMoves = entry(r.bestMoves);
  const bestTime = entry(r.bestTime);
  if (!bestMoves || !bestTime || !isInt(r.stars) || !isInt(r.clears)) return null;
  return { clears: r.clears, stars: r.stars, par: isInt(r.par) ? r.par : null, bestMoves, bestTime };
}

const RESULTS = new Set(Object.values(HardResult));

function cleanHardBest(b) {
  return b && Number.isFinite(b.timeMs) && isInt(b.moves)
    ? {
      score: isInt(b.score) ? b.score : null,
      timeMs: b.timeMs,
      moves: b.moves,
      undos: isInt(b.undos) ? b.undos : 0,
      seed: typeof b.seed === 'string' ? b.seed : null,
    }
    : null;
}

/**
 * 하드 모드 기록 — 깨진 값은 버리고 모양을 맞춘다.
 * ★ 규칙 판(rules)이 지금과 다르면 통째로 비운다 — 규칙이 바뀐 뒤의 기록과 견줄 수 없다 (판 번호가 없던 옛 기록도 비운다)
 */
function cleanHard(h) {
  const base = emptyHardRecord();
  if (!h || typeof h !== 'object' || h.rules !== HARD_RULES_VERSION) return base;
  const recent = (Array.isArray(h.recent) ? h.recent : [])
    .filter((e) => e && isInt(e.id) && typeof e.seed === 'string' && RESULTS.has(e.result))
    .slice(0, HARD_RECENT_LIMIT)
    .map((e) => ({
      id: e.id,
      seed: e.seed.slice(0, 40),
      result: e.result,
      moves: isInt(e.moves) ? e.moves : 0,
      undos: isInt(e.undos) ? e.undos : 0,
      timeMs: Number.isFinite(e.timeMs) ? e.timeMs : 0,
      score: e.result === HardResult.CLEAR && isInt(e.score) ? e.score : null,   // 점수는 클리어한 판에만
      at: Number.isFinite(e.at) ? e.at : 0,
    }));
  const maxId = recent.reduce((m, e) => Math.max(m, e.id), 0);
  return {
    rules: HARD_RULES_VERSION,
    plays: isInt(h.plays) ? h.plays : recent.length,
    clears: isInt(h.clears) ? h.clears : 0,
    bestScore: (() => { const x = cleanHardBest(h.bestScore); return x && x.score != null ? x : null; })(),
    bestTime: cleanHardBest(h.bestTime),
    bestMoves: cleanHardBest(h.bestMoves),
    recent,
    nextId: Math.max(isInt(h.nextId) ? h.nextId : 1, maxId + 1),
  };
}

/**
 * @returns {{ unlocked: number, records: Object<string, record>, free: object, hard: object, settings: object }}
 *   settings.hideHardIntro — 하드 모드 시작 안내를 '다음부터 안 보기' 했는가
 *   unlocked — 플레이할 수 있는 가장 높은 단계 (1부터)
 */
export function loadSave(levelCount) {
  const raw = readJson(SAVE_KEY) ?? {};
  const records = {};
  for (const [k, v] of Object.entries(raw.records ?? {})) {
    const r = cleanRecord(v);
    if (r && isInt(Number(k))) records[k] = r;
  }
  const unlocked = Math.min(levelCount, Math.max(1, isInt(raw.unlocked) ? raw.unlocked : 1));
  const free = { ...FREE_DEFAULTS };
  for (const key of ['size', 'cars', 'buses', 'blocks']) if (isInt(raw.free?.[key])) free[key] = raw.free[key];
  if (typeof raw.free?.seed === 'string') free.seed = raw.free.seed.slice(0, 40);
  const settings = { hideHardIntro: raw.settings?.hideHardIntro === true };
  return { unlocked, records, free, hard: cleanHard(raw.hard), settings };
}

export function writeSave(save) {
  return writeJson(SAVE_KEY, {
    version: 1,
    unlocked: save.unlocked,
    records: save.records,
    free: save.free,
    hard: save.hard ?? emptyHardRecord(),
    settings: save.settings ?? { hideHardIntro: false },
  });
}

// ── 만들어 둔 판 ──────────────────────────────────────────
// 같은 설정·시드면 같은 판이 나오지만, 큰 판은 만드는 데 시간이 걸리므로 결과를 기억해 둔다.
// 키에 생성기 버전·설정이 모두 들어 있어 레벨 숫자를 바꾸면 저절로 새로 만든다.

export function readPuzzleCache(key) {
  const cache = readJson(CACHE_KEY);
  const hit = cache?.entries?.[key];
  return hit && hit.def && isInt(hit.par) ? hit : null;
}

export function writePuzzleCache(key, value) {
  const cache = readJson(CACHE_KEY) ?? {};
  const entries = cache.entries ?? {};
  const order = (cache.order ?? []).filter((k) => k !== key && entries[k]);
  entries[key] = value;
  order.push(key);
  while (order.length > CACHE_LIMIT) delete entries[order.shift()];
  writeJson(CACHE_KEY, { entries, order });
}
