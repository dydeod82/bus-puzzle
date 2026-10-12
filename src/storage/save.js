// 저장 — localStorage. 해금 단계·단계별 기록·자유 모드 설정, 그리고 만들어 둔 판(캐시).
//
// ⚠️ localStorage는 사생활 보호 모드·저장 공간 꽉 참·itch.io 같은 iframe의 제3자 저장 차단에서
//    읽기·쓰기가 예외를 던질 수 있다. 전부 try/catch로 감싸고, 못 쓰면 이번 방문 동안만 기억한다.
// ⚠️ 저장된 값은 사용자가 손댈 수 있으므로 읽을 때 모양을 다시 확인한다 (깨진 값으로 화면이 멈추지 않게).

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

/**
 * @returns {{ unlocked: number, records: Object<string, record>, free: object }}
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
  return { unlocked, records, free };
}

export function writeSave(save) {
  return writeJson(SAVE_KEY, { version: 1, unlocked: save.unlocked, records: save.records, free: save.free });
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
