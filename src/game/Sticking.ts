/**
 * Absorb / reject resolution.
 *
 * Rules, in feel order:
 *  - Anything with `absorbSize <= radius * ABSORB_RATIO` sticks. The ratio is
 *    above 1 on purpose: being *slightly* too small to eat something is
 *    frustrating, so we err generous. Casual players read this as "the game is
 *    on my side", which is the entire tone we want.
 *  - Anything bigger blocks. The ball is pushed clear and *slides* along the
 *    obstacle rather than bouncing off it, so holding a direction against a
 *    building carries you around it. Blocks are never punishing (no score loss,
 *    no stun) — they're texture, and a promise for later.
 *  - Contact uses the ball's *visual* radius so what you see is what you eat.
 */

import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { bus } from '../core/Events';
import { Rand, clamp01 } from '../core/Math';
import type { PropDef } from '../data/props';
import { perks } from '../meta/Upgrades';
import type { Ball } from './Ball';
import { BallBaker } from './BallBaker';
import type { SpatialHash } from './SpatialHash';
import type { PropInstance } from './city/Props';

/** How much bigger than a prop the ball must be. <1 is deliberately generous. */
const ABSORB_RATIO = 1.0;
/**
 * Contact tolerance. The additive term matters more than the multiplier: a
 * 0.4 m pebble sweeping a 0.46 m path collects almost nothing per second, which
 * reads as an empty city no matter how much litter you scatter. The flat bonus
 * gives the early ball a usable sweep width and quietly fades to irrelevance
 * once the ball is metres across.
 */
const REACH = 1.22;
const REACH_BONUS = 0.55;
/**
 * Blocking radius, as a fraction of the ball. Deliberately much tighter than
 * the absorb reach: the generous vacuum is a gift, but if obstacles *blocked*
 * at that same distance the ball would jam in gaps that plainly look wide
 * enough, which reads as invisible walls — the fastest way to make a relaxing
 * game infuriating.
 */
const BLOCK = 1.02;
/** How much of an obstacle's own size counts toward the contact. */
const BLOCK_PROP = 0.45;

const _v = new Vector3();
const _q = new Quaternion();
const _start = new Matrix4();
const _target = new Matrix4();
const _obj = new Object3D();

export interface StickResult {
  absorbed: number;
  rejected: boolean;
}

/** What Score hands back for each absorbed prop. */
export interface Award {
  points: number;
  combo: number;
}

/** Cap on obstacles resolved per frame; more than this is a pathological pile. */
const MAX_BLOCKERS = 12;

export class Sticking {
  private rand = new Rand(0xbeef);
  /** Props absorbed this frame, reused to avoid per-frame allocation. */
  private harvested: PropInstance[] = [];
  /** Obstacles overlapping the ball this frame. Reused, never reallocated. */
  private blockers: { p: PropInstance; rr: number }[] = [];
  /** Rate-limits the reject thunk so scraping a wall isn't a machine gun. */
  private rejectCooldown = 0;
  /** Seconds spent blocked and barely moving; drives the anti-stick nudge. */
  private stuckTimer = 0;

  constructor(
    private ball: Ball,
    private baker: BallBaker,
    private hash: SpatialHash<PropInstance>
  ) {}

  /**
   * @param onAbsorb called per prop so Score/Collectibles can react before the
   *        mesh is consumed.
   */
  update(onAbsorb: (p: PropInstance, def: PropDef) => Award): StickResult {
    const ball = this.ball;
    const r = ball.visualRadius;
    // Magnetism widens the vacuum only. The blocking radius is deliberately left
    // alone: growing it too would mean an upgraded ball collides with buildings
    // from further away, so a perk sold as "reach further" would make the city
    // feel like it had grown invisible walls.
    const reach = (r * REACH + REACH_BONUS) * perks().reachMult;
    const block = r * BLOCK;
    const eatSize = r * ABSORB_RATIO;

    this.harvested.length = 0;
    this.blockers.length = 0;

    this.hash.query(ball.pos.x, ball.pos.z, reach + 1, (p) => {
      if (p.absorbed) return;
      const dx = p.x - ball.pos.x;
      const dz = p.z - ball.pos.z;
      const d2 = dx * dx + dz * dz;

      if (!p.blocker && p.def.absorbSize <= eatSize) {
        // Edible: use the generous vacuum radius.
        const rr = reach + p.def.absorbSize * 0.5;
        if (d2 <= rr * rr) this.harvested.push(p);
        return;
      }

      // Too big: use the tight, honest contact radius, and only its footprint —
      // colliding against a lamp post's full height makes it feel like a wall.
      const rr = block + p.def.absorbSize * BLOCK_PROP;
      if (d2 <= rr * rr && this.blockers.length < MAX_BLOCKERS) {
        this.blockers.push({ p, rr });
      }
    });

    for (const p of this.harvested) {
      const award = onAbsorb(p, p.def);
      this.absorb(p, award.points, award.combo);
    }

    const rejected = this.blockers.length > 0 && this.resolveBlockers();
    return { absorbed: this.harvested.length, rejected };
  }

