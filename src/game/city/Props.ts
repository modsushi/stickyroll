/**
 * Static absorbable props.
 *
 * Props of the same model share one batch, but batches are **chunked
 * spatially** rather than being one batch per model across the whole level.
 * A single map-wide batch has a map-wide bounding sphere, which means the GPU
 * draws all four thousand props every frame — twice, once for the shadow pass —
 * no matter that the camera can only see a sixth of the district. Chunking gives
 * three.js bounds it can actually cull against, and cuts the frame in half.
 *
 * "Absorbing" a prop hides its instance by collapsing it to zero scale: cheaper
 * and hitch-free compared to rebuilding the instance buffer, and the slot is
 * simply never reused.
 */

import {
  BufferGeometry,
  Euler,
  Group,
  Material,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { MeshBatch } from '../../render/Batch';
import { assets } from '../../core/Assets';
import type { PropDef } from '../../data/props';
import type { HashItem } from '../SpatialHash';

/**
 * Side length of a culling chunk, in metres. Tuned against the *widest* camera
 * (max ball size), where a small chunk means dozens of batches on screen at
 * once and the culling win stops paying for the draw calls it costs.
 */
const CHUNK = 70;
/**
 * Props smaller than this don't cast shadows. A bolt's shadow is a couple of
 * pixels, but it costs a full shadow-map draw — and the soft contact decals
 * already ground everything.
 */
const SHADOW_MIN_SIZE = 0.55;

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3();

export interface PropInstance extends HashItem {
  def: PropDef;
  /**
   * Collision-only: this can never be absorbed at any ball size.
   *
   * Scenery buildings are drawn as merged instances and have no prop entry, so
   * without an explicit marker they were absent from the spatial hash entirely
   * and the ball rolled straight through every tower on the map.
   */
  blocker?: boolean;
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
  absorbed: boolean;
  /** Geometry handed to the baker when absorbed. */
  geometry: BufferGeometry;
  material: Material;
  /** Collapses this instance in its batch. */
  hide: () => void;
}

interface Batch {
  mesh: MeshBatch;
  used: number;
}

const chunkKey = (x: number, z: number) =>
  `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;

export class Props {
  readonly group = new Group();
  readonly all: PropInstance[] = [];
  private batches = new Map<string, Batch>();
  private counts = new Map<string, number>();

  constructor() {
    this.group.name = 'props';
  }

  private key(def: PropDef, x: number, z: number) {
    return `${def.kit}/${def.model}#${chunkKey(x, z)}`;
  }

  /** Two-pass build: count first so each batch is sized exactly. */
  reserve(def: PropDef, x: number, z: number) {
    const k = this.key(def, x, z);
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
  }

  allocate() {
    for (const [key, count] of this.counts) {
      if (this.batches.has(key)) continue;
      const [path] = key.split('#');
      const [kit, model] = path.split('/');
      const src = assets.get(kit as PropDef['kit'], model);
      const mesh = new MeshBatch(src.geometry, src.material, count);
      mesh.setShadows(false, true);
      mesh.visibleCount = 0;
      this.group.add(mesh);
      this.batches.set(key, { mesh, used: 0 });
    }
  }

  add(def: PropDef, x: number, z: number, rotY: number, scaleMul = 1): PropInstance {
    const key = this.key(def, x, z);
    const batch = this.batches.get(key);
    if (!batch) throw new Error(`prop batch not allocated: ${key}`);

    const src = assets.get(def.kit, def.model);
    const scale = (def.scale ?? 1) * scaleMul;
    const slot = batch.used++;
    batch.mesh.visibleCount = batch.used;
    // Shadow casting is a per-batch flag, so the batch casts if anything in it
    // is big enough to be worth it.
    if (def.absorbSize >= SHADOW_MIN_SIZE) batch.mesh.setShadows(true, true);

    _p.set(x, 0, z);
    _e.set(0, rotY, 0);
    _q.setFromEuler(_e);
    _s.setScalar(scale);
    _m.compose(_p, _q, _s);
    batch.mesh.setMatrixAt(slot, _m);

    const inst: PropInstance = {
      def,
      x,
      z,
      // Absorb tests are 2D, but the y of the prop's visual centre is used to
      // place it on the ball's surface at the right height.
      y: src.size.y * scale * 0.5,
      rotY,
      scale,
      absorbed: false,
      geometry: src.geometry,
      material: src.material,
      hide: () => batch.mesh.hideAt(slot),
    };
    this.all.push(inst);
    return inst;
  }

  /**
   * Computes per-batch bounds once placement is done. Without this every
   * a batch keeps the *source model's* bounding sphere, which sits at the
   * origin and makes culling reject batches that are plainly on screen.
   */
  finalize() {
    for (const b of this.batches.values()) {
      // build() bakes a merged batch; computeBoundingSphere covers both paths.
      b.mesh.build();
      b.mesh.computeBoundingSphere();
      b.mesh.setCulling(true);
    }
  }

  /** Batches in play. Only the on-screen ones become draw calls. */
  get batchCount() {
    return this.batches.size;
  }

  clear() {
    for (const b of this.batches.values()) {
      b.mesh.dispose();
      this.group.remove(b.mesh);
    }
    this.batches.clear();
    this.counts.clear();
    this.all.length = 0;
  }
}

/**
 * Instancing for non-absorbable scenery, chunked spatially like the props.
 *
 * One batch per model looks cheaper on paper — 30 draw calls instead of 90 —
 * but a batch holding buildings from all over the district has a district-sized
 * bounding sphere, so it is never culled, in the main pass *or the shadow pass*.
 * That put a quarter of a million triangles through the shadow map every frame
 * no matter where the camera was. Chunking trades a few draw calls for bounds
 * the renderer can actually reject, and it is the difference between 60fps and
 * 30 at full ball size.
 *
 * `chunk = 0` disables chunking, for content like the skyline that is genuinely
 * visible from everywhere.
 */
export function chunkedScenery(
  items: { kit: string; model: string; x: number; z: number; rotY: number; scale: number }[],
  chunk = 60
): { group: Group; batches: number } {
  const group = new Group();
  group.name = 'buildings';

  // Chunking only pays when there is enough geometry for culling to reject.
  // Below this, splitting just multiplies draw calls for nothing.
  const worthChunking = chunk > 0 && items.length >= 120;
  const key = (b: { x: number; z: number }) =>
    worthChunking ? `#${Math.floor(b.x / chunk)},${Math.floor(b.z / chunk)}` : '';

  const buckets = new Map<string, typeof items>();
  for (const b of items) {
    const k = `${b.kit}/${b.model}${key(b)}`;
    let arr = buckets.get(k);
    if (!arr) buckets.set(k, (arr = []));
    arr.push(b);
  }

  const o = new Vector3();
  for (const [bucketKey, list] of buckets) {
    const [kit, model] = bucketKey.split('#')[0].split('/');
    const src = assets.get(kit as PropDef['kit'], model);
    const mesh = new MeshBatch(src.geometry, src.material, list.length);
    mesh.setShadows(true, true);
    mesh.visibleCount = list.length;
    list.forEach((b, i) => {
      o.set(b.x, 0, b.z);
      _e.set(0, b.rotY, 0);
      _q.setFromEuler(_e);
      _s.setScalar(b.scale);
      _m.compose(o, _q, _s);
      mesh.setMatrixAt(i, _m);
    });
    mesh.build();
    mesh.computeBoundingSphere();
    mesh.setCulling(true);
    group.add(mesh);
  }
  return { group, batches: buckets.size };
}
