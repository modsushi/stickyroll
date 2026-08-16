/**
 * Downtown Sweep — the vertical slice level.
 *
 * A 34x34 district at 4 m per tile (136 m), as a 4x4 grid of streets with a
 * promenade inside the boundary wall.
 *
 * ## Why the buildings only line one side of each street
 *
 * The camera sits at a fixed yaw, south-west of the ball and about 57° above
 * it. Anything to the ball's south-west is therefore between the lens and the
 * player. Blocks filled edge to edge put frontages on both sides of every
 * street, so half the time the ball was behind a wall.
 *
 * So buildings hug each block's **south and west** edges only — which is the
 * *north* side of every east-west street and the *east* side of every
 * north-south street, i.e. always the far side from the camera. Each block's
 * north-east interior is left open for that district's content. It reads as a
 * real streetscape, it keeps the ball visible, and it cut the building count
 * from 350 to 90.
 *
 * ## Where things go
 *
 *  - `C` cafe terrace, immediately in front of the commercial frontages:
 *    tables with their chairs pulled in, a planter and a bin. Furniture appears
 *    *here*, arranged, and essentially nowhere else.
 *  - `.` park: benches, saplings, planters, and oak clusters (`T`) as the
 *    high-value late collectible.
 *  - `M` market square: shop fittings spilling out — shelves, produce, coolers.
 *  - `,` pavement: deliberately clean, with occasional piles of ordinary street
 *    junk (bolts, plates, tires, boxes — the car kit, not furniture).
 *  - `#` road: near-empty. Cones and barriers only; roads are travel corridors.
 *  - `P` plaza: the spawn. Open, with a bowl of small litter to feed on.
 */

import type { LevelDef } from './types';

// prettier-ignore
const MAP = [
  ',,,#,,,,,,,,#,,,,,,,,#,,,,,,,,#,,,',
  ',,,#,,,,,,,,#,,,,,,,,#,,,,,,,,#,,,',
  ',,,X,,,,,,,,X,,,,,,,,X,,,,,,,,X,,,',
  '##X#X######X#X######X#X######X#X##',
  ',,,X........XBMMMMMMMXBCCCCCCCX,,,',
  ',,,#..TT....#BMMMMMMM#BCCCCCCC#,,,',
  ',,,#..T.....#BMMMMMMM#BCCCCCCC#,,,',
  ',,,#......T.#BMMMMMMM#BCCCCCCC#,,,',
  ',,,#.....T..#BMMMMMMM#BCCCCCCC#,,,',
  ',,,#......T.#BMMMMMMM#BCCCCCCC#,,,',
  ',,,#........#BMMMMMMM#BCCCCCCC#,,,',
  ',,,X........XBBBBBBBBXBBBBBBBBX,,,',
  '##X#X######X#X######X#X######X#X##',
  ',,,XBCCCCCCCXPPPPPPPPXH.......X,,,',
  ',,,#BCCCCCCC#PPPPPPPP#H.......#,,,',
  ',,,#BCCCCCCC#PPPPPPPP#H.......#,,,',
  ',,,#BCCCCCCC#PPPPPPPP#H.......#,,,',
  ',,,#BCCCCCCC#PPPPPPPP#H.......#,,,',
  ',,,#BCCCCCCC#PPPPPPPP#H.......#,,,',
  ',,,#BCCCCCCC#PPPPPPPP#H.......#,,,',
  ',,,XBCCCCCCCXPPPPPPPPXH.......X,,,',
  '##X#X######X#X######X#X######X#X##',
  ',,,XH.......XBCCCCCCCX........X,,,',
  ',,,#H.......#BCCCCCCC#..T.T...#,,,',
  ',,,#H.......#BCCCCCCC#...T....#,,,',
  ',,,#H.......#BCCCCCCC#.....T..#,,,',
  ',,,#H.......#BCCCCCCC#......T.#,,,',
  ',,,#H.......#BCCCCCCC#..T.....#,,,',
  ',,,#H.......#BCCCCCCC#........#,,,',
  ',,,XHHHHHHHHXBBBBBBBBX........X,,,',
  '##X#X######X#X######X#X######X#X##',
  ',,,X,,,,,,,,X,,,,,,,,X,,,,,,,,X,,,',
  ',,,#,,,,,,,,#,,,,,,,,#,,,,,,,,#,,,',
  ',,,#,,,,,,,,#,,,,,,,,#,,,,,,,,#,,,',
];

