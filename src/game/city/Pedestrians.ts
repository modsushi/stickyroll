/**
 * Citizens.
 *
 * The Kenney characters ship with 27 baked clips, but each model is six separate
 * meshes and each variant has its own texture — so playing the clips as authored
 * would cost six draw calls per person and batch none of them. The meshes are
 * also unskinned (the clips animate node transforms), which means the rig is
 * trivial to rebuild.
 *
 * So we rebuild it twice over:
 *
 *  1. Torso, arms and head merge into one "upper" mesh, leaving a 3-part rig
 *     (legL, legR, upper) animated procedurally off a single speed parameter.
 *     Blending continuously beats cross-fading clips here — it is what lets
 *     someone shift from a stroll to a dead sprint as the ball closes in.
 *  2. Those three parts are drawn as **MeshBatch**, three per variant, with
 *     the per-person matrices rewritten each frame. A crowd therefore costs a
 *     fixed ~21 draw calls whether it is twenty people or two hundred, which is
 *     what makes a genuinely busy street affordable.
 *
 * Citizens are `PropInstance`s in the spatial hash, so absorbing one uses the
 * same code path as a traffic cone.
 */

import {
  BufferGeometry,
  CanvasTexture,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { MeshBatch, batchMode } from '../../render/Batch';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sfx } from '../../audio/Sfx';
import { assets } from '../../core/Assets';
import { Rand, TAU, clamp01, dampAngle } from '../../core/Math';
import { PROPS, type PropDef } from '../../data/props';
import type { LevelDef, TileChar } from '../../levels/types';
import type { Ball } from '../Ball';
import type { BuiltCity } from './CityBuilder';
import type { PropInstance } from './Props';

type Mood = 'stroll' | 'idle' | 'notice' | 'startle' | 'flee';

interface Ped extends PropInstance {
  rig: number;
  /** Slot within this rig's instanced meshes. */
  slot: number;
  /** Slot in the shared exclamation-mark mesh; unique across the crowd. */
  marker: number;
  mood: Mood;
  moodT: number;
  heading: number;
  targetHeading: number;
  speed: number;
  phase: number;
  bobSeed: number;
  hidden: boolean;
}

interface Rig {
  legL: BufferGeometry;
  legR: BufferGeometry;
  upper: BufferGeometry;
  /** Height of the hip joint; the rig's parts pivot about it. */
  hipY: number;
  /** Top of the head above the ground, measured from the baked geometry. */
  headY: number;
  material: Mesh['material'];
  meshes?: { legL: MeshBatch; legR: MeshBatch; upper: MeshBatch };
  used: number;
}

const WALK = 1.15;
const FLEE = 4.2;
/** How far a citizen notices the ball, on top of its radius. */
const AWARE = 9;

/**
 * Growth tier from which citizens *double take* instead of merely noticing.
 *
 * Not an arbitrary number: `pedestrian` is a tier-4 prop, so tier 4 is exactly
 * the point at which the ball can swallow a person. Before that the ball is a
 * nuisance rolling past and a glance is the honest reaction; from tier 4 it is
 * an existential threat, and the game should say so.
 */
const STARTLE_TIER = 4;
/**
 * How often the big reaction plays instead of the old quick glance.
 *
 * Deliberately not 1. A whole street double-taking every time is a cutscene —
 * the beat stops landing after the third one, and worse, it makes the crowd
 * feel scripted rather than alive. Mixing the two means the reaction stays a
 * surprise for the whole run.
 */
const STARTLE_CHANCE = 0.55;
/** Seconds frozen in shock before the legs catch up. */
const STARTLE_TIME = 0.62;

/**
 * The `!` glyph, drawn rather than typed.
 *
 * `fillText` would need the UI font to have finished loading before the first
 * canvas draw, and a missed race silently substitutes a system serif that looks
 * nothing like the game. Two rounded shapes are unambiguous, load-order-proof,
 * and crisper at 64px than any font would be.
 */
function exclamationTexture(): CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;

  const glyph = (lw: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(s / 2, 12);
    ctx.lineTo(s / 2, 38);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s / 2, 52, lw / 2, 0, TAU);
    ctx.fill();
  };

  // Dark pass first, thicker, so the mark keeps its edge against pale pavement
  // and dark shopfronts alike.
  glyph(20, '#5c2f00');
  glyph(11, '#ffd23f');

  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// Preallocated: `render` runs over the whole crowd every frame.
