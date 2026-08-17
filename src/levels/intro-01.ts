import type { LevelDef } from './types';

/** A deliberately small first district: four blocks, three landmarks, one park. */
const MAP = [
  ',,,,,,,,,,,,,,,',
  ',......#......,',
  ',......#....B.,',
  ',..T...#......,',
  ',......#......,',
  ',......#......,',
  ',......#......,',
  '#######X#######',
  ',......#......,',
  ',......#......,',
  ',..B...#..PCC.,',
  ',......#...C..,',
  ',......#..B.C.,',
  ',......#...C..,',
  ',,,,,,,,,,,,,,,',
];

export const INTRO: LevelDef = {
  id: 'intro-01',
  name: 'Pocket Park',
  subtitle: 'Clear the little block',
  time: 90,
  clearToComplete: true,
  tileSize: 4,
  map: MAP,
  start: [10, 10],
  scatter: [],
  clusters: [
    // The opening food is deliberately arranged as obvious, dense piles. A
    // beginner should roll *through* a satisfying bundle, not hunt dozens of
    // tiny parts over the whole district.
    {
      id: 'intro-tidy-pile', on: ['P', ',', '.', 'C'], count: 10, radius: 1.35, freeRotation: true,
      items: [
        { prop: 'bolt', x: -0.65, z: -0.45 }, { prop: 'nut', x: -0.25, z: -0.52 },
        { prop: 'plate-small-a', x: 0.18, z: -0.48 }, { prop: 'bolt', x: 0.58, z: -0.28 },
        { prop: 'plate-small-b', x: -0.48, z: -0.08 }, { prop: 'nut', x: -0.04, z: -0.1 },
        { prop: 'bolt', x: 0.42, z: 0.04 }, { prop: 'plate-small-a', x: -0.62, z: 0.35 },
        { prop: 'nut', x: -0.2, z: 0.4 }, { prop: 'plate-small-b', x: 0.2, z: 0.38 },
        { prop: 'bolt', x: 0.62, z: 0.42 }, { prop: 'nut', x: 0.02, z: 0.72 },
      ],
    },
    {
      id: 'intro-cafe', on: ['C'], count: 3, radius: 2.25,
      items: [
        { prop: 'table-cafe', x: 0, z: 0 },
        { prop: 'chair', x: 1.1, z: 0, rot: -Math.PI / 2 },
        { prop: 'chair', x: -1.1, z: 0, rot: Math.PI / 2 },
        { prop: 'potted-plant', x: 0, z: 1.25 },
      ],
    },
    // A small park reads as a place as soon as it has a few trees to navigate
    // around. They are regular absorbable props, so they become late-run goals
    // rather than permanent scenery.
    {
      id: 'intro-tree-grove', on: ['.'], count: 4, radius: 2.2,
      items: [
        { prop: 'tree-small', x: 0, z: 0 },
        { prop: 'planter', x: 1.25, z: 0.8 },
      ],
    },
    // Parked rather than moving traffic: the compact tutorial streets remain
    // easy to read, while cars still form a satisfying late-game obstacle.
    {
      id: 'intro-parked-car', on: [','], count: 2, radius: 2.7,
      items: [{ prop: 'sedan', x: 0, z: 0 }],
    },
  ],
  lanes: [],
  pedestrianOn: ['.', ',', 'P', 'C'],
  // Citizens join the same collision/absorption system as every other prop:
  // they block the tiny ball, react to it, and become collectible later.
  pedestrians: 5,
  collectibles: [
    { prop: 'bolt', target: 5, label: 'Bolts' },
    { prop: 'chair', target: 3, label: 'Cafe Chairs' },
  ],
  stars: [500, 1000, 1700],
  // Both models are in the prop catalog, so every `B` plot is a real
  // demolition target once the ball is large enough.
  commercial: { kit: 'commercial', models: ['building-a', 'building-d'] },
  suburban: { kit: 'suburban', models: ['building-type-a'] },
  surround: { wallHeight: 4, wallThickness: 0.7, skyline: { kit: 'commercial', models: ['building-a'] }, skylineRings: 0, skylineGap: 16 },
};
