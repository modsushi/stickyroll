/**
 * Builds a level's world from its ASCII map.
 *
 * Three jobs:
 *  1. Autotile the roads — derive model + rotation from each cell's neighbours,
 *     so authors draw `#` and get bends, T-junctions and crossroads for free.
 *  2. Lay ground. Pavement and grass are two big merged planes with vertex
 *     colours rather than per-tile meshes, because a 44x44 map is 1936 tiles and
 *     none of them need to be individually addressable.
 *  3. Scatter props and place buildings, registering every absorbable thing in
 *     the spatial hash.
 *
 * Everything static ends up as a handful of instanced or merged meshes.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { MeshBatch } from '../../render/Batch';
import { makeLit } from '../../render/litMaterial';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assets } from '../../core/Assets';
import { Rand, clamp } from '../../core/Math';
import { toggle } from '../../core/Debug';
import { PROPS, prop, type PropDef } from '../../data/props';
import type { LevelDef, TileChar } from '../../levels/types';
import { SpatialHash } from '../SpatialHash';
import { Props, chunkedScenery, type PropInstance } from './Props';

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3(1, 1, 1);

const isRoad = (c: string) => c === '#' || c === 'X';

/** A resolved prop placement, before it is handed to the batcher. */
interface Placement {
  def: PropDef;
  x: number;
  z: number;
  rotY: number;
  scale: number;
  /** Height off the ground, for stacked junk. */
  lift?: number;
}

/** Fog colour the distant skyline washes toward, matching Renderer's fog. */
const HORIZON_HAZE = new Color(0xc4dfec);

/**
 * Radius around the spawn kept free of anything the starting ball can't move.
 * Small litter is still welcome — that's the opening bowl — but a bench or a
 * shop shelf here would trap the player before the first drag.
 */
const START_CLEAR = 5;

/** Neighbour bitmask: N=1 E=2 S=4 W=8. */
function roadMask(map: string[], x: number, y: number): number {
  let m = 0;
  if (isRoad(map[y - 1]?.[x] ?? ' ')) m |= 1;
  if (isRoad(map[y]?.[x + 1] ?? ' ')) m |= 2;
  if (isRoad(map[y + 1]?.[x] ?? ' ')) m |= 4;
  if (isRoad(map[y]?.[x - 1] ?? ' ')) m |= 8;
  return m;
}

/**
 * Maps a neighbour mask to a road model plus a Y rotation in quarter turns.
 *
 * The base orientations below were read off the models themselves (rendered
 * top-down against known axes), not guessed — the kit's naming is no guide, and
 * getting one wrong lays every lane marking and zebra crossing sideways:
 *
 *   road-straight / road-crossing  run along X, i.e. connect E-W
 *   road-bend                      connects W and S
 *   road-intersection              T-junction, bar E-W with the stem to S
 *   road-end                       opens to the E
 *
 * One quarter turn is -90° about Y, which rotates a compass direction one step
 * clockwise: N -> E -> S -> W -> N.
 *
 * `road-split` is deliberately unused despite being the obvious-sounding
 * T-piece: it is a 1x2 model and silently overhangs its neighbour in a 1x1 grid.
 * `road-intersection` is the 1x1 T.
 */
function roadTile(mask: number): { model: string; turns: number } {
  switch (mask) {
    case 0b1111: return { model: 'road-crossroad', turns: 0 };

    // T-junctions. Base is missing N; each turn advances the missing side.
    case 0b1110: return { model: 'road-intersection', turns: 0 }; // no N
    case 0b1101: return { model: 'road-intersection', turns: 1 }; // no E
    case 0b1011: return { model: 'road-intersection', turns: 2 }; // no S
    case 0b0111: return { model: 'road-intersection', turns: 3 }; // no W

    // Straights. Base runs E-W.
    case 0b1010: return { model: 'road-straight', turns: 0 }; // E-W
    case 0b0101: return { model: 'road-straight', turns: 1 }; // N-S

    // Bends. Base connects S+W.
    case 0b1100: return { model: 'road-bend', turns: 0 }; // S+W
    case 0b1001: return { model: 'road-bend', turns: 1 }; // W+N
    case 0b0011: return { model: 'road-bend', turns: 2 }; // N+E
    case 0b0110: return { model: 'road-bend', turns: 3 }; // E+S

    // Dead ends. Base opens E.
    case 0b0010: return { model: 'road-end', turns: 0 }; // E
    case 0b0100: return { model: 'road-end', turns: 1 }; // S
    case 0b1000: return { model: 'road-end', turns: 2 }; // W
    case 0b0001: return { model: 'road-end', turns: 3 }; // N

    default: return { model: 'road-straight', turns: 0 };
  }
}

