/**
 * Animated railway traffic for Rail City.
 *
 * Track follows smooth Catmull-Rom loops and is drawn as one static batch per
 * route. Train units use dynamic batches grouped by model, so a commuter train,
 * freight train and tram cost roughly the same draw calls as the city's cars.
 *
 * Every unit is also a normal `PropInstance`: before tier eight it is a moving
 * obstacle, and at the final tier the ordinary sticking system can lift a
 * locomotive straight off the rails with no train-specific pickup logic.
 */

import {
  BoxGeometry,
  CatmullRomCurve3,
  Group,
  Object3D,
  PointLight,
  Vector3,
} from 'three';
import { sfx } from '../../audio/Sfx';
import { assets } from '../../core/Assets';
import { Rand } from '../../core/Math';
import { PROPS, type PropDef } from '../../data/props';
import type { LevelDef } from '../../levels/types';
import { MeshBatch, batchMode } from '../../render/Batch';
import { makeLit, type LitMaterial } from '../../render/litMaterial';
import type { Ball } from '../Ball';
import type { BuiltCity } from './CityBuilder';
import type { PropInstance } from './Props';

const _o = new Object3D();
const _p = new Vector3();
const _t = new Vector3();

interface Route {
  curve: CatmullRomCurve3;
  length: number;
}

interface Consist {
  route: Route;
  distance: number;
  speed: number;
  direction: 1 | -1;
  units: RailUnit[];
  horn: number;
  light: PointLight;
}

interface RailUnit extends PropInstance {
  consist: Consist;
  behind: number;
  slot: number;
  mesh: MeshBatch;
  phase: number;
}

interface UnitPlan {
  def: PropDef;
  consistIndex: number;
  behind: number;
}

export class Trains {
  /** Models outside the prop catalog that still have to be ready at boot. */
  static readonly MODELS = ['track-detailed'] as const;

  readonly group = new Group();
  private routes: Route[] = [];
  private consists: Consist[] = [];
  private meshes = new Map<string, { mesh: MeshBatch; used: number }>();
  private trackMeshes: MeshBatch[] = [];
  private stationMeshes: MeshBatch[] = [];
  private stationMaterials: LitMaterial[] = [];
  private rand = new Rand(0x7a11);
  private visualTime = 0;
  private clack = 0;

  constructor(
    private level: LevelDef,
    private city: BuiltCity
  ) {
    this.group.name = 'railway';
    if (!level.rails?.length) return;
    this.buildRoutes();
    this.buildTrack();
    this.buildTrains();
    this.buildStations();
  }

  private tilePoint([x, y]: [number, number]): Vector3 {
    return new Vector3(
      (x - (this.level.map[0].length - 1) / 2) * this.level.tileSize,
      0.035,
      (y - (this.level.map.length - 1) / 2) * this.level.tileSize
    );
  }

  private buildRoutes() {
    for (const spec of this.level.rails ?? []) {
      const points = spec.points.map((p) => this.tilePoint(p));
      if (points.length < 4) continue;
      const curve = new CatmullRomCurve3(points, true, 'centripetal', 0.5);
      // A dense arc-length table keeps car spacing stable through the corners.
      curve.arcLengthDivisions = Math.max(512, points.length * 96);
      curve.updateArcLengths();
      this.routes.push({ curve, length: curve.getLength() });
    }
  }

  private buildTrack() {
    const specs = this.level.rails ?? [];
    for (let r = 0; r < this.routes.length; r++) {
      const spec = specs[r];
      const model = spec.trackModel ?? 'track-detailed';
      if (!assets.has('trains', model)) continue;
      const route = this.routes[r];
      const spacing = spec.trackSpacing ?? 1.55;
      const count = Math.max(8, Math.ceil(route.length / spacing));
      const src = assets.get('trains', model);
      const mesh = new MeshBatch(src.geometry, src.material, count);
      mesh.setShadows(false, true);

      for (let i = 0; i < count; i++) {
        const u = i / count;
        route.curve.getPointAt(u, _p);
        route.curve.getTangentAt(u, _t);
        _o.position.copy(_p);
        _o.rotation.set(0, Math.atan2(_t.x, _t.z), 0);
        _o.scale.setScalar(1);
        _o.updateMatrix();
        mesh.setMatrixAt(i, _o.matrix);
      }
      mesh.build();
      mesh.computeBoundingSphere();
      mesh.setCulling(true);
      this.group.add(mesh);
      this.trackMeshes.push(mesh);
    }
  }

