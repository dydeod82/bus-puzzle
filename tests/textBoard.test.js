import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseTextBoard, toTextBoard } from '../src/core/textBoard.js';
import { createPuzzle } from '../src/core/rules.js';

test('글자 그림: 대문자가 앞쪽, 칸 수로 자동차·버스를 가른다', () => {
  const def = parseTextBoard(`
    a A . B b
    c . . . .
    C . # . .
    . . . . e
    d d D . E
  `);
  assert.equal(def.size, 5);
  assert.deepEqual(def.blocks, [[2, 2]]);
  assert.deepEqual(def.vehicles, [
    { kind: 'car', x: 0, y: 0, front: 'right', label: 'a' },
    { kind: 'car', x: 3, y: 0, front: 'left', label: 'b' },
    { kind: 'car', x: 0, y: 1, front: 'down', label: 'c' },
    { kind: 'bus', x: 0, y: 4, front: 'right', label: 'd' },
    { kind: 'car', x: 4, y: 3, front: 'down', label: 'e' },
  ]);
});

test('글자 그림: 위를 보는 세로 버스', () => {
  const def = parseTextBoard(`
    F . .
    f . .
    f . .
  `);
  assert.deepEqual(def.vehicles, [{ kind: 'bus', x: 0, y: 0, front: 'up', label: 'f' }]);
});

test('글자 그림 → 퍼즐 → 글자 그림이 그대로 돌아온다', () => {
  const text = [
    '. . . # .',
    '# a A b .',
    '. d . B .',
    '. D c C #',
    'G g g e E',
  ].join('\n');
  const p = createPuzzle(parseTextBoard(text));
  assert.equal(toTextBoard(p, p.start), text);
});

test('글자 그림: 잘못된 차량은 예외', () => {
  assert.throws(() => parseTextBoard('A A .\n. . .\n. . .'), /정확히 한 칸/);        // 대문자 둘
  assert.throws(() => parseTextBoard('a a .\n. . .\n. . .'), /정확히 한 칸/);        // 대문자 없음
  assert.throws(() => parseTextBoard('a A .\n. a .\n. . .'), /3칸|한 줄/);           // 꺾임
  assert.throws(() => parseTextBoard('a a a A\n. . . .\n. . . .\n. . . .'), /4칸/); // 너무 김
  assert.throws(() => parseTextBoard('a A a\n. . .\n. . .'), /끝 칸/);               // 머리가 가운데
  assert.throws(() => parseTextBoard('a . A\n. . .\n. . .'), /이어져/);              // 끊김
  assert.throws(() => parseTextBoard('a A .\n. . .'), /정사각형/);
  assert.throws(() => parseTextBoard('a A ?\n. . .\n. . .'), /알 수 없는 글자/);
});