const _root = new Matrix4();
const _part = new Matrix4();
const _out = new Matrix4();
const _pos = new Vector3();
const _quat = new Quaternion();
const _euler = new Euler();
const _one = new Vector3(1, 1, 1);
const _s = new Vector3();
const _mark = new Matrix4();
const ZERO = new Matrix4().makeScale(0, 0, 0);
/** World height of the `!` quad, before its pop-in overshoot. */
const MARK_SIZE = 0.86;

export class Pedestrians {
  /** Variants used. Each costs one texture, so this list stays short. */
  static readonly MODELS = [
    'character-a', 'character-c', 'character-e', 'character-h',
    'character-k', 'character-n', 'character-p',
  ];

  readonly group = new Group();
  /** Set each frame by `Game.render` so the `!` marks face the camera. */
  readonly billboard = new Quaternion();

  private peds: Ped[] = [];
  private rigs: Rig[] = [];
  private rand = new Rand(0x9ed);
  private def?: PropDef;
  private marks?: InstancedMesh;
  /**
   * Extra size for the `!`, tracked from the ball.
   *
   * The camera pulls back hard as the ball grows — by the top tiers it is ~55 m
   * up — so a mark sized purely in metres shrinks to a couple of pixels exactly
   * when there is most going on to distract from it. Growing it slightly with
   * the framing keeps it the same apparent size on screen without ever making
   * it a billboard the size of a bus.
   */
  private markScale = 1;

  constructor(
    private level: LevelDef,
    private city: BuiltCity
  ) {
    this.group.name = 'pedestrians';
    this.def = PROPS['pedestrian'];
    if (!this.def) return;
    this.buildRigs();
    this.spawn();
  }

