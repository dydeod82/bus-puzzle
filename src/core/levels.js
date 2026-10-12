// 1~10단계 설정. 숫자만 바꿔 난이도를 조정한다 — 판은 이 값과 고정 시드로 매번 똑같이 다시 만들어진다.
//
//   size        판 크기 (size × size)
//   cars, buses 자동차(2칸)·버스(3칸) 수
//   blocks      고정 구조물 수 (고리 하나에 구조물이 2~4개 든다)
//   minSlides   정답 수순에 '다른 차를 먼저 밀어 두기'가 최소 몇 번 들어가야 하는가 — 높을수록 어렵다.
//               이만큼의 '고리'(서로의 앞을 막은 차 4대)를 판에 끼워 넣는다
//   maxSlides   그 상한
//   maxExitable 시작하자마자 바로 나갈 수 있는 차량 수 상한 — 낮을수록 첫 수를 고민하게 된다
//   seed        고정 시드. 바꾸면 같은 난이도의 다른 판이 나온다
//
// ⚠️ 값을 바꾸면 `node tools/levels-report.js`로 10단계가 모두 조건을 맞추는지 확인할 것.
//    못 맞추면 가장 가까운 판이 나오고 보고서에 '조건 미달'로 표시된다.

export const LEVELS = [
  { size: 6, cars: 4, buses: 1, blocks: 1, minSlides: 0, maxSlides: 0, maxExitable: 2, seed: 'L01' },
  { size: 7, cars: 6, buses: 2, blocks: 2, minSlides: 0, maxSlides: 0, maxExitable: 3, seed: 'L02' },
  { size: 8, cars: 8, buses: 3, blocks: 5, minSlides: 1, maxSlides: 1, maxExitable: 3, seed: 'L03' },
  { size: 9, cars: 10, buses: 4, blocks: 6, minSlides: 1, maxSlides: 2, maxExitable: 3, seed: 'L04' },
  { size: 10, cars: 12, buses: 5, blocks: 9, minSlides: 2, maxSlides: 2, maxExitable: 4, seed: 'L05' },
  { size: 10, cars: 14, buses: 6, blocks: 10, minSlides: 2, maxSlides: 3, maxExitable: 4, seed: 'L06' },
  { size: 11, cars: 16, buses: 7, blocks: 13, minSlides: 3, maxSlides: 3, maxExitable: 5, seed: 'L07' },
  { size: 12, cars: 18, buses: 9, blocks: 14, minSlides: 3, maxSlides: 4, maxExitable: 5, seed: 'L08' },
  { size: 13, cars: 21, buses: 10, blocks: 17, minSlides: 4, maxSlides: 4, maxExitable: 6, seed: 'L09' },
  { size: 14, cars: 24, buses: 12, blocks: 19, minSlides: 4, maxSlides: 5, maxExitable: 6, seed: 'L10' },
];

export const LEVEL_COUNT = LEVELS.length;

// ── 자유 모드 ──────────────────────────────────────────────
// 슬라이더 범위와, 고른 숫자로 생성기 설정을 만드는 규칙. 판 크기에 따라 넣을 수 있는 수가 달라진다.

export const FREE_SIZE_MIN = 6;
export const FREE_SIZE_MAX = 14;
/** 차량·구조물이 칸을 이 비율보다 많이 채우면 판을 만들지 않는다 (빽빽하면 들여보낼 길이 없다) */
export const FREE_MAX_FILL = 0.62;

export function freeLimits(size) {
  const cells = size * size;
  return {
    cars: { min: 1, max: Math.floor(cells * 0.3) },
    buses: { min: 0, max: Math.floor(cells * 0.12) },
    blocks: { min: 0, max: Math.floor(cells * 0.16) },
  };
}

/** 칸 채움 비율 */
export function freeFill({ size, cars, buses, blocks }) {
  return (cars * 2 + buses * 3 + blocks) / (size * size);
}

/**
 * 자유 모드 설정 → 생성기 설정.
 * '밀어 두기'가 필요한 고리 수는 따로 고르지 않고 차량·구조물 수에서 정한다
 * (고리 하나에 차 4대·구조물 2~4개가 든다 — 구조물 3개·차 7대마다 하나, 최대 4개).
 */
