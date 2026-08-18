/**
 * Level data format.
 *
 * A level is an ASCII tile map plus scatter rules. Roads are *autotiled*: the
 * builder derives model and rotation from each cell's four neighbours, so an
 * author draws `#` and gets correct bends, T-junctions and crossroads for free.
 * Hand-rotating 400 road tiles would make new levels a chore, and the whole
 * point of this format is that level two is authoring, not engineering.
 */

import type { KitId } from '../data/props';

/**
 * Tile legend:
 *   `#` road          `X` road + pedestrian crossing
 *   `,` pavement      `.` grass / park
 *   `B` commercial building plot   `H` suburban house plot
 *   `T` park tree cluster          ` ` empty (treated as pavement)
 *   `P` plaza — paved open space; the spawn
 *   `M` market square — paved, where stalls and shop fittings go
 *   `C` cafe terrace — paved, directly in front of a commercial frontage;
 *       the only place outdoor seating is placed
 */
export type TileChar = '#' | 'X' | ',' | '.' | 'B' | 'H' | 'T' | 'P' | 'M' | 'C' | ' ';

/** One prop within a cluster, positioned relative to the cluster's centre. */
export interface ClusterItem {
  prop: string;
  /** Offset in metres, before the cluster's own rotation. */
  x: number;
  z: number;
  /** Yaw in radians, added to the cluster's rotation. */
  rot?: number;
  /** Fixed visual scale, or a random range for organic variation. */
  scale?: number | [number, number];
  /** Chance this accent appears in an individual arrangement. */
  chance?: number;
  /** Random offset in metres around the authored position. */
  jitter?: number;
  /** Give this item its own random yaw instead of following the arrangement. */
  randomRotation?: boolean;
  /**
   * Height off the ground in metres, for stacking. A heap of junk reads as a
   * heap only if some of it sits *on* the rest; laid out flat it is just litter
   * in a circle. Absorb tests are 2-D, so a raised prop is still reachable.
   */
  y?: number;
}

/**
 * A hand-arranged group of props — a cafe table with its chairs, a row of shop
 * shelves, a dumped sofa and TV.
 *
 * Scatter rules alone produce an even sprinkle of unrelated objects, which reads
 * as debris no matter how dense it is. Arrangements read as *places*: somewhere
 * people sat, somewhere a shop spilled onto the pavement. The whole cluster
 * rotates as a unit so it never looks stamped.
 */
export interface ClusterSpec {
  id: string;
  /** Tile types the cluster centre may land on. */
  on: TileChar[];
  /** How many to place across the level, or an inclusive random range. */
  count: number | [number, number];
  /** Ground this cluster claims, in metres — keeps arrangements from merging. */
  radius: number;
  items: ClusterItem[];
  /** Exact map tile for a one-off authored landmark rather than random placement. */
  at?: [number, number];
  /** Fixed yaw for an authored landmark. */
  rot?: number;
  minFromStart?: number;
  maxFromStart?: number;
  /** Free yaw rather than quarter turns. Good for junk, bad for seating rows. */
  freeRotation?: boolean;
  /** Only for arrangements made entirely from tier-0, starter-sized props. */
  allowNearStart?: boolean;
}

/**
 * Props placed at regular intervals along a straight run, in tile coordinates.
 *
 * Scatter rules cannot do this: they sprinkle by tile type, so street lights
 * asked for on pavement ended up dotted around the map's outer promenade — the
 * only place that tile occurs — rather than lining any street. Lighting a few
 * chosen blocks properly needs the run stated outright.
 */
export interface LineSpec {
  prop: string;
  /** Tile coordinates of the run's ends, inclusive. */
  from: [number, number];
  to: [number, number];
  /** Metres between props along the run. */
  spacing: number;
  /**
   * Metres perpendicular to the run, positive to the right of from->to. Used to
   * stand lights on the kerb instead of in the carriageway.
   */
  offset?: number;
  /** Yaw in radians added to the run's own facing. */
  rot?: number;
  /** Alternate the offset side each step, for lights down both kerbs. */
  alternate?: boolean;
}