  private buildTrains() {
    const specs = this.level.rails ?? [];
    const plans: UnitPlan[] = [];
    const consistPlans: {
      route: Route;
      distance: number;
      speed: number;
      direction: 1 | -1;
      horn: number;
    }[] = [];

    for (let r = 0; r < this.routes.length; r++) {
      const route = this.routes[r];
      for (const spec of specs[r].consists) {
        const consistIndex = consistPlans.length;
        consistPlans.push({
          route,
          distance: route.length * (spec.start ?? 0),
          speed: spec.speed,
          direction: spec.direction ?? 1,
          horn: this.rand.range(1.5, 5),
        });
        const gap = spec.gap ?? 4.35;
        spec.units.forEach((id, i) => {
          const def = PROPS[id];
          if (def?.kit === 'trains' && assets.has('trains', def.model)) {
            plans.push({ def, consistIndex, behind: i * gap });
          }
        });
      }
    }

    const counts = new Map<string, number>();
    for (const p of plans) counts.set(p.def.model, (counts.get(p.def.model) ?? 0) + 1);
    for (const [model, count] of counts) {
      const src = assets.get('trains', model);
      const mesh = new MeshBatch(src.geometry, src.material, count, batchMode(true));
      mesh.setShadows(true, true);
      mesh.visibleCount = 0;
      this.group.add(mesh);
      this.meshes.set(model, { mesh, used: 0 });
    }

    for (const p of consistPlans) {
      const light = new PointLight(0xffd58a, 3.4, 13, 2);
      light.castShadow = false;
      this.group.add(light);
      this.consists.push({ ...p, units: [], light });
    }

    for (const p of plans) {
      const entry = this.meshes.get(p.def.model);
      const consist = this.consists[p.consistIndex];
      if (!entry || !consist) continue;
      const src = assets.get('trains', p.def.model);
      const slot = entry.used++;
      entry.mesh.visibleCount = entry.used;
      const unit: RailUnit = {
        def: p.def,
        x: 0,
        y: src.size.y * 0.5,
        z: 0,
        lift: 0,
        rotY: 0,
        scale: p.def.scale ?? 1,
        absorbed: false,
        geometry: src.geometry,
        material: src.material,
        hide: () => entry.mesh.hideAt(slot),
        consist,
        behind: p.behind,
        slot,
        mesh: entry.mesh,
        phase: this.rand.angle(),
      };
      consist.units.push(unit);
      this.place(unit);
      this.city.hash.insert(unit);
      let byProp = this.city.byProp.get(unit.def.id);
      if (!byProp) this.city.byProp.set(unit.def.id, (byProp = []));
      byProp.push(unit);
    }
  }

  private place(unit: RailUnit) {
    const c = unit.consist;
    const route = c.route;
    const distance = c.distance - c.direction * unit.behind;
    const u = (((distance / route.length) % 1) + 1) % 1;
    route.curve.getPointAt(u, _p);
    route.curve.getTangentAt(u, _t).multiplyScalar(c.direction);
    unit.x = _p.x;
    unit.z = _p.z;
    unit.rotY = Math.atan2(_t.x, _t.z);
  }

  /** Fixed-step movement, collision re-registration and restrained rail audio. */
  step(dt: number, ball: Ball) {
    if (!this.consists.length) return;
    this.clack -= dt;
    let nearRail = false;

    for (const consist of this.consists) {
      consist.distance += consist.speed * consist.direction * dt;
      consist.horn -= dt;
      let nearest = Infinity;

      for (const unit of consist.units) {
        if (unit.absorbed) continue;
        this.city.hash.remove(unit);
        this.place(unit);
        this.city.hash.insert(unit);
        const d = Math.hypot(unit.x - ball.pos.x, unit.z - ball.pos.z);
        nearest = Math.min(nearest, d);
      }

      const head = consist.units.find((u) => !u.absorbed);
      consist.light.visible = Boolean(head);
      if (head) consist.light.position.set(head.x, 1.15, head.z);

      if (nearest < 22 && consist.horn <= 0) {
        consist.horn = this.rand.range(6.5, 11);
        sfx.trainHorn(this.rand.range(0.88, 1.12));
      }
      if (nearest < 16) nearRail = true;
    }

    if (nearRail && this.clack <= 0) {
      this.clack = this.rand.range(0.34, 0.52);
      sfx.railClack(this.rand.range(0.92, 1.08));
    }
  }

