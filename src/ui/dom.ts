/** Tiny DOM helper. The UI is small enough that a framework would cost more
 *  than it saves, but building elements by hand three lines at a time is worse. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.setAttribute('style', v);
    else node.setAttribute(k, v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Waits for the next frame after a style change so a CSS transition runs. */
export const nextFrame = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Runs `onFrame(t)` from 0 to 1 over `seconds`, then resolves.
 *
 * Uses rAF when the page is visible and a timer when it isn't. Browsers suspend
 * rAF entirely in a background tab, so a purely rAF-driven sequence would leave
 * the results screen frozen mid-count — buttons invisible, game unplayable —
 * for anyone who tabs away while it plays.
 */
export function animate(seconds: number, onFrame: (t: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onFrame(1);
      resolve();
    };
    const step = () => {
      if (done) return;
      const t = Math.min(1, (performance.now() - start) / (seconds * 1000));
      onFrame(t);
      if (t >= 1) return finish();
      if (document.hidden) setTimeout(step, 32);
      else requestAnimationFrame(step);
    };
    step();
    // Belt and braces: guarantee completion even if both clocks misbehave.
    setTimeout(finish, seconds * 1000 + 800);
  });
}