export const DOWNTOWN: LevelDef = {
  id: 'downtown-01',
  name: 'Downtown Sweep',
  subtitle: 'Tidy up the whole district',
  time: 180,
  tileSize: 4,
  map: MAP,
  start: [16, 16],

  scatter: [
    // The opening bowl. Small car-kit debris only, packed tight and only near
    // the spawn, so the first twenty seconds are uninterrupted feeding.
    {
      props: ['bolt', 'nut', 'plate-small-a', 'plate-small-b', 'road-cone', 'cone-flat'],
      on: [',', 'P', 'C', 'M', '.'],
      density: 4.0,
      maxFromStart: 22,
      scale: [0.8, 1.25],
    },

    // Roads: cones and barriers only, and sparse. A carriageway strewn with
    // furniture reads as a rubbish tip, and roads are meant to be the clear,
    // fast routes between the places worth cleaning.
    { props: ['road-cone', 'barrier-small', 'cone'], on: ['#'], density: 0.08, clump: 3.2 },
    // Crossings stay completely clear so the zebra markings read.

    // Parks: planting only. The only furniture in a park is the benches, and
    // those are placed as arrangements below.
    { props: ['tree-small', 'planter'], on: ['.'], density: 0.34, clump: 0.8, scale: [0.9, 1.15] },
    { props: ['tree-large'], on: ['T'], density: 1.2, scale: [0.9, 1.2] },

    // Street lights are placed as runs (see `lines`), not scattered: `,` only
    // occurs on the outer promenade, so a scatter rule dotted them around the
    // map's edge and lit nothing.
    { props: ['sign-highway'], on: [','], density: 0.014, minFromStart: 30 },

    // Parked cars along the kerbs — the tier 6 payoff, pre-placed so the city
    // looks inhabited long before you can eat them.
    {
      props: ['sedan', 'taxi', 'suv', 'hatchback', 'van', 'police'],
      on: [','],
      density: 0.09,
      minFromStart: 18,
    },
    { props: ['kart'], on: [','], density: 0.03, minFromStart: 22 },
    { props: ['firetruck', 'ambulance', 'garbage-truck'], on: [','], density: 0.02, minFromStart: 30 },
  ],

  // Lit streets. Deliberately only the four sides of the spawn plaza and the
  // one commercial street below it: lighting every road turns a readable
  // silhouette into a picket fence, and evenly-spaced lamps read as designed
  // only where the eye can take in the whole run.
  lines: [
    // Around the spawn plaza, lamps standing on the plaza kerb.
    { prop: 'street-light', from: [13, 12], to: [20, 12], spacing: 12, offset: 2.8 },
    { prop: 'street-light', from: [13, 21], to: [20, 21], spacing: 12, offset: -2.8 },
    { prop: 'street-light', from: [12, 13], to: [12, 20], spacing: 12, offset: -2.8 },
    { prop: 'street-light', from: [21, 13], to: [21, 20], spacing: 12, offset: 2.8 },
    // One commercial street, lit down both kerbs so it reads as the main drag.
    { prop: 'street-light', from: [4, 12], to: [11, 12], spacing: 10, offset: 2.8, alternate: true },
  ],

  clusters: [
    // ── Cafe terraces, in front of the shops ─────────────────────────────
    // A table with its chairs pulled in around it, a planter and a bin. This is
    // the whole reason the furniture kit is here, and it only appears on
    // terrace tiles — furniture scattered loose across a city reads as a
    // flytipping site, not a cafe.
    {
      id: 'cafe-set',
      on: ['C'],
      count: 30,
      radius: 2.5,
      items: [
        { prop: 'table-cafe', x: 0, z: 0 },
        { prop: 'chair', x: 1.25, z: 0, rot: -Math.PI / 2 },
        { prop: 'chair', x: -1.25, z: 0, rot: Math.PI / 2 },
        { prop: 'chair', x: 0, z: 1.25, rot: Math.PI },
        { prop: 'potted-plant', x: 1.5, z: -1.5 },
        { prop: 'trashcan', x: -1.6, z: -1.4 },
      ],
    },
    {
      id: 'cafe-terrace',
      on: ['C'],
      count: 16,
      radius: 3.4,
      items: [
        { prop: 'parasol', x: 0, z: 0 },
        { prop: 'table-cafe', x: -2.0, z: 0.2 },
        { prop: 'table-cafe', x: 2.0, z: 0.2 },
        { prop: 'chair', x: -2.0, z: 1.5, rot: Math.PI },
        { prop: 'chair', x: -2.0, z: -1.1 },
        { prop: 'chair', x: 2.0, z: 1.5, rot: Math.PI },
        { prop: 'chair', x: 2.0, z: -1.1 },
        { prop: 'potted-plant', x: 0, z: 2.1 },
        { prop: 'trashcan', x: 0, z: -2.0 },
      ],
    },
    {
      id: 'cafe-bar',
      on: ['C'],
      count: 12,
      radius: 3.0,
      items: [
        { prop: 'table', x: 0, z: 0 },
        { prop: 'stool-bar', x: -1.2, z: 1.1 },
        { prop: 'stool-bar', x: 0, z: 1.2 },
        { prop: 'stool-bar', x: 1.2, z: 1.1 },
        { prop: 'potted-plant', x: -2.0, z: -0.6 },
        { prop: 'trashcan', x: 2.0, z: -0.6 },
      ],
    },

    // ── Parks: benches, and only benches ─────────────────────────────────
    {
      id: 'park-bench',
      on: ['.'],
      count: 26,
      radius: 2.6,
      items: [
        { prop: 'bench-cushion', x: 0, z: 0 },
        { prop: 'trashcan', x: 1.7, z: 0.3 },
        { prop: 'potted-plant', x: -1.7, z: 0.2 },
      ],
    },
    {
      id: 'park-bench-pair',
      on: ['.'],
      count: 16,
      radius: 3.0,
      items: [
        { prop: 'bench-cushion', x: 0, z: -1.1 },
        { prop: 'bench-cushion', x: 0, z: 1.1, rot: Math.PI },
        { prop: 'potted-plant', x: 2.0, z: 0 },
        { prop: 'trashcan', x: -2.0, z: 0 },
      ],
    },

    // ── Market squares: shops spilling onto the street ───────────────────
    {
      id: 'market-shelves',
      on: ['M'],
      count: 18,
      radius: 3.2,
      items: [
        { prop: 'shelf-boxes', x: -1.6, z: 0 },
        { prop: 'shelf-bags', x: 0, z: 0 },
        { prop: 'shelf-end', x: 1.6, z: 0 },
        { prop: 'basket', x: 0.4, z: 1.6 },
        { prop: 'cart', x: -1.2, z: 1.8, rot: 0.4 },
      ],
    },
    {
      id: 'market-produce',
      on: ['M'],
      count: 14,
      radius: 2.8,
      items: [
        { prop: 'display-fruit', x: -1.1, z: 0 },
        { prop: 'display-bread', x: 1.1, z: 0 },
        { prop: 'market-fence', x: 0, z: 1.4 },
        { prop: 'basket', x: 1.5, z: 1.5 },
      ],
    },
    {
      id: 'market-cold',
      on: ['M'],
      count: 10,
      radius: 3.0,
      items: [
        { prop: 'freezers-standing', x: -1.2, z: 0 },
        { prop: 'freezer', x: 1.2, z: 0 },
        { prop: 'bottle-return', x: 2.6, z: 0.4 },
        { prop: 'cart', x: 0, z: 1.9, rot: 1.2 },
      ],
    },
    {
      id: 'market-checkout',
      on: ['M'],
      count: 8,
      radius: 2.6,
      items: [
        { prop: 'cash-register', x: 0, z: 0 },
        { prop: 'basket', x: 1.3, z: 0.9 },
        { prop: 'basket', x: 1.6, z: 0.3, rot: 0.7 },
      ],
    },

    // ── Street junk: piles, on otherwise clean pavement ──────────────────
    // Ordinary city debris from the car kit — never furniture. Clustering is
    // the whole point: the same objects sprinkled evenly read as noise, but
    // heaped in a corner they read as a mess somebody should clear up, which is
    // the itch the game exists to scratch.
    {
      id: 'junk-pile',
      on: [','],
      count: 30,
      radius: 1.7,
      minFromStart: 12,
      freeRotation: true,
      // A heap, not a circle of litter. Everything sits within ~0.8 m of the
      // centre and the light pieces rest *on* the box and tire rather than
      // beside them — spread flat at arm's length this read as scattered
      // rubbish, which is exactly what the rest of the map avoids.
      items: [
        { prop: 'box', x: 0, z: 0 },
        { prop: 'tire', x: -0.62, z: 0.34 },
        { prop: 'plate-a', x: 0.55, z: 0.38, rot: 0.4 },
        { prop: 'bumper', x: 0.18, z: -0.66, rot: -0.3 },
        // Stacked on the heap.
        { prop: 'plate-small-a', x: 0.04, z: 0.06, y: 0.42, rot: 0.8 },
        { prop: 'bolt', x: -0.58, z: 0.3, y: 0.3 },
        { prop: 'nut', x: 0.62, z: -0.2 },
        { prop: 'nut', x: -0.72, z: -0.38 },
      ],
    },
    {
      id: 'scrap-pile',
      on: [','],
      count: 22,
      radius: 1.6,
      minFromStart: 14,
      freeRotation: true,
      // Same idea with the heavier car parts: a door leaned across the wheel,
      // the small stuff on top of it.
      items: [
        { prop: 'wheel', x: 0, z: 0 },
        { prop: 'door', x: 0.6, z: 0.24, rot: 0.5 },
        { prop: 'spoiler', x: -0.58, z: 0.34, rot: -0.4 },
        { prop: 'axle', x: 0.12, z: -0.62 },
        { prop: 'plate-b', x: -0.1, z: 0.05, y: 0.34, rot: 1.1 },
        { prop: 'bolt', x: 0.4, z: 0.62, y: 0.26 },
      ],
    },
    // Roadworks belong *on* the carriageway — cones and barriers are the one
    // thing that reads as correct there, and it gives the cone collectible a
    // reason to send the player down the streets.
    {
      id: 'roadworks',
      on: ['#'],
      count: 26,
      radius: 2.2,
      minFromStart: 14,
      items: [
        { prop: 'barrier-small', x: -1.0, z: 0, rot: Math.PI / 2 },
        { prop: 'barrier-small', x: 1.0, z: 0, rot: Math.PI / 2 },
        { prop: 'cone', x: 0, z: 1.1 },
        { prop: 'cone', x: 0, z: -1.1 },
        { prop: 'work-light', x: 1.4, z: 1.2 },
      ],
    },
  ],

  // Closed circuits on the 4x4 street grid (roads at tile rows/cols 3, 12, 21, 30).
  lanes: [
    { points: [[3, 3], [21, 3], [21, 12], [3, 12]], cars: 4, speed: 7.0, loop: true },
    { points: [[12, 12], [30, 12], [30, 21], [12, 21]], cars: 4, speed: 6.6, loop: true },
    { points: [[3, 21], [21, 21], [21, 30], [3, 30]], cars: 4, speed: 7.3, loop: true },
    { points: [[21, 3], [30, 3], [30, 12], [21, 12]], cars: 3, speed: 6.9, loop: true },
    { points: [[3, 12], [12, 12], [12, 21], [3, 21]], cars: 3, speed: 7.1, loop: true },
    // Outer ring.
    { points: [[3, 3], [3, 30], [30, 30], [30, 3]], cars: 6, speed: 7.6, loop: true },
  ],

  // Citizens fill the terraces, markets, parks and pavements — never the road.
  pedestrianOn: [',', '.', 'P', 'M', 'C'],
  pedestrians: 52,

  collectibles: [
    { prop: 'cone', target: 20, label: 'Traffic Cones' },
    { prop: 'tree-large', target: 10, label: 'Oak Trees' },
  ],

  // Derived from the level's score budget, not guessed: ~10,800 base points are
  // reachable before the top tier, and the combo multiplier tops out at 5x. So
  // one star is a first pass, two is a confident sweep, three needs most of the
  // district cleared on a long chain.
  stars: [4500, 12000, 26000],

  // In-map buildings are deliberately the *short* ones. A 17 m tower occludes
  // everything within ~11 m behind it at this camera pitch; an 11 m storefront
  // only ~7 m, and a 6 m house barely at all. The tall towers live on the
  // skyline beyond the wall, where they cannot get between the lens and the ball.
  commercial: {
    kit: 'commercial',
    models: [
      'building-a', 'building-b', 'building-c', 'building-d', 'building-e',
      'building-h', 'low-detail-building-wide-a', 'low-detail-building-wide-b',
    ],
  },
  suburban: {
    kit: 'suburban',
    models: [
      'building-type-a', 'building-type-c', 'building-type-e', 'building-type-g',
      'building-type-i', 'building-type-k', 'building-type-m', 'building-type-o',
    ],
  },

  surround: {
    wallHeight: 7,
    wallThickness: 2.5,
    // The tallest towers in the pack, kept for the horizon where their cost is
    // paid once and their silhouette does the most work.
    skyline: {
      kit: 'commercial',
      models: ['building-skyscraper-a', 'building-skyscraper-e'],
    },
    skylineRings: 3,
    skylineGap: 9,
  },
};
