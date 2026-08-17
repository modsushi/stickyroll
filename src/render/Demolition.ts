/**
 * Levelling a building: the highlight, the flash, the rubble, the shockwave.
 *
 * Rolling over a shopfront used to be the quietest thing in the game — the
 * mesh simply stopped drawing and reappeared welded to the ball. That is the
 * top-tier payoff the whole run is aiming at, so it now gets a four-beat
 * sequence, and every beat exists to answer a different question:
 *
 *   lock      *can* I eat this? A warm outline traced around the frontage a
 *             few metres before contact, plus a ring on its plot. At tier 8
 *             most of the skyline is still immovable scenery, so the ones that
 *             can come down have to advertise it.
 *   flash     did I hit it? A bright shell of the building's own silhouette,
 *             blown up 12% and gone in a fifth of a second. This is what
 *             covers the frame where the real instance disappears.
 *   rubble    what happened to it? Three dozen lit blocks in the building's own
 *             colours, thrown away from the ball, tumbling, bouncing off the
 *             pavement and finally sinking into it.
 *   wave      how big was that? Two ground rings — a fast bright one and a slow
 *             dusty one — plus the dust cloud from the particle layer.
 *
 * ## Why the rubble is one hand-written mesh
 *
 * The obvious implementation is an `InstancedMesh` of boxes with per-instance
 * colour. Two things rule it out. Instanced *lit* draws render black on some
 * Android GPUs and take the frame's clear with them (see `Batch.ts`), and
 * per-instance colour cannot carry a *texture* lookup — the Kenney kits are one
 * shared atlas, so a block's colour is a UV, not an RGB.
 *
 * So each block is a real box baked into one shared, non-indexed-per-chunk
 * geometry that is rewritten on the CPU each frame: 24 vertices transformed per
 * live block, which at this count is nothing, and the whole field draws in one
 * ordinary lit call on every device. The UVs are the good part — each block
 * samples a random triangle of the building it came from, so brick stays brick,
 * render stays render and a window frame occasionally lands in the pile.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  type Texture,
  Vector3,
} from 'three';
import { Rand, clamp01, easeOutCubic } from '../core/Math';
import type { PropInstance } from '../game/city/Props';
import type { Particles } from './Particles';

/** Phones get a thinner pile and a thinner cloud. */
const MOBILE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Blocks per pile, before the size scaling. */
const CHUNKS = MOBILE ? 20 : 34;
/** Ceiling on live blocks per material. Two piles' worth, so overlapping
 *  demolitions recycle the oldest rather than allocating. */
const CHUNK_CAP = MOBILE ? 72 : 128;

/**
 * Gravity for rubble.
 *
 * Above 9.81 because arcade debris that falls at real speed looks like it is
 * drifting — the blocks are metres across — but a good deal below the 26 it
 * started at, which put the whole arc up and back down inside a third of a
 * second. Long enough to *see* is the point of throwing them at all.
 */
const GRAVITY = 19;
/** Seconds at the end of a block's life spent sinking into the road. */
const SINK = 0.7;

const _v = new Vector3();
const _n = new Vector3();
const _q = new Quaternion();
const _spin = new Quaternion();
const _axis = new Vector3();

// ── rubble ──────────────────────────────────────────────────────────────────

interface Chunk {
  alive: boolean;
  /** Set once when the block dies, so its vertices are collapsed exactly once. */
  dirty: boolean;
  pos: Vector3;
  vel: Vector3;
  half: Vector3;
  quat: Quaternion;
  /** Rotation axis and rate, in radians per second. */
  axis: Vector3;
  rate: number;
  /** Distance from centre to corner — the ground test. */
  reach: number;
  life: number;
  rest: boolean;
}

/**
 * One pile of blocks per material, drawn as a single mesh whose vertex buffer
 * is rewritten each frame. Capacity is fixed and slots are recycled oldest
 * first, so nothing allocates once a level is running.
 */
