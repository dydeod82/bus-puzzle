// 글자 그림 ↔ 판 정의. 테스트와 손으로 만드는 판, 디버그 출력에 쓴다.
//
//   .   빈칸
//   #   고정 구조물
//   영문자 — 같은 글자끼리 한 차량. 2칸 = 자동차, 3칸 = 버스.
//            대문자 칸이 앞쪽(머리)이다.  aA = 오른쪽을 보는 자동차,  Bbb = 왼쪽을 보는 버스
//   칸 사이 공백은 무시한다.
//
// 예)  . . . . . .
//      a A . . # .
//      . . . c . .
//      . . . C . .     ← c 위, C 아래 = 아래를 보는 세로 자동차
//
// 차량 번호는 글자 순서다(a가 0번). 그래서 테스트에서 글자로 차량을 가리킬 수 있다.

export function parseTextBoard(text) {
  const rows = text.split('\n').map((r) => r.replace(/\s+/g, '')).filter((r) => r.length > 0);
  const size = rows.length;
  rows.forEach((r, y) => {
    if (r.length !== size) {
      throw new Error(`${y}번째 줄의 칸 수가 ${r.length}입니다 — 정사각형 판이라 ${size}여야 합니다`);
    }
  });

  const blocks = [];
  const groups = new Map();   // 소문자 글자 → { cells, heads }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      if (ch === '#') {
        blocks.push([x, y]);
        continue;
      }
      if (!/[a-zA-Z]/.test(ch)) throw new Error(`알 수 없는 글자 '${ch}' (${x}, ${y})`);
      const key = ch.toLowerCase();
      if (!groups.has(key)) groups.set(key, { cells: [], heads: [] });
      const g = groups.get(key);
      g.cells.push({ x, y });
      if (ch !== key) g.heads.push({ x, y });
    }
  }

  const vehicles = [...groups.keys()].sort().map((label) => toVehicle(label, groups.get(label)));
  return { size, blocks, vehicles };
}

function toVehicle(label, { cells, heads }) {
  const len = cells.length;
  const kind = len === 2 ? 'car' : len === 3 ? 'bus' : null;
  if (!kind) throw new Error(`차량 '${label}'이 ${len}칸입니다 — 자동차 2칸, 버스 3칸만 있습니다`);

  const sameRow = cells.every((c) => c.y === cells[0].y);
  const sameCol = cells.every((c) => c.x === cells[0].x);
  if (!sameRow && !sameCol) throw new Error(`차량 '${label}'이 한 줄로 놓여 있지 않습니다`);
  const axis = sameRow ? 'h' : 'v';

  const coords = cells.map((c) => (axis === 'h' ? c.x : c.y)).sort((a, b) => a - b);
  for (let k = 1; k < len; k++) {
    if (coords[k] !== coords[0] + k) throw new Error(`차량 '${label}'의 칸이 이어져 있지 않습니다`);
  }

  if (heads.length !== 1) {
    throw new Error(`차량 '${label}'의 앞쪽(대문자)은 정확히 한 칸이어야 합니다 (지금 ${heads.length}칸)`);
  }
  const h = axis === 'h' ? heads[0].x : heads[0].y;
  const min = coords[0];
  const max = coords[len - 1];
  if (h !== min && h !== max) throw new Error(`차량 '${label}'의 앞쪽(대문자)이 끝 칸에 있지 않습니다`);

  const front = axis === 'h' ? (h === max ? 'right' : 'left') : (h === max ? 'down' : 'up');
  const x = axis === 'h' ? min : cells[0].x;
  const y = axis === 'h' ? cells[0].y : min;
  return { kind, x, y, front, label };
}

/**
 * 퍼즐 + 위치 → 글자 그림. 이름(label)이 없는 차량은 번호 순으로 a, b, c…를 붙인다.
 * 26대를 넘으면 글자가 겹친다 — 디버그 출력용이라 그대로 둔다.
 */
export function toTextBoard(puzzle, pos) {
  const { size } = puzzle;
  const rows = Array.from({ length: size }, () => Array(size).fill('.'));
  for (const b of puzzle.blocks) rows[b.y][b.x] = '#';
  puzzle.vehicles.forEach((v, i) => {
    const p = pos[i];
    if (p < 0) return;
    const label = v.label ?? String.fromCharCode(97 + (i % 26));
    for (let k = 0; k < v.len; k++) {
      const isHead = v.front > 0 ? k === v.len - 1 : k === 0;
      const ch = isHead ? label.toUpperCase() : label;
      if (v.axis === 'h') rows[v.lane][p + k] = ch;
      else rows[p + k][v.lane] = ch;
    }
  });
  return rows.map((r) => r.join(' ')).join('\n');
}
