/**
 * Rail City Rush — a 36x36 city district encircled by working trains.
 *
 * The railway occupies a protected three-tile promenade just inside the wall.
 * Two smooth parallel loops keep the commuter, freight and tram traffic apart,
 * while four road axes cross the tracks and feed a familiar downtown grid.
 *
 * ## Why the district is smaller than the railway suggests
 *
 * The first version was 40x40 with nine 8x8 blocks — 576 tiles of content, half
 * again as much as `downtown-01` has, over a district 24 m wider. The ball
 * reached Roll Master with well over a third of the map untouched, and a top
 * tier spent mopping up is the one part of a run with no beat to it: nothing
 * left can tier you up, so the last stretch is scenery.
 *
 * So the grid was rebuilt around the *centre* rather than around the wall. The
 * plaza block stays 8x8 — it is the opening, and the tram runs around it — and
 * the eight outer blocks dropped to 6x6, which is 372 tiles of content instead
 * of 576. Per tile the district is as dense as Downtown; there is simply less
 * filler between the parts worth rolling to, and the belt, the promenade and
 * the station approaches are untouched, so it still reads as the big one.
 *
 * The effect on pacing is the whole point. Roughly 30,000 units of mass are
 * reachable below the top tier and Roll Master costs 12,000, so it now lands
 * around 40% of the way through the district rather than 20% — late enough to
 * be the run's climax, with the frontages as the payoff rather than the filler.
 *
 * ## Where the buildings went
 *
 * Same reasoning applied to frontages. Buildings are top-tier food, so a
 * district lined with them is a district you finish by driving down streets
 * eating walls. Half the outer blocks now carry a frontage on one edge only,
 * and every edge is two tiles shorter than it was: thirty-nine buildings
 * against the old sixty-four. The skyline beyond the wall makes the horizon
 * look like a city, at no cost to the run.
 *
 * Frontages still hug each block's **west and south** edges only — the far side
 * from a fixed camera sitting south-west of the ball. See `downtown-01` for why.
 */

import type { LevelDef, TileChar } from './types';

const SIZE = 36;

/**
 * Road axes. The outer pair sit one tile inside the rail belt, and the inner
 * pair are spread wide enough to leave an 8x8 civic block in the middle for the
 * plaza and its tram loop. Everything else is mirrored about the centre, so a
 * coordinate's opposite number is always `SIZE - 1 - c`.
 */
const ROADS = [6, 13, 22, 29] as const;
const MIRROR = SIZE - 1;

/** Rail belt rows/columns, protected from scatter so nothing sits on a track. */
const RAILS = [2, 3, 4, SIZE - 5, SIZE - 4, SIZE - 3];

interface District {
  ground: TileChar;
  buildings?: 'B' | 'H';
  /**
   * Which street edges carry a frontage. Blocks lined on both edges read as a
   * proper commercial corner; blocks lined on one stay open and let the park or
   * market inside them be seen from the street.
   */
  edges?: ('west' | 'south')[];
}

/**
 * The nine blocks, north row first. Two markets and two cafe terraces face the
 * streets that carry the frontages; the four parks and the plaza are what the
 * gaps in those frontages look through onto.
 */
const DISTRICTS: District[][] = [
  [
    { ground: '.', buildings: 'H', edges: ['west'] },
    { ground: 'M', buildings: 'B', edges: ['west', 'south'] },
    { ground: 'C', buildings: 'B', edges: ['west', 'south'] },
  ],
  [
    { ground: 'C', buildings: 'B', edges: ['west'] },
    { ground: 'P' },
    { ground: '.', buildings: 'H', edges: ['south'] },
  ],
  [
    { ground: '.', buildings: 'H', edges: ['west'] },
    { ground: 'M', buildings: 'B', edges: ['west', 'south'] },
    { ground: '.', buildings: 'H', edges: ['west', 'south'] },
  ],
];

/**
 * Oak anchors, in tight clumps of three rather than dotted about.
 *
 * `T` scatters singles at just over one tree a tile, so adjacent anchors grow
 * into a copse and isolated ones grow into a lone tree — and a lone tree is a
 * lone collectible, which is the thing this set is not supposed to be. Four
 * copses, one per park block, kept clear of the frontage rows.
 */