/** Every road model the autotiler can emit. The loader preloads exactly these. */
export const ROAD_MODELS = [
  'road-straight',
  'road-crossing',
  'road-bend',
  'road-intersection',
  'road-crossroad',
  'road-end',
] as const;

export interface BuiltCity {
  group: Group;
  props: Props;
  hash: SpatialHash<PropInstance>;
  /** World-space bounds of the playable area. */
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** World position of the ball's spawn. */
  start: Vector3;
  /** Absorbable prop instances by prop id, for collectible bookkeeping. */
  byProp: Map<string, PropInstance[]>;
  drawCalls: number;
}

export class CityBuilder {
  private rand: Rand;

  constructor(private level: LevelDef, seed = 1337) {
    this.rand = new Rand(seed);
  }

  private get cols() {
    return this.level.map[0].length;
  }
  private get rows() {
    return this.level.map.length;
  }

  /** Tile coords -> world centre of that tile. */
  private worldX(tx: number) {
    return (tx - (this.cols - 1) / 2) * this.level.tileSize;
  }
  private worldZ(ty: number) {
    return (ty - (this.rows - 1) / 2) * this.level.tileSize;
  }

  private at(x: number, y: number): TileChar {
    const c = this.level.map[y]?.[x] ?? ' ';
    return (c === ' ' ? ',' : c) as TileChar;
  }

  build(): BuiltCity {
    const L = this.level;
    const group = new Group();
    group.name = 'city';

    const halfW = (this.cols * L.tileSize) / 2;
    const halfD = (this.rows * L.tileSize) / 2;
    const bounds = { minX: -halfW, minZ: -halfD, maxX: halfW, maxZ: halfD };

    const hash = new SpatialHash<PropInstance>(
      bounds.minX - 8,
      bounds.minZ - 8,
      this.cols * L.tileSize + 16,
      this.rows * L.tileSize + 16,
      Math.max(4, L.tileSize)
    );

    let drawCalls = 0;
    group.add(this.buildGround());
    drawCalls += 2;
    const roads = this.buildRoads();
    group.add(roads.group);
    drawCalls += roads.drawCalls;

    const props = new Props();
    const byProp = new Map<string, PropInstance[]>();

    // Buildings whose model is in the prop catalog are absorbable at the top
    // tiers, so they join the scattered props; the rest are pure scenery. Both
    // sets are planned before a single allocate() so every batch is
    // sized exactly once.
    const buildings = this.planBuildings();
    const scenery = this.splitBuildings(buildings);
    // Clusters go down first and claim their ground, so loose scatter fills in
    // around the arrangements instead of landing on top of them.
    const claimed = new Set<string>();
    const clusters = this.planClusters(claimed);
    const lines = this.planLines(claimed);
    const placements = [
      ...lines,
      ...clusters,
      ...this.planProps(claimed),
      ...scenery.absorbable,
    ];
    this.guaranteeCollectibles(placements);

    for (const pl of placements) props.reserve(pl.def, pl.x, pl.z);
    props.allocate();
    for (const pl of placements) {
      const inst = props.add(pl.def, pl.x, pl.z, pl.rotY, pl.scale, pl.lift ?? 0);
      hash.insert(inst);
      let list = byProp.get(pl.def.id);
      if (!list) byProp.set(pl.def.id, (list = []));
      list.push(inst);
    }
    props.finalize();
    group.add(props.group);
    drawCalls += props.batchCount;

    const built = this.buildScenery(scenery.static);
    group.add(built.group);
    drawCalls += built.drawCalls;
    this.insertBuildingBlockers(scenery.static, hash);

    const surround = this.buildSurround(bounds);
    group.add(surround.group);
    drawCalls += surround.drawCalls;

    return {
      group,
      props,
      hash,
      bounds,
      start: new Vector3(this.worldX(L.start[0]), 0, this.worldZ(L.start[1])),
      byProp,
      drawCalls,
    };
  }

  // ── ground ──────────────────────────────────────────────────────────────