  /** Render-rate suspension bob and batched matrix refresh. */
  render(dt: number) {
    this.visualTime += dt;
    for (const consist of this.consists) {
      for (const unit of consist.units) {
        if (unit.absorbed) continue;
        const wave = this.visualTime * 5.2 + unit.phase;
        _o.position.set(unit.x, 0.018 + Math.abs(Math.sin(wave)) * 0.018, unit.z);
        _o.rotation.set(0, unit.rotY, Math.sin(wave * 0.7) * 0.008);
        _o.scale.setScalar(unit.scale);
        _o.updateMatrix();
        unit.mesh.setMatrixAt(unit.slot, _o.matrix);
      }
    }
    for (const { mesh } of this.meshes.values()) mesh.computeBoundingSphere();
  }

  /** Low-poly platforms, safety stripes and canopies, all merged by material. */
  private buildStations() {
    const stations = (this.level.rails ?? []).flatMap((r) => r.stations ?? []);
    if (!stations.length) return;

    const unit = new BoxGeometry(1, 1, 1);
    const concrete = makeLit({ color: 0xb7c2c8, roughness: 0.88, metalness: 0 });
    const safety = makeLit({ color: 0xf6c945, roughness: 0.76, metalness: 0 });
    const canopy = makeLit({ color: 0x277da1, roughness: 0.68, metalness: 0.04 });
    this.stationMaterials.push(concrete, safety, canopy);

    const platforms = new MeshBatch(unit, concrete, stations.length);
    const stripes = new MeshBatch(unit, safety, stations.length * 2);
    const canopies = new MeshBatch(unit, canopy, stations.length * 5);
    platforms.setShadows(true, true);
    stripes.setShadows(false, true);
    canopies.setShadows(true, true);

    const setBox = (
      mesh: MeshBatch,
      slot: number,
      cx: number,
      cy: number,
      cz: number,
      sx: number,
      sy: number,
      sz: number,
      yaw: number
    ) => {
      _o.position.set(cx, cy, cz);
      _o.rotation.set(0, yaw, 0);
      _o.scale.set(sx, sy, sz);
      _o.updateMatrix();
      mesh.setMatrixAt(slot, _o.matrix);
    };

    stations.forEach((station, i) => {
      const centre = this.tilePoint(station.at);
      const yaw = station.rot ?? 0;
      const length = station.length ?? 15;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const local = (x: number, z: number) => ({
        x: centre.x + x * cos + z * sin,
        z: centre.z - x * sin + z * cos,
      });

      setBox(platforms, i, centre.x, 0.13, centre.z, length, 0.26, 2.35, yaw);
      for (let side = -1; side <= 1; side += 2) {
        const p = local(0, side * 1.02);
        setBox(stripes, i * 2 + (side > 0 ? 1 : 0), p.x, 0.285, p.z, length * 0.94, 0.055, 0.12, yaw);
      }

      setBox(canopies, i * 5, centre.x, 2.72, centre.z, length * 0.68, 0.16, 2.1, yaw);
      let slot = i * 5 + 1;
      for (const x of [-length * 0.27, length * 0.27]) {
        for (const z of [-0.72, 0.72]) {
          const p = local(x, z);
          setBox(canopies, slot++, p.x, 1.42, p.z, 0.13, 2.7, 0.13, yaw);
        }
      }
    });

    for (const mesh of [platforms, stripes, canopies]) {
      mesh.build();
      mesh.computeBoundingSphere();
      mesh.setCulling(true);
      this.group.add(mesh);
      this.stationMeshes.push(mesh);
    }
  }

  get drawCalls() {
    return this.trackMeshes.length + this.meshes.size + this.stationMeshes.length;
  }

  dispose() {
    for (const consist of this.consists) {
      for (const unit of consist.units) if (!unit.absorbed) this.city.hash.remove(unit);
      this.group.remove(consist.light);
    }
    for (const { mesh } of this.meshes.values()) mesh.dispose();
    for (const mesh of this.trackMeshes) mesh.dispose();
    for (const mesh of this.stationMeshes) mesh.dispose();
    for (const material of this.stationMaterials) material.dispose();
    this.group.clear();
    this.meshes.clear();
    this.trackMeshes.length = 0;
    this.stationMeshes.length = 0;
    this.stationMaterials.length = 0;
    this.consists.length = 0;
    this.routes.length = 0;
  }
}