  /**
   * Rebuilds each character as a 3-part rig, baking every node's rest transform
   * into its geometry so the runtime only has to place three matrices.
   */
  private buildRigs() {
    for (const model of Pedestrians.MODELS) {
      if (!assets.has('characters', model)) continue;
      const src = assets.get('characters', model);
      const scene = src.scene;
      scene.updateMatrixWorld(true);

      const byName = new Map<string, Mesh>();
      scene.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) byName.set(m.name, m);
      });

      const legL = byName.get('leg-left');
      const legR = byName.get('leg-right');
      if (!legL || !legR) continue;

      legL.updateWorldMatrix(true, false);
      const hipY = new Vector3().setFromMatrixPosition(legL.matrixWorld).y;

      const bake = (meshes: (Mesh | undefined)[]) => {
        const parts: BufferGeometry[] = [];
        for (const m of meshes) {
          if (!m) continue;
          m.updateWorldMatrix(true, false);
          const g = m.geometry.clone();
          g.applyMatrix4(m.matrixWorld);
          g.translate(0, -hipY, 0); // move the pivot to the hip joint
          for (const k of Object.keys(g.attributes)) {
            if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
          }
          parts.push(g);
        }
        return parts.length === 1 ? parts[0] : BufferGeometryUtils.mergeGeometries(parts, false)!;
      };

      const upper = bake([
        byName.get('torso'), byName.get('arm-left'),
        byName.get('arm-right'), byName.get('head'),
      ]);
      // Measured, not guessed: the seven variants are not all the same height,
      // and a `!` floating at a fixed offset sits on one character's scalp and
      // a foot above another's.
      upper.computeBoundingBox();
      const headY = hipY + (upper.boundingBox?.max.y ?? 1.0);

      this.rigs.push({
        legL: bake([legL]),
        legR: bake([legR]),
        upper,
        hipY,
        headY,
        material: legL.material as Mesh['material'],
        used: 0,
      });
    }
  }

  private spawn() {
    if (!this.rigs.length || !this.def) return;
    const L = this.level;
    const allowed = new Set<TileChar>(L.pedestrianOn);
    const cells: [number, number][] = [];
    const cols = L.map[0].length;
    const rows = L.map.length;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const c = (L.map[y][x] === ' ' ? ',' : L.map[y][x]) as TileChar;
        if (allowed.has(c)) cells.push([x, y]);
      }
    }
    if (!cells.length) return;

    // Count per rig first so each MeshBatch is sized exactly.
    const assignments: number[] = [];
    for (let i = 0; i < L.pedestrians; i++) {
      const r = i % this.rigs.length;
      assignments.push(r);
      this.rigs[r].used++;
    }
    for (const rig of this.rigs) {
      const mk = (geo: BufferGeometry) => {
        const m = new MeshBatch(geo, rig.material, Math.max(1, rig.used), batchMode(true));
        m.setShadows(true, false);
        m.setCulling(false); // the crowd spans the district
        this.group.add(m);
        return m;
      };
      rig.meshes = { legL: mk(rig.legL), legR: mk(rig.legR), upper: mk(rig.upper) };
      rig.used = 0; // reused below as the slot allocator
    }

    // One instanced quad per citizen for the `!`, sized to the whole crowd and
    // collapsed to zero scale unless that citizen is mid-double-take. A slot
    // each rather than a pool: the marker's lifetime *is* the mood, so there is
    // nothing to allocate, expire or recycle.
    //
    // `MeshBasicMaterial` is not a coincidence. Instanced draws that read
    // normals are what produced the Android black screen (see Batch.ts), and an
    // unlit material reads none — which is why Particles already gets away with
    // exactly this on the same hardware.
    const marks = new InstancedMesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: exclamationTexture(),
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
      Math.max(1, L.pedestrians)
    );
    marks.frustumCulled = false; // the crowd spans the district
    marks.renderOrder = 9; // over the city, under the particle layer
    marks.count = Math.max(1, L.pedestrians);
    for (let i = 0; i < marks.count; i++) marks.setMatrixAt(i, ZERO);
    this.group.add(marks);
    this.marks = marks;

    for (let i = 0; i < L.pedestrians; i++) {
      const rigIndex = assignments[i];
      const rig = this.rigs[rigIndex];
      const [tx, ty] = this.rand.pick(cells);
      const x = (tx - (cols - 1) / 2) * L.tileSize + this.rand.range(-1.2, 1.2);
      const z = (ty - (rows - 1) / 2) * L.tileSize + this.rand.range(-1.2, 1.2);
      const slot = rig.used++;

      const ped: Ped = {
        def: this.def,
        x,
        z,
        y: 0.9,
        rotY: 0,
        scale: 1,
        absorbed: false,
        geometry: assets.get('characters', Pedestrians.MODELS[rigIndex]).geometry,
        material: rig.material as PropInstance['material'],
        hide: () => {
          ped.hidden = true;
        },
        rig: rigIndex,
        slot,
        marker: i,
        mood: 'stroll',
        moodT: this.rand.range(1, 5),
        heading: this.rand.angle(),
        targetHeading: 0,
        speed: WALK,
        phase: this.rand.range(0, TAU),
        bobSeed: this.rand.range(0, TAU),
        hidden: false,
      };
      ped.targetHeading = ped.heading;
      this.peds.push(ped);
      this.city.hash.insert(ped);
    }
  }

  step(dt: number, ball: Ball) {
    const bx = ball.pos.x;
    const bz = ball.pos.z;
    const aware = ball.visualRadius + AWARE;
    const b = this.city.bounds;
    const deadly = ball.growth.tier >= STARTLE_TIER;
    this.markScale = 1 + ball.visualRadius * 0.09;

    for (const p of this.peds) {
      if (p.absorbed) continue;

      const dx = p.x - bx;
      const dz = p.z - bz;
      const dist = Math.hypot(dx, dz);

      // ── mood ──
      if (dist < aware) {
        if (p.mood !== 'flee' && p.mood !== 'notice' && p.mood !== 'startle') {
          // A beat before running reads as a reaction rather than a state
          // machine flipping. Which beat depends on how dangerous the ball is
          // and on a coin toss — see STARTLE_CHANCE.
          const shocked = deadly && this.rand.chance(STARTLE_CHANCE);
          p.mood = shocked ? 'startle' : 'notice';
          p.moodT = shocked ? STARTLE_TIME : 0.28;
          if (shocked) {
            p.speed = 0;
            // Pitched by variant so each character keeps one voice all run.
            sfx.startle(0.86 + p.rig * 0.075);
          }
        }
        if (p.mood === 'notice') {
          p.moodT -= dt;
          p.targetHeading = Math.atan2(-dx, -dz); // turn and look
          if (p.moodT <= 0) p.mood = 'flee';
        }
        if (p.mood === 'startle') {
          // Rooted to the spot, staring straight at it. Freezing is what sells
          // the shock: a citizen who backs away while yelping just looks like
          // they are already running, and the `!` has nothing to punctuate.
          p.moodT -= dt;
          p.targetHeading = Math.atan2(-dx, -dz);
          p.speed = 0;
          if (p.moodT <= 0) p.mood = 'flee';
        }
        if (p.mood === 'flee') {
          p.targetHeading = Math.atan2(dx, dz);
          // Panic scales with proximity — a distant ball is a jog, a close one
          // is a sprint.
          p.speed = WALK + (FLEE - WALK) * clamp01(1 - (dist - ball.visualRadius) / AWARE);
        }
      } else {
        if (p.mood === 'flee' || p.mood === 'notice' || p.mood === 'startle') {
          p.mood = 'stroll';
          p.moodT = this.rand.range(2, 6);
          p.speed = WALK;
        }
        p.moodT -= dt;
        if (p.moodT <= 0) {
          if (p.mood === 'idle') {
            p.mood = 'stroll';
            p.moodT = this.rand.range(3, 8);
            p.targetHeading = this.rand.angle();
            p.speed = WALK * this.rand.range(0.75, 1.15);
          } else if (this.rand.chance(0.35)) {
            // A few stop to look at something; a crowd where everyone walks at
            // the same pace looks like a screensaver.
            p.mood = 'idle';
            p.moodT = this.rand.range(1.5, 4);
            p.speed = 0;
          } else {
            p.moodT = this.rand.range(3, 8);
            p.targetHeading = p.heading + this.rand.range(-1.4, 1.4);
          }
        }
      }

      // ── move ──
      // A startled head-turn is the fastest of the three. It has 0.62s to read
      // as a double take, and easing into it over half of that would look like
      // the citizen had merely changed their mind.
      const turn = p.mood === 'startle' ? 0.00002 : p.mood === 'flee' ? 0.0001 : 0.02;
      p.heading = dampAngle(p.heading, p.targetHeading, turn, dt);
      if (p.speed > 0.01) {
        const nx = p.x + Math.sin(p.heading) * p.speed * dt;
        const nz = p.z + Math.cos(p.heading) * p.speed * dt;
        // Turn away from the wall rather than piling up against it.
        if (nx < b.minX + 3 || nx > b.maxX - 3 || nz < b.minZ + 3 || nz > b.maxZ - 3) {
          p.targetHeading += Math.PI * 0.7;
        } else {
          p.x = nx;
          p.z = nz;
          this.city.hash.remove(p);
          this.city.hash.insert(p);
        }
        p.phase += p.speed * dt * 4.2;
      } else {
        // Idle sway keeps standing citizens from looking like statues.
        p.phase += dt * 0.9;
      }
    }
  }

  /** Procedural walk: leg swing, torso bob, and a lean into a sprint. */
  render(dt: number) {
    const marks = this.marks;
    let marked = 0;

    for (const p of this.peds) {
      const rig = this.rigs[p.rig];
      const m = rig.meshes;
      if (!m) continue;

      if (p.absorbed || p.hidden) {
        m.legL.setMatrixAt(p.slot, ZERO);
        m.legR.setMatrixAt(p.slot, ZERO);
        m.upper.setMatrixAt(p.slot, ZERO);
        marks?.setMatrixAt(p.marker, ZERO);
        continue;
      }

      const moving = p.speed > 0.05;
      const swing = moving ? Math.min(0.95, 0.35 + p.speed * 0.16) : 0.06;
      const s = Math.sin(p.phase);
      const c = Math.cos(p.phase);
      // Bob twice per stride.
      const bob = moving ? Math.abs(c) * 0.045 * swing : Math.sin(p.phase) * 0.008;

      // 0 -> 1 through the double take, 0 when not startled.
      const shock = p.mood === 'startle' ? clamp01(1 - p.moodT / STARTLE_TIME) : -1;
      // A single hop, front-loaded: up hard on the gasp, down before the run.
      const hop = shock >= 0 ? Math.sin(Math.min(1, shock * 2.6) * Math.PI) * 0.11 : 0;

      p.rotY = p.heading;
      // The rig pivots about the hip, so the root must sit at hip height or the
      // legs hang below the pavement.
      _pos.set(p.x, rig.hipY + bob * 0.4 + hop, p.z);
      _euler.set(0, p.heading, 0);
      _quat.setFromEuler(_euler);
      _root.compose(_pos, _quat, _one);

      _euler.set(s * swing, 0, 0);
      _quat.setFromEuler(_euler);
      _part.compose(ZERO_V, _quat, _one);
      m.legL.setMatrixAt(p.slot, _out.multiplyMatrices(_root, _part));

      _euler.set(-s * swing, 0, 0);
      _quat.setFromEuler(_euler);
      _part.compose(ZERO_V, _quat, _one);
      m.legR.setMatrixAt(p.slot, _out.multiplyMatrices(_root, _part));

      // Lean forward with speed, counter-rotate the shoulders against the hips,
      // and add a panic wobble at full sprint.
      const wobble =
        p.mood === 'flee' && p.speed > FLEE * 0.8
          ? Math.sin(p.phase * 2 + p.bobSeed) * 0.12
          : 0;
      // Recoil: the torso snaps *backwards* — the opposite sign to the forward
      // lean of a sprint — and springs back over the shock. Reusing the same
      // axis is what makes the transition into the run read as one continuous
      // movement rather than two poses cut together.
      const recoil = shock >= 0 ? Math.exp(-shock * 3.4) * 0.34 : 0;
      _euler.set(
        -clamp01(p.speed / FLEE) * 0.26 + recoil,
        -s * swing * 0.28,
        wobble + (shock >= 0 ? Math.sin(shock * 26) * 0.05 * (1 - shock) : 0)
      );
      _quat.setFromEuler(_euler);
      _pos.set(0, bob, 0);
      _part.compose(_pos, _quat, _one);
      m.upper.setMatrixAt(p.slot, _out.multiplyMatrices(_root, _part));

      // ── the `!` ──
      if (!marks) continue;
      if (shock < 0) {
        marks.setMatrixAt(p.marker, ZERO);
        continue;
      }
      // Overshoot on the way in, then settle and drift up a little, so the mark
      // punches onto the screen instead of fading on.
      const pop =
        shock < 0.22
          ? 0.35 + (shock / 0.22) * 0.95
          : 1.3 - Math.min(1, (shock - 0.22) / 0.16) * 0.3;
      const size = MARK_SIZE * this.markScale * pop;
      _pos.set(p.x, rig.headY + 0.28 + size * 0.5 + hop + shock * 0.16, p.z);
      _s.set(size, size, size);
      _mark.compose(_pos, this.billboard, _s);
      marks.setMatrixAt(p.marker, _mark);
      marked++;
    }

    if (marks) {
      // Nobody is mid-double-take for most of a run — and never at all below
      // tier 4 — so drop the mesh out of the frame entirely rather than paying
      // a draw call to rasterise fifty zero-scale quads.
      marks.count = marked ? this.peds.length : 0;
      marks.instanceMatrix.needsUpdate = true;
    }
    void dt;
  }

  /**
   * Three per variant, plus one shared call for every `!` on screen at once —
   * and zero when none are.
   */
  get drawCalls() {
    return this.rigs.length * 3 + (this.marks?.count ? 1 : 0);
  }

  dispose() {
    for (const p of this.peds) if (!p.absorbed) this.city.hash.remove(p);
    this.peds.length = 0;
    if (this.marks) {
      // The canvas texture and the quad are per-level, so both go with it.
      (this.marks.material as MeshBasicMaterial).map?.dispose();
      (this.marks.material as MeshBasicMaterial).dispose();
      this.marks.geometry.dispose();
      this.marks.dispose();
      this.group.remove(this.marks);
      this.marks = undefined;
    }
    for (const rig of this.rigs) {
      if (!rig.meshes) continue;
      for (const m of [rig.meshes.legL, rig.meshes.legR, rig.meshes.upper]) {
        m.dispose();
        this.group.remove(m);
      }
      rig.meshes = undefined;
    }
  }
}

const ZERO_V = new Vector3(0, 0, 0);
