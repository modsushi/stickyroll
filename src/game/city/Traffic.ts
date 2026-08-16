/**
 * City traffic.
 *
 * Cars drive closed circuits with lookahead braking and give way at the ball, so
 * the streets read as a working city rather than a diorama. Each car is a
 * `PropInstance` re-registered in the spatial hash as it moves, which means the
 * ordinary sticking code absorbs a moving car with no special case at all — and
 * eating a car that was driving away from you is one of the best moments in the
 * game.
 *
 * One InstancedMesh per car model keeps all traffic at ~6 draw calls.
 */

import { DynamicDrawUsage, Group, InstancedMesh, Matrix4, Object3D, Vector3 } from 'three';
import { assets } from '../../core/Assets';
import { Rand, clamp01, dampAngle, lerp } from '../../core/Math';
import { PROPS, type PropDef } from '../../data/props';
import { sfx } from '../../audio/Sfx';
import type { LevelDef } from '../../levels/types';
import type { Ball } from '../Ball';
import type { BuiltCity } from './CityBuilder';
import type { PropInstance } from './Props';

const ZERO = new Matrix4().makeScale(0, 0, 0);
const _o = new Object3D();

interface Car extends PropInstance {
  lane: Lane;
  /** Distance travelled along the lane. */
  s: number;
  speed: number;
  targetSpeed: number;
  heading: number;
  slot: number;
  mesh: InstancedMesh;
  hornCooldown: number;
  /** Lateral offset from the lane centre — puts cars in the right-hand lane. */
  offset: number;
}

interface Lane {
  pts: Vector3[];
  /** Cumulative arc length at each point. */
  cum: number[];
  length: number;
  speed: number;
  loop: boolean;
}

export class Traffic {
  /** Car models used by traffic. Every one must exist in the prop catalog. */
  static readonly MODELS = [
    'sedan', 'taxi', 'suv', 'hatchback-sports', 'van', 'police', 'ambulance', 'firetruck',
  ];
  /** Catalog ids matching the models above, in the same order. */
  private static readonly PROP_IDS = [
    'sedan', 'taxi', 'suv', 'hatchback', 'van', 'police', 'ambulance', 'firetruck',
  ];

  readonly group = new Group();
  private cars: Car[] = [];
  private meshes = new Map<string, { mesh: InstancedMesh; used: number }>();
  private rand = new Rand(0x51ee7);

  constructor(
    private level: LevelDef,
    private city: BuiltCity
  ) {
    this.group.name = 'traffic';
    this.build();
  }

  private build() {
    const L = this.level;
    const lanes: Lane[] = L.lanes.map((spec) => {
      const pts = spec.points.map(
        ([tx, ty]) =>
          new Vector3(
            (tx - (L.map[0].length - 1) / 2) * L.tileSize,
            0,
            (ty - (L.map.length - 1) / 2) * L.tileSize
          )
      );
      const cum = [0];
      let total = 0;
      const n = spec.loop ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        total += pts[i].distanceTo(pts[(i + 1) % pts.length]);
        cum.push(total);
      }
      return { pts, cum, length: total, speed: spec.speed, loop: spec.loop ?? true };
    });

    // Count per model first so each InstancedMesh is sized exactly.
    const picks: { def: PropDef; lane: Lane; s: number }[] = [];
    lanes.forEach((lane, li) => {
      const spec = L.lanes[li];
      for (let i = 0; i < spec.cars; i++) {
        const idx = this.rand.int(0, Traffic.PROP_IDS.length - 1);
        // Emergency vehicles are rare; without this every street is a parade.
        const id = Traffic.PROP_IDS[idx === 6 || idx === 7 ? this.rand.int(0, 4) : idx];
        const def = PROPS[id];
        if (!def) continue;
        picks.push({ def, lane, s: (lane.length / spec.cars) * i });
      }
    });

    const counts = new Map<string, number>();
    for (const p of picks) counts.set(p.def.model, (counts.get(p.def.model) ?? 0) + 1);
    for (const [model, count] of counts) {
      if (!assets.has('cars', model)) continue;
      const src = assets.get('cars', model);
      const mesh = new InstancedMesh(src.geometry, src.material, count);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Bounds are recomputed each frame from the live instances (see render),
      // so traffic is culled like anything else instead of being drawn from
      // across the district every frame.
      mesh.frustumCulled = true;
      mesh.count = 0;
      this.group.add(mesh);
      this.meshes.set(model, { mesh, used: 0 });
    }

