// 판 불러오기 — 기억해 둔 판이 있으면 바로, 없으면 생성기를 돌린다.
//
// ★ 생성은 Web Worker에서 돈다. 모듈 워커를 못 쓰는 환경(오래된 브라우저 등)이면
//   조용히 화면 스레드에서 돌린다 — 잠깐 멈출 뿐 결과는 같다(같은 시드 → 같은 판).

import { normalizeParams, GENERATOR_VERSION } from '../core/generator.js';
import { HARD_GENERATOR_VERSION } from '../core/hardGenerator.js';
import { runJob } from './puzzleJobs.js';
import { readPuzzleCache, writePuzzleCache } from '../storage/save.js';

const memory = new Map();
let worker = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map();

class WorkerUnavailable extends Error {}

function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('../workers/generator.worker.js', import.meta.url), { type: 'module' });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.onmessage = (e) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    pending.delete(e.data.id);
    if (e.data.ok) job.resolve(e.data.result);
    else job.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    // 워커 자체가 못 뜬 경우(모듈 워커 미지원 등) — 기다리던 일은 화면 스레드로 넘긴다
    e.preventDefault?.();
    workerBroken = true;
    worker.terminate();
    worker = null;
    for (const job of pending.values()) job.reject(new WorkerUnavailable());
    pending.clear();
  };
  return worker;
}

function viaWorker(kind, params, seed) {
  const w = getWorker();
  if (!w) return Promise.reject(new WorkerUnavailable());
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, kind, params, seed });
  });
}

async function viaMainThread(kind, params, seed) {
  await new Promise((r) => setTimeout(r, 30));   // '불러오는 중'이 먼저 그려지도록
  return runJob(kind, params, seed);
}

export function cacheKey(params, seed) {
  const p = normalizeParams(params);
  delete p.seed;
  return `${GENERATOR_VERSION}|${seed}|${JSON.stringify(p)}`;
}

/**
 * @returns Promise<{ def, par, slides, optimal }>
 * 조건이 너무 빽빽해 판을 못 만들면 Error로 거부된다 (메시지를 그대로 화면에 보여 줘도 된다).
 */
export function loadPuzzle(params, seed) {
  return load(cacheKey(params, seed), 'level', params, seed);
}

/**
 * 하드 모드 판 — 시드는 사람이 보는 시드 그대로 넘긴다 (생성기가 안에서 `hard:${seed}`로 난수를 만든다).
 * 점수 설정은 판과 무관하므로 캐시 키에서 뺀다 (점수 규칙만 바꿨는데 기억해 둔 판이 모두 버려지지 않게).
 * @returns Promise<{ def, par }>
 */
export function loadHardPuzzle(seed, config) {
  const { score, ...board } = config;
  return load(`hard|${HARD_GENERATOR_VERSION}|${seed}|${JSON.stringify(board)}`, 'hard', config, seed);
}

async function load(key, kind, params, seed) {
  const hit = memory.get(key) ?? readPuzzleCache(key);
  if (hit) {
    memory.set(key, hit);
    return hit;
  }

  let result;
  try {
    result = await viaWorker(kind, params, seed);
  } catch (err) {
    if (!(err instanceof WorkerUnavailable)) throw err;
    result = await viaMainThread(kind, params, seed);
  }
  memory.set(key, result);
  writePuzzleCache(key, result);
  return result;
}