class Rubble {
  readonly mesh: Mesh;
  private chunks: Chunk[] = [];
  private next = 0;
  private position: Float32Array;
  private normal: Float32Array;
  private uv: Float32Array;
  private color: Float32Array;
  private tplPos: Float32Array;
  private tplNrm: Float32Array;
  private geo: BufferGeometry;

  constructor(material: Material, capacity: number) {
    // A stock box supplies the vertex layout: 24 vertices (four per face, so
    // each face keeps its own flat normal) and 36 indices.
    const tpl = new BoxGeometry(1, 1, 1);
    this.tplPos = tpl.attributes.position.array as Float32Array;
    this.tplNrm = tpl.attributes.normal.array as Float32Array;
    const tplIdx = tpl.index!.array;

    const verts = capacity * 24;
    this.position = new Float32Array(verts * 3);
    this.normal = new Float32Array(verts * 3);
    this.uv = new Float32Array(verts * 2);
    this.color = new Float32Array(verts * 3).fill(1);
    const index = new Uint16Array(capacity * 36);
    for (let c = 0; c < capacity; c++) {
      for (let i = 0; i < 36; i++) index[c * 36 + i] = c * 24 + (tplIdx[i] as number);
    }

    const geo = new BufferGeometry();
    const pos = new BufferAttribute(this.position, 3).setUsage(DynamicDrawUsage);
    const nrm = new BufferAttribute(this.normal, 3).setUsage(DynamicDrawUsage);
    geo.setAttribute('position', pos);
    geo.setAttribute('normal', nrm);
    geo.setAttribute('uv', new BufferAttribute(this.uv, 2));
    // Present whether or not the material reads it: the city kits are textured
    // but the furniture kit is vertex-coloured, and one layout covers both.
    geo.setAttribute('color', new BufferAttribute(this.color, 3));
    geo.setIndex(new BufferAttribute(index, 1));
    tpl.dispose();
    this.geo = geo;

    this.mesh = new Mesh(geo, material);
    // The pile is only ever near the ball, which is what the camera is framing,
    // and its bounds change every frame. Culling it would cost more than it saves.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;

    for (let i = 0; i < capacity; i++) {
      this.chunks.push({
        alive: false,
        dirty: false,
        pos: new Vector3(),
        vel: new Vector3(),
        half: new Vector3(),
        quat: new Quaternion(),
        axis: new Vector3(0, 1, 0),
        rate: 0,
        reach: 0,
        life: 0,
        rest: false,
      });
    }
  }

