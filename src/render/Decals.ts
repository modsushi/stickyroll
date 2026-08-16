/**
 * Ground contact shadow under the ball.
 *
 * A real shadow map at this softness would need a huge blur budget, but the
 * reference art's grounding cue is just a soft dark disc — so that's what this
 * is: one additively-darkened quad with a radial-gradient texture, scaled with
 * the ball. It costs one draw call and does more for "the ball is touching the
 * street" than any amount of shadow filtering.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
} from 'three';
import type { Ball } from '../game/Ball';
import type { BuiltCity } from '../game/city/CityBuilder';

function blobTexture(): CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Solid-ish core with a long soft falloff reads as ambient occlusion rather
  // than a painted circle.
  g.addColorStop(0, 'rgba(10,6,24,0.78)');
  g.addColorStop(0.3, 'rgba(12,8,26,0.52)');
  g.addColorStop(0.62, 'rgba(14,10,28,0.2)');
  g.addColorStop(0.85, 'rgba(16,12,30,0.05)');
  g.addColorStop(1, 'rgba(16,12,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class Decals {
  readonly group = new Group();
  private blob: Mesh;
  private ring: Mesh;
  private ringMat: MeshBasicMaterial;

  constructor(_city: BuiltCity) {
    this.group.name = 'decals';

    const geo = new PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.blob = new Mesh(
      geo,
      new MeshBasicMaterial({
        map: blobTexture(),
        transparent: true,
        depthWrite: false,
        // Multiply-style darkening without a second pass: the texture is black
        // with alpha, so plain alpha blending darkens correctly.
        opacity: 1,
      })
    );
    this.blob.renderOrder = 1;
    this.group.add(this.blob);

    // Thin bright ring at the contact line — the reference art has one, and it
    // makes the ball's footprint legible against busy pavement.
    const ringGeo = new RingGeometry(0.94, 1.0, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.ring = new Mesh(ringGeo, this.ringMat);
    this.ring.renderOrder = 2;
    this.group.add(this.ring);
  }

  update(ball: Ball) {
    const r = ball.visualRadius;
    const s = r * 3.9;
    this.blob.position.set(ball.pos.x, 0.035, ball.pos.z);
    this.blob.scale.set(s, 1, s);

    const rs = r * 1.22;
    this.ring.position.set(ball.pos.x, 0.045, ball.pos.z);
    this.ring.scale.set(rs, 1, rs);
    // Fade the ring in with speed so a parked ball looks calm.
    const speed = Math.hypot(ball.vel.x, ball.vel.z);
    this.ringMat.opacity = 0.1 + Math.min(0.22, speed * 0.03);
  }
}