export function freeModeParams({ size, cars, buses, blocks }) {
  const loops = Math.max(0, Math.min(4, Math.floor(blocks / 3), Math.floor((cars + buses) / 7)));
  return {
    size,
    cars,
    buses,
    blocks,
    minSlides: loops,
    maxSlides: loops + 1,
    maxExitable: Math.max(2, Math.round((cars + buses) * 0.18)),
  };
}

/** 설정이 판을 만들 수 있는 범위인가 — 문제가 있으면 그 이유(한국어), 없으면 null */
export function freeSettingsProblem(s) {
  if (s.cars + s.buses < 2) return '차량이 2대 이상 있어야 해요.';
  if (freeFill(s) > FREE_MAX_FILL) return '판이 너무 빽빽해요. 차량이나 구조물을 줄여 주세요.';
  return null;
}

// ── 하드 모드 ──────────────────────────────────────────────
// 숫자만 바꿔 조정한다. 판은 시작할 때마다 새 시드로 만든다.
//
//   size, safeSize  판 크기와 정중앙 안전구역 크기 — (size − safeSize)가 짝수여야 가운데에 놓인다 (25 = 9 + 7 + 9)
//   startVehicles   시작 차량 수 (리무진 제외, 안전구역 안의 차 포함), busRatio 그중 버스 비율
//                   (새로 도착하는 차량의 종류도 이 비율로 뽑는다)
//   limos           안전구역 안에 놓는 리무진 수 — 모두 판 밖으로 빼면 클리어. 판 생성기는 2대(가로 하나·세로 하나)만 짓는다
//   blocks          고정 구조물 수 — 변화구역 곳곳에 차와 섞어 흩는다. 리무진 차선에는 놓지 않는다
//   safeBlocks      안전구역 안에 따로 놓는 구조물 수 (blocks와 별개). 리무진 차선에는 놓지 않는다
//   safeCars        안전구역 안에 놓는 일반 차 수 [최소, 최대] — 리무진이 안전구역을 빠져나가는 길 위에 놓는다
//   safeBusMax      그중 버스 최대 수
//   safeLeave       리무진마다 '안전구역을 벗어나는 최소 수'가 이 범위여야 한다 (판 생성기가 배치를 다시 뽑아 맞춘다)
//   randomMin/Max   한 턴에 변화구역에서 저절로 움직이는 차량 수 범위 (리무진은 제외)
//   spawnDelay      탈출이 생긴 뒤 새 차량이 도착하기까지의 턴 수
//
// 2026-10-12: 차량·구조물 두 배 (50 → 100, 30 → 60) → 하드 모드 개편 (안전구역 7×7, 차량 200, 리무진 2대)
//             → 차량 절반(100), 구조물을 차와 섞어 흩기 → 안전구역 구조물 6 + 안전구역 차 3~4대 (전용 생성기 hardGenerator.js)

export const HARD_MODE = Object.freeze({
  size: 25,
  safeSize: 7,
  startVehicles: 100,
  busRatio: 0.3,
  limos: 2,
  blocks: 60,
  safeBlocks: 6,
  safeCars: Object.freeze([3, 4]),
  safeBusMax: 1,
  safeLeave: Object.freeze([3, 5]),
  randomMin: 1,
  randomMax: 4,
  spawnDelay: 3,
  // 점수 (클리어했을 때만) — base에서 이동 횟수만큼 깎는다. 구간마다 '몇 번 움직이면 1점'이 다르다.
  //   tiers: upTo번째 이동까지는 movesPerPoint회당 1점 (upTo: null = 끝까지). 소수점은 마지막에 버린다
  //   예) 30회 → 70점, 50회 → 55점, 70회 → 45점, 100회 → 35점
  score: Object.freeze({
    base: 100,
    min: 10,
    tiers: Object.freeze([
      Object.freeze({ upTo: 40, movesPerPoint: 1 }),
      Object.freeze({ upTo: 70, movesPerPoint: 2 }),
      Object.freeze({ upTo: null, movesPerPoint: 3 }),
    ]),
  }),
});