  /**
   * Pushes the ball out of every obstacle it overlaps, then makes it *slide*
   * along the deepest one.
   *
   * The original version summed all the push-out normals and reflected the
   * velocity off the result. That deadlocks: two obstacles on opposite sides
   * cancel to a zero normal, so the ball jitters in place forever with nowhere
   * to go — and the player has no way to understand why they're stuck.
   *
   * Resolving each contact separately guarantees the ball always ends the frame
   * outside every obstacle, and removing only the into-surface component of
   * velocity (rather than reflecting it) means holding a direction against a
   * building slides you along the wall instead of bouncing you off it. For a
   * game about relaxing, sliding is also just the nicer verb.
   */
  private resolveBlockers(): boolean {
    const ball = this.ball;
    let deepest = 0;
    let ndx = 0;
    let ndz = 0;
    let hitDef: PropDef | null = null;

    // Two passes: after pushing out of one obstacle the ball may have moved
    // into another, and a second sweep settles almost every real case.
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.blockers) {
        const dx = b.p.x - ball.pos.x;
        const dz = b.p.z - ball.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= b.rr * b.rr) continue;
        const d = Math.sqrt(d2);

        // Dead centre: pick an arbitrary but stable direction rather than
        // dividing by zero.
        const nx = d > 1e-4 ? -dx / d : 1;
        const nz = d > 1e-4 ? -dz / d : 0;
        const overlap = b.rr - d;

        ball.pos.x += nx * overlap;
        ball.pos.z += nz * overlap;

