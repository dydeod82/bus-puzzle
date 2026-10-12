// 판 생성을 화면과 다른 스레드에서 돌린다 — 큰 판을 만드는 동안에도 화면(불러오는 중 표시)이 멈추지 않게.
import { generatePuzzle } from '../core/generator.js';

self.onmessage = (e) => {
  const { id, params, seed } = e.data;
  try {
    const r = generatePuzzle(params, seed);
    self.postMessage({ id, ok: true, result: { def: r.def, par: r.par, slides: r.slides, optimal: r.optimal } });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message ?? String(err) });
  }
};
