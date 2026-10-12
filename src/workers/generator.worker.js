// 판 생성을 화면과 다른 스레드에서 돌린다 — 큰 판을 만드는 동안에도 화면(불러오는 중 표시)이 멈추지 않게.
import { runJob } from '../ui/puzzleJobs.js';

self.onmessage = (e) => {
  const { id, kind, params, seed } = e.data;
  try {
    self.postMessage({ id, ok: true, result: runJob(kind, params, seed) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message ?? String(err) });
  }
};