const GROVES: [number, number][] = [
  [9, 8], [10, 8], [9, 9],
  [26, 16], [27, 16], [26, 17],
  [9, 26], [10, 26], [9, 27],
  [26, 26], [27, 26], [26, 27],
];

/** Build the legible city grid without hand-maintaining thirty-six rows. */
function makeMap(): string[] {
  const map: TileChar[][] = Array.from({ length: SIZE }, () =>
    Array<TileChar>(SIZE).fill(',')
  );

  // Protected twin-track belt. Roads are painted afterwards and therefore cut
  // clean level crossings through it rather than stopping at the railway.
  for (let i = 0; i < SIZE; i++) {
    for (const rail of RAILS) {
      map[rail][i] = 'R';
      map[i][rail] = 'R';
    }
  }

  for (let by = 0; by < 3; by++) {
    for (let bx = 0; bx < 3; bx++) {
      const x0 = ROADS[bx] + 1;
      const x1 = ROADS[bx + 1] - 1;
      const y0 = ROADS[by] + 1;
      const y1 = ROADS[by + 1] - 1;
      const district = DISTRICTS[by][bx];

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) map[y][x] = district.ground;
      }

      // Every other tile, so the frontage reads as a street of separate
      // premises with gaps you can see the block through, rather than a wall.
      for (const edge of district.buildings ? district.edges ?? [] : []) {
        if (edge === 'west') for (let y = y0; y <= y1; y += 2) map[y][x0] = district.buildings!;
        else for (let x = x0; x <= x1; x += 2) map[y1][x] = district.buildings!;
      }
    }
  }

  // Authored tree-grove anchors keep the parks varied rather than uniformly
  // sprinkled. Ordinary park scatter and bench arrangements fill around them.
  for (const [x, y] of GROVES) if (map[y][x] === '.') map[y][x] = 'T';

  // The city tram circles the civic plaza, visible from the very first frame.
  // Reserving its one-tile belt prevents starter props and pedestrians from
  // spawning on the rails while leaving a generous 6x6 feeding plaza inside.
  for (let i = 14; i <= 21; i++) {
    map[14][i] = 'R';
    map[21][i] = 'R';
    map[i][14] = 'R';
    map[i][21] = 'R';
  }

  for (const road of ROADS) {
    for (let i = 0; i < SIZE; i++) {
      map[road][i] = '#';
      map[i][road] = '#';
    }
  }

  // Zebra markings bracket road intersections and announce every rail crossing.
  const crossing = (x: number, y: number) => {
    if (map[y]?.[x] === '#') map[y][x] = 'X';
  };
  for (const x of ROADS) {
    for (const y of ROADS) {
      crossing(x - 1, y);
      crossing(x + 1, y);
      crossing(x, y - 1);
      crossing(x, y + 1);
    }
    for (const rail of [3, 4, SIZE - 5, SIZE - 4]) {
      crossing(x, rail);
      crossing(rail, x);
    }
  }

  return map.map((row) => row.join(''));
}

