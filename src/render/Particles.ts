/**
 * One pooled instanced-quad system for every particle in the game: dust puffs
 * as the ball rolls, confetti on a tier-up, sparkles on a collectible, and
 * expanding impact rings.
 *
 * A single InstancedMesh with per-instance colour keeps the whole effects layer
 * at one draw call. Particles are billboarded on the CPU by copying the camera's
 * rotation, which for a few hundred quads is far cheaper than a custom shader
 * and keeps them compatible with the scene's tone mapping.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { Rand } from '../core/Math';

const MAX = 420;

type Kind = 'dust' | 'confetti' | 'spark' | 'ring';

interface P {
  alive: boolean;
  kind: Kind;
  pos: Vector3;
  vel: Vector3;
  life: number;
  maxLife: number;
  size: number;
  endSize: number;
  spin: number;
  rot: number;
  color: Color;
  gravity: number;
}

function softTexture(): CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _c = new Color();

export class Particles {
  readonly group = new Group();
  private mesh: InstancedMesh;
  private pool: P[] = [];
  private next = 0;
  private rand = new Rand(0x1eaf);
  /** Set each frame by the renderer so quads face the camera. */
  readonly billboard = new Quaternion();

  constructor() {
    this.group.name = 'particles';
    const geo = new PlaneGeometry(1, 1);
    const mat = new MeshBasicMaterial({
      map: softTexture(),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    this.mesh = new InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = MAX;
    this.mesh.renderOrder = 10;
    this.group.add(this.mesh);

    for (let i = 0; i < MAX; i++) {
      this.pool.push({
        alive: false,
        kind: 'dust',
        pos: new Vector3(),
        vel: new Vector3(),
        life: 0,
        maxLife: 1,
        size: 1,
        endSize: 1,
        spin: 0,
        rot: 0,
        color: new Color(),
        gravity: 0,
      });
    }
    // Everything starts collapsed; `update` writes real matrices for live ones.
    for (let i = 0; i < MAX; i++) this.mesh.setMatrixAt(i, ZERO);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private take(): P {
    // Ring buffer: oldest particle is recycled when the pool is exhausted, which
    // is invisible at these lifetimes and avoids ever allocating mid-game.
    for (let i = 0; i < MAX; i++) {
      const p = this.pool[this.next];
      this.next = (this.next + 1) % MAX;
      if (!p.alive) return p;
    }
    const p = this.pool[this.next];
    this.next = (this.next + 1) % MAX;
    return p;
  }

  /** Rolling dust, emitted at the ball's contact point. */
  dust(x: number, z: number, radius: number, speed: number) {
    const p = this.take();
    p.alive = true;
    p.kind = 'dust';
    const a = this.rand.angle();
    p.pos.set(x + Math.cos(a) * radius * 0.7, 0.12, z + Math.sin(a) * radius * 0.7);
    p.vel.set(Math.cos(a) * 0.6, this.rand.range(0.3, 0.9), Math.sin(a) * 0.6);
    p.life = p.maxLife = this.rand.range(0.45, 0.8);
    p.size = radius * 0.35;
    p.endSize = radius * 1.1;
    p.gravity = -0.15;
    p.rot = this.rand.angle();
    p.spin = this.rand.range(-1, 1);
    // Warm pale dust; additive blending makes it read as a lit puff.
    p.color.setRGB(0.34, 0.31, 0.26).multiplyScalar(0.6 + speed * 0.03);
  }

  /** Tier-up confetti burst. */
  confetti(x: number, y: number, z: number, count: number, power: number) {
    for (let i = 0; i < count; i++) {
      const p = this.take();
      p.alive = true;
      p.kind = 'confetti';
      p.pos.set(x, y, z);
      const a = this.rand.angle();
      const up = this.rand.range(0.55, 1);
      const out = this.rand.range(0.35, 1);
      p.vel.set(Math.cos(a) * out * power, up * power * 1.4, Math.sin(a) * out * power);
      p.life = p.maxLife = this.rand.range(0.9, 1.7);
      p.size = p.endSize = this.rand.range(0.16, 0.34) * (1 + power * 0.06);
      p.gravity = -7;
      p.rot = this.rand.angle();
      p.spin = this.rand.range(-9, 9);
      // Festival palette — gold, magenta, cyan, lime.
      const hue = this.rand.pick([0.11, 0.9, 0.52, 0.28, 0.05]);
      p.color.setHSL(hue, 0.85, 0.6);
    }
  }

  /** Sparkle trail for collectibles. */
  spark(x: number, y: number, z: number, count = 6) {
    for (let i = 0; i < count; i++) {
      const p = this.take();
      p.alive = true;
      p.kind = 'spark';
      p.pos.set(x, y, z);
      const a = this.rand.angle();
      p.vel.set(Math.cos(a) * 1.6, this.rand.range(0.8, 2.4), Math.sin(a) * 1.6);
      p.life = p.maxLife = this.rand.range(0.3, 0.6);
      p.size = this.rand.range(0.2, 0.4);
      p.endSize = 0.02;
      p.gravity = -2;
      p.rot = 0;
      p.spin = 0;
      p.color.setHSL(0.13, 1, 0.72);
    }
  }

  /** Expanding flat ring — the tier-up shockwave. */
  shockwave(x: number, z: number, from: number, to: number) {
    const p = this.take();
    p.alive = true;
    p.kind = 'ring';
    p.pos.set(x, 0.2, z);
    p.vel.set(0, 0, 0);
    p.life = p.maxLife = 0.55;
    p.size = from * 2.2;
    p.endSize = to * 7;
    p.gravity = 0;
    p.rot = 0;
    p.spin = 0;
    p.color.setRGB(1, 0.93, 0.72);
  }

  update(dt: number) {
    let live = 0;
    for (let i = 0; i < MAX; i++) {
      const p = this.pool[i];
      if (!p.alive) {
        this.mesh.setMatrixAt(i, ZERO);
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        this.mesh.setMatrixAt(i, ZERO);
        continue;
      }
      live++;

      const t = 1 - p.life / p.maxLife;
      p.vel.y += p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.kind === 'confetti' && p.pos.y < 0.06) {
        // Settle on the ground rather than sinking through it.
        p.pos.y = 0.06;
        p.vel.set(p.vel.x * 0.4, 0, p.vel.z * 0.4);
        p.spin *= 0.5;
      }
      p.rot += p.spin * dt;

      const size = p.size + (p.endSize - p.size) * t;
      // Fade in fast, out slow — a linear fade looks like a bug.
      const alpha = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;

      if (p.kind === 'ring') {
        _q.setFromAxisAngle(RIGHT, -Math.PI / 2);
      } else {
        _q.copy(this.billboard);
        _qSpin.setFromAxisAngle(FORWARD, p.rot);
        _q.multiply(_qSpin);
      }
      _s.setScalar(size);
      _m.compose(p.pos, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      _c.copy(p.color).multiplyScalar(alpha);
      this.mesh.setColorAt(i, _c);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.liveCount = live;
  }

  liveCount = 0;

  dispose() {
    this.mesh.dispose();
    this.group.remove(this.mesh);
  }
}

const ZERO = new Matrix4().makeScale(0, 0, 0);
const RIGHT = new Vector3(1, 0, 0);
const FORWARD = new Vector3(0, 0, 1);
const _qSpin = new Quaternion();
