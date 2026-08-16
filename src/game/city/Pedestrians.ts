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
  Euler,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { MeshBatch, batchMode } from '../../render/Batch';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assets } from '../../core/Assets';
import { Rand, TAU, clamp01, dampAngle } from '../../core/Math';
import { PROPS, type PropDef } from '../../data/props';
import type { LevelDef, TileChar } from '../../levels/types';
import type { Ball } from '../Ball';
import type { BuiltCity } from './CityBuilder';
import type { PropInstance } from './Props';

type Mood = 'stroll' | 'idle' | 'notice' | 'flee';

interface Ped extends PropInstance {
  rig: number;
  /** Slot within this rig's instanced meshes. */
  slot: number;
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
  material: Mesh['material'];
  meshes?: { legL: MeshBatch; legR: MeshBatch; upper: MeshBatch };
  used: number;
}

const WALK = 1.15;
const FLEE = 4.2;
/** How far a citizen notices the ball, on top of its radius. */
const AWARE = 9;

// Preallocated: `render` runs over the whole crowd every frame.
const _root = new Matrix4();
const _part = new Matrix4();
const _out = new Matrix4();
const _pos = new Vector3();
const _quat = new Quaternion();
const _euler = new Euler();
const _one = new Vector3(1, 1, 1);
const ZERO = new Matrix4().makeScale(0, 0, 0);

export class Pedestrians {
  /** Variants used. Each costs one texture, so this list stays short. */
  static readonly MODELS = [
    'character-a', 'character-c', 'character-e', 'character-h',
    'character-k', 'character-n', 'character-p',
  ];

  readonly group = new Group();
  private peds: Ped[] = [];
  private rigs: Rig[] = [];
  private rand = new Rand(0x9ed);
  private def?: PropDef;

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

      this.rigs.push({
        legL: bake([legL]),
        legR: bake([legR]),
        upper: bake([
          byName.get('torso'), byName.get('arm-left'),
          byName.get('arm-right'), byName.get('head'),
        ]),
        hipY,
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

    for (const p of this.peds) {
      if (p.absorbed) continue;

      const dx = p.x - bx;
      const dz = p.z - bz;
      const dist = Math.hypot(dx, dz);

      // ── mood ──
      if (dist < aware) {
        if (p.mood !== 'flee' && p.mood !== 'notice') {
          // A beat of "notice" before running reads as a reaction rather than
          // a state machine flipping.
          p.mood = 'notice';
          p.moodT = 0.28;
        }
        if (p.mood === 'notice') {
          p.moodT -= dt;
          p.targetHeading = Math.atan2(-dx, -dz); // turn and look
          if (p.moodT <= 0) p.mood = 'flee';
        }
        if (p.mood === 'flee') {
          p.targetHeading = Math.atan2(dx, dz);
          // Panic scales with proximity — a distant ball is a jog, a close one
          // is a sprint.
          p.speed = WALK + (FLEE - WALK) * clamp01(1 - (dist - ball.visualRadius) / AWARE);
        }
      } else {
        if (p.mood === 'flee' || p.mood === 'notice') {
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
      p.heading = dampAngle(p.heading, p.targetHeading, p.mood === 'flee' ? 0.0001 : 0.02, dt);
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
    for (const p of this.peds) {
      const rig = this.rigs[p.rig];
      const m = rig.meshes;
      if (!m) continue;

      if (p.absorbed || p.hidden) {
        m.legL.setMatrixAt(p.slot, ZERO);
        m.legR.setMatrixAt(p.slot, ZERO);
        m.upper.setMatrixAt(p.slot, ZERO);
        continue;
      }

      const moving = p.speed > 0.05;
      const swing = moving ? Math.min(0.95, 0.35 + p.speed * 0.16) : 0.06;
      const s = Math.sin(p.phase);
      const c = Math.cos(p.phase);
      // Bob twice per stride.
      const bob = moving ? Math.abs(c) * 0.045 * swing : Math.sin(p.phase) * 0.008;

      p.rotY = p.heading;
      // The rig pivots about the hip, so the root must sit at hip height or the
      // legs hang below the pavement.
      _pos.set(p.x, rig.hipY + bob * 0.4, p.z);
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
      _euler.set(-clamp01(p.speed / FLEE) * 0.26, -s * swing * 0.28, wobble);
      _quat.setFromEuler(_euler);
      _pos.set(0, bob, 0);
      _part.compose(_pos, _quat, _one);
      m.upper.setMatrixAt(p.slot, _out.multiplyMatrices(_root, _part));
    }

    void dt;
  }

  /** Fixed cost: three per variant, however big the crowd. */
  get drawCalls() {
    return this.rigs.length * 3;
  }

  dispose() {
    for (const p of this.peds) if (!p.absorbed) this.city.hash.remove(p);
    this.peds.length = 0;
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