    for (const p of picks) {
      const entry = this.meshes.get(p.def.model);
      if (!entry) continue;
      const slot = entry.used++;
      entry.mesh.count = entry.used;

      const car: Car = {
        def: p.def,
        x: 0,
        y: p.def.size.y * 0.5,
        z: 0,
        rotY: 0,
        scale: 1,
        absorbed: false,
        geometry: assets.get('cars', p.def.model).geometry,
        material: assets.get('cars', p.def.model).material,
        hide: () => {
          entry.mesh.setMatrixAt(slot, ZERO);
          entry.mesh.instanceMatrix.needsUpdate = true;
        },
        lane: p.lane,
        s: p.s,
        speed: p.lane.speed,
        targetSpeed: p.lane.speed,
        heading: 0,
        slot,
        mesh: entry.mesh,
        hornCooldown: 0,
        // Right-hand traffic: sit a lane-width to the right of the centre line.
        offset: 1.5,
      };
      this.cars.push(car);
      this.city.hash.insert(car);
      this.place(car);
    }
  }

  /** Position and heading at arc-length `s` along a lane. */
  private sample(lane: Lane, s: number, out: Vector3): number {
    const len = lane.length;
    let t = lane.loop ? ((s % len) + len) % len : Math.min(Math.max(s, 0), len);
    let i = 0;
    while (i < lane.cum.length - 2 && lane.cum[i + 1] < t) i++;
    const a = lane.pts[i];
    const b = lane.pts[(i + 1) % lane.pts.length];
    const segLen = lane.cum[i + 1] - lane.cum[i] || 1;
    const f = clamp01((t - lane.cum[i]) / segLen);
    out.set(lerp(a.x, b.x, f), 0, lerp(a.z, b.z, f));
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  private place(car: Car) {
    const heading = this.sample(car.lane, car.s, _tmp);
    car.heading = heading;
    // Push the car to the right of the centre line, perpendicular to heading.
    const rx = Math.cos(heading);
    const rz = -Math.sin(heading);
    car.x = _tmp.x + rx * car.offset;
    car.z = _tmp.z + rz * car.offset;
  }

  step(dt: number, ball: Ball) {
    const bx = ball.pos.x;
    const bz = ball.pos.z;
    const br = ball.visualRadius;

    for (const car of this.cars) {
      if (car.absorbed) continue;

      // Lookahead: brake for the car ahead on the same lane, and for the ball.
      let target = car.lane.speed;
      const ahead = this.gapAhead(car);
      if (ahead < 9) target *= clamp01((ahead - 3.5) / 5.5);

      const dToBall = Math.hypot(car.x - bx, car.z - bz);
      const danger = br + 5;
      if (dToBall < danger) {
        target *= clamp01((dToBall - br - 1.2) / 4);
        car.hornCooldown -= dt;
        if (car.hornCooldown <= 0 && dToBall < br + 3.5) {
          car.hornCooldown = this.rand.range(1.6, 4);
          sfx.horn(this.rand.range(0.85, 1.2));
        }
      }
      car.targetSpeed = target;

      // Asymmetric response: brake hard, accelerate gently. Sells mass.
      const rate = target < car.speed ? 9 : 3.2;
      car.speed += (target - car.speed) * Math.min(1, rate * dt);
      car.s += car.speed * dt;

      const prevX = car.x;
      const prevZ = car.z;
      this.place(car);
      // Only re-hash when the car actually moved a meaningful distance.
      if (Math.abs(car.x - prevX) + Math.abs(car.z - prevZ) > 0.001) {
        this.city.hash.remove(car);
        this.city.hash.insert(car);
      }
    }
  }

  /** Distance to the next car ahead on the same lane. */
  private gapAhead(car: Car): number {
    let best = Infinity;
    for (const other of this.cars) {
      if (other === car || other.absorbed || other.lane !== car.lane) continue;
      let d = other.s - car.s;
      if (car.lane.loop && d < 0) d += car.lane.length;
      if (d > 0 && d < best) best = d;
    }
    return best;
  }

  render(dt: number) {
    for (const car of this.cars) {
      if (car.absorbed) continue;
      // Smooth the visual heading so corners look driven, not snapped.
      car.rotY = dampAngle(car.rotY, car.heading, 0.0001, dt);
      _o.position.set(car.x, 0, car.z);
      _o.rotation.set(0, car.rotY, 0);
      _o.scale.setScalar(1);
      _o.updateMatrix();
      car.mesh.setMatrixAt(car.slot, _o.matrix);
    }
    for (const { mesh } of this.meshes.values()) {
      mesh.instanceMatrix.needsUpdate = true;
      // Cars move, so their batch bounds go stale immediately. Recomputing is
      // cheap at this count and is what lets the renderer reject off-screen
      // traffic in both the colour and shadow passes.
      mesh.computeBoundingSphere();
    }
  }

  get drawCalls() {
    return this.meshes.size;
  }

  dispose() {
    for (const car of this.cars) if (!car.absorbed) this.city.hash.remove(car);
    for (const { mesh } of this.meshes.values()) {
      mesh.dispose();
      this.group.remove(mesh);
    }
    this.meshes.clear();
    this.cars.length = 0;
  }
}

const _tmp = new Vector3();
