/**
 * The ball: arcade motion, rolling orientation, and squash/stretch.
 *
 * Deliberately not a rigid body. Everything here is tuned for a forgiving,
 * always-responsive feel: acceleration scales with size so a big ball feels
 * heavy without feeling sluggish, and steering has a turn-assist term that
 * rotates existing momentum instead of only adding force — that is what makes
 * one-thumb play feel precise instead of like pushing a shopping trolley.
 */

import {
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { type LitMaterial, makeLit } from '../render/litMaterial';
import { clamp01, damp, elasticOut, lerp } from '../core/Math';
import { Growth } from './Growth';

export class Ball {
  /**
   * Hierarchy: `group` (position only) -> `spinner` (rotation only) -> children.
   *
   * The group deliberately carries **no scale**. If it did, everything welded to
   * the ball would grow with it, and a traffic cone absorbed at pebble size
   * would end up the size of a bus. Instead only the core sphere is scaled, and
   * stuck props are placed in real metres — so as the ball grows, older debris
   * is gradually swallowed into the mass while fresh, bigger pickups stud the
   * new surface. That churn is the look the whole genre is built on.
   */
  readonly group = new Group();
  /** Child that carries stuck props and the rolling rotation. */
  readonly spinner = new Group();
  readonly growth = new Growth();

  readonly pos = new Vector3(0, 0.4, 0);
  readonly vel = new Vector3();
  /** Radius used for rendering; eases toward `growth.radius` on a tier-up. */
  visualRadius = this.growth.radius;

  private core: Mesh;
  private coreMat: LitMaterial;
  private spin = new Quaternion();
  private axis = new Vector3();
  private squash = 0;
  private squashT = 0;
  private growT = 1;
  private growFrom = this.growth.radius;

  /** Set by Sticking when a reject happens, so motion can recoil. */
  readonly recoil = new Vector3();

  constructor() {
    // Faceted low-poly sphere: matches the reference art and, more usefully,
    // gives stuck props flat facets to sit against instead of sliding on a
    // perfectly smooth surface.
    const geo = new IcosahedronGeometry(1, 2);
    geo.computeVertexNormals();
    this.coreMat = makeLit({
      color: new Color(0xf6f4ef),
      roughness: 0.55,
      metalness: 0.02,
      flatShading: true,
    });
    this.core = new Mesh(geo, this.coreMat);
    this.core.castShadow = true;
    this.core.receiveShadow = true;

    this.spinner.add(this.core);
    this.group.add(this.spinner);
    this.group.position.copy(this.pos);
  }

  get radius() {
    return this.growth.radius;
  }

  /** Speed ceiling and grip both scale with size. */
  private get maxSpeed() {
    return 5.6 + this.growth.tier * 1.15;
  }

  private get accel() {
    return 26 + this.growth.tier * 3.2;
  }

  /** @param dir world-space desired direction, length 0..1 */
  step(dir: Vector3, dt: number) {
    const want = dir.lengthSq();

    if (want > 1e-5) {
      const strength = Math.min(1, Math.sqrt(want));
      // Split the input into "push along current heading" and "rotate heading".
      // The rotate term is what gives tight, satisfying cornering.
      const speed = this.vel.length();
      if (speed > 0.35) {
        const fx = this.vel.x / speed;
        const fz = this.vel.z / speed;
        const dot = (dir.x / strength) * fx + (dir.z / strength) * fz;
        // Turn assist is strongest when steering sideways, zero when steering
        // straight ahead, and becomes braking when steering backwards.
        const assist = clamp01(1 - Math.abs(dot)) * 7.5 * strength * dt;
        this.vel.x = lerp(this.vel.x, (dir.x / strength) * speed, clamp01(assist));
        this.vel.z = lerp(this.vel.z, (dir.z / strength) * speed, clamp01(assist));
      }
      this.vel.x += dir.x * this.accel * dt;
      this.vel.z += dir.z * this.accel * dt;
    }

    // Rolling friction: light while steering, firm when you let go, so the ball
    // coasts pleasantly but always comes to rest.
    const drag = want > 1e-5 ? 0.55 : 2.6;
    const damping = Math.exp(-drag * dt);
    this.vel.x *= damping;
    this.vel.z *= damping;

    if (this.recoil.lengthSq() > 1e-6) {
      this.vel.add(this.recoil);
      this.recoil.set(0, 0, 0);
    }

    const speed = Math.hypot(this.vel.x, this.vel.z);
    const cap = this.maxSpeed;
    if (speed > cap) {
      this.vel.x = (this.vel.x / speed) * cap;
      this.vel.z = (this.vel.z / speed) * cap;
    }
    if (speed < 0.02) this.vel.x = this.vel.z = 0;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y = this.visualRadius;

    // Roll: angular velocity is v/r about the axis perpendicular to travel.
    if (speed > 1e-4) {
      this.axis.set(this.vel.z, 0, -this.vel.x).normalize();
      const angle = (speed / Math.max(this.visualRadius, 0.05)) * dt;
      this.spin.setFromAxisAngle(this.axis, angle);
      this.spinner.quaternion.premultiply(this.spin);
    }
  }

  /** Confines the ball to the level bounds with a soft, non-jarring push-back. */
  clampToBounds(minX: number, minZ: number, maxX: number, maxZ: number) {
    const r = this.visualRadius;
    if (this.pos.x < minX + r) { this.pos.x = minX + r; this.vel.x = Math.abs(this.vel.x) * 0.25; }
    if (this.pos.x > maxX - r) { this.pos.x = maxX - r; this.vel.x = -Math.abs(this.vel.x) * 0.25; }
    if (this.pos.z < minZ + r) { this.pos.z = minZ + r; this.vel.z = Math.abs(this.vel.z) * 0.25; }
    if (this.pos.z > maxZ - r) { this.pos.z = maxZ - r; this.vel.z = -Math.abs(this.vel.z) * 0.25; }
  }

  /** Kicks off the visual growth ease. Called by Game on a tier-up. */
  beginGrow() {
    this.growFrom = this.visualRadius;
    this.growT = 0;
    this.squash = 1;
    this.squashT = 0;
  }

  /** Small squash pulse, used for heavy pickups and rejects. */
  bump(amount = 0.45) {
    this.squash = Math.max(this.squash, amount);
    this.squashT = 0;
  }

  /** Visual-only update; safe to run at render rate. */
  render(dt: number) {
    if (this.growT < 1) {
      this.growT = Math.min(1, this.growT + dt * 2.4);
      // Overshoot on the way up so the size change reads as a *pop*.
      const t = this.growT;
      const e = 1 - Math.pow(1 - t, 3) + Math.sin(t * Math.PI) * 0.12;
      this.visualRadius = lerp(this.growFrom, this.growth.radius, Math.min(e, 1.08));
    } else {
      this.visualRadius = damp(this.visualRadius, this.growth.radius, 0.001, dt);
    }

    this.group.position.set(this.pos.x, this.visualRadius, this.pos.z);

    // Squash along the velocity axis; recovery is a decaying sine so it wobbles.
    let sx = 1;
    let sy = 1;
    if (this.squash > 0.001) {
      this.squashT += dt;
      const e = elasticOut(this.squashT, 2.6, 9) * this.squash;
      sy = 1 - e * 0.22;
      sx = 1 + e * 0.13;
      if (this.squashT > 1.1) this.squash = 0;
    }

    // Only the core carries the radius. Stuck props sit in world metres under
    // the same (unscaled) spinner, so they never inflate as the ball grows.
    // The core also shrinks a touch with tier so debris sits proud of it.
    const cover = 1 - clamp01(this.growth.tier / 6) * 0.05;
    const r = this.visualRadius * cover;
    this.core.scale.set(r * sx, r * sy, r * sx);
  }

  reset() {
    this.growth.reset();
    this.pos.set(0, this.growth.radius, 0);
    this.vel.set(0, 0, 0);
    this.visualRadius = this.growth.radius;
    this.growT = 1;
    this.squash = 0;
    this.spinner.quaternion.identity();
    this.spinner.clear();
    this.spinner.add(this.core);
  }
}
