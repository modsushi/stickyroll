/**
 * Keeps the ball cheap no matter how much city is welded to it.
 *
 * A ball with 600 absorbed props would be 600 draw calls if each stayed a Mesh.
 * Instead props live as individual meshes only while their pop-in animation
 * plays; after that they are welded into fixed-size *chunks* (one merged
 * BufferGeometry per material per chunk). Chunk merges are bounded work, so
 * there is never a frame-long stall, and once a material accumulates too many
 * chunks they are consolidated into one — rare, but it caps the draw calls.
 *
 * Finally, `prune` throws away whole layers the ball has grown past. A maxed-out
 * ball has swallowed a couple of thousand objects, nearly all of them buried
 * inside an opaque sphere where they cost triangles (twice, with the shadow
 * pass) and show nothing.
 */

import {
  BufferGeometry,
  Group,
  Material,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { easeOutBack } from '../core/Math';

/** Props kept as live meshes while they animate in. */
const POP_TIME = 0.26;
/** Props welded per chunk. Bigger = fewer draw calls, longer merge spikes. */
const CHUNK_SIZE = 24;
/** Above this, chunks for a material are consolidated into one. */
const MAX_CHUNKS = 4;
/**
 * A chunk welded when the ball was this much smaller than it is now sits
 * entirely inside the current sphere, so it can be thrown away unseen.
 */
const BURIED_RATIO = 0.62;

interface Live {
  mesh: Mesh;
  material: Material;
  geometry: BufferGeometry;
  /** Final local transform on the ball, reached when the pop finishes. */
  target: Matrix4;
  /** Where it started (its world pose at contact, converted to ball space). */
  from: Matrix4;
  t: number;
}

interface Bucket {
  material: Material;
  /**
   * Props that have finished animating but aren't welded yet. They stay in the
   * scene as individual meshes the whole time — a prop must never blink out
   * while it waits for its chunk to fill.
   */
  settled: { mesh: Mesh; geometry: BufferGeometry; matrix: Matrix4 }[];
  /** Each chunk remembers the ball radius when it was welded, so `prune` can
   *  tell which ones the ball has since swallowed. */
  chunks: { mesh: Mesh; radius: number }[];
}

// Preallocated scratch. `update` runs over every live prop every frame, so
// allocating here would hand the GC a steady drip of garbage during play.
const _pos = new Vector3();
const _quat = new Quaternion();
const _scale = new Vector3();
const _posB = new Vector3();
const _quatB = new Quaternion();
const _scaleB = new Vector3();
const _m = new Matrix4();

export class BallBaker {
  private live: Live[] = [];
  private buckets = new Map<Material, Bucket>();
  /** Total props welded on, for stats and the HUD. */
  count = 0;
  /** Current ball radius, so chunks record the size they were welded at. */
  radius = 0.4;

  constructor(private parent: Group) {}

  /**
   * Drops geometry the ball has grown past.
   *
   * By the top tiers the ball carries a couple of thousand objects, and the
   * great majority are buried metres inside an opaque sphere — pure cost,
   * rendered twice over once the shadow pass is counted. Anything welded on
   * when the ball was under `BURIED_RATIO` of its current size cannot be
   * visible, so it goes. Called on tier-ups, which is exactly when the ball
   * outgrows a layer.
   */
  prune(radius: number) {
    this.radius = radius;
    const cutoff = radius * BURIED_RATIO;
    for (const b of this.buckets.values()) {
      for (let i = b.chunks.length - 1; i >= 0; i--) {
        if (b.chunks[i].radius >= cutoff) continue;
        this.parent.remove(b.chunks[i].mesh);
        b.chunks[i].mesh.geometry.dispose();
        b.chunks.splice(i, 1);
      }
    }
  }

  private bucket(material: Material): Bucket {
    let b = this.buckets.get(material);
    if (!b) this.buckets.set(material, (b = { material, settled: [], chunks: [] }));
    return b;
  }

  /**
   * @param localTarget where the prop should end up, in ball-spinner space
   * @param localStart   its pose at the moment of contact, in the same space
   */
  add(
    geometry: BufferGeometry,
    material: Material,
    localTarget: Matrix4,
    localStart: Matrix4
  ) {
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = false; // self-shadowing on the ball reads as noise
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(localStart);
    this.parent.add(mesh);

    this.live.push({
      mesh,
      material,
      geometry,
      target: localTarget.clone(),
      from: localStart.clone(),
      t: 0,
    });
    this.count++;
  }

  /** Advances pop-in animations and retires finished props into chunks. */
  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i];
      l.t += dt / POP_TIME;

      if (l.t >= 1) {
        // Freeze it in place and hand it to its bucket. The mesh stays in the
        // scene — welding happens later, invisibly.
        l.mesh.matrix.copy(l.target);
        l.mesh.matrixWorldNeedsUpdate = true;
        this.retire(l);
        this.live.splice(i, 1);
        continue;
      }

      // Interpolate TRS separately so the overshoot applies to scale only —
      // overshooting position would push props through the ball surface.
      const e = Math.min(1, l.t);
      lerpMatrix(_m, l.from, l.target, e, easeOutBack(e, 2.2));
      l.mesh.matrix.copy(_m);
      l.mesh.matrixWorldNeedsUpdate = true;
    }

    for (const b of this.buckets.values()) {
      if (b.settled.length >= CHUNK_SIZE) this.flush(b);
    }
  }

  private retire(l: Live) {
    const b = this.bucket(l.material);
    b.settled.push({ mesh: l.mesh, geometry: l.geometry, matrix: l.target });
  }

  /** Welds a bucket's settled props into one chunk mesh and drops the originals. */
  private flush(b: Bucket) {
    if (!b.settled.length) return;

    const parts: BufferGeometry[] = [];
    for (const s of b.settled) {
      const g = s.geometry.clone();
      g.applyMatrix4(s.matrix);
      parts.push(g);
    }
    const merged = BufferGeometryUtils.mergeGeometries(parts, false);
    for (const g of parts) g.dispose();

    // Only drop the individual meshes once the merge actually succeeded,
    // otherwise a failed weld would silently delete part of the ball.
    if (!merged) return;
    for (const s of b.settled) this.parent.remove(s.mesh);
    b.settled.length = 0;

    const mesh = new Mesh(merged, b.material);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false; // it's always on screen; culling it costs more
    this.parent.add(mesh);
    b.chunks.push({ mesh, radius: this.radius });

    if (b.chunks.length > MAX_CHUNKS) this.consolidate(b);
  }

  private consolidate(b: Bucket) {
    const geos = b.chunks.map((c) => c.mesh.geometry);
    const merged = BufferGeometryUtils.mergeGeometries(geos, false);
    if (!merged) return;
    // The merged chunk inherits the *oldest* radius, so pruning still treats it
    // as the deep layer it mostly is.
    const oldest = Math.min(...b.chunks.map((c) => c.radius));
    for (const c of b.chunks) {
      this.parent.remove(c.mesh);
      c.mesh.geometry.dispose();
    }
    b.chunks.length = 0;

    const mesh = new Mesh(merged, b.material);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    this.parent.add(mesh);
    b.chunks.push({ mesh, radius: oldest });
  }

  /** Draw calls currently used by absorbed props. Surfaced in the perf HUD. */
  get drawCalls() {
    let n = this.live.length;
    for (const b of this.buckets.values()) n += b.chunks.length + b.settled.length;
    return n;
  }

  clear() {
    for (const l of this.live) this.parent.remove(l.mesh);
    this.live.length = 0;
    for (const b of this.buckets.values()) {
      for (const c of b.chunks) {
        this.parent.remove(c.mesh);
        c.mesh.geometry.dispose();
      }
      for (const s of b.settled) this.parent.remove(s.mesh);
    }
    this.buckets.clear();
    this.count = 0;
  }
}

/** Decomposed TRS interpolation, with a separate eased curve for scale. */
function lerpMatrix(out: Matrix4, a: Matrix4, b: Matrix4, t: number, scaleT: number) {
  a.decompose(_pos, _quat, _scale);
  b.decompose(_posB, _quatB, _scaleB);
  _pos.lerp(_posB, t);
  _quat.slerp(_quatB, t);
  _scale.lerp(_scaleB, scaleT);
  out.compose(_pos, _quat, _scale);
}

/** Converts a world-space object pose into ball-spinner local space. */
export function worldToLocal(out: Matrix4, obj: Object3D, spinner: Object3D): Matrix4 {
  obj.updateMatrixWorld(true);
  spinner.updateMatrixWorld(true);
  return out.copy(spinner.matrixWorld).invert().multiply(obj.matrixWorld);
}