  /**
   * One merged plane per surface type. Vertex colour carries slight per-tile
   * variation so a big park doesn't read as a flat green rectangle.
   */
  private buildGround(): Group {
    const L = this.level;
    const g = new Group();
    g.name = 'ground';

    const pave: BufferGeometry[] = [];
    const grass: BufferGeometry[] = [];
    const t = L.tileSize;

    // Darker than the Kenney pavement tile on purpose: the ball is near-white,
    // and it has to read against this surface for the entire game.
    // Cool light concrete. This was briefly a warm cream, which looked lovely
    // empty and was a mistake the moment furniture stood on it: the furniture
    // kit is warm tan wood, so tables and chairs sank into the pavement. A
    // cool grey is the same brightness but the opposite hue, so the warm props
    // read as objects sitting on a surface rather than pattern in it.
    const paveColor = new Color(0xbcc3c9);
    // Bright, but pulled back from the near-neon it was — a real lawn, not a
    // highlighter.
    const grassColor = new Color(0x74b04a);

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const c = this.at(x, y);
        if (isRoad(c)) continue;
        const isGrass = c === '.' || c === 'T';
        const geo = new PlaneGeometry(t, t);
        geo.rotateX(-Math.PI / 2);
        geo.translate(this.worldX(x), 0, this.worldZ(y));

        const base = isGrass ? grassColor : paveColor;
        const v = 1 + (this.rand.next() - 0.5) * (isGrass ? 0.14 : 0.07);
        const col = new Color(base.r * v, base.g * v, base.b * v);
        const count = geo.attributes.position.count;
        const arr = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          arr[i * 3] = col.r;
          arr[i * 3 + 1] = col.g;
          arr[i * 3 + 2] = col.b;
        }
        geo.setAttribute('color', new BufferAttribute(arr, 3));
        (isGrass ? grass : pave).push(geo);
      }
    }

    for (const [list, y] of [
      [pave, 0.0],
      [grass, 0.012], // lift grass a hair so it never z-fights the pavement
    ] as const) {
      if (!list.length) continue;
      const merged = BufferGeometryUtils.mergeGeometries(list, false);
      for (const q of list) q.dispose();
      if (!merged) continue;
      const mesh = new Mesh(
        merged,
        makeLit({ vertexColors: true, roughness: 0.95, metalness: 0 })
      );
      mesh.position.y = y;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      g.add(mesh);
    }

    // Skirt: an oversized plane under everything. The ball is confined to the
    // tile grid, but the camera looks well past it — without this you can see
    // the sky through the ground at the map edge.
    //
    // Its colour matters more than it sounds: this is the ground *outside* the
    // city wall, seen between the towers on the horizon. Green reads as "the
    // map ended and here is a field"; a hazy grey reads as more city receding
    // into the distance, which is the whole point of the wall and skyline.
    const span = Math.max(this.cols, this.rows) * t * 5;
    const skirt = new PlaneGeometry(span, span);
    skirt.rotateX(-Math.PI / 2);
    const skirtMesh = new Mesh(
      skirt,
      makeLit({ color: 0xb3bac0, roughness: 1, metalness: 0 })
    );
    skirtMesh.position.y = -0.06;
    skirtMesh.receiveShadow = false;
    skirtMesh.frustumCulled = false;
    g.add(skirtMesh);

    return g;
  }

  // ── the edge of the world ───────────────────────────────────────────────

  /**
   * Boundary wall plus the skyline behind it.
   *
   * The ball can be driven right into the level bounds, so the border has to
   * survive being looked at from a metre away. A wall does two jobs at once: it
   * explains the invisible limit the clamp already enforces, and it hides the
   * seam where the tile grid stops. Behind it, rings of the tallest towers fill
   * the horizon so the district reads as part of a much larger city.
   *
   * The wall is built geometry rather than kit models because it has to match
   * the play bounds exactly — no kit piece is 4 m wide and 7 m tall — and it
   * merges to two draw calls.
   */
  private buildSurround(bounds: BuiltCity['bounds']): { group: Group; drawCalls: number } {
    const g = new Group();
    g.name = 'surround';
    const spec = this.level.surround;
    if (!spec) return { group: g, drawCalls: 0 };

    const { minX, minZ, maxX, maxZ } = bounds;
    const h = spec.wallHeight;
    const t = spec.wallThickness;
    const w = maxX - minX;
    const d = maxZ - minZ;

    // Four slabs, overlapping at the corners so there are no gaps to see through.
    const slabs: BufferGeometry[] = [];
    const caps: BufferGeometry[] = [];
    const push = (cx: number, cz: number, sx: number, sz: number) => {
      const body = new BoxGeometry(sx, h, sz);
      body.translate(cx, h / 2, cz);
      slabs.push(body);
      // A lighter capstone reads as deliberate construction rather than a
      // clipping plane, and catches the sun along the top edge.
      const cap = new BoxGeometry(sx + 0.35, 0.5, sz + 0.35);
      cap.translate(cx, h + 0.15, cz);
      caps.push(cap);
    };
    push((minX + maxX) / 2, minZ - t / 2, w + t * 2, t);
    push((minX + maxX) / 2, maxZ + t / 2, w + t * 2, t);
    push(minX - t / 2, (minZ + maxZ) / 2, t, d);
    push(maxX + t / 2, (minZ + maxZ) / 2, t, d);

    let drawCalls = 0;
    for (const [list, color] of [
      [slabs, 0x6f6a63],
      [caps, 0x9a948a],
    ] as const) {
      const merged = BufferGeometryUtils.mergeGeometries(list, false);
      for (const q of list) q.dispose();
      if (!merged) continue;
      const mesh = new Mesh(
        merged,
        makeLit({ color, roughness: 0.95, metalness: 0 })
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      g.add(mesh);
      drawCalls++;
    }

    // Skyline beyond the wall. Placed on a ring grid and jittered so it reads as
    // a city rather than a fence of towers, and scaled up because these are
    // meant to be read at 100+ metres.
    //
    // Currently defaulted OFF at the user's request so the map can be judged
    // without it; `?skyline=1` brings it back. Flip the fallback here to make it
    // permanent again.
    const models = toggle('skyline', false)
      ? spec.skyline.models.filter((m) => assets.has(spec.skyline.kit, m))
      : [];
    if (models.length) {
      const towers: {
        kit: string; model: string; x: number; z: number; rotY: number; scale: number;
        ring: number;
      }[] = [];
      const step = 16;
      for (let ring = 0; ring < spec.skylineRings; ring++) {
        const inset = spec.skylineGap + ring * step;
        const x0 = minX - inset;
        const x1 = maxX + inset;
        const z0 = minZ - inset;
        const z1 = maxZ + inset;
        for (let x = x0; x <= x1; x += step) {
          for (let z = z0; z <= z1; z += step) {
            // Ring, not slab: skip anything that isn't on this ring's border.
            const onEdge =
              Math.abs(x - x0) < 1 || Math.abs(x - x1) < 1 ||
              Math.abs(z - z0) < 1 || Math.abs(z - z1) < 1;
            if (!onEdge || !this.rand.chance(0.92)) continue;
            towers.push({
              kit: spec.skyline.kit,
              model: this.rand.pick(models),
              x: x + this.rand.range(-2.5, 2.5),
              z: z + this.rand.range(-2.5, 2.5),
              rotY: this.rand.int(0, 3) * (Math.PI / 2),
              // Further rings are taller, so the horizon rises away from you.
              scale: this.rand.range(1.1, 1.7) + ring * 0.45,
              ring,
            });
          }
        }
      }
      // Only the innermost ring keeps its real geometry. Standing at the map
      // edge you are barely 9 m from it, close enough that a flat box reads as
      // a blank slab rather than a building; the outer rings are 25 m and 41 m
      // further again, where the silhouette is all that survives.
      const near = towers.filter((t) => t.ring === 0);
      const far = towers.filter((t) => t.ring > 0);

      const detailed = chunkedScenery(near, 0);
      detailed.group.name = 'skyline-near';
      detailed.group.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = false;
        }
      });
      g.add(detailed.group);
      drawCalls += detailed.batches;

      const sky = this.buildSkylineImpostors(far);
      sky.name = 'skyline';
      g.add(sky);
      drawCalls += 1;
    }

    return { group: g, drawCalls };
  }

  /**
   * The horizon, as boxes rather than buildings.
   *
   * The skyline sat 100 m+ beyond a wall the player cannot cross, yet it was
   * ~125 detailed skyscrapers: 74k triangles across 4 draw calls that were
   * never frustum-culled, drawn every frame at every tier — around a quarter of
   * the scene's triangles for something that only ever reads as a silhouette.
   *
   * Each tower becomes a single box coloured from its model's own average
   * vertex colour, so the horizon keeps its palette and its varied heights.
   * That is ~12 triangles apiece instead of ~590, welded into one mesh.
   */
  private buildSkylineImpostors(
    towers: {
      kit: string; model: string; x: number; z: number; rotY: number; scale: number; ring: number;
    }[]
  ): Group {
    const g = new Group();
    const parts: BufferGeometry[] = [];
    const tint = new Color();

    for (const t of towers) {
      if (!assets.has(t.kit as never, t.model)) continue;
      const src = assets.get(t.kit as never, t.model);
      const w = src.size.x * t.scale;
      const h = src.size.y * t.scale;
      const d = src.size.z * t.scale;

      const box = new BoxGeometry(w, h, d);
      // Boxes are built centred; lift so the base sits on the ground.
      box.translate(0, h / 2, 0);
      box.rotateY(t.rotY);
      box.translate(t.x, 0, t.z);

      // Sample the model's own colours so the horizon keeps the kit's palette
      // instead of turning into a row of grey slabs. Textured kits carry no
      // vertex colours, so a little per-tower variation and a wash toward the
      // fog colour with distance does the work the lost detail used to.
      averageColor(src.geometry, tint);
      const v = 0.82 + this.rand.next() * 0.30;
      tint.setRGB(tint.r * v, tint.g * v, tint.b * v);
      const haze = Math.min(0.55, 0.18 * t.ring);
      tint.lerp(HORIZON_HAZE, haze);
      const count = box.attributes.position.count;
      const arr = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        arr[i * 3] = tint.r;
        arr[i * 3 + 1] = tint.g;
        arr[i * 3 + 2] = tint.b;
      }
      box.setAttribute('color', new BufferAttribute(arr, 3));
      parts.push(box);
    }

    if (!parts.length) return g;
    const merged = BufferGeometryUtils.mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!merged) return g;

    const mesh = new Mesh(
      merged,
      makeLit({ vertexColors: true, roughness: 0.95, metalness: 0 })
    );
    // Nothing out here can be reached, so nothing out here needs a shadow.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false; // the horizon is visible from everywhere anyway
    g.add(mesh);
    return g;
  }

  // ── roads ───────────────────────────────────────────────────────────────

  private buildRoads(): { group: Group; drawCalls: number } {
    const L = this.level;
    const g = new Group();
    g.name = 'roads';

    // Bucket cells by model so each becomes one batch.
    const buckets = new Map<string, { x: number; z: number; turns: number }[]>();
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const c = this.at(x, y);
        if (!isRoad(c)) continue;
        const mask = roadMask(L.map, x, y);
        let { model, turns } = roadTile(mask);
        // A marked crossing only makes sense on a straight run.
        if (c === 'X' && model === 'road-straight') model = 'road-crossing';
        let list = buckets.get(model);
        if (!list) buckets.set(model, (list = []));
        list.push({ x: this.worldX(x), z: this.worldZ(y), turns });
      }
    }

    for (const [model, cells] of buckets) {
      if (!assets.has('roads', model)) continue;
      const src = assets.get('roads', model);
      const mesh = new MeshBatch(src.geometry, src.material, cells.length);
      // flat tiles casting shadows is pure cost
      mesh.setShadows(false, true);
      cells.forEach((cell, i) => {
        _p.set(cell.x, 0, cell.z);
        _q.setFromAxisAngle(UP, (-cell.turns * Math.PI) / 2);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(i, _m);
      });
      mesh.build();
      mesh.computeBoundingSphere();
      g.add(mesh);
    }
    return { group: g, drawCalls: buckets.size };
  }

  // ── props ───────────────────────────────────────────────────────────────

  /** Tile under a world position. */
  private tileAtWorld(x: number, z: number): TileChar {
    const c = Math.round(x / this.level.tileSize + (this.cols - 1) / 2);
    const r = Math.round(z / this.level.tileSize + (this.rows - 1) / 2);
    return this.at(c, r);
  }

  /**
   * Whether loose furniture may occupy this spot. Roads must stay clear so they
   * read as travel corridors, and building plots are already solid.
   */
  private canPlaceAt(x: number, z: number): boolean {
    const t = this.tileAtWorld(x, z);
    return !isRoad(t) && t !== 'B' && t !== 'H';
  }

  /**
   * Reserves a prop's footprint on a shared 0.6 m occupancy grid.
   * @returns false if any cell it needs is already taken.
   */
  private claim(occupied: Set<string>, x: number, z: number, radius: number): boolean {
    const CELL = 0.6;
    const r = Math.max(CELL * 0.5, radius * 0.8);
    const cx0 = Math.floor((x - r) / CELL);
    const cx1 = Math.floor((x + r) / CELL);
    const cz0 = Math.floor((z - r) / CELL);
    const cz1 = Math.floor((z + r) / CELL);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (occupied.has(`${cx}:${cz}`)) return false;
      }
    }
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) occupied.add(`${cx}:${cz}`);
    }
    return true;
  }

  /**
   * Places the level's hand-arranged prop groups.
   *
   * Each cluster picks a free tile of an allowed type, rotates as a unit, and
   * claims its footprint on the shared occupancy grid so nothing else lands
   * inside a cafe or a shop display.
   */
  private planClusters(occupied: Set<string>) {
    const L = this.level;
    const out: Placement[] = [];
    const startX = this.worldX(L.start[0]);
    const startZ = this.worldZ(L.start[1]);

    for (const spec of L.clusters ?? []) {
      const defs = spec.items.filter((i) => i.prop in PROPS);
      if (!defs.length) continue;

      const on = new Set<string>(spec.on);
      const cells: [number, number][] = [];
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          if (on.has(this.at(x, y))) cells.push([x, y]);
        }
      }
      if (!cells.length) continue;

      let placed = 0;
      // Bounded attempts: a crowded level should thin the clusters out, not
      // spin forever looking for room that isn't there.
      for (let attempt = 0; attempt < spec.count * 40 && placed < spec.count; attempt++) {
        const [tx, ty] = this.rand.pick(cells);
        const cx = this.worldX(tx) + this.rand.range(-0.3, 0.3) * L.tileSize;
        const cz = this.worldZ(ty) + this.rand.range(-0.3, 0.3) * L.tileSize;

        const d = Math.hypot(cx - startX, cz - startZ);
        // Nothing furniture-sized may sit on the spawn. The ball starts at
        // 0.4 m and cannot move a cafe table, so a cluster landing here would
        // wedge the player in before they had touched the controls.
        if (d < START_CLEAR + spec.radius) continue;
        if (spec.minFromStart && d < spec.minFromStart) continue;
        if (spec.maxFromStart && d > spec.maxFromStart) continue;
        if (!this.claim(occupied, cx, cz, spec.radius)) continue;

        const yaw = spec.freeRotation
          ? this.rand.angle()
          : this.rand.int(0, 3) * (Math.PI / 2);
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);

        // Rotate offsets with the same Y-rotation three applies to `rotY`,
        // so an item's own facing and its position stay consistent.
        //
        // Only the cluster's *centre* is guaranteed to be on an allowed tile;
        // items sit up to ~3 m out, which is most of a tile. Without a per-item
        // check, cafe chairs end up in the carriageway and bins inside shops.
        //
        // But the check cannot be `canPlaceAt` alone. That rule is about *loose
        // furniture*, and it excludes roads outright — so a cluster that
        // explicitly declares `on: ['#']` had every single item rejected for
        // standing where it asked to stand. `roadworks` was authored to sit on
        // the carriageway and instead survived only where the centre's jitter
        // happened to fling an item onto the pavement: 3 barriers out of a
        // possible 40. A cluster's own `on` list is a statement of intent and
        // has to outrank the generic rule.
        for (const item of defs) {
          const ix = cx + item.x * cos + item.z * sin;
          const iz = cz - item.x * sin + item.z * cos;
          if (!on.has(this.tileAtWorld(ix, iz)) && !this.canPlaceAt(ix, iz)) continue;
          out.push({
            def: prop(item.prop),
            x: ix,
            z: iz,
            rotY: yaw + (item.rot ?? 0),
            scale: item.scale ?? 1,
            lift: item.y,
          });
        }
        placed++;
      }
    }
    return out;
  }

  /**
   * Props stepped along a straight run — street lights down a kerb.
   *
   * Deliberately not routed through `claim`: a line is authored, so it should
   * appear exactly where it was asked for rather than losing lamps to whatever
   * scatter happened to land first. It runs before the scatter and claims its
   * own ground, so the loose props flow around it instead.
   */
  private planLines(occupied: Set<string>): Placement[] {
    const out: Placement[] = [];
    for (const spec of this.level.lines ?? []) {
      if (!(spec.prop in PROPS)) continue;
      const def = prop(spec.prop);

      const x0 = this.worldX(spec.from[0]);
      const z0 = this.worldZ(spec.from[1]);
      const x1 = this.worldX(spec.to[0]);
      const z1 = this.worldZ(spec.to[1]);
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;

      const ux = dx / len;
      const uz = dz / len;
      // Perpendicular, to the right of from->to.
      const px = -uz;
      const pz = ux;
      // Facing along the run, so a lamp's arm reaches over the carriageway.
      const yaw = Math.atan2(ux, uz) + (spec.rot ?? 0);

      const steps = Math.max(1, Math.round(len / spec.spacing));
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * len;
        const side = spec.alternate && i % 2 === 1 ? -1 : 1;
        const off = (spec.offset ?? 0) * side;
        const x = x0 + ux * t + px * off;
        const z = z0 + uz * t + pz * off;
        if (!this.canPlaceAt(x, z)) continue;
        this.claim(occupied, x, z, 1.2);
        out.push({
          def,
          x,
          z,
          // Lamps on the far kerb face back across the road.
          rotY: yaw + (side < 0 ? Math.PI : 0),
          scale: 1,
        });
      }
    }
    return out;
  }

  private planProps(occupied: Set<string>) {
    const L = this.level;
    const out: Placement[] = [];
    const startX = this.worldX(L.start[0]);
    const startZ = this.worldZ(L.start[1]);

    for (const rule of L.scatter) {
      const defs = rule.props.filter((id) => id in PROPS).map(prop);
      if (!defs.length) continue;
      const on = new Set<string>(rule.on);

      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          if (!on.has(this.at(x, y))) continue;

          // Clumping: most tiles get nothing, a few get a pile. Reads as litter
          // that collected somewhere rather than an even sprinkle.
          const clump = rule.clump ?? 0;
          let n = rule.density;
          if (clump > 0) {
            if (!this.rand.chance(1 / (1 + clump))) continue;
            n = rule.density * (1 + clump);
          }
          let count = Math.floor(n);
          if (this.rand.next() < n - count) count++;

          for (let i = 0; i < count; i++) {
            const def = this.rand.pick(defs);
            const jx = this.rand.range(-0.42, 0.42) * L.tileSize;
            const jz = this.rand.range(-0.42, 0.42) * L.tileSize;
            const wx = this.worldX(x) + jx;
            const wz = this.worldZ(y) + jz;

            {
              const d = Math.hypot(wx - startX, wz - startZ);
              // Anything the starting ball cannot eat stays off the spawn.
              if (def.absorbSize > 0.35 && d < START_CLEAR) continue;
              if (rule.minFromStart && d < rule.minFromStart) continue;
              if (rule.maxFromStart && d > rule.maxFromStart) continue;
            }
            // Footprint claim on a fine grid, sized by the prop itself. A single
            // coarse cell would either let cars overlap or stop bolts from
            // packing tightly enough to read as litter — each prop needs to
            // reserve only as much ground as it actually covers.
            if (!this.claim(occupied, wx, wz, def.absorbSize)) continue;

            const [lo, hi] = rule.scale ?? [1, 1];
            out.push({
              def,
              x: wx,
              z: wz,
              rotY: this.rand.angle(),
              scale: this.rand.range(lo, hi),
            });
          }
        }
      }
    }
    return out;
  }

  /**
   * A collectible goal the level physically cannot satisfy would be a bug the
   * player pays for, and random scatter makes exact counts impossible to author
   * by hand. So: count what scatter produced and top up any shortfall (plus a
   * small surplus, so the last one isn't a needle hunt).
   */
  private guaranteeCollectibles(
    placements: Placement[]
  ) {
    const L = this.level;
    for (const c of L.collectibles) {
      if (!(c.prop in PROPS)) continue;
      const def = prop(c.prop);
      const have = placements.reduce((n, p) => n + (p.def.id === c.prop ? 1 : 0), 0);
      const want = Math.ceil(c.target * 1.6);
      if (have >= want) continue;

      // Place the shortfall on any tile this prop's own scatter rules allow, so
      // top-ups land where they look natural.
      const allowed = new Set<TileChar>();
      for (const rule of L.scatter) {
        if (rule.props.includes(c.prop)) for (const t of rule.on) allowed.add(t);
      }
      if (!allowed.size) allowed.add(',');

      const cells: [number, number][] = [];
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          if (allowed.has(this.at(x, y))) cells.push([x, y]);
        }
      }
      if (!cells.length) continue;

      for (let i = have; i < want; i++) {
        const [tx, ty] = this.rand.pick(cells);
        placements.push({
          def,
          x: this.worldX(tx) + this.rand.range(-0.35, 0.35) * L.tileSize,
          z: this.worldZ(ty) + this.rand.range(-0.35, 0.35) * L.tileSize,
          rotY: this.rand.angle(),
          scale: 1,
        });
      }
    }
  }

  // ── buildings ───────────────────────────────────────────────────────────

  private planBuildings() {
    const L = this.level;
    const out: { kit: 'commercial' | 'suburban'; model: string; x: number; z: number; rotY: number; scale: number }[] = [];

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const c = this.at(x, y);
        if (c !== 'B' && c !== 'H') continue;
        const spec = c === 'B' ? L.commercial : L.suburban;
        const model = this.rand.pick(spec.models);
        if (!assets.has(spec.kit as 'commercial' | 'suburban', model)) continue;

        // Face the nearest road so building fronts point at the street.
        const rotY = this.faceRoad(x, y);

        // Fit the model to its plot. The kits' buildings are 7-13 m across but
        // a plot is one 4 m tile, so at native scale they sprawl over their
        // neighbours *and* over the carriageway — which both looks wrong and
        // pushes their collision into the road, where the ball gets wedged.
        // Fitting also shortens them, which is exactly what the camera wants.
        const src = assets.get(spec.kit as 'commercial' | 'suburban', model);
        const footprint = Math.max(src.size.x, src.size.z) || 1;
        const fit = clamp(L.tileSize / footprint, 0.3, 1.15);

        out.push({
          kit: spec.kit as 'commercial' | 'suburban',
          model,
          x: this.worldX(x),
          z: this.worldZ(y),
          rotY,
          scale: (spec.scale ?? 1) * fit * this.rand.range(0.94, 1.06),
        });
      }
    }
    return out;
  }

  /** Yaw that points a building's front (+Z) at the nearest adjacent road. */
  private faceRoad(x: number, y: number): number {
    if (isRoad(this.at(x, y + 1))) return 0;
    if (isRoad(this.at(x + 1, y))) return Math.PI / 2;
    if (isRoad(this.at(x, y - 1))) return Math.PI;
    if (isRoad(this.at(x - 1, y))) return -Math.PI / 2;
    return this.rand.int(0, 3) * (Math.PI / 2);
  }

  /** Partitions planned buildings into absorbable props and static scenery. */
  private splitBuildings(list: ReturnType<CityBuilder['planBuildings']>) {
    const catalogued = new Map<string, PropDef>();
    for (const def of Object.values(PROPS)) {
      if (def.kit === 'commercial' || def.kit === 'suburban') {
        catalogued.set(`${def.kit}/${def.model}`, def);
      }
    }

    const absorbable: Placement[] = [];
    const staticByModel = new Map<string, typeof list>();

    for (const b of list) {
      const def = catalogued.get(`${b.kit}/${b.model}`);
      if (def) {
        absorbable.push({ def, x: b.x, z: b.z, rotY: b.rotY, scale: b.scale });
      } else {
        const key = `${b.kit}/${b.model}`;
        let arr = staticByModel.get(key);
        if (!arr) staticByModel.set(key, (arr = []));
        arr.push(b);
      }
    }
    return { absorbable, static: staticByModel };
  }

  private buildScenery(
    scenery: Map<string, ReturnType<CityBuilder['planBuildings']>>
  ): { group: Group; drawCalls: number } {
    const flat = [...scenery.values()].flat();
    const { group, batches } = chunkedScenery(flat);
    return { group, drawCalls: batches };
  }

  /**
   * Registers static scenery buildings as collision-only entries.
   *
   * These are drawn as merged instances and have no prop-catalog entry, so
   * nothing else puts them in the spatial hash — which meant the ball drove
   * clean through every tower on the map. They are pure blockers: no size of
   * ball ever absorbs them.
   */
  private insertBuildingBlockers(
    scenery: Map<string, ReturnType<CityBuilder['planBuildings']>>,
    hash: SpatialHash<PropInstance>
  ) {
    let n = 0;
    for (const [key, items] of scenery) {
      const [kit, model] = key.split('/');
      if (!assets.has(kit as PropDef['kit'], model)) continue;
      const size = assets.get(kit as PropDef['kit'], model).size;

      for (const b of items) {
        // Collide against the footprint, not the height — a tower's silhouette
        // is irrelevant to a ball rolling past its base. The 1.1 factor cancels
        // the BLOCK_PROP weighting in Sticking so the contact radius comes out
        // at the building's true half-width.
        const footprint = Math.max(size.x, size.z) * b.scale;
        const def = {
          id: `scenery:${model}`,
          kit: kit as PropDef['kit'],
          model,
          tier: 99,
          label: 'Building',
          voice: 'heavy' as const,
          absorbSize: footprint * 1.1,
          mass: 0,
          points: 0,
          size,
        } satisfies PropDef;

        const inst: PropInstance = {
          def,
          x: b.x,
          z: b.z,
          y: size.y * 0.5,
          rotY: b.rotY,
          scale: b.scale,
          absorbed: false,
          blocker: true,
          geometry: assets.get(kit as PropDef['kit'], model).geometry,
          material: assets.get(kit as PropDef['kit'], model).material,
          hide: () => {},
        };
        hash.insert(inst);
        n++;
      }
    }
    return n;
  }
}

const UP = new Vector3(0, 1, 0);

/**
 * Mean vertex colour of a geometry, falling back to sampling nothing when the
 * kit is textured rather than vertex-coloured.
 *
 * Textured kits carry no `color` attribute, so the atlas cannot be averaged
 * cheaply here; a neutral concrete tone stands in, which is what the distant
 * towers read as anyway.
 */
function averageColor(geo: BufferGeometry, out: Color): Color {
  const attr = geo.getAttribute('color');
  if (!attr || attr.count === 0) return out.setRGB(0.62, 0.66, 0.72);
  let r = 0;
  let g = 0;
  let b = 0;
  const step = Math.max(1, Math.floor(attr.count / 64));
  let n = 0;
  for (let i = 0; i < attr.count; i += step) {
    r += attr.getX(i);
    g += attr.getY(i);
    b += attr.getZ(i);
    n++;
  }
  return out.setRGB(r / n, g / n, b / n);
}