  /** @param uv atlas coordinate this block is coloured from */
  spawn(
    pos: Vector3,
    half: Vector3,
    vel: Vector3,
    axis: Vector3,
    rate: number,
    life: number,
    uv: { x: number; y: number },
    color: Color
  ) {
    const i = this.next;
    this.next = (this.next + 1) % this.chunks.length;
    const c = this.chunks[i];

    c.alive = true;
    c.dirty = false;
    c.rest = false;
    c.pos.copy(pos);
    c.vel.copy(vel);
    c.half.copy(half);
    c.quat.random();
    c.axis.copy(axis).normalize();
    c.rate = rate;
    c.reach = half.length();
    c.life = life;

    // UV and colour are per-block constants, so they are written once here
    // rather than every frame with the positions.
    const base = i * 24;
    for (let v = 0; v < 24; v++) {
      this.uv[(base + v) * 2] = uv.x;
      this.uv[(base + v) * 2 + 1] = uv.y;
      this.color[(base + v) * 3] = color.r;
      this.color[(base + v) * 3 + 1] = color.g;
      this.color[(base + v) * 3 + 2] = color.b;
    }
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  update(dt: number): number {
    let live = 0;
    let touched = false;

    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (!c.alive) {
        if (c.dirty) {
          this.position.fill(0, i * 24 * 3, (i + 1) * 24 * 3);
          c.dirty = false;
          touched = true;
        }
        continue;
      }

      c.life -= dt;
      if (c.life <= 0) {
        c.alive = false;
        c.dirty = true;
        continue;
      }
      live++;
      // A block that settled last frame and is not yet sinking has nothing new
      // to say, and rewriting it would upload the whole buffer for no change.
      // Sampled *before* the physics so the frame it comes to rest still writes.
      const moving = !c.rest || c.life < SINK;

      if (!c.rest) {
        c.vel.y -= GRAVITY * dt;
        c.pos.addScaledVector(c.vel, dt);

        // Ground contact, approximated with the block's corner radius. Exact
        // face contact would need a full box-plane resolve, and at this size
        // and speed nobody can tell the difference between the two.
        const floor = c.reach * 0.62;
        if (c.pos.y < floor) {
          c.pos.y = floor;
          if (c.vel.y < -1.6) {
            // Bounce, losing most of it. Masonry is not a ball.
            c.vel.y = -c.vel.y * 0.3;
            c.vel.x *= 0.62;
            c.vel.z *= 0.62;
            c.rate *= 0.55;
          } else {
            // Settled: skid to a stop and stop tumbling, so the pile reads as
            // rubble lying on the street rather than boxes twitching on it.
            c.vel.set(c.vel.x * 0.35, 0, c.vel.z * 0.35);
            c.rate *= 0.2;
            if (c.vel.lengthSq() < 0.05) c.rest = true;
          }
        }

        if (c.rate > 0.001) {
          _spin.setFromAxisAngle(c.axis, c.rate * dt);
          c.quat.premultiply(_spin);
          // Air drag on the tumble, so blocks slow as they fall rather than
          // spinning at launch speed all the way down.
          c.rate *= Math.max(0, 1 - 1.1 * dt);
        }
      }

      // The last stretch of life sinks the block into the road while shrinking
      // it slightly. Fading is not an option — this is opaque lit geometry —
      // and sinking is what the eye reads as "cleared away" rather than
      // "deleted".
      let shrink = 1;
      if (c.life < SINK) {
        const t = 1 - c.life / SINK;
        shrink = 1 - t * 0.35;
        c.pos.y -= dt * (1.2 + t * 2.4);
      }

      if (moving) {
        this.write(i, c, shrink);
        touched = true;
      }
    }

    if (touched) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.normal.needsUpdate = true;
    }
    return live;
  }

  /** Bakes one block's world-space vertices into the shared buffers. */
  private write(i: number, c: Chunk, shrink: number) {
    const base = i * 24;
    const sx = c.half.x * 2 * shrink;
    const sy = c.half.y * 2 * shrink;
    const sz = c.half.z * 2 * shrink;
    _q.copy(c.quat);

    for (let v = 0; v < 24; v++) {
      _v.set(this.tplPos[v * 3] * sx, this.tplPos[v * 3 + 1] * sy, this.tplPos[v * 3 + 2] * sz)
        .applyQuaternion(_q)
        .add(c.pos);
      const p = (base + v) * 3;
      this.position[p] = _v.x;
      this.position[p + 1] = _v.y;
      this.position[p + 2] = _v.z;

      _n.set(this.tplNrm[v * 3], this.tplNrm[v * 3 + 1], this.tplNrm[v * 3 + 2]).applyQuaternion(_q);
      this.normal[p] = _n.x;
      this.normal[p + 1] = _n.y;
      this.normal[p + 2] = _n.z;
    }
  }

  dispose() {
    this.geo.dispose();
  }
}

// ── the system ──────────────────────────────────────────────────────────────

interface Highlight {
  prop: PropInstance;
  shell: Mesh;
  shellMat: MeshBasicMaterial;
  ring: Mesh;
  ringMat: MeshBasicMaterial;
  /** Eases to 1 while locked and to 0 once released; removed when it lands. */
  alpha: number;
  target: number;
  t: number;
  /** The prop's own scale, and how much bigger the glow shell is drawn. */
  base: number;
  grow: number;
  footprint: number;
}

interface Flash {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  life: number;
  maxLife: number;
  scale: number;
}

interface Wave {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  life: number;
  maxLife: number;
  from: number;
  to: number;
  peak: number;
}

