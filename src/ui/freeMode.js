// 자유 모드 설정 화면 — 슬라이더로 판 크기·자동차·버스·구조물 수를 고르고, 시드로 같은 판을 다시 부를 수 있다.

import {
  FREE_SIZE_MIN, FREE_SIZE_MAX, freeLimits, freeFill, freeModeParams, freeSettingsProblem,
} from '../core/levels.js';
import { randomSeedString } from '../core/random.js';

const FIELDS = ['size', 'cars', 'buses', 'blocks'];

export class FreeModeScreen {
  /**
   * @param root   data-screen="free"
   * @param handlers { onPlay(settings), onChange(settings) }
   */
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    this.inputs = Object.fromEntries(FIELDS.map((f) => [f, root.querySelector(`#free-${f}`)]));
    this.outputs = Object.fromEntries(FIELDS.map((f) => [f, root.querySelector(`#free-${f}-out`)]));
    this.seed = root.querySelector('#free-seed');
    this.fill = root.querySelector('#free-fill');
    this.fillBar = root.querySelector('#free-fill-bar');
    this.info = root.querySelector('#free-info');
    this.problem = root.querySelector('#free-problem');
    this.playBtn = root.querySelector('[data-action="free-play"]');

    this.inputs.size.min = FREE_SIZE_MIN;
    this.inputs.size.max = FREE_SIZE_MAX;
    for (const f of FIELDS) this.inputs[f].addEventListener('input', () => this.refresh(f));
    this.seed.addEventListener('input', () => this.h.onChange(this.read()));
    root.querySelector('[data-action="free-random-seed"]').addEventListener('click', () => {
      this.seed.value = randomSeedString();
      this.h.onChange(this.read());
    });
    root.querySelector('#free-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (freeSettingsProblem(this.read())) return;
      if (!this.seed.value.trim()) this.seed.value = randomSeedString();
      const s = this.read();
      this.h.onChange(s);
      this.h.onPlay(s);
    });
  }

  /** 저장된 설정으로 채운다 */
  load(settings) {
    this.inputs.size.value = settings.size;
    this.applyLimits();
    for (const f of ['cars', 'buses', 'blocks']) this.inputs[f].value = settings[f];
    this.seed.value = settings.seed ?? '';
    this.refresh();
  }

  read() {
    const s = Object.fromEntries(FIELDS.map((f) => [f, Number(this.inputs[f].value)]));
    s.seed = this.seed.value.trim().slice(0, 40);
    return s;
  }

  /** 판 크기가 바뀌면 나머지 슬라이더의 최대값도 바뀐다 */
  applyLimits() {
    const lim = freeLimits(Number(this.inputs.size.value));
    for (const f of ['cars', 'buses', 'blocks']) {
      this.inputs[f].min = lim[f].min;
      this.inputs[f].max = lim[f].max;
      if (Number(this.inputs[f].value) > lim[f].max) this.inputs[f].value = lim[f].max;
    }
  }

  refresh(changed) {
    if (changed === 'size') this.applyLimits();
    const s = this.read();
    this.outputs.size.textContent = `${s.size}×${s.size}`;
    this.outputs.cars.textContent = `${s.cars}대`;
    this.outputs.buses.textContent = `${s.buses}대`;
    this.outputs.blocks.textContent = `${s.blocks}개`;
    for (const f of FIELDS) {
      const el = this.inputs[f];
      const t = (Number(el.value) - Number(el.min)) / Math.max(1, Number(el.max) - Number(el.min));
      el.style.setProperty('--t', t);
    }

    const fill = freeFill(s);
    this.fill.textContent = `${Math.round(fill * 100)}%`;
    this.fillBar.style.setProperty('--fill', Math.min(1, fill / 0.62));
    this.fillBar.classList.toggle('over', fill > 0.62);

    const p = freeModeParams(s);
    this.info.textContent = p.minSlides > 0
      ? `다른 차를 먼저 밀어 둬야 풀리는 고리 ${p.minSlides}개를 넣어요.`
      : '빼는 순서만 맞히면 되는 판이에요. 구조물을 3개 이상 두면 꼬인 판이 나와요.';

    const problem = freeSettingsProblem(s);
    this.problem.textContent = problem ?? '';
    this.problem.hidden = !problem;
    this.playBtn.disabled = !!problem;
    if (changed) this.h.onChange(s);
  }
}
