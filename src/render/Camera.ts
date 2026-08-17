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

/**
 * The camera distance a shake amount of 1 was tuned against — the opening
 * framing. Everything further out scales up from here, so an impact lands with
 * the same force on screen whatever size the ball is.
 */
const SHAKE_BASE = 12;

/**
 * Dolly gain for `punch`. The camera pulls out by `PUNCH_GAIN / e` times the
 * punch amount at the peak, so the tier-up's 0.85 lands at ~1.46 — a 2.46×
 * framing, which is what the old per-frame accumulation produced at 60 fps.
 */
const PUNCH_GAIN = 4.67;

/**
 * Phones get a looser frame than desktops.
 *
 * The framing below is one set of numbers for a screen of any size, and on a
 * 6-inch portrait display that reads as tight: the ball fills the middle and
 * you can see barely a block in any direction, so you steer into things you
 * never had a chance to notice. A phone also holds the *short* axis vertically,
 * so the same vertical FOV shows far less ground than the same numbers do on a
 * landscape monitor.
 *
 * Pulling back and widening slightly restores roughly the desktop field of view
 * without changing the diorama look — the pitch is untouched, so it is the same
 * picture seen from a little further away.
 */
const MOBILE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const EASE_DIST = MOBILE ? 1.16 : 1;
const EASE_HEIGHT = MOBILE ? 1.1 : 1;
const EASE_FOV = MOBILE ? 4.5 : 0;

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
  /** The kick's visible envelope: ramps in, eases out. See `update`. */
  private surge = 0;

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
      dist: (lerp(11, 30, e) + radius * 1.35) * EASE_DIST,
      height: (lerp(17, 46, e) + radius * 1.6) * EASE_HEIGHT,
      fov: lerp(30, 34, t) + EASE_FOV,
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
    // A snap is a cut, so nothing survives it. The camera outlives a run, and
    // restarting mid tier-up used to carry that tier-up's punch into the first
    // second of the new one.
    this.kick = 0;
    this.surge = 0;
    this.shakeAmp = 0;
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
    this.dist = damp(this.dist, f.dist, 0.02, dt);
    this.height = damp(this.height, f.height, 0.02, dt);

    // Impacts are a *fraction of the framing*, not a number of metres.
    //
    // The punch and the shake were both flat world offsets — 3.5 m of dolly,
    // about half a metre of wobble. At the opening framing the camera is 11 m
    // out and that is a real jolt; by tier 8 it is 38 m out and 55 m up, where
    // the same numbers move the picture two or three pixels. So a tier-up — and
    // then a demolition — quietly stopped being felt at exactly the point in
    // the run where the biggest things happen.
    //
    // The offsets are applied *here*, to local values, and never written back
    // into `this.dist`. Folding them into the smoothed state is how the
    // original produced its punch — it added 3.5 m *per frame* and let the damp
    // claw a few percent back, which stacked into a peak of about 2.5× the
    // framing. Two problems with that: it diverges outright if the offset is
    // made proportional, and being per-frame it was frame-rate dependent — the
    // same tier-up whipped the camera out 2.5× at 60 fps and 3.9× at 120.
    //
    // `surge` reproduces the shape honestly instead: a follower chasing the
    // decaying kick, which ramps over ~250 ms and eases back, peaking at
    // `PUNCH_GAIN / e` times the kick. The gain is set so a tier-up peaks at
    // the same 2.46× it used to at 60 fps — now at any refresh rate, and at any
    // ball size rather than fading to 1.4× by the top tier.
    this.surge = damp(this.surge, this.kick * PUNCH_GAIN, 0.02, dt);
    const framing = this.dist / SHAKE_BASE;
    const dist = this.dist * (1 + this.surge);
    const height = this.height * (1 + this.surge * 0.46);

    const cx = this.focus.x + Math.sin(YAW) * dist;
    const cz = this.focus.z + Math.cos(YAW) * dist;
    this.cam.position.set(cx, this.focus.y + height, cz);

    if (this.shakeAmp > 0.0005) {
      this.shakeT += dt;
      // Two decaying sines at incommensurate frequencies read as a real impact
      // rather than a vibration.
      const e = this.shakeAmp * Math.exp(-this.shakeT * 7) * framing;
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