/** Warm gold, matching the sun in the scene rather than a UI colour. */
const LOCK_COLOR = new Color(1, 0.68, 0.28);

/**
 * How far outside the building the glow shell sits, in metres. Sized against
 * the camera, which is 40-55 m up at the tiers where buildings can be eaten:
 * below about a quarter of a metre the rim is thinner than a pixel.
 */
const RIM = 0.4;

export class Demolition {
  readonly group = new Group();
  private rand = new Rand(0xd3b715);
  private highlights = new Map<PropInstance, Highlight>();
  private flashes: Flash[] = [];
  private waves: Wave[] = [];
  private piles = new Map<Material, Rubble>();
  private ringGeo = new RingGeometry(0.8, 1, 56);
  private _color = new Color();
  private _uv = { x: 0, y: 0 };
  /** Live block count, for the perf overlay. */
  liveChunks = 0;

  constructor(private particles: Particles) {
    this.group.name = 'demolition';
    this.ringGeo.rotateX(-Math.PI / 2);
  }

  // ── highlight ─────────────────────────────────────────────────────────────

  /**
   * Lights the building up: a warm additive copy of it, a shade larger, with a
   * pulsing ring on its plot.
   *
   * The first version was an inverted hull — the model rendered slightly larger
   * with front faces culled, so only the rim survived the depth test. That is
   * the textbook outline and here it was invisible, for a reason worth writing
   * down: buildings are fitted to a 4 m plot, so the "couple of percent" that
   * makes a clean outline on a character-sized object is four centimetres on a
   * frontage, seen from a camera fifty metres up. Sub-pixel.
   *
   * So the shell keeps its front faces and glows over the whole frontage
   * instead, and the expansion is specified in *metres* rather than as a
   * percentage — `RIM` of clearance whatever the building's size — which gives
   * a rim that is visible at this camera height without inflating a small
   * building into its neighbour. Scaling is about the model origin, which sits
   * on the ground for every building in the kits, so the glow grows up and out
   * and never lifts the building off its plot.
   */
  lock(prop: PropInstance) {
    if (this.highlights.has(prop)) return;

    const scale = prop.scale ?? 1;
    // Ring radius, not half-width: the marker has to stand *outside* the
    // frontage or the building hides its own highlight from a camera looking
    // down at 57 degrees.
    const footprint = Math.max(prop.def.size.x, prop.def.size.z) * scale * 0.95;
    // Enough clearance to read from the game camera, capped so the smallest
    // house doesn't balloon.
    const grow = clamp01(RIM / Math.max(footprint, 0.5)) * 0.7;

    const shellMat = new MeshBasicMaterial({
      color: LOCK_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    const shell = new Mesh(prop.geometry, shellMat);
    shell.position.set(prop.x, prop.lift ?? 0, prop.z);
    shell.rotation.set(0, prop.rotY, 0);
    shell.renderOrder = 6;
    this.group.add(shell);

    const ringMat = new MeshBasicMaterial({
      color: LOCK_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    const ring = new Mesh(this.ringGeo, ringMat);
    ring.position.set(prop.x, 0.07, prop.z);
    ring.renderOrder = 6;
    this.group.add(ring);

    this.highlights.set(prop, {
      prop,
      shell,
      shellMat,
      ring,
      ringMat,
      alpha: 0,
      target: 1,
      t: 0,
      base: scale,
      grow,
      footprint,
    });
  }

  /** The ball moved on. Fades the outline rather than cutting it. */
  release(prop: PropInstance) {
    const h = this.highlights.get(prop);
    if (h) h.target = 0;
  }

  /** Drops a highlight immediately, for the frame its building is destroyed. */
  private discard(prop: PropInstance) {
    const h = this.highlights.get(prop);
    if (!h) return;
    this.group.remove(h.shell, h.ring);
    h.shellMat.dispose();
    h.ringMat.dispose();
    this.highlights.delete(prop);
  }

  // ── demolition ────────────────────────────────────────────────────────────

  /**
   * @param impact where the ball was — everything is thrown away from here, so
   *   the pile lands on the far side of the building from the ball, which is
   *   what makes the collapse look caused rather than scheduled
   * @param power 0..1 by building size; scales block count, throw and rings
   */
  demolish(
    prop: PropInstance,
    impact: { x: number; z: number },
    power: number,
    ballRadius: number
  ) {
    this.discard(prop);

    const scale = prop.scale ?? 1;
    const w = Math.max(prop.def.size.x, prop.def.size.z) * scale;
    const h = prop.def.size.y * scale;
    const base = prop.lift ?? 0;
    const p = clamp01(power);

    // The ball that just did this is *bigger than the building* — 11 m across
    // against a 4 m frontage at the top tier — and it is standing on the plot.
    // Anything spawned inside the footprint is therefore behind an opaque
    // sphere, which is how the first version managed to throw thirty blocks
    // and show the player none of them. Everything below is pushed out to at
    // least this radius, so the wreckage erupts *around* the ball instead of
    // inside it.
    const clear = Math.max(w * 0.55, ballRadius * 0.98);

    this.flash(prop, scale);
    // Bright and fast, then slow and dusty. One ring reads as a UI element; two
    // at different speeds read as a pressure wave with dust behind it.
    this.wave(impact.x, impact.z, clear * 0.8, clear + w * 2.4, 0.45, 0.8, 1, 0.93, 0.76);
    this.wave(impact.x, impact.z, clear * 0.9, clear + w * 5 + 6, 1.05, 0.34, 0.82, 0.72, 0.55);

    this.rubble(prop, impact, w, h, base, p, clear);

    this.particles.smoke(
      impact.x,
      base + Math.min(h, ballRadius) * 0.5,
      impact.z,
      MOBILE ? 18 : 34,
      clear,
      3 + p * 3
    );
  }

  /** The building's silhouette, blown out white for a fifth of a second. */
  private flash(prop: PropInstance, scale: number) {
    // Four is more simultaneous demolitions than the ball can physically reach,
    // and capping the pool means a pathological pile-up recycles rather than
    // allocating a material per frame.
    let f = this.flashes.find((x) => x.life <= 0);
    if (!f && this.flashes.length >= 4) {
      f = this.flashes.reduce((a, b) => (a.life <= b.life ? a : b));
    }
    if (!f) {
      const mat = new MeshBasicMaterial({
        color: 0xfff0d6,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      });
      const mesh = new Mesh(prop.geometry, mat);
      mesh.renderOrder = 7;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      f = { mesh, mat, life: 0, maxLife: 0.22, scale };
      this.flashes.push(f);
    }
    f.mesh.geometry = prop.geometry;
    f.mesh.position.set(prop.x, prop.lift ?? 0, prop.z);
    f.mesh.rotation.set(0, prop.rotY, 0);
    f.mesh.visible = true;
    f.scale = scale;
    f.life = f.maxLife = 0.22;
  }

  /** One expanding ground ring. */
  private wave(
    x: number,
    z: number,
    from: number,
    to: number,
    life: number,
    peak: number,
    r: number,
    g: number,
    b: number
  ) {
    let w = this.waves.find((free) => free.life <= 0);
    if (!w && this.waves.length >= 8) {
      w = this.waves.reduce((a, b) => (a.life <= b.life ? a : b));
    }
    if (!w) {
      const mat = new MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      });
      const mesh = new Mesh(this.ringGeo, mat);
      mesh.renderOrder = 5;
      this.group.add(mesh);
      w = { mesh, mat, life: 0, maxLife: life, from, to, peak };
      this.waves.push(w);
    }
    w.mat.color.setRGB(r, g, b);
    // Just above the pavement, and above the ball's contact decals, so the
    // wave passes over them rather than fighting them for the same depth.
    w.mesh.position.set(x, 0.08, z);
    w.mesh.visible = true;
    w.life = w.maxLife = life;
    w.from = from;
    w.to = to;
    w.peak = peak;
  }

  /** Throws the pile. */
  private rubble(
    prop: PropInstance,
    impact: { x: number; z: number },
    w: number,
    h: number,
    base: number,
    p: number,
    clear: number
  ) {
    const pile = this.pile(prop.material);
    const count = Math.round(CHUNKS * (0.7 + p * 0.6));
    const geo = prop.geometry;
    // Blocks are sized against the *framing*, not only the building.
    //
    // A shopfront fitted to its 4 m plot broken into tenths gives 40 cm rubble,
    // and at tier 8 the camera is 55 m up looking at an 11 m ball: 40 cm is
    // grit. The wreckage of a small building has to be drawn at the scale of
    // the thing that destroyed it or the player never sees it happen.
    const bulk = Math.max(w, clear * 0.9);

    for (let i = 0; i < count; i++) {
      // Flat slabs among the cubes: a pile of pure cubes reads as Lego, and a
      // building is mostly walls and floors.
      const slab = this.rand.chance(0.35);
      const s = bulk * this.rand.range(0.16, 0.3);
      _half.set(
        s * this.rand.range(0.7, 1.2),
        s * (slab ? this.rand.range(0.16, 0.3) : this.rand.range(0.7, 1.2)),
        s * this.rand.range(0.7, 1.2)
      ).multiplyScalar(0.5);

      // Where the block erupts, as an angle around the ball.
      //
      // Not "wherever it was inside the building", which is the physically
      // honest answer and the wrong one: the building sits on the far side of a
      // ball wider than it is, and the camera is pinned to the ball's
      // south-west, so an honest spawn throws half the pile into the one place
      // the player cannot see. Fanning the blocks a wide arc either side of the
      // building's bearing wraps the wreck around the ball's flanks and into
      // frame, at the cost of a metre or two of accuracy nobody can measure.
      const bearing = Math.atan2(prop.z - impact.z, prop.x - impact.x);
      // Quadratic bias: most blocks erupt toward the building's bearing, but the
      // tail of the distribution wraps the whole way round the ball. A hard fan
      // — even a generous ±100° one — still leaves every block on the far side,
      // because the far side is what "toward the building" means.
      const u = this.rand.range(-1, 1);
      const angle = bearing + Math.PI * u * Math.abs(u);
      _dir.set(Math.cos(angle), 0, Math.sin(angle));

      // Height still comes from the building's own volume, so the collapse
      // reads top-down: high blocks start high and are thrown hardest.
      const hy = this.rand.range(0.08, 0.95);
      const ring = Math.max(clear, w * 0.4) * this.rand.range(0.86, 1.06);
      _pos.set(
        impact.x + _dir.x * ring,
        base + hy * h + _half.y,
        impact.z + _dir.z * ring
      );

      // The throw is deliberately short. An early version launched blocks at
      // 10 m/s and they scattered thirty metres across three streets, which
      // looks like an explosion; a building that is *rolled over* should leave
      // its rubble roughly where it stood, in a heap you can see was a building.
      const spread = this.rand.range(-0.9, 0.9);
      const out = (1.8 + this.rand.range(0, 3) + p * 2) * (0.5 + hy * 0.7);
      _vel
        .set(_dir.x + -_dir.z * spread, 0, _dir.z + _dir.x * spread)
        .normalize()
        .multiplyScalar(out);
      _vel.y = this.rand.range(4, 10) * (0.5 + hy * 0.6);

      _axis.set(this.rand.range(-1, 1), this.rand.range(-1, 1), this.rand.range(-1, 1));
      if (_axis.lengthSq() < 1e-6) _axis.set(0, 1, 0);

      sampleSurface(geo, prop.material, this.rand, this._uv, this._color);
      pile.spawn(
        _pos,
        _half,
        _vel,
        _axis,
        this.rand.range(3, 9),
        this.rand.range(3, 4.6),
        this._uv,
        this._color
      );
    }
  }

  /** Lazily makes the pile for a material — one per kit, so at most two. */
  private pile(material: Material): Rubble {
    let r = this.piles.get(material);
    if (!r) {
      r = new Rubble(material, CHUNK_CAP);
      this.group.add(r.mesh);
      this.piles.set(material, r);
    }
    return r;
  }

  // ── frame ─────────────────────────────────────────────────────────────────

  update(dt: number) {
    for (const h of [...this.highlights.values()]) {
      h.t += dt;
      // Fade in fast, out faster: a highlight that lingers after the ball has
      // gone past suggests the building is still a target when it no longer is.
      const rate = h.target > h.alpha ? 9 : 7;
      h.alpha += (h.target - h.alpha) * Math.min(1, rate * dt);
      if (h.target === 0 && h.alpha < 0.01) {
        this.discard(h.prop);
        continue;
      }

      // One shared pulse: a slow breath rather than a blink, because the thing
      // being outlined is a building and buildings should not flicker.
      const pulse = 0.5 + 0.5 * Math.sin(h.t * 5.5);
      h.shellMat.opacity = (0.16 + pulse * 0.22) * h.alpha;
      h.shell.scale.setScalar(h.base * (1 + h.grow * (0.7 + pulse * 0.3)));

      const rs = h.footprint * (1.04 + pulse * 0.08);
      h.ring.scale.set(rs, 1, rs);
      h.ringMat.opacity = (0.3 + pulse * 0.34) * h.alpha;
    }

    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.mesh.visible = false;
        continue;
      }
      const t = 1 - f.life / f.maxLife;
      f.mat.opacity = (1 - t) * 0.85;
      f.mesh.scale.setScalar(f.scale * (1 + easeOutCubic(t) * 0.12));
    }

    for (const w of this.waves) {
      if (w.life <= 0) continue;
      w.life -= dt;
      if (w.life <= 0) {
        w.mesh.visible = false;
        continue;
      }
      const t = 1 - w.life / w.maxLife;
      // Fast out of the gate and decelerating — the profile of a real pressure
      // wave, and the one thing that stops an expanding circle looking scripted.
      const r = w.from + (w.to - w.from) * easeOutCubic(t);
      w.mesh.scale.set(r, 1, r);
      w.mat.opacity = w.peak * Math.pow(1 - t, 1.7);
    }

    let live = 0;
    for (const pile of this.piles.values()) live += pile.update(dt);
    this.liveChunks = live;
  }

