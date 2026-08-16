/**
 * Free-look debug camera, enabled with `?fly=1`.
 *
 * Detaches the view from the ball so the level can be inspected directly:
 * click to capture the mouse, then WASD to move, mouse to look. Nothing here
 * touches the simulation — the ball stays where it is and the world keeps
 * running, so traffic, pedestrians and shadows can all be watched from any
 * angle.
 *
 * Runs *after* the follow camera each frame and simply overwrites the
 * transform, which avoids threading an "is the camera in use" flag through the
 * game just for a debug tool.
 */

import { Euler, type PerspectiveCamera, Vector3 } from 'three';

const _forward = new Vector3();
const _right = new Vector3();
const _move = new Vector3();
const WORLD_UP = new Vector3(0, 1, 0);
/** Just short of straight up/down, so the view never flips over the pole. */
const MAX_PITCH = Math.PI / 2 - 0.02;

export class FlyCamera {
  enabled = false;
  /** Metres per second at the default speed step; `?flyspeed=N` overrides. */
  speed = 22;

  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();
  private locked = false;
  private euler = new Euler(0, 0, 0, 'YXZ');
  /**
   * The fly camera's own position. The follow camera rewrites
   * `camera.position` every frame, so accumulating movement directly onto the
   * camera just gets overwritten — it drifts a single frame's worth and snaps
   * back. Holding the position here and writing it last makes fly mode
   * authoritative.
   */
  private pos = new Vector3();

  constructor(
    private cam: PerspectiveCamera,
    private dom: HTMLElement
  ) {}

  /** Places the camera and points it at a world position. */
  placeAt(x: number, y: number, z: number, lookAt?: { x: number; y: number; z: number }) {
    this.pos.set(x, y, z);
    if (lookAt) {
      const dx = lookAt.x - x;
      const dy = lookAt.y - y;
      const dz = lookAt.z - z;
      this.yaw = Math.atan2(-dx, -dz);
      this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
    }
  }

  /**
   * Seeds orientation from wherever the follow camera currently is, so enabling
   * fly mode never snaps the view somewhere unexpected.
   */
  attach() {
    this.enabled = true;
    this.euler.setFromQuaternion(this.cam.quaternion, 'YXZ');
    this.yaw = this.euler.y;
    this.pitch = this.euler.x;
    this.pos.copy(this.cam.position);

    this.dom.addEventListener('click', () => {
      if (!this.locked) this.dom.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
    });

    addEventListener('keydown', (e) => {
      // Let the perf overlay and other single-key toggles through.
      if (e.key === 'F3' || e.key === '`') return;
      this.keys.add(e.code);
      // Stop WASD scrolling the page while the mouse is captured.
      if (this.locked) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    this.dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        e.preventDefault();
        this.speed = Math.max(2, Math.min(200, this.speed * (e.deltaY > 0 ? 0.85 : 1.18)));
      },
      { passive: false }
    );
  }

  update(dt: number) {
    if (!this.enabled) return;

    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.cam.quaternion.setFromEuler(this.euler);

    _forward.set(0, 0, -1).applyQuaternion(this.cam.quaternion);
    // Strafe stays level even when looking up or down, which is what makes
    // flying around a city feel controllable rather than swimmy.
    _right.crossVectors(_forward, WORLD_UP).normalize();

    _move.set(0, 0, 0);
    if (this.keys.has('KeyW')) _move.add(_forward);
    if (this.keys.has('KeyS')) _move.sub(_forward);
    if (this.keys.has('KeyD')) _move.add(_right);
    if (this.keys.has('KeyA')) _move.sub(_right);
    if (this.keys.has('Space') || this.keys.has('KeyE')) _move.add(WORLD_UP);
    if (this.keys.has('KeyQ') || this.keys.has('KeyC')) _move.sub(WORLD_UP);

    if (_move.lengthSq() > 0) {
      const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4 : 1;
      const crawl = this.keys.has('AltLeft') || this.keys.has('AltRight') ? 0.2 : 1;
      _move.normalize().multiplyScalar(this.speed * boost * crawl * dt);
      this.pos.add(_move);
    }
    this.cam.position.copy(this.pos);
  }

  /**
   * Two lines for the perf overlay. The position is shown because it is the
   * only way to tell at a glance whether the camera is actually being driven —
   * a still image of a static scene looks identical either way.
   */
  describe() {
    const p = this.pos;
    const where = `${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}`;
    return (
      `fly    ${where}  ${this.speed.toFixed(0)}m/s` +
      (this.locked ? '  (esc to release)' : '  (click to look)')
    );
  }
}
