/**
 * Magnetic Pull — the swirl.
 *
 * ## Why this doesn't absorb anything
 *
 * It moves props and nothing else. Everything that makes eating a thing feel
 * good — the score award, the combo chain, the collectible flying to its card,
 * the per-material pickup sound, the mesh welding onto the ball — already lives
 * in `Sticking`, and a second path into all of that would be a second set of
 * bugs. So the magnet drags loose objects into the ball's ordinary vacuum and
 * lets the ordinary vacuum do the ordinary thing. A magnet pull is therefore
 * indistinguishable from a very good few seconds of driving, which is exactly
 * what it should be.
 *
 * It also means the power-up can never eat something the ball could not: only
 * props already under the size limit are pulled. It is a burst of *convenience*,
 * not a burst of power, and that keeps it from trivialising the tier curve.
 *
 * ## The spiral
 *
 * Straight-line attraction looks like a bug — objects sliding through each
 * other on converging rails, arriving in one clump. Adding a tangential
 * component makes them orbit inward instead, so they arrive spread around the
 * ball over the whole duration and the effect reads as a whirlpool. The
 * tangential share falls off as objects close in, or they would circle forever
 * just outside the vacuum.
 */

import { isBuilding, isRooted } from '../data/props';
import type { Ball } from './Ball';
import type { BuiltCity } from './city/CityBuilder';
import type { PropInstance } from './city/Props';

/** Seconds a single charge lasts. */
const DURATION = 2.6;
/** Pull radius: a fixed plaza-sized disc, plus a share of the ball. */
const RADIUS_BASE = 11;
const RADIUS_PER_R = 2.4;
/**
 * Inward speed in metres per second, and how much of it survives being far
 * away. Objects accelerate as they close so the swirl tightens rather than
 * arriving at a constant crawl.
 */
const PULL_SPEED = 9;
/** Fraction of the pull spent going *around* the ball rather than toward it. */
const SWIRL = 0.85;
/**
 * Position updates per second.
 *
 * Merged batches rewrite a vertex range per moved prop, so this is not free —
 * `Wind` runs at 20 Hz for the same reason. But wind creeps and the magnet
 * sprints: at 20 Hz a pulled object jumps 45 cm at a time and strobes. Thirty
 * is the point where the motion reads as continuous and the cost is still a
 * fraction of what the effect is worth.
 */
const RATE = 30;
/**
 * Ceiling on objects in flight at once. A dense market square can put four
 * hundred props inside the radius, and past a certain point the screen is a
 * blur anyway — the cap protects the frame without being visible.
 */
const MAX_PULLED = 220;

export class Magnet {
  /** Seconds remaining, or 0 when idle. */
  private left = 0;
  private tick = 0;
  /** Reused so a pull allocates nothing per frame. */
  private caught: PropInstance[] = [];

  constructor(
    private ball: Ball,
    private city: BuiltCity
  ) {}

  get active() {
    return this.left > 0;
  }

  /** 0..1 for the HUD ring. */
  get progress() {
    return this.left > 0 ? this.left / DURATION : 0;
  }

  /** Radius of the current pull, for the effect layer. */
  get radius() {
    return RADIUS_BASE + this.ball.visualRadius * RADIUS_PER_R;
  }

  start() {
    // Re-triggering refreshes rather than stacks: two charges spent back to
    // back should read as one longer pull, not as a doubled speed nobody
    // asked for.
    this.left = DURATION;
    this.tick = 0;
  }

  stop() {
    this.left = 0;
  }

  step(dt: number) {
    if (this.left <= 0) return;
    this.left -= dt;

    this.tick += dt;
    if (this.tick < 1 / RATE) return;
    const moveDt = Math.min(this.tick, 0.12);
    this.tick = 0;

    const ball = this.ball;
    // Same size gate the vacuum uses, so the magnet never delivers something
    // that would just bounce off on arrival.
    const eatSize = ball.visualRadius;
    const radius = this.radius;

    this.caught.length = 0;
    this.city.hash.query(ball.pos.x, ball.pos.z, radius, (p) => {
      if (p.absorbed || p.blocker) return;
      if (isBuilding(p.def) || isRooted(p.def) || !p.translate) return;
      if (p.def.absorbSize > eatSize) return;
      const dx = p.x - ball.pos.x;
      const dz = p.z - ball.pos.z;
      if (dx * dx + dz * dz > radius * radius) return;
      if (this.caught.length < MAX_PULLED) this.caught.push(p);
    });

    if (!this.caught.length) return;

    for (const p of this.caught) {
      const dx = ball.pos.x - p.x;
      const dz = ball.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-3) continue;

      // Closer means faster, so the last metre snaps in rather than drifting.
      const speed = PULL_SPEED * (1.35 - 0.55 * (d / radius));
      const inward = (speed * moveDt) / d;
      // Orbit strongly while far out, then straighten so nothing ends up
      // circling the vacuum without ever entering it.
      const swirl = SWIRL * Math.min(1, d / (radius * 0.55));
      const mx = dx * inward - dz * inward * swirl;
      const mz = dz * inward + dx * inward * swirl;

      // Never overshoot: a step longer than the remaining distance would fling
      // objects out the far side and back, which reads as the pull failing.
      const step = Math.hypot(mx, mz);
      const scale = step > d ? d / step : 1;
      const ox = mx * scale;
      const oz = mz * scale;

      p.x += ox;
      p.z += oz;
      p.translate!(ox, oz);
      this.city.hash.update(p);
    }

    // The pulled props are the only thing that moved, and they moved *inward* —
    // every batch's existing bounds still contain them, so unlike `Wind` there
    // is nothing to refit.
  }
}