  dispose() {
    for (const h of [...this.highlights.values()]) this.discard(h.prop);
    for (const f of this.flashes) {
      this.group.remove(f.mesh);
      f.mat.dispose();
    }
    this.flashes.length = 0;
    for (const w of this.waves) {
      this.group.remove(w.mesh);
      w.mat.dispose();
    }
    this.waves.length = 0;
    for (const pile of this.piles.values()) {
      this.group.remove(pile.mesh);
      pile.dispose();
    }
    this.piles.clear();
    this.ringGeo.dispose();
  }
}

const _half = new Vector3();
const _pos = new Vector3();
const _vel = new Vector3();
const _dir = new Vector3();

/**
 * Picks the look of one block: an atlas coordinate and a vertex colour taken
 * from a random face of the building it came from.
 *
 * Two details earn their keep here.
 *
 * **The triangle centroid, not a vertex.** The Kenney atlas is a grid of flat
 * colour patches sampled with `NearestFilter`, and a model's UVs sit at the
 * *corners* of the patch they use — so a vertex UV lands on a patch boundary
 * and half the rubble comes out somebody else's colour. A face's centroid is
 * always well inside its own patch.
 *
 * **Dark faces are re-rolled.** Kenney frontages are mostly glazing, so an
 * unbiased sample gives a pile of near-black cubes that read as holes in the
 * road rather than as masonry. Four attempts, keeping the first face that is
 * not glass and falling back to the brightest one seen, gives a pile that is
 * mostly wall with the odd dark piece in it — which is what a collapsed
 * building actually looks like.
 */
