/**
 * Rail City Rush — a lively 40x40 city district encircled by working trains.
 *
 * The railway occupies a protected three-tile promenade just inside the wall.
 * Two smooth parallel loops keep the commuter, freight and tram traffic apart,
 * while four road axes cross the tracks and feed a familiar downtown grid.
 * The centre stays open and starter-dense; progressively heavier districts sit
 * further out, so the visual spectacle never comes at the cost of a fair run.
 */

import type { LevelDef, TileChar } from './types';

const SIZE = 40;
const ROADS = [6, 15, 24, 33] as const;

interface District {
  ground: TileChar;
  buildings?: 'B' | 'H';
}

const DISTRICTS: District[][] = [
  [
    { ground: '.', buildings: 'H' },
    { ground: 'M', buildings: 'B' },
    { ground: 'C', buildings: 'B' },
  ],
  [
    { ground: 'C', buildings: 'B' },
    { ground: 'P' },
    { ground: '.', buildings: 'H' },
  ],
  [
    { ground: '.', buildings: 'H' },
    { ground: 'C', buildings: 'B' },
    { ground: '.', buildings: 'H' },
  ],
];

/** Build the legible city grid without hand-maintaining forty 40-char rows. */
function makeMap(): string[] {
  const map: TileChar[][] = Array.from({ length: SIZE }, () =>
    Array<TileChar>(SIZE).fill(',')
  );

  // Protected twin-track belt. Roads are painted afterwards and therefore cut
  // clean level crossings through it rather than stopping at the railway.
  for (let i = 0; i < SIZE; i++) {
    for (const rail of [2, 3, 4, SIZE - 5, SIZE - 4, SIZE - 3]) {
      map[rail][i] = 'R';
      map[i][rail] = 'R';
    }
  }

  // Nine distinct blocks. Buildings occupy the west and south street edges,
  // leaving their north-east interiors visible from the gameplay camera.
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

      if (district.buildings) {
        for (let y = y0; y <= y1; y += 2) map[y][x0] = district.buildings;
        for (let x = x0; x <= x1; x += 2) map[y1][x] = district.buildings;
      }
    }
  }

  // Authored tree-grove anchors keep the parks varied rather than uniformly
  // sprinkled. Ordinary park scatter and bench arrangements fill around them.
  for (const [x, y] of [
    [10, 9], [13, 11], [27, 18], [30, 20], [10, 27],
    [12, 30], [27, 27], [30, 29], [28, 31],
  ] as [number, number][]) {
    if (map[y][x] === '.') map[y][x] = 'T';
  }

  // The city tram circles the civic plaza, visible from the very first frame.
  // Reserving its one-tile belt prevents starter props and pedestrians from
  // spawning on the rails while leaving a generous 6x6 feeding plaza inside.
  for (let i = 16; i <= 23; i++) {
    map[16][i] = 'R';
    map[23][i] = 'R';
    map[i][16] = 'R';
    map[i][23] = 'R';
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
  time: 210,
  tileSize: 4,
  map: makeMap(),
  start: [19, 19],

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
    { props: ['road-cone', 'cone', 'barrier-small'], on: ['#'], density: 0.075, clump: 2.8 },
    { props: ['tree-small', 'planter'], on: ['.'], density: 0.38, clump: 0.7, scale: [0.88, 1.14] },
    { props: ['tree-large'], on: ['T'], density: 1.45, scale: [0.9, 1.18] },
    { props: ['street-light'], on: [','], density: 0.022, minFromStart: 25 },
    {
      props: ['sedan', 'taxi', 'suv', 'hatchback', 'van', 'police'],
      on: [','],
      density: 0.085,
      minFromStart: 20,
    },
    { props: ['kart'], on: [','], density: 0.032, minFromStart: 24 },
    { props: ['ambulance', 'firetruck', 'garbage-truck'], on: [','], density: 0.025, minFromStart: 34 },
  ],

  lines: [
    // A well-lit civic core, plus station approaches that visually lead to the
    // railway without turning every pavement into a row of lamp posts.
    { prop: 'street-light', from: [16, 15], to: [23, 15], spacing: 10, offset: 2.7 },
    { prop: 'street-light', from: [16, 24], to: [23, 24], spacing: 10, offset: -2.7 },
    { prop: 'street-light', from: [15, 16], to: [15, 23], spacing: 10, offset: -2.7 },
    { prop: 'street-light', from: [24, 16], to: [24, 23], spacing: 10, offset: 2.7 },
    { prop: 'street-light', from: [7, 6], to: [14, 6], spacing: 9, offset: 2.7, alternate: true },
    { prop: 'street-light', from: [25, 33], to: [32, 33], spacing: 9, offset: -2.7, alternate: true },
  ],

  clusters: [
    {
      id: 'starter-sparkles',
      on: ['P'],
      count: 18,
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
      count: 15,
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
      count: 11,
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
      count: 28,
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
      count: 15,
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
      count: 22,
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
    {
      id: 'park-social',
      on: ['.'],
      count: 25,
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
      count: 15,
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
      count: 32,
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
    {
      id: 'road-crew',
      on: ['#'],
      count: 18,
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
      at: [27, 39],
      rot: Math.PI,
      items: [
        { prop: 'bench-cushion', x: -1.5, z: 0 },
        { prop: 'bench-cushion', x: 1.5, z: 0 },
        { prop: 'trashcan', x: 0, z: 0.8 },
        { prop: 'potted-plant', x: 2.8, z: 0.7 },
      ],
    },
    {
      id: 'freight-yard',
      on: [','],
      count: 1,
      radius: 3.4,
      at: [35, 11],
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
    { points: [[6, 6], [24, 6], [24, 15], [6, 15]], cars: 4, speed: 7.2, loop: true },
    { points: [[15, 15], [33, 15], [33, 24], [15, 24]], cars: 4, speed: 6.9, loop: true },
    { points: [[6, 24], [24, 24], [24, 33], [6, 33]], cars: 4, speed: 7.4, loop: true },
    { points: [[24, 6], [33, 6], [33, 15], [24, 15]], cars: 3, speed: 7.0, loop: true },
    { points: [[6, 15], [15, 15], [15, 24], [6, 24]], cars: 3, speed: 7.1, loop: true },
    { points: [[6, 6], [6, 33], [33, 33], [33, 6]], cars: 7, speed: 7.8, loop: true },
  ],

  rails: [
    {
      points: [[6, 2.65], [33, 2.65], [36.35, 6], [36.35, 33], [33, 36.35], [6, 36.35], [2.65, 33], [2.65, 6]],
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
        { at: [27, 37.12], length: 17 },
      ],
    },
    {
      points: [[7, 4.25], [32, 4.25], [34.75, 7], [34.75, 32], [32, 34.75], [7, 34.75], [4.25, 32], [4.25, 7]],
      trackModel: 'track-detailed',
      trackSpacing: 1.5,
      consists: [
      ],
      stations: [
        { at: [3.52, 27], rot: Math.PI / 2, length: 14 },
        { at: [35.48, 13], rot: Math.PI / 2, length: 14 },
      ],
    },
    {
      points: [[18, 16.1], [21, 16.1], [22.9, 18], [22.9, 21], [21, 22.9], [18, 22.9], [16.1, 21], [16.1, 18]],
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
  pedestrians: 78,

  collectibles: [
    { prop: 'taxi', target: 12, label: 'City Taxis' },
    { prop: 'train-city-car', target: 2, label: 'Metro Cars', guarantee: false },
  ],

  stars: [7000, 19000, 42000],

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
