/**
 * Batched drawing that can avoid instancing.
 *
 * Chrome on Android drives Samsung's Xclipse GPU through ANGLE's Vulkan
 * backend, and on that path an instanced draw whose shader reads the normal
 * attribute renders black — and takes the frame's clear with it, so the sky
 * disappears too. The result is a black screen flickering hard-edged wedges of
 * correct city wherever a tile happened to survive.
 *
 * This was proved on-device with `?selftest=1`, which drew the same buildings
 * twice, back to back, in the same scene with the same material and lights:
 *
 *   PASS 9/9  buildings: de-instanced, lit        [68 calls, 72k tris]
 *   FAIL 0/9  buildings: instanced, lit (control) [ 9 calls, 63k tris]
 *
 * Unlit instanced draws are unaffected, which is why the particles and decals
 * (both `MeshBasicMaterial`) were always fine, and why the bug looked like a
 * lighting or post-processing problem for so long.
 *
 * A boot-time probe is deliberately *not* used to detect this: the same device
 * renders an isolated instanced lit mesh perfectly, and only fails inside the
 * full scene, so a small probe reports a false all-clear.
 *
 * Three backends, chosen by `batchMode`:
 *
 * - `instanced` — an `InstancedMesh`, as before.
 * - `merged`    — every instance baked into one `BufferGeometry`. For static
 *                 content this is *fewer* draw calls than instancing, so the
 *                 fallback costs nothing; the trade is vertex memory.
 * - `meshes`    — one ordinary `Mesh` per instance, for content whose
 *                 transforms change every frame and so cannot be baked.
 */

import {
  type BufferGeometry,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  Sphere,
} from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type BatchMode = 'instanced' | 'merged' | 'meshes';

const _m = new Matrix4();

/** True for phones and tablets. */
const isTouch = () =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * Picks a backend. `dynamic` means the transforms change after build, which
 * rules out merging.
 *
 * Desktop keeps instancing: it is known good there, and leaving the working
 * platform on its existing path keeps the blast radius of this fix small.
 * `?instancing=off` forces the fallback anywhere, so the mobile path can be
 * exercised on a desktop.
 */
export function batchMode(dynamic: boolean): BatchMode {
  const q = typeof location === 'undefined' ? '' : location.search;
  if (/[?&]instancing=on/.test(q)) return 'instanced';
  const avoid = /[?&]instancing=off/.test(q) || isTouch();
  if (!avoid) return 'instanced';
  return dynamic ? 'meshes' : 'merged';
}

/**
 * An `InstancedMesh`-shaped batch that may not be instanced underneath.
 *
 * Only the surface the game actually uses is implemented: `setMatrixAt`,
 * `getMatrixAt`, `count`, the shadow flags, bounds and disposal.
 */
export class MeshBatch extends Group {
  readonly mode: BatchMode;
  readonly capacity: number;

  private geo: BufferGeometry;
  private mat: Material | Material[];
  private inst?: InstancedMesh;
  private merged?: Mesh;
  private kids: Mesh[] = [];
  /** Per-slot transforms, kept so a merged batch can be baked lazily. */
  private matrices: Matrix4[] = [];
  /** Vertex ranges in the merged geometry, for collapsing a single slot. */
  private ranges: { start: number; count: number }[] = [];
  private used = 0;
  private built = false;
  private wantCast = false;
  private wantReceive = false;

  constructor(
    geometry: BufferGeometry,
    material: Material | Material[],
    capacity: number,
    mode: BatchMode = batchMode(false)
  ) {
    super();
    this.geo = geometry;
    this.mat = material;
    this.capacity = Math.max(1, capacity);
    this.mode = mode;

    if (mode === 'instanced') {
      this.inst = new InstancedMesh(geometry, material, this.capacity);
      this.inst.count = 0;
      this.add(this.inst);
    }
  }

  /**
   * How many slots draw. Named `visibleCount` rather than `count` on purpose:
   * `Object3D` already declares a `count`, and shadowing it with an accessor
   * that stores elsewhere risks confusing three's own bookkeeping.
   */
  get visibleCount() {
    return this.used;
  }

  set visibleCount(n: number) {
    this.used = Math.min(n, this.capacity);
    if (this.inst) this.inst.count = this.used;
    if (this.mode === 'meshes') {
      for (let i = 0; i < this.kids.length; i++) this.kids[i].visible = i < this.used;
    }
  }

