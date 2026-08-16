/**
 * Fixed-yaw follow camera.
 *
 * The camera never rotates with the ball. Katamari's rotating camera is the
 * single biggest source of motion sickness and disorientation in the genre, and
 * this game is meant to be relaxing — so we lock the yaw, keep north pinned, and
 * spend the freedom on smooth distance/pitch changes as the ball grows. Growth
 * reads as the world getting *smaller*, which is exactly the fantasy.
 */

import { PerspectiveCamera, Vector3 } from 'three';
import { clamp01, damp, elasticOut, lerp, smoothstep } from '../core/Math';

const YAW = -Math.PI * 0.25; // fixed compass heading, matches the reference art

export class FollowCamera {
  /** Point the camera is actually looking at; lags the ball for weight. */
  private focus = new Vector3();
  private shakeAmp = 0;
  private shakeT = 0;
  private shakeSeed = 0;

  /** Smoothed values so tier-ups ease rather than snap. */
  private dist = 12;
  private height = 9;
  private lookAhead = new Vector3();
  private kick = 0;

  constructor(private cam: PerspectiveCamera) {}

  /**
   * Framing for a given ball radius.
   *
   * Two constraints shape these numbers:
   *
   *  - The camera must stay above the skyline. Commercial blocks are 11 m tall,
   *    so anything lower than ~16 m spends the game clipping through rooftops.
   *  - The ball must still read at pebble size. A high camera plus a *narrow*
   *    FOV solves both at once: the long lens keeps the subject large while the
   *    height clears the buildings, and it's also what gives the picture its
   *    flattened, miniature-diorama look.
   *
   * Pitch stays near 57° throughout; only the scale of the view changes.
   */
  private framing(radius: number) {
    const t = clamp01((radius - 0.4) / 5.4);
    const e = smoothstep(t);
    return {
      dist: lerp(11, 30, e) + radius * 1.35,
      height: lerp(17, 46, e) + radius * 1.6,
      fov: lerp(30, 34, t),
    };
  }

  /** Camera shake, used for rejects, tier-ups and heavy pickups. */
  shake(amount: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
    this.shakeT = 0;
    this.shakeSeed = Math.random() * 1000;
  }

  /** A quick dolly-out punch. Sells a tier-up more than any particle does. */
  punch(amount = 1) {
    this.kick = Math.max(this.kick, amount);
  }

  snapTo(pos: Vector3, radius: number) {
    this.focus.copy(pos);
    const f = this.framing(radius);
    this.dist = f.dist;
    this.height = f.height;
    this.update(pos, new Vector3(), radius, 1);
  }

  update(ballPos: Vector3, ballVel: Vector3, radius: number, dt: number) {
    const f = this.framing(radius);

    // Lead the ball slightly in its direction of travel so you can see where
    // you're going; the lead shrinks at low speed so idling stays centred.
    const speed = ballVel.length();
    const lead = Math.min(speed * 0.28, 3.4 + radius * 0.5);
    this.lookAhead.set(
      speed > 0.01 ? (ballVel.x / speed) * lead : 0,
      0,
      speed > 0.01 ? (ballVel.z / speed) * lead : 0
    );

    const targetX = ballPos.x + this.lookAhead.x;
    const targetZ = ballPos.z + this.lookAhead.z;
    this.focus.x = damp(this.focus.x, targetX, 0.0015, dt);
    this.focus.z = damp(this.focus.z, targetZ, 0.0015, dt);
    this.focus.y = damp(this.focus.y, ballPos.y + radius * 0.5, 0.0008, dt);

    this.kick = damp(this.kick, 0, 0.02, dt);
    this.dist = damp(this.dist, f.dist, 0.02, dt) + this.kick * 3.5;
    this.height = damp(this.height, f.height, 0.02, dt) + this.kick * 1.6;

    const cx = this.focus.x + Math.sin(YAW) * this.dist;
    const cz = this.focus.z + Math.cos(YAW) * this.dist;
    this.cam.position.set(cx, this.focus.y + this.height, cz);

    if (this.shakeAmp > 0.0005) {
      this.shakeT += dt;
      // Two decaying sines at incommensurate frequencies read as a real impact
      // rather than a vibration.
      const e = this.shakeAmp * Math.exp(-this.shakeT * 7);
      const s = this.shakeSeed;
      this.cam.position.x += elasticOut(this.shakeT * 1.4, 11, 0) * e * 0.5 + Math.sin(s + this.shakeT * 53) * e * 0.18;
      this.cam.position.y += elasticOut(this.shakeT * 1.4, 17, 0) * e * 0.38;
      this.cam.position.z += Math.cos(s + this.shakeT * 61) * e * 0.42;
      if (this.shakeT > 0.8) this.shakeAmp = 0;
    }

    this.cam.lookAt(this.focus);
    if (Math.abs(this.cam.fov - f.fov) > 0.01) {
      this.cam.fov = damp(this.cam.fov, f.fov, 0.05, dt);
      this.cam.updateProjectionMatrix();
    }
  }

  /**
   * Converts the screen-space stick vector into a world-space direction on the
   * ground plane. Because yaw is fixed this is a constant rotation, so "up on
   * the screen" always means the same world direction — muscle memory holds.
   */
  screenToWorld(sx: number, sy: number, out: Vector3): Vector3 {
    const c = Math.cos(YAW);
    const s = Math.sin(YAW);
    // Screen +y is down, which maps to +z away from the camera.
    out.set(sx * c + sy * s, 0, -sx * s + sy * c);
    return out;
  }

  get focusPoint() {
    return this.focus;
  }
}
