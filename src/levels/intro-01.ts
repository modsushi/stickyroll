import type { LevelDef } from './types';

/** A deliberately small first district: four blocks, three landmarks, one park. */
const MAP = [
  ',,,,,,,,,,,,,,,',
  ',......#......,',
  ',......#....B.,',
  ',......#......,',
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
  time: 210,
  clearToComplete: true,
  tileSize: 4,
  picnicGround: true,
  map: MAP,
  start: [10, 10],
  scatter: [
    // Dense, evenly available opening food. The authored ring below guarantees
    // the first movement pays off; this halo then lets the player choose any
    // direction without running into a dead patch.
    {
      props: ['food-cookie', 'food-strawberry', 'food-cherries', 'food-maki', 'food-apple', 'food-donut'],
      on: ['P', '.', 'C'], density: 2.4, maxFromStart: 12, scale: [0.84, 1.08],
    },
    // Tiny picnic crumbs throughout the four blocks keep traversal rewarding,
    // but clumping leaves clean negative space around the authored scenes.
    {
      props: ['food-cookie', 'food-strawberry', 'food-cherries', 'food-maki', 'food-apple', 'food-donut'],
      on: ['.', ',', 'C'], density: 0.34, minFromStart: 10, scale: [0.78, 1.16], clump: 1.7,
    },
    // Mid-sized food bridges the first three growth tiers between landmarks.
    {
      props: ['food-croissant', 'food-muffin', 'food-banana', 'food-soda', 'food-fries', 'food-cupcake'],
      on: ['.', ',', 'C'], density: 0.24, minFromStart: 7, maxFromStart: 28, scale: [0.86, 1.12], clump: 1.1,
    },
    // A few parked cars sell the city setting and become the tier-six reward.
    {
      props: ['sedan', 'taxi', 'hatchback', 'van'], on: [','], density: 0.085,
      minFromStart: 18, scale: [0.92, 1.05], clump: 0.35,
    },
  ],
  clusters: [
    // ── Opening route ────────────────────────────────────────────────────
    // These are deliberately exact, tier-zero arrangements. They remove the
    // frustrating possibility of a random seed leaving the new player hungry.
    {
      id: 'starter-snack-ring', on: ['P'], at: [10, 10], count: 1, radius: 1.8,
      allowNearStart: true, rot: 0,
      items: [
        { prop: 'food-cookie', x: -1.15, z: -0.35, rot: 0.2 },
        { prop: 'food-strawberry', x: -0.65, z: -1.25, rot: -0.4 },
        { prop: 'food-maki', x: 0.05, z: -1.45, rot: 0.8 },
        { prop: 'food-cherries', x: 0.85, z: -1.05, rot: -0.2 },
        { prop: 'food-donut', x: 1.35, z: -0.25, rot: 0.4 },
        { prop: 'food-cookie', x: 1.2, z: 0.7, rot: -0.7 },
        { prop: 'food-apple', x: 0.45, z: 1.35, rot: 0.1 },
        { prop: 'food-strawberry', x: -0.45, z: 1.4, rot: 0.6 },
        { prop: 'food-maki', x: -1.25, z: 0.75, rot: -0.1 },
      ],
    },
    {
      id: 'starter-west-trail', on: ['.'], at: [9, 10], count: 1, radius: 1.25,
      allowNearStart: true, rot: 0,
      items: [
        { prop: 'food-cookie', x: 1.1, z: -0.35 }, { prop: 'food-cherries', x: 0.45, z: 0.25 },
        { prop: 'food-strawberry', x: -0.2, z: -0.2 }, { prop: 'food-maki', x: -0.85, z: 0.3 },
        { prop: 'food-donut', x: -1.2, z: -0.35, scale: 0.95 },
      ],
    },
    {
      id: 'starter-north-trail', on: ['.'], at: [10, 9], count: 1, radius: 1.25,
      allowNearStart: true, rot: Math.PI / 2,
      items: [
        { prop: 'food-apple', x: 1.05, z: 0.25 }, { prop: 'food-cookie', x: 0.4, z: -0.25 },
        { prop: 'food-maki', x: -0.15, z: 0.2 }, { prop: 'food-strawberry', x: -0.75, z: -0.3 },
        { prop: 'food-cherries', x: -1.15, z: 0.25 },
      ],
    },

    // ── One-off food stories ─────────────────────────────────────────────
    // Every landmark has a different silhouette, density, pairing and spacing.
    // Optional accents, local jitter and per-item rotation stop even the small
    // repeated ingredients from reading as a copied prefab.
    {
      id: 'berry-pinwheel', on: ['.'], at: [13, 9], count: 1, radius: 2.15, freeRotation: true,
      items: [
        { prop: 'food-strawberry', x: 0, z: 0, randomRotation: true },
        { prop: 'food-cherries', x: -0.65, z: -0.25, jitter: 0.12, randomRotation: true },
        { prop: 'food-apple', x: 0.75, z: -0.45, jitter: 0.16, randomRotation: true },
        { prop: 'food-strawberry', x: 1.15, z: 0.45, jitter: 0.12, scale: [0.85, 1.08], randomRotation: true },
        { prop: 'food-cherries', x: 0.25, z: 1.2, jitter: 0.18, randomRotation: true },
        { prop: 'food-cookie', x: -1.0, z: 0.85, jitter: 0.2, randomRotation: true },
        { prop: 'food-banana', x: -1.45, z: -0.65, rot: 0.4 },
      ],
    },
    {
      id: 'brunch-for-two', on: ['.'], at: [5, 10], count: 1, radius: 2.45, rot: -0.35,
      items: [
        { prop: 'food-croissant', x: -0.85, z: -0.35, rot: -0.4 },
        { prop: 'food-muffin', x: 0.55, z: -0.7, randomRotation: true },
        { prop: 'food-cupcake', x: 1.35, z: 0.15, scale: 0.92 },
        { prop: 'food-donut', x: 0.45, z: 0.8, randomRotation: true },
        { prop: 'food-strawberry', x: -0.45, z: 0.9, jitter: 0.1 },
        { prop: 'food-cookie', x: -1.45, z: 0.55, jitter: 0.16 },
      ],
    },
    {
      id: 'sushi-comet', on: ['.'], at: [2, 9], count: 1, radius: 2.35, rot: 0.6,
      items: [
        { prop: 'food-maki', x: -1.55, z: -0.65, rot: 0.2 },
        { prop: 'food-maki', x: -0.85, z: -0.25, rot: -0.35 },
        { prop: 'food-maki', x: -0.15, z: 0.05, rot: 0.55 },
        { prop: 'food-maki', x: 0.55, z: 0.25, rot: -0.1 },
        { prop: 'food-maki', x: 1.25, z: 0.7, rot: 0.8 },
        { prop: 'food-cherries', x: 0.9, z: -0.7, chance: 0.8, randomRotation: true },
        { prop: 'food-soda', x: 1.65, z: -0.35, rot: 0.15 },
      ],
    },
    {
      id: 'street-food-zigzag', on: ['.'], at: [2, 3], count: 1, radius: 2.75, rot: -0.25,
      items: [
        { prop: 'food-taco', x: -1.65, z: -0.85, rot: -0.3 },
        { prop: 'food-fries', x: -0.75, z: -0.2, rot: 0.2 },
        { prop: 'food-hotdog', x: 0.25, z: -0.65, rot: 0.8 },
        { prop: 'food-soda', x: 1.25, z: 0.1, rot: -0.15 },
        { prop: 'food-taco', x: 1.65, z: 1.0, rot: 0.35 },
        { prop: 'food-cookie', x: 0.4, z: 1.2, chance: 0.7, jitter: 0.2 },
        { prop: 'food-fries', x: -1.1, z: 1.05, chance: 0.75, rot: -0.6 },
      ],
    },
    {
      id: 'orchard-crescent', on: ['.'], at: [5, 2], count: 1, radius: 2.9, freeRotation: true,
      items: [
        { prop: 'food-apple', x: -1.75, z: 0.15, jitter: 0.15, randomRotation: true },
        { prop: 'food-banana', x: -1.05, z: -0.8, rot: -0.5 },
        { prop: 'food-cherries', x: -0.15, z: -1.15, jitter: 0.16 },
        { prop: 'food-watermelon', x: 0.95, z: -0.65, rot: 0.3 },
        { prop: 'food-pineapple', x: 1.55, z: 0.65, rot: -0.2 },
        { prop: 'food-strawberry', x: 0.45, z: 1.35, jitter: 0.18, scale: [0.8, 1.12] },
        { prop: 'food-apple', x: -0.75, z: 1.15, chance: 0.85, jitter: 0.2 },
      ],
    },
    {
      id: 'dessert-sunburst', on: ['.'], at: [9, 2], count: 1, radius: 3.15, rot: 0.15,
      items: [
        { prop: 'food-cake', x: 0, z: 0, rot: 0.1 },
        { prop: 'food-cupcake', x: -1.45, z: -0.75, scale: [0.88, 1.08], randomRotation: true },
        { prop: 'food-donut', x: -1.65, z: 0.75, randomRotation: true },
        { prop: 'food-muffin', x: -0.55, z: 1.55, randomRotation: true },
        { prop: 'food-cookie', x: 0.8, z: 1.45, jitter: 0.15, randomRotation: true },
        { prop: 'food-cupcake', x: 1.65, z: 0.45, scale: [0.9, 1.12] },
        { prop: 'food-strawberry', x: 1.4, z: -1.0, jitter: 0.18 },
        { prop: 'food-croissant', x: 0.3, z: -1.65, rot: -0.6 },
      ],
    },
    {
      id: 'cookout-diagonal', on: ['.'], at: [13, 5], count: 1, radius: 3.4, rot: -0.7,
      items: [
        { prop: 'food-burger', x: -1.8, z: -0.75, rot: 0.2 },
        { prop: 'food-hotdog', x: -0.55, z: -0.2, rot: -0.65 },
        { prop: 'food-fries', x: 0.55, z: -0.85, rot: 0.15 },
        { prop: 'food-turkey', x: 1.55, z: 0.05, rot: 0.5 },
        { prop: 'food-soda', x: 1.25, z: 1.35, chance: 0.9 },
        { prop: 'food-taco', x: 0.05, z: 1.3, rot: -0.25 },
        { prop: 'food-giant-burger', x: -1.45, z: 1.25, rot: 0.35 },
      ],
    },
    {
      id: 'lunchbox-crossing', on: ['.'], at: [9, 6], count: 1, radius: 3.0, rot: 0.3,
      items: [
        { prop: 'food-sandwich', x: -1.75, z: -0.85, rot: -0.25 },
        { prop: 'food-pizza', x: -0.45, z: -1.15, rot: 0.45 },
        { prop: 'food-hotdog', x: 0.95, z: -0.75, rot: -0.6 },
        { prop: 'food-taco', x: 1.65, z: 0.25, rot: 0.35 },
        { prop: 'food-burger', x: 0.65, z: 1.3, rot: -0.15 },
        { prop: 'food-pizza', x: -0.75, z: 1.15, rot: -0.4 },
        { prop: 'food-sandwich', x: -1.7, z: 0.45, rot: 0.55 },
        { prop: 'food-fries', x: 1.75, z: -1.15, chance: 0.85, rot: 0.2 },
      ],
    },
    {
      id: 'harvest-garden', on: ['.'], at: [5, 4], count: 1, radius: 3.05, rot: -0.4,
      items: [
        { prop: 'food-watermelon', x: -1.65, z: -1.05, rot: 0.25 },
        { prop: 'food-pineapple', x: 0, z: -1.25, rot: -0.15 },
        { prop: 'food-turkey', x: 1.55, z: -0.75, rot: 0.45 },
        { prop: 'food-burger', x: 1.35, z: 0.85, rot: -0.35 },
        { prop: 'food-watermelon', x: 0, z: 1.35, rot: 0.1 },
        { prop: 'food-pineapple', x: -1.45, z: 0.75, rot: 0.3 },
        { prop: 'food-apple', x: 0.15, z: 0.1, chance: 0.8, jitter: 0.15 },
      ],
    },

    // ── Late-game spectacle ─────────────────────────────────────────────
    // Three different compositions carry enough gated mass to reach tier 8.
    // Their models are visually smaller than the earlier giant-food pass; the
    // progression value lives in catalog bias rather than absurd scale.
    {
      id: 'harvest-feast', on: ['.'], at: [2, 13], count: 1, radius: 4.2, rot: 0.25,
      items: [
        { prop: 'food-giant-pineapple', x: -2.1, z: -1.3, rot: -0.2 },
        { prop: 'food-giant-pineapple', x: 1.7, z: 1.25, rot: 0.35 },
        { prop: 'food-giant-burger', x: 1.7, z: -1.65, rot: -0.45 },
        { prop: 'food-giant-burger', x: -1.2, z: 1.7, rot: 0.6 },
        { prop: 'food-watermelon', x: 0.15, z: -0.1, rot: 0.1 },
      ],
    },
    {
      id: 'pizza-parade', on: ['.'], at: [6, 13], count: 1, radius: 4.1, rot: -0.2,
      items: [
        { prop: 'food-giant-pizza', x: -2.35, z: -1.15, rot: -0.2 },
        { prop: 'food-giant-pizza', x: 0.15, z: -0.15, rot: 0.45 },
        { prop: 'food-giant-pizza', x: 2.25, z: 1.25, rot: -0.55 },
        { prop: 'food-festival-cake', x: -1.6, z: 1.75, rot: 0.2 },
        { prop: 'food-soda', x: 1.75, z: -1.6, scale: 1.15 },
      ],
    },
    {
      id: 'grand-picnic-finale', on: ['.'], at: [12, 13], count: 1, radius: 4.35, rot: 0.45,
      items: [
        { prop: 'food-festival-cake', x: 0, z: 0, rot: -0.25 },
        { prop: 'food-giant-pizza', x: -2.45, z: -1.4, rot: 0.3 },
        { prop: 'food-giant-pineapple', x: 2.2, z: -1.3, rot: -0.35 },
        { prop: 'food-feast-turkey', x: -1.8, z: 1.65, rot: 0.55 },
        { prop: 'food-giant-burger', x: 1.65, z: 1.75, rot: -0.4 },
        { prop: 'food-cupcake', x: 2.8, z: 0.45, chance: 0.75, scale: 1.1 },
      ],
    },

    // ── Picnic-city set dressing ────────────────────────────────────────
    {
      id: 'park-conversation', on: ['.'], at: [5, 6], count: 1, radius: 3.0, rot: Math.PI / 2,
      items: [
        { prop: 'bench-cushion', x: 0, z: -1.0 }, { prop: 'bench-cushion', x: 0, z: 1.0, rot: Math.PI },
        { prop: 'potted-plant', x: 1.8, z: 0 }, { prop: 'basket', x: -1.65, z: 0.35, rot: 0.35 },
      ],
    },
    {
      id: 'blanket-corner', on: ['.'], at: [2, 6], count: 1, radius: 2.8, rot: -0.2,
      items: [
        { prop: 'rug', x: 0, z: 0 }, { prop: 'basket', x: -1.15, z: 0.75, rot: -0.4 },
        { prop: 'potted-plant', x: 1.35, z: -0.75 }, { prop: 'food-croissant', x: 0.65, z: 0.55, rot: 0.2 },
      ],
    },
    {
      id: 'intro-cafe', on: ['C'], at: [12, 10], count: 1, radius: 2.4, rot: Math.PI / 2,
      items: [
        { prop: 'table-cafe', x: 0, z: 0 },
        { prop: 'chair', x: 1.25, z: 0, rot: -Math.PI / 2 },
        { prop: 'chair-rounded', x: -1.25, z: 0, rot: Math.PI / 2 },
        { prop: 'chair', x: 0, z: 1.25, rot: Math.PI },
        { prop: 'potted-plant', x: 1.45, z: -1.25 },
      ],
    },
  ],
  lanes: [],
  pedestrianOn: ['.', ',', 'P', 'C'],
  // Citizens join the same collision/absorption system as every other prop:
  // they block the tiny ball, react to it, and become collectible later.
  pedestrians: 5,
  collectibles: [
    { prop: 'food-donut', target: 24, label: 'Donuts' },
    { prop: 'food-cupcake', target: 16, label: 'Cupcakes' },
  ],
  stars: [500, 1000, 1700],
  // Both models are in the prop catalog, so every `B` plot is a real
  // demolition target once the ball is large enough.
  commercial: { kit: 'commercial', models: ['building-a', 'building-d'] },
  suburban: { kit: 'suburban', models: ['building-type-a'] },
  blockStacks: [
    { at: [4, 5], models: ['wallBrick01', 'wallBrick04', 'stone02'], scale: 0.85, layers: 4 },
    { at: [10, 4], models: ['stone02', 'wallBrick04', 'wallBrick01'], scale: 0.72, layers: 3 },
  ],
  pets: [
    { at: [2, 2], model: 'animal-bunny', scale: 0.95 },
    { at: [12, 8], model: 'animal-chick', scale: 0.8 },
    { at: [4, 12], model: 'animal-dog', scale: 0.9 },
  ],
  surround: { wallHeight: 4, wallThickness: 0.7, skyline: { kit: 'commercial', models: ['building-a'] }, skylineRings: 0, skylineGap: 16 },
};