  setMatrixAt(i: number, m: Matrix4) {
    if (i >= this.capacity) return;
    // Grows the drawn range automatically. Requiring callers to also set
    // `visibleCount` meant a batch that filled every slot could still bake
    // nothing and silently disappear — which is exactly what happened to the
    // roads. Callers that want fewer slots drawn can still set it explicitly.
    if (i + 1 > this.used) this.visibleCount = i + 1;
    if (this.inst) {
      this.inst.setMatrixAt(i, m);
      this.inst.instanceMatrix.needsUpdate = true;
      return;
    }

    if (!this.matrices[i]) this.matrices[i] = new Matrix4();
    this.matrices[i].copy(m);

    if (this.mode === 'meshes') {
      let child = this.kids[i];
      if (!child) {
        child = new Mesh(this.geo, this.mat);
        child.matrixAutoUpdate = false;
        child.castShadow = this.wantCast;
        child.receiveShadow = this.wantReceive;
        this.kids[i] = child;
        this.add(child);
      }
      child.matrix.copy(m);
      child.matrixWorldNeedsUpdate = true;
    } else if (this.built) {
      // Rebaking the whole batch for one changed transform would be far worse
      // than the instancing it replaces, so merged batches are build-once.
      // Callers that need per-frame movement must ask for a dynamic batch.
      console.warn('[batch] merged batch cannot move after build');
    }
  }

  getMatrixAt(i: number, target: Matrix4) {
    if (this.inst) this.inst.getMatrixAt(i, target);
    else target.copy(this.matrices[i] ?? _m.identity());
    return target;
  }

  /**
   * Collapses one slot so it stops drawing — the merged-geometry equivalent of
   * writing a zero-scale instance matrix.
   */
  hideAt(i: number) {
    if (this.inst) {
      this.inst.setMatrixAt(i, _m.makeScale(0, 0, 0));
      this.inst.instanceMatrix.needsUpdate = true;
      return;
    }
    if (this.mode === 'meshes') {
      if (this.kids[i]) this.kids[i].visible = false;
      return;
    }
    const range = this.ranges[i];
    const pos = this.merged?.geometry.getAttribute('position');
    if (!range || !pos) return;
    // Every vertex to a single point: the triangles become degenerate and are
    // discarded before rasterisation.
    const arr = pos.array as Float32Array;
    arr.fill(0, range.start * 3, (range.start + range.count) * 3);
    pos.needsUpdate = true;
  }

  /** Bakes a merged batch. Safe to call more than once; only the first counts. */
  build() {
    if (this.mode !== 'merged' || this.built) return;
    this.built = true;

    const parts: BufferGeometry[] = [];
    let vertexStart = 0;
    for (let i = 0; i < this.used; i++) {
      const m = this.matrices[i];
      if (!m) continue;
      const g = this.geo.clone().applyMatrix4(m);
      const n = g.getAttribute('position').count;
      this.ranges[i] = { start: vertexStart, count: n };
      vertexStart += n;
      parts.push(g);
    }
    if (!parts.length) return;

    const merged = BufferGeometryUtils.mergeGeometries(parts, false) ?? parts[0];
    for (const p of parts) p.dispose();

    const mesh = new Mesh(merged, this.mat);
    mesh.castShadow = this.wantCast;
    mesh.receiveShadow = this.wantReceive;
    this.merged = mesh;
    this.add(mesh);
  }

  computeBoundingSphere() {
    this.build();
    if (this.inst) {
      this.inst.computeBoundingSphere();
      return;
    }
    this.merged?.geometry.computeBoundingSphere();
    for (const k of this.kids) k.geometry.computeBoundingSphere();
  }

  /** Combined world-space bounds, for callers that cull the whole batch. */
  boundingSphere(): Sphere | null {
    this.build();
    const g = this.inst?.geometry ?? this.merged?.geometry;
    if (!g) return null;
    if (!g.boundingSphere) g.computeBoundingSphere();
    return g.boundingSphere;
  }

  setShadows(cast: boolean, receive: boolean) {
    this.wantCast = cast;
    this.wantReceive = receive;
    if (this.inst) {
      this.inst.castShadow = cast;
      this.inst.receiveShadow = receive;
    }
    if (this.merged) {
      this.merged.castShadow = cast;
      this.merged.receiveShadow = receive;
    }
    for (const k of this.kids) {
      k.castShadow = cast;
      k.receiveShadow = receive;
    }
  }

  setCulling(on: boolean) {
    if (this.inst) this.inst.frustumCulled = on;
    if (this.merged) this.merged.frustumCulled = on;
    for (const k of this.kids) k.frustumCulled = on;
  }

  dispose() {
    this.inst?.dispose();
    this.merged?.geometry.dispose();
    this.clear();
    this.kids.length = 0;
  }
}