        if (iter === 0 && overlap > deepest) {
          deepest = overlap;
          ndx = nx;
          ndz = nz;
          hitDef = b.p.def;
        }
      }
    }

    if (!hitDef) {
      this.stuckTimer = 0;
      return false;
    }

    // Safety net. Even with honest contact radii a player can find a pocket
    // where opposing pushes cancel. Rather than let them sit there confused,
    // slide them along the obstacle after half a second of going nowhere. It
    // costs nothing when it isn't needed and it makes "stuck" unreachable.
    if (Math.hypot(ball.vel.x, ball.vel.z) < 0.6) {
      this.stuckTimer += 1 / 120;
      if (this.stuckTimer > 0.5) {
        // Escape along the tangent *and* straight out along the normal.
        //
        // Tangent alone deadlocks in a concave corner — where two building
        // frontages meet at a right angle, sliding along either wall drives you
        // deeper into the other, so the ball can sit in the pocket forever.
        // Adding the outward component means every nudge makes real progress
        // away from the obstacle, whatever shape the pocket is.
        const tx = -ndz;
        const tz = ndx;
        const sign = ball.vel.x * tx + ball.vel.z * tz >= 0 ? 1 : -1;
        ball.vel.x += tx * sign * 1.6 + ndx * 2.2;
        ball.vel.z += tz * sign * 1.6 + ndz * 2.2;
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }

    // Cancel the component of velocity heading into the surface; keep the rest.
    const into = ball.vel.x * ndx + ball.vel.z * ndz;
    if (into < 0) {
      // A little restitution so a hard hit still reads as an impact.
      const gap = clamp01(hitDef.absorbSize / Math.max(ball.visualRadius, 0.1) - 1);
      const bounce = 0.12 + gap * 0.16;
      ball.vel.x -= ndx * into * (1 + bounce);
      ball.vel.z -= ndz * into * (1 + bounce);

      const speed = -into;
      if (speed > 1.8 && this.rejectCooldown <= 0) {
        this.rejectCooldown = 0.25;
        ball.bump(clamp01(speed / 6) * 0.5);
        bus.emit('reject', { def: hitDef, speed });
      }
    }
    return true;
  }

  private absorb(p: PropInstance, points: number, combo: number) {
    const ball = this.ball;
    this.hash.remove(p);
    p.absorbed = true;

    // Direction from ball centre to the prop, in world space, then converted to
    // the spinner's frame so the prop rides the roll.
    _v.set(p.x - ball.pos.x, p.y + p.def.absorbSize * 0.35 - ball.pos.y, p.z - ball.pos.z);
    if (_v.lengthSq() < 1e-6) _v.set(0, 1, 0);
    _v.normalize();

    // Sit the prop with its base on the surface, sunk slightly in so it looks
    // embedded rather than glued on. Deeper for big props so they don't stick
    // out like antennae.
    const r = ball.visualRadius;
    const size = p.def.size;
    // Tall, thin things (trees, lamp posts, signs) must not be stood upright on
    // the surface normal — a ball of radially-aligned trees looks like a sea
    // urchin, not a rolling pile of city. They get laid over toward tangential
    // and pushed further in, so they read as swept up rather than skewered on.
    const slenderness = size.y / Math.max(size.x, size.z, 0.05);
    const tall = clamp01((slenderness - 1.1) / 1.6);
    const leanMax = 0.3 + tall * 1.15;

    const sink = 0.15 + clamp01(p.def.absorbSize / r) * 0.25 + tall * 0.12;
    const surface = r * (1 - sink);

    // The spinner is unscaled, so this is plain world metres: the prop keeps the
    // exact size it had on the street. Everything welded on stays true-to-scale
    // for the rest of the run.
    const scale = p.scale ?? 1;
    _obj.position.copy(_v).multiplyScalar(surface);
    // Orient the prop's up-axis along the surface normal, then spin it randomly
    // about that normal so a field of identical cones doesn't look combed.
    _q.setFromUnitVectors(UP, _v);
    // Bias the lean toward its maximum rather than sampling uniformly: a
    // uniform range still leaves plenty of trees standing straight up, and it
    // only takes a few of those to make the ball read as a pincushion.
    const lean = leanMax * this.rand.range(0.5, 1) * (this.rand.chance(0.5) ? 1 : -1);
    _obj.quaternion.copy(_q).multiply(tiltQuat(this.rand.range(0, Math.PI * 2), lean));
    _obj.scale.setScalar(scale);
    _obj.updateMatrix();
    _target.copy(_obj.matrix);

    // Start pose: just off the surface, where the prop was at contact.
    _obj.position.copy(_v).multiplyScalar(r * 1.02 + p.def.absorbSize * 0.6);
    _obj.quaternion.copy(_q);
    _obj.scale.setScalar(scale * 1.12);
    _obj.updateMatrix();
    _start.copy(_obj.matrix);

    // The spinner already carries the roll rotation; undo it so the prop lands
    // at the world contact point rather than a rotated copy of it.
    ball.spinner.updateMatrix();
    _inv.copy(ball.spinner.matrix).invert();
    _start.premultiply(_inv);
    _target.premultiply(_inv);

    this.baker.add(p.geometry, p.material, _target, _start);
    p.hide();

    bus.emit('stick', {
      def: p.def,
      points,
      combo,
      world: { x: p.x, y: p.y, z: p.z },
    });

    // Heavier things thump the ball visibly.
    if (p.def.mass > 30) ball.bump(clamp01(p.def.mass / 400) * 0.7);
  }

  /** Advances internal timers. */
  tick(dt: number) {
    if (this.rejectCooldown > 0) this.rejectCooldown -= dt;
  }
}

const UP = new Vector3(0, 1, 0);
const _inv = new Matrix4();
const _tiltA = new Quaternion();
const _tiltB = new Quaternion();
const _axis = new Vector3();

/** Random spin about the surface normal plus a small random lean. */
function tiltQuat(spin: number, lean: number): Quaternion {
  _tiltA.setFromAxisAngle(UP, spin);
  _axis.set(Math.cos(spin), 0, Math.sin(spin));
  _tiltB.setFromAxisAngle(_axis, lean);
  return _tiltA.multiply(_tiltB);
}
