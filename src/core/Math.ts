export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v: number, a: number, b: number, c: number, d: number) =>
  lerp(c, d, clamp01(invLerp(a, b, v)));

/**
 * Frame-rate independent exponential smoothing.
 * `smoothing` is the fraction of the gap remaining after one second.
 */
export const damp = (a: number, b: number, smoothing: number, dt: number) =>
  lerp(a, b, 1 - Math.pow(smoothing, dt));

export const smoothstep = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** Overshoot ease used for every "pop" in the game. */
export const easeOutBack = (t: number, s = 1.70158) => {
  const x = t - 1;
  return x * x * ((s + 1) * x + s) + 1;
};

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number) => t * t * t;
export const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Decaying sine — for shake, wobble, and squash recovery. */
export const elasticOut = (t: number, freq = 3, decay = 6) =>
  Math.sin(t * TAU * freq) * Math.exp(-t * decay);

export const shortestAngle = (from: number, to: number) => {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

export const dampAngle = (a: number, b: number, smoothing: number, dt: number) =>
  a + shortestAngle(a, b) * (1 - Math.pow(smoothing, dt));

/** Deterministic PRNG so a level always builds identically. */
export class Rand {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }
  /** mulberry32 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + this.next() * (b - a);
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number) {
    return this.next() < p;
  }
  /** Random unit direction on the XZ plane. */
  angle() {
    return this.next() * TAU;
  }
}