function sampleSurface(
  geo: BufferGeometry,
  material: Material,
  rand: Rand,
  uv: { x: number; y: number },
  color: Color
) {
  const uvAttr = geo.getAttribute('uv');
  const colAttr = geo.getAttribute('color');
  const index = geo.getIndex();
  const tris = Math.floor((index ? index.count : geo.getAttribute('position').count) / 3);
  const atlas = atlasOf(material);

  let bestLum = -1;
  for (let attempt = 0; attempt < 4; attempt++) {
    const tri = Math.min(tris - 1, Math.floor(rand.next() * tris));
    let a = tri * 3;
    let b = a + 1;
    let c = a + 2;
    if (index) {
      a = index.getX(tri * 3);
      b = index.getX(tri * 3 + 1);
      c = index.getX(tri * 3 + 2);
    }

    const u = uvAttr ? (uvAttr.getX(a) + uvAttr.getX(b) + uvAttr.getX(c)) / 3 : 0;
    const v = uvAttr ? (uvAttr.getY(a) + uvAttr.getY(b) + uvAttr.getY(c)) / 3 : 0;
    if (colAttr) {
      _sample.setRGB(
        (colAttr.getX(a) + colAttr.getX(b) + colAttr.getX(c)) / 3,
        (colAttr.getY(a) + colAttr.getY(b) + colAttr.getY(c)) / 3,
        (colAttr.getZ(a) + colAttr.getZ(b) + colAttr.getZ(c)) / 3
      );
    } else {
      _sample.setRGB(1, 1, 1);
    }

    // Without an atlas to read there is nothing to judge, so take the first
    // face and be done.
    const lum = atlas ? atlas(u, v) : 1;
    if (lum > bestLum) {
      bestLum = lum;
      uv.x = u;
      uv.y = v;
      color.copy(_sample);
    }
    if (lum >= 0.42) break;
  }
}

