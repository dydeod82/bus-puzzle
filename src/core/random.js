// 시드 기반 난수. 같은 시드면 어느 브라우저·어느 컴퓨터에서든 같은 수열이 나온다.
// Math.random은 시드를 줄 수 없어 쓰지 않는다. 정수 연산(Math.imul, >>>)만 쓰므로 엔진마다 결과가 같다.

/** 문자열·숫자 시드 → 32비트 정수 (xmur3) */
export function hashSeed(seed) {
  const s = String(seed);
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 시드로 난수 발생기를 만든다 (sfc32) */
export function createRng(seed) {
  let a = hashSeed(`${seed}:a`);
  let b = hashSeed(`${seed}:b`);
  let c = hashSeed(`${seed}:c`);
  let d = hashSeed(`${seed}:d`);

  function next() {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
  // 처음 몇 개는 시드 티가 나므로 버린다
  for (let i = 0; i < 12; i++) next();

  return {
    next,
    /** 0 이상 n 미만 정수 */
    int(n) {
      return Math.floor(next() * n);
    },
    /** lo 이상 hi 이하 정수 */
    range(lo, hi) {
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    chance(p) {
      return next() < p;
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    /** 제자리 섞기 (Fisher–Yates) */
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
  };
}

/** 사람이 읽고 옮겨 적기 쉬운 무작위 시드 (자유 모드의 '무작위' 버튼용) */
export function randomSeedString() {
  const n = Math.floor(Math.random() * 1e9);
  return n.toString(36).toUpperCase().padStart(6, '0');
}
