/**
 * Keeps the ball cheap no matter how much city is welded to it.
 *
 * A ball with 600 absorbed props would be 600 draw calls if each stayed a Mesh.
 * Instead props live as individual meshes only while their pop-in animation
 * plays; after that they are welded into *chunks* (one merged BufferGeometry
 * per material per chunk).
 *
 * Everything expensive here is bounded per frame, because merging is the one
 * thing this class does that can stall the loop. Profiling at tier 8 showed a
 * 6 ms median against a 150 ms worst frame — the median was never the problem,
 * the stalls were. So: at most one weld per frame, consolidation merges only
 * two chunks at a time, and a chunk past `SEALED_TRIS` is never merged again.
 *
 * Two independent mechanisms then keep the ball small. `pruneBuried` drops
 * layers the ball has visibly grown past, and `enforceBudget` caps total welded
 * triangles outright, discarding the deepest first. The ball is opaque, so only
 * a shell is ever visible; everything under it is paid for twice — once in the
 * main pass and again in the shadow pass — and shows nothing.
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
/** Above this, chunks for a material are consolidated. */
const MAX_CHUNKS = 4;
/**
 * A chunk welded when the ball was this much smaller than it is now sits
 * entirely inside the current sphere, so it can be thrown away unseen.
 */
const BURIED_RATIO = 0.62;
/**
 * Weld once this many props are waiting, rather than holding out for a full
 * `CHUNK_SIZE`. Settled props are still individual meshes, so a backlog is pure
 * draw calls: at tier 8 the ball eats fast enough that waiting for full chunks
 * left ~100 individual meshes standing, a quarter of the frame's draw calls for
 * only 49k triangles. Small frequent merges are far cheaper than that backlog,
 * and stay bounded because only one runs per frame.
 */
const SETTLED_MIN_WELD = 6;
/**
 * Hard ceiling on triangles welded to the ball, deepest dropped first.
 *
 * The ball is an opaque sphere, so only a shell of props is ever visible; the
 * rest is paid for twice (main pass and shadow pass) and shows nothing. A
 * budget bounds that directly, where the old radius heuristic only guessed at
 * it — and guessed differently depending on how chunks happened to merge.
 */
const BALL_TRI_BUDGET = 60000;
/**
 * A chunk this large is never merged again. Without it, pairwise merging keeps
 * folding new geometry into the same ever-growing chunk, so the "bounded" merge
 * grows without limit and the frame spikes come back.
 */