const _sample = new Color();

/**
 * Luminance lookup into a kit's colour atlas, built once per texture.
 *
 * The atlas is a tiny PNG already in memory, so drawing it into a canvas and
 * keeping the pixels costs a few kilobytes and answers "is this face glass or
 * wall?" exactly, which nothing on the geometry can. Returns `null` for
 * untextured kits and for a texture whose image has not decoded yet — callers
 * treat that as "no opinion" rather than failing.
 */
const _atlases = new Map<unknown, ((u: number, v: number) => number) | null>();

function atlasOf(material: Material): ((u: number, v: number) => number) | null {
  const map = (material as { map?: Texture | null }).map ?? null;
  if (!map) return null;
  if (_atlases.has(map)) return _atlases.get(map) ?? null;

  let fn: ((u: number, v: number) => number) | null = null;
  const img = map.image as (HTMLImageElement | ImageBitmap | HTMLCanvasElement) | undefined;
  const w = (img as HTMLImageElement)?.width ?? 0;
  const hgt = (img as HTMLImageElement)?.height ?? 0;
  if (img && w > 0 && hgt > 0) {
    try {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = hgt;
      const ctx = c.getContext('2d', { willReadFrequently: false })!;
      ctx.drawImage(img as CanvasImageSource, 0, 0);
      const data = ctx.getImageData(0, 0, w, hgt).data;
      // `flipY = false` on every kit texture, so v runs down the image the same
      // way the pixel rows do; honour the flag anyway rather than the habit.
      const flip = map.flipY;
      fn = (u, v) => {
        const px = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
        const vy = flip ? 1 - v : v;
        const py = Math.min(hgt - 1, Math.max(0, Math.floor(vy * hgt)));
        const i = (py * w + px) * 4;
        return (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
      };
    } catch {
      // A cross-origin texture taints the canvas. Nothing here is important
      // enough to break a demolition over.
      fn = null;
    }
  }
  // A `null` for an image that simply has not decoded is cached too: this runs
  // in the middle of a frame, and retrying the decode on every block would be a
  // worse trade than a few grey blocks in the first pile of the run.
  _atlases.set(map, fn);
  return fn;
}