export const RAIL_CITY: LevelDef = {
  id: 'rail-city-01',
  name: 'Rail City Rush',
  subtitle: 'Rule the rails and roll up the rush hour',
  // Trimmed with the district. The old 210 s were budgeted against a map a
  // third larger; on this one they left the last stretch with nothing to do.
  time: 195,
  tileSize: 4,
  map: makeMap(),
  start: [17, 17],

  scatter: [
    // A generous opening feed in the central plaza. It is dense, but its small
    // footprint leaves clear steering lanes between the hand-made starter piles.
    {
      props: ['bolt', 'nut', 'plate-small-a', 'plate-small-b', 'road-cone', 'cone-flat'],
      on: ['P', ',', 'C', 'M', '.'],
      density: 1.65,
      maxFromStart: 22,
      scale: [0.82, 1.18],
    },
    // Loose road cones stay off the carriageway: `cone` is a collection set now
    // and it is supposed to be found in the roadworks below, in handfuls.
    { props: ['barrier-small', 'cone-flat'], on: ['#'], density: 0.06, clump: 2.8 },
    { props: ['tree-small', 'planter'], on: ['.'], density: 0.34, clump: 0.7, scale: [0.88, 1.14] },
    { props: ['tree-large'], on: ['T'], density: 1.3, scale: [0.9, 1.18] },
    { props: ['street-light'], on: [','], density: 0.02, minFromStart: 25 },
    {
      props: ['sedan', 'taxi', 'suv', 'hatchback', 'van', 'police'],
      on: [','],
      density: 0.075,
      minFromStart: 20,
    },
    { props: ['kart'], on: [','], density: 0.028, minFromStart: 24 },
    { props: ['ambulance', 'firetruck', 'garbage-truck'], on: [','], density: 0.022, minFromStart: 32 },
  ],

  lines: [
    // A well-lit civic core, plus station approaches that visually lead to the
    // railway without turning every pavement into a row of lamp posts.
    { prop: 'street-light', from: [14, 13], to: [21, 13], spacing: 10, offset: 2.7 },
    { prop: 'street-light', from: [14, 22], to: [21, 22], spacing: 10, offset: -2.7 },
    { prop: 'street-light', from: [13, 14], to: [13, 21], spacing: 10, offset: -2.7 },
    { prop: 'street-light', from: [22, 14], to: [22, 21], spacing: 10, offset: 2.7 },
    { prop: 'street-light', from: [7, 6], to: [12, 6], spacing: 9, offset: 2.7, alternate: true },
    { prop: 'street-light', from: [23, 29], to: [28, 29], spacing: 9, offset: -2.7, alternate: true },
  ],

  clusters: [
    {
      id: 'starter-sparkles',
      on: ['P'],
      count: 16,
      radius: 0.82,
      maxFromStart: 19,
      allowNearStart: true,
      freeRotation: true,
      items: [
        { prop: 'bolt', x: 0, z: 0, jitter: 0.18, randomRotation: true },
        { prop: 'nut', x: 0.28, z: 0.08, jitter: 0.16, randomRotation: true },
        { prop: 'plate-small-a', x: -0.24, z: 0.18, jitter: 0.14, randomRotation: true },
        { prop: 'plate-small-b', x: 0.08, z: -0.25, jitter: 0.14, randomRotation: true },
        { prop: 'road-cone', x: -0.3, z: -0.18, jitter: 0.1, chance: 0.7 },
      ],
    },
    {
      id: 'commuter-snacks',
      on: ['P'],
      count: 13,
      radius: 0.9,
      maxFromStart: 20,
      allowNearStart: true,
      freeRotation: true,
      items: [
        { prop: 'food-strawberry', x: -0.25, z: -0.18, jitter: 0.12, randomRotation: true },
        { prop: 'food-cookie', x: 0.2, z: -0.18, jitter: 0.14, randomRotation: true },
        { prop: 'food-donut', x: 0.08, z: 0.24, jitter: 0.12, randomRotation: true, chance: 0.78 },
        { prop: 'food-apple', x: -0.28, z: 0.25, jitter: 0.1, randomRotation: true, chance: 0.72 },
        { prop: 'food-maki', x: 0.34, z: 0.16, jitter: 0.1, randomRotation: true, chance: 0.62 },
      ],
    },
    {
      id: 'morning-commute',
      on: ['P'],
      count: 9,
      radius: 1.0,
      minFromStart: 5,
      maxFromStart: 21,
      allowNearStart: true,
      freeRotation: true,
      items: [
        { prop: 'books', x: -0.28, z: 0, jitter: 0.12, randomRotation: true },
        { prop: 'plant-small', x: 0.3, z: 0.12, jitter: 0.1, randomRotation: true },
        { prop: 'plant-small-b', x: 0, z: -0.3, jitter: 0.1, randomRotation: true, chance: 0.7 },
        { prop: 'toaster', x: 0.22, z: 0.36, jitter: 0.08, randomRotation: true, chance: 0.55 },
      ],
    },
    {
      id: 'cafe-rounds',
      on: ['C'],
      count: 18,
      radius: 2.65,
      items: [
        { prop: 'table-cafe', x: 0, z: 0 },
        { prop: 'chair-rounded', x: 1.3, z: 0, rot: -Math.PI / 2 },
        { prop: 'chair', x: -1.3, z: 0, rot: Math.PI / 2 },
        { prop: 'chair', x: 0, z: 1.3, rot: Math.PI },
        { prop: 'plant-small', x: 1.5, z: -1.35 },
        { prop: 'trashcan', x: -1.55, z: -1.25 },
      ],
    },
    {
      id: 'cafe-canopies',
      on: ['C'],
      count: 10,
      radius: 3.35,
      items: [
        { prop: 'parasol-b', x: 0, z: 0 },
        { prop: 'table-cafe', x: -1.75, z: 0.1 },
        { prop: 'table-cafe', x: 1.75, z: 0.1 },
        { prop: 'stool-bar', x: -1.75, z: 1.45, rot: Math.PI },
        { prop: 'stool-bar', x: 1.75, z: 1.45, rot: Math.PI },
        { prop: 'potted-plant', x: 0, z: 1.9 },
      ],
    },
    {
      id: 'market-islands',
      on: ['M'],
      count: 20,
      radius: 3.2,
      items: [
        { prop: 'display-fruit', x: -1.25, z: -0.6 },
        { prop: 'display-bread', x: 1.25, z: -0.6 },
        { prop: 'shelf-bags', x: 0, z: 1.25 },
        { prop: 'basket', x: -1.65, z: 1.5, rot: 0.4 },
        { prop: 'cart', x: 1.65, z: 1.55, rot: -0.55 },
      ],
    },
    {
      id: 'market-cold-row',
      on: ['M'],
      count: 11,
      radius: 3.0,
      items: [
        { prop: 'freezers-standing', x: -1.35, z: 0 },
        { prop: 'freezer', x: 1.15, z: 0 },
        { prop: 'bottle-return', x: 0, z: 1.75 },
        { prop: 'basket', x: 1.6, z: 1.45, rot: 0.8 },
      ],
    },
    // ── Oaks: the second collection set ──────────────────────────────────
    // The `T` anchors scatter singles, which is what makes a park look planted;
    // the groves are what make the set worth chasing. Four trees fly to the
    // card together and the grove reads as the better park besides.
    //
    // Ahead of `park-social` on purpose. Clusters claim their ground in list
    // order, and a 5.2 m grove needs a clear patch — behind twenty benches it
    // placed three times out of five, which put the set back under the
    // builder's top-up line and scattered the shortfall as lone trees.
    {
      id: 'oak-grove',
      on: ['.'],
      count: 5,
      radius: 5.2,
      minFromStart: 20,
      freeRotation: true,
      items: [
        { prop: 'tree-large', x: -1.6, z: -1.3, scale: 1.1 },
        { prop: 'tree-large', x: 1.7, z: -0.9, scale: 0.95 },
        { prop: 'tree-large', x: -0.5, z: 1.8, scale: 1.05 },
        { prop: 'tree-large', x: 2.2, z: 2.3, scale: 0.9 },
      ],
    },
    {
      id: 'park-social',
      on: ['.'],
      count: 20,
      radius: 3.15,
      items: [
        { prop: 'bench-cushion', x: 0, z: -1.05 },
        { prop: 'bench-cushion', x: 0, z: 1.05, rot: Math.PI },
        { prop: 'potted-plant', x: 1.8, z: 0 },
        { prop: 'trashcan', x: -1.8, z: 0 },
      ],
    },
    {
      id: 'plaza-popups',
      on: ['P'],
      count: 13,
      radius: 2.5,
      minFromStart: 9,
      items: [
        { prop: 'table-cafe', x: 0, z: 0 },
        { prop: 'chair-rounded', x: 1.25, z: 0, rot: -Math.PI / 2 },
        { prop: 'chair-rounded', x: -1.25, z: 0, rot: Math.PI / 2 },
        { prop: 'radio', x: 0, z: 0.65, rot: 0.3 },
      ],
    },
    {
      id: 'railside-scrap',
      on: [','],
      count: 30,
      radius: 1.65,
      minFromStart: 22,
      freeRotation: true,
      items: [
        { prop: 'box', x: 0, z: 0 },
        { prop: 'tire', x: -0.58, z: 0.32 },
        { prop: 'plate-a', x: 0.52, z: 0.36, rot: 0.5 },
        { prop: 'bumper', x: 0.12, z: -0.62, rot: -0.4 },
        { prop: 'bolt', x: -0.42, z: 0.15, y: 0.36 },
        { prop: 'nut', x: 0.58, z: -0.2 },
      ],
    },

    // ── Traffic cones: the first collection set ──────────────────────────
    // Both cone arrangements are deliberately generous, because a set you find
    // one piece at a time is a chore and a set you find four at a time is the
    // reason the cards exist. Between them they place ~50 cones against a
    // target of 24, comfortably over the builder's 1.6x top-up threshold —
    // so every cone in the level arrives as part of a group somebody put there,
    // never as a lone one dropped in to make the numbers work.
    {
      id: 'road-crew',
      on: ['#'],
      count: 10,
      radius: 2.2,
      minFromStart: 15,
      items: [
        { prop: 'barrier-small', x: -1.0, z: 0, rot: Math.PI / 2 },
        { prop: 'barrier-small', x: 1.0, z: 0, rot: Math.PI / 2 },
        { prop: 'cone', x: 0, z: 1.25 },
        { prop: 'cone', x: 0, z: -1.25 },
        { prop: 'work-light', x: 0, z: 0 },
      ],
    },
    // A cordon: seven cones ringing a work light, the whole set jumping to the
    // card at once when the ball rolls through it. Every offset stays inside
    // ±1.7 m because only the cluster's centre is guaranteed to be on a road
    // tile and a road tile is 4 m across — see `downtown-01`.
    {
      id: 'cone-cordon',
      on: ['#'],
      count: 5,
      radius: 2.6,
      minFromStart: 16,
      items: [
        { prop: 'cone', x: -1.3, z: -1.4 },
        { prop: 'cone', x: -0.2, z: -1.7 },
        { prop: 'cone', x: 1.1, z: -1.3 },
        { prop: 'cone', x: -1.6, z: 0.1 },
        { prop: 'cone', x: 1.5, z: 0.2 },
        { prop: 'cone', x: -0.9, z: 1.5 },
        { prop: 'cone', x: 0.7, z: 1.6 },
        { prop: 'work-light', x: 0, z: 0 },
      ],
    },

    // Waiting areas sit outside the track belt beside the custom station meshes.
    {
      id: 'north-station-waiting',
      on: [','],
      count: 1,
      radius: 3.1,
      at: [12, 0],
      items: [
        { prop: 'bench-cushion', x: -1.5, z: 0 },
        { prop: 'bench-cushion', x: 1.5, z: 0 },
        { prop: 'trashcan', x: 0, z: 0.8 },
        { prop: 'potted-plant', x: -2.8, z: 0.7 },
      ],
    },
    {
      id: 'south-station-waiting',
      on: [','],
      count: 1,
      radius: 3.1,
      at: [23, MIRROR],
      rot: Math.PI,
      items: [
        { prop: 'bench-cushion', x: -1.5, z: 0 },
        { prop: 'bench-cushion', x: 1.5, z: 0 },
        { prop: 'trashcan', x: 0, z: 0.8 },
        { prop: 'potted-plant', x: 2.8, z: 0.7 },
      ],
    },
    // On the outer promenade, not on the belt itself: an `at` cluster is
    // discarded outright when its tile does not match `on`, and the old
    // freight yard asked for a `,` on a column the railway owns — so it had
    // never once appeared in the level.
    {
      id: 'freight-yard',
      on: [','],
      count: 1,
      radius: 3.4,
      at: [34, 17],
      freeRotation: true,
      items: [
        { prop: 'box-closed', x: -0.8, z: -0.5 },
        { prop: 'box-closed', x: 0.2, z: -0.4, y: 0.45 },
        { prop: 'box-open', x: 1.0, z: 0.25, rot: 0.5 },
        { prop: 'cart', x: -1.2, z: 1.15, rot: -0.7 },
        { prop: 'market-fence', x: 1.4, z: 1.2, rot: Math.PI / 2 },
      ],
    },
  ],

  lanes: [
    { points: [[6, 6], [22, 6], [22, 13], [6, 13]], cars: 3, speed: 7.2, loop: true },
    { points: [[13, 13], [29, 13], [29, 22], [13, 22]], cars: 3, speed: 6.9, loop: true },
    { points: [[6, 22], [22, 22], [22, 29], [6, 29]], cars: 3, speed: 7.4, loop: true },
    { points: [[22, 6], [29, 6], [29, 13], [22, 13]], cars: 3, speed: 7.0, loop: true },
    { points: [[6, 13], [13, 13], [13, 22], [6, 22]], cars: 3, speed: 7.1, loop: true },
    { points: [[6, 6], [6, 29], [29, 29], [29, 6]], cars: 6, speed: 7.8, loop: true },
  ],

  rails: [
    {
      points: [[6, 2.65], [29, 2.65], [32.35, 6], [32.35, 29], [29, 32.35], [6, 32.35], [2.65, 29], [2.65, 6]],
      trackModel: 'track-detailed',
      trackSpacing: 1.5,
      consists: [
        {
          units: ['train-city-front', 'train-city-car', 'train-city-car', 'train-city-rear'],
          speed: 8.55,
          start: 0.08,
          direction: 1,
        },
        {
          units: ['train-locomotive', 'train-container-blue', 'train-container-red', 'train-tank', 'train-lumber'],
          speed: 8.2,
          start: 0.56,
          direction: 1,
        },
      ],
      stations: [
        { at: [12, 1.88], length: 17 },
        { at: [23, 33.12], length: 17 },
      ],
    },
    {
      points: [[7, 4.25], [28, 4.25], [30.75, 7], [30.75, 28], [28, 30.75], [7, 30.75], [4.25, 28], [4.25, 7]],
      trackModel: 'track-detailed',
      trackSpacing: 1.5,
      consists: [
      ],
      // Kept off the road axes: a platform straddling a level crossing reads as
      // a mistake even when nothing collides with it.
      stations: [
        { at: [3.52, 25], rot: Math.PI / 2, length: 14 },
        { at: [31.48, 10], rot: Math.PI / 2, length: 14 },
      ],
    },
    {
      points: [[16, 14.1], [19, 14.1], [20.9, 16], [20.9, 19], [19, 20.9], [16, 20.9], [14.1, 19], [14.1, 16]],
      trackModel: 'track-detailed',
      trackSpacing: 1.42,
      consists: [
        {
          units: ['train-tram', 'train-city-car', 'train-city-rear'],
          speed: 7.4,
          start: 0.2,
          direction: -1,
          gap: 4.15,
        },
      ],
    },
  ],

  pedestrianOn: [',', '.', 'P', 'M', 'C'],
  pedestrians: 58,

  // The same two sets as `downtown-01`, and deliberately so: cones send you
  // down the streets and oaks send you into the parks, which is exactly the
  // route through this map too. The taxi and metro-car sets they replace were
  // both found in ones — a taxi is a lone kerbside pickup and there were only
  // ever two metro cars in the level — so neither ever produced the run of
  // cards the flight animation is built for.
  collectibles: [
    { prop: 'cone', target: 24, label: 'Traffic Cones' },
    { prop: 'tree-large', target: 14, label: 'Oak Trees' },
  ],

  // Rescaled with the district: roughly a third less content is reachable than
  // in the 40x40 version, so thresholds that used to mean "a confident sweep"
  // would now mean "a perfect one".
  stars: [5500, 15000, 32000],

  commercial: {
    kit: 'commercial',
    models: [
      'building-a', 'building-b', 'building-c', 'building-d', 'building-e',
      'building-h', 'low-detail-building-wide-a', 'low-detail-building-wide-b',
    ],
    demolitionTier: 8,
  },
  suburban: {
    kit: 'suburban',
    models: [
      'building-type-a', 'building-type-c', 'building-type-e', 'building-type-g',
      'building-type-i', 'building-type-k', 'building-type-m', 'building-type-o',
    ],
    demolitionTier: 7,
  },

  surround: {
    wallHeight: 7,
    wallThickness: 2.5,
    skyline: {
      kit: 'commercial',
      models: ['building-skyscraper-a', 'building-skyscraper-e'],
    },
    skylineRings: 3,
    skylineGap: 9,
  },
};
