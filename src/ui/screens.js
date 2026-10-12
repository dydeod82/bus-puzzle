// 화면 전환 — data-screen이 붙은 구역 중 하나만 보이게 한다.
// 각 화면은 on(name, { show, hide })로 들어오고 나갈 때 할 일을 등록한다.

export class Screens {
  constructor(root) {
    this.root = root;
    this.current = null;
    this.hooks = new Map();
    for (const el of root.querySelectorAll('[data-screen]')) el.hidden = true;
  }

  on(name, hooks) {
    this.hooks.set(name, hooks);
  }

  el(name) {
    return this.root.querySelector(`[data-screen="${name}"]`);
  }

  show(name, ...args) {
    if (this.current) {
      this.hooks.get(this.current)?.hide?.();
      this.el(this.current).hidden = true;
    }
    const el = this.el(name);
    el.hidden = false;
    // 들어오는 애니메이션을 매번 다시 돌린다
    el.classList.remove('entering');
    void el.offsetWidth;
    el.classList.add('entering');
    this.current = name;
    window.scrollTo(0, 0);
    this.hooks.get(name)?.show?.(...args);

    // 화면 읽기 프로그램이 새 화면을 알 수 있도록 제목에 초점 (스크롤은 하지 않는다)
    const target = el.querySelector('[data-autofocus]') ?? el.querySelector('h1, h2');
    target?.focus({ preventScroll: true });
  }
}