export interface ScatterRule {
  /** Prop ids from the catalog, picked at random with equal weight. */
  props: string[];
  /** Tile types this rule may place on. */
  on: TileChar[];
  /** Expected props per tile. Values above 1 place multiple. */
  density: number;
  /** Random scale multiplier range. */
  scale?: [number, number];
  /** Keep this far from the level's start point, so tier 0 isn't overwhelming. */
  minFromStart?: number;
  /** Only place within this radius of the start — for packing the opening. */
  maxFromStart?: number;
  /** Cluster instead of spreading evenly — reads as litter, not wallpaper. */
  clump?: number;
}

export interface LaneSpec {
  /** Waypoints in tile coordinates; the builder converts to world space. */
  points: [number, number][];
  /** Cars on this lane. */
  cars: number;
  /** Metres per second. */
  speed: number;
  /** Loop back to the first point. */
  loop?: boolean;
}

export interface CollectibleSpec {
  /** Prop id that counts toward this set. */
  prop: string;
  /** How many exist in the level and must be gathered for a complete set. */
  target: number;
  label: string;
}

export interface BuildingSpec {
  kit: KitId;
  models: string[];
  /** Uniform scale applied to every building from this set. */
  scale?: number;
  /** Latest zero-based growth tier at which every configured model must fall. */
  demolitionTier?: number;
}

/** A small, physics-like decorative stack that tumbles apart when the ball hits it. */
export interface BlockStackSpec {
  /** Tile coordinate of the stack's base. */
  at: [number, number];
  /** Block-pack model ids, cycled through the stack. */
  models: string[];
  scale?: number;
  /** A square pyramid with this many layers; omitted uses the small 3-2-1 tower. */
  layers?: number;
}

/** A cheerful animated pet that decorates the level without blocking play. */
export interface PetSpec {
  at: [number, number];
  model: string;
  scale?: number;
}

/** A persistent ground-level wind that pushes loose props across the map. */
export interface WindSpec {
  /** X/Z direction; normalised by the runtime. */
  direction: [number, number];
  /** Multiplier for drift speed. One is a clearly visible steady breeze. */
  strength?: number;
}

export interface LevelDef {
  id: string;
  name: string;
  subtitle: string;
  /** Seconds. */
  time: number;
  /** End as soon as every non-building prop is absorbed, rather than at time-up. */
  clearToComplete?: boolean;
  /** Tile size in world units. Kenney road tiles are authored at 1×1. */
  tileSize: number;
  /** Rows of the map, top row is -Z. All rows must be the same length. */
  map: string[];
  /** Tile coordinate the ball starts on. */
  start: [number, number];
  scatter: ScatterRule[];
  /** Hand-arranged prop groups — see ClusterSpec. */
  clusters: ClusterSpec[];
  /** Props placed along straight runs — see LineSpec. */
  lines?: LineSpec[];
  lanes: LaneSpec[];
  /** Pedestrians wander tiles matching these chars. */
  pedestrianOn: TileChar[];
  pedestrians: number;
  /** Exactly two, matching the two HUD cards. */
  collectibles: [CollectibleSpec, CollectibleSpec];
  /** Score needed for 1, 2 and 3 stars. */
  stars: [number, number, number];
  commercial: BuildingSpec;
  suburban: BuildingSpec;
  /** Optional cute, breakable stacks made from the isometric block pack. */
  blockStacks?: BlockStackSpec[];
  pets?: PetSpec[];
  /** Optional gusting wind applied to food, furniture and market props. */
  wind?: WindSpec;
  /** Replaces ordinary pavement/grass with a cheerful gingham ground treatment. */
  picnicGround?: boolean;
  /** Boundary wall + the skyline placed beyond it. */
  surround: SurroundSpec;
}

/**
 * The edge of the world.
 *
 * The map is a district, not an island, so its border needs to read as "the
 * city continues" rather than "the ground stops". A wall gives the player a
 * hard, legible limit they can roll right up to, and a ring of the tallest
 * towers behind it hides the horizon.
 */
export interface SurroundSpec {
  /** Wall height and thickness in metres. */
  wallHeight: number;
  wallThickness: number;
  /** Models used for the skyline beyond the wall. */
  skyline: { kit: KitId; models: string[] };
  /** How many rings of towers, and how far out they start. */
  skylineRings: number;
  skylineGap: number;
}
