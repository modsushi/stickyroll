/**
 * Fixed-step simulation with an interpolated render, so physics feel is identical
 * on a 60Hz phone and a 144Hz monitor. Long stalls (tab switch) are clamped rather
 * than replayed, which would otherwise teleport the ball through the city.
 */

const STEP = 1 / 120;
const MAX_FRAME = 0.25;

export type StepFn = (dt: number) => void;
export type RenderFn = (alpha: number, dt: number) => void;

export class Loop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;

  /** Wall-clock seconds since start, unaffected by pause. */
  elapsed = 0;
  /** Smoothed frames-per-second for the perf HUD. */
  fps = 60;

  constructor(
    private step: StepFn,
    private render: RenderFn
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /**
   * Advances the simulation by hand, ignoring the wall clock.
   *
   * Browsers suspend `requestAnimationFrame` entirely in a backgrounded tab,
   * which makes the game impossible to drive from an automation harness. This
   * gives tooling a deterministic way to run N seconds of gameplay and inspect
   * or screenshot the result. Not used by the game itself.
   */
  advance(seconds: number, renderEvery = 1) {
    const steps = Math.max(1, Math.round(seconds / STEP));
    for (let i = 0; i < steps; i++) {
      this.step(STEP);
      this.elapsed += STEP;
      if (i % renderEvery === 0) this.render(0, STEP * renderEvery);
    }
  }

  private tick = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);

    let frame = (now - this.last) / 1000;
    this.last = now;
    if (frame > MAX_FRAME) frame = MAX_FRAME;
    this.fps += (1 / Math.max(frame, 1e-4) - this.fps) * 0.1;
    this.elapsed += frame;

    this.acc += frame;
    let steps = 0;
    while (this.acc >= STEP && steps < 8) {
      this.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    // Bail out of a death spiral rather than letting the accumulator grow.
    if (steps === 8) this.acc = 0;

    this.render(this.acc / STEP, frame);
  };
}