const SEALED_TRIS = 15000;

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
  chunks: { mesh: Mesh; radius: number; tris: number }[];
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
    this.pruneBuried();
  }

  /** Triangle count of a geometry, for the ball's budget. */
  private static tris(g: BufferGeometry): number {
    const idx = g.index;
    const pos = g.getAttribute('position');
    return (idx ? idx.count : (pos?.count ?? 0)) / 3;
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

  /**
   * Advances pop-in animations and retires finished props into chunks.
   *
   * `radius` is the ball's current radius, so burial can be reclaimed
   * continuously instead of only at tier-ups.
   */
  update(dt: number, radius?: number) {
    if (radius !== undefined) this.radius = radius;

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

    // At most one weld per frame. Flushing every eligible bucket in the same
    // frame stacked several merges together, and merging is the single most
    // expensive thing this class does — measured at tier 8 as a 150 ms worst
    // frame against a 6 ms median. One bounded merge per frame keeps the ball
    // just as cheap to draw without ever stalling the loop.
    let worst: Bucket | undefined;
    for (const b of this.buckets.values()) {
      if (b.settled.length < SETTLED_MIN_WELD) continue;
      if (!worst || b.settled.length > worst.settled.length) worst = b;
    }
    if (worst) this.flush(worst);

    // Reclaim buried layers as they become buried. Doing this only on tier-ups
    // meant the ball carried everything through the whole of a tier, which is
    // exactly the stretch where it is largest and the camera sees most.
    this.pruneBuried();
    this.enforceBudget();
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
    b.chunks.push({ mesh, radius: this.radius, tris: BallBaker.tris(merged) });

    if (b.chunks.length > MAX_CHUNKS) this.consolidate(b);
  }

  /**
   * Merges the two deepest chunks, and only those.
   *
   * Previously this re-merged *every* chunk for the material each time the cap
   * was passed, so the cost grew with the whole ball and recurred every ~96
   * props — an unbounded merge on the main thread, and the main source of late
   * frame spikes. Pairwise merging is bounded work and reaches the same chunk
   * count over the same number of absorbs.
   *
   * Merging only *adjacent* chunks also fixes a correctness trap. The old code
   * gave the combined chunk the oldest member's radius, which made a chunk
   * holding freshly-stuck surface props eligible for pruning at the next
   * tier-up — quietly deleting things the player just watched stick. Adjacent
   * chunks were welded at similar radii, so the combined radius is honest
   * either way; the newer of the two is used, which errs toward keeping
   * geometry rather than dropping it.
   */
  private consolidate(b: Bucket) {
    b.chunks.sort((x, y) => x.radius - y.radius);
    // Sealed chunks are left out: folding them back in is what made the merge
    // cost grow with the whole ball.
    const open = b.chunks.filter((c) => c.tris < SEALED_TRIS);
    const a = open[0];
    const c = open[1];
    if (!a || !c) return;

    const merged = BufferGeometryUtils.mergeGeometries(
      [a.mesh.geometry, c.mesh.geometry],
      false
    );
    if (!merged) return;

    for (const old of [a, c]) {
      this.parent.remove(old.mesh);
      old.mesh.geometry.dispose();
      b.chunks.splice(b.chunks.indexOf(old), 1);
    }

    const mesh = new Mesh(merged, b.material);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    this.parent.add(mesh);
    b.chunks.unshift({
      mesh,
      radius: Math.max(a.radius, c.radius),
      tris: a.tris + c.tris,
    });
  }

  /**
   * Drops the most deeply buried chunks until the ball fits its triangle
   * budget. This is the blunt, reliable half of the compaction: burial
   * heuristics decide what *might* be invisible, this decides how much the ball
   * is allowed to cost regardless.
   */
  private enforceBudget() {
    let total = 0;
    const all: { b: Bucket; i: number; radius: number; tris: number }[] = [];
    for (const b of this.buckets.values()) {
      for (let i = 0; i < b.chunks.length; i++) {
        total += b.chunks[i].tris;
        all.push({ b, i, radius: b.chunks[i].radius, tris: b.chunks[i].tris });
      }
    }
    if (total <= BALL_TRI_BUDGET) return;

    // Deepest (smallest weld radius) first — those sit furthest inside.
    all.sort((x, y) => x.radius - y.radius);
    for (const entry of all) {
      if (total <= BALL_TRI_BUDGET) break;
      // Never strip a bucket to nothing; the newest chunk is the visible shell.
      if (entry.b.chunks.length <= 1) continue;
      const idx = entry.b.chunks.findIndex((c) => c.radius === entry.radius && c.tris === entry.tris);
      if (idx < 0) continue;
      const chunk = entry.b.chunks[idx];
      this.parent.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      entry.b.chunks.splice(idx, 1);
      total -= chunk.tris;
    }
  }

  /** Drops chunks the ball has since swallowed. Cheap enough to run per frame. */
  private pruneBuried() {
    const cutoff = this.radius * BURIED_RATIO;
    for (const b of this.buckets.values()) {
      for (let i = b.chunks.length - 1; i >= 0; i--) {
        if (b.chunks[i].radius >= cutoff) continue;
        this.parent.remove(b.chunks[i].mesh);
        b.chunks[i].mesh.geometry.dispose();
        b.chunks.splice(i, 1);
      }
    }
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
