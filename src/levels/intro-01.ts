import type { LevelDef } from './types';

/**
 * Pocket Park — the picnic level, and now the last one.
 *
 * ## Why it was unfinishable
 *
 * It was authored as the *first* level: a 22x22 tutorial garden, three
 * buildings, and 8,761 units of mass in the whole district. Roll Master costs
 * 12,000. Reaching the top size here was not hard, it was arithmetically
 * impossible — eating literally every crumb, car and shopfront on the map left
 * you 3,200 short, stranded at City Eater with nothing left to grow on.
 *
 * Three separate faults, all fixed here:
 *
 *  - **Not enough mass.** The district holds 26,600 now, a shade over three
 *    times what it did. Most of the new weight is the neighbourhood: twelve
 *    houses and four shopfronts around the green, where there used to be one
 *    house and two shops.
 *  - **A hole in the size ladder.** Above the vans at 1.9 m the old map had
 *    nothing until the house at 3.7 m, so a Colossus-sized ball — a whole
 *    growth tier — had no new food anywhere in the level. The service vehicles
 *    fill it: an ambulance or a fire engine is the reward for reaching the size
 *    where a parked hatchback stops being a challenge.
 *  - **A trap in the clear condition.** `clearToComplete` ends the run when
 *    every *non-building* prop is gone. Sweep the park perfectly without
 *    touching a house and the old map handed you "Level Complete" at 11,447 —
 *    553 short of the top size, which is the original bug wearing a hat. The
 *    loose half of the map is now worth 14,500 on its own, so clearing the
 *    block and maxing the ball are the same act with room to spare.
 *
 * ## The shape of the run
 *
 * Half the old level's mass sat in objects under 1.65 m, against 8% in the two
 * city maps: a picnic is made of small heavy things, and the ball snowballed
 * through the early tiers on biscuits. That share is 31% now — still the
 * highest in the game, because it is still a picnic, but the climb no longer
 * outruns the map. Measured against an autopilot sweep, the journey to Roll
 * Master is 6.1 map widths here, 6.3 in Downtown and 6.7 in Rail City: the same
 * proportional tour of the district, over less ground.
 *
 * The map went 22x22 -> 26x26 to hold it, which is still comfortably the
 * smallest district in the game. The nine blocks are the same nine blocks; the
 * middle one is a proper 10x10 green now rather than a 6x6 patch, and the four
 * corners have houses along their streets.
 *
 * Frontages sit on each block's west and south edges only — the far side from
 * the camera. See `downtown-01` for the reasoning.
 */
const MAP = [
  ',,,,,,,,,,,,,,,,,,,,,,,,,,',
  ',H.....#..........#H.....,',
  ',......#..........#......,',
  ',H.....#..........#H.....,',
  ',......#..........#......,',
  ',H.....#..........#H.....,',
  ',......#...B..B...#......,',
  '#######X##########X#######',
  ',......#..........#......,',
  ',......#..........#......,',
  ',......#...PCC....#......,',
  ',......#....C.....#......,',
  ',......#.....C....#......,',
  ',......#....C.....#......,',
  ',......#..........#......,',
  ',......#..........#......,',
  ',......#..........#......,',
  ',......#..........#......,',
  '#######X##########X#######',
  ',H.....#..........#H.....,',
  ',......#..........#......,',
  ',H.....#..........#H.....,',
  ',......#..........#......,',
  ',H.....#..........#H.....,',
  ',......#...B..B...#......,',
  ',,,,,,,,,,,,,,,,,,,,,,,,,,',
];

export const INTRO: LevelDef = {
  id: 'intro-01',
  name: 'Pocket Park',
  subtitle: 'Clear the little block',
  // Was 210 s, set when this was a tutorial garden with an hour's worth of
  // slack. An optimal sweep now reaches the top size in about 65 s and a
  // relaxed one in roughly twice that, so 180 leaves real room without the
  // clock being decorative — and stops the smallest level owning the longest
  // timer in the game.
  time: 180,
  clearToComplete: true,
  tileSize: 4,
  picnicGround: true,
  map: MAP,
  start: [11, 10],
  // Rule order is placement order, and every rule claims the ground it uses.
  // The big things therefore go first: with the crumbs running ahead of them a
  // density of 0.16 was putting down five cars instead of fifteen, because a
  // scattering of biscuits had already reserved every gap a car would fit in.
  scatter: [
    // Service vehicles: the one thing in the level between a van and a house.
    // See the note at the top — a Colossus-sized ball had nothing to eat, so
    // an entire growth tier passed with no new food anywhere on the map. Ahead
    // of the cars because they are bigger and there are only a handful: losing
    // two of five to a parked hatchback is the difference between a payoff and
    // a curiosity.
    {
      props: ['ambulance', 'firetruck', 'garbage-truck'], on: ['#'], density: 0.2,
      minFromStart: 24, clump: 0.3,
    },
    // Parked cars, along the carriageway and the kerb both. Vehicles are what
    // carries this level over the line: `clearToComplete` ends the run when
    // every non-building prop is gone, so the loose half of the map has to be
    // worth more than the 12,000 Roll Master costs on its own — or sweeping the
    // park perfectly would finish the level at City Eater, which is the exact
    // bug this rebalance exists to kill. Cars sit in the 1.8-2.1 m band the
    // climb is short of, so they buy that margin without making the early game
    // any richer.
    {
      props: ['sedan', 'taxi', 'hatchback', 'van', 'suv'], on: ['#', ','], density: 0.26,
      minFromStart: 16, scale: [0.92, 1.05], clump: 0.35,
    },
    // One or two, not eight. A police car is a landmark, not traffic.
    { props: ['police'], on: ['#'], density: 0.035, minFromStart: 22 },
    // Oaks and saplings. A park with no trees was always a slightly odd
    // picture, and at 1.4 m they are exactly the size the climb is short of.
    {
      props: ['tree-large'], on: ['.'], density: 0.055, minFromStart: 14, scale: [0.92, 1.16], clump: 2.2,
    },
    { props: ['tree-small', 'planter'], on: ['.'], density: 0.06, minFromStart: 10, clump: 1.4 },
    // The picnic's heavy end, loose on the grass rather than only inside the
    // authored feasts. Without this the middle of the run is one long stretch
    // of crumbs: everything from Boulder to Wrecking Ball used to come from a
    // dozen hand-placed scenes, and once you had toured them there was nothing
    // of your own size left anywhere on the map.
    {
      props: ['food-watermelon', 'food-pineapple', 'food-turkey', 'food-burger', 'food-cake'],
      on: ['.'], density: 0.07, minFromStart: 12, scale: [0.9, 1.15], clump: 0.9,
    },
    // Mid-sized food bridges the first three growth tiers between landmarks.
    {
      props: ['food-croissant', 'food-muffin', 'food-banana', 'food-soda', 'food-fries', 'food-cupcake'],
      on: ['.', ',', 'C'], density: 0.24, minFromStart: 7, scale: [0.86, 1.12], clump: 1.1,
    },
    // Tiny picnic crumbs throughout the nine blocks keep traversal rewarding,
    // but clumping leaves clean negative space around the authored scenes.
    {
      props: ['food-cookie', 'food-strawberry', 'food-cherries', 'food-maki', 'food-apple', 'food-donut'],
      on: ['.', ',', 'C'], density: 0.40, minFromStart: 10, scale: [0.78, 1.16], clump: 1.7,
    },
    // Dense, evenly available opening food. The authored ring below guarantees
    // the first movement pays off; this halo then lets the player choose any
    // direction without running into a dead patch. Last, because it is all
    // tier-zero and small enough to fit whatever gaps are left.
    {
      props: ['food-cookie', 'food-strawberry', 'food-cherries', 'food-maki', 'food-apple', 'food-donut'],
      on: ['P', '.', 'C'], density: 2.4, maxFromStart: 12, scale: [0.84, 1.08],
    },
  ],
  clusters: [
    // ── Opening route ────────────────────────────────────────────────────
    // These are deliberately exact, tier-zero arrangements. They remove the
    // frustrating possibility of a random seed leaving the new player hungry.
    {
      id: 'starter-snack-ring', on: ['P'], at: [11, 10], count: 1, radius: 1.8,
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
      id: 'starter-west-trail', on: ['.'], at: [10, 10], count: 1, radius: 1.25,
      allowNearStart: true, rot: 0,
      items: [
        { prop: 'food-cookie', x: 1.1, z: -0.35 }, { prop: 'food-cherries', x: 0.45, z: 0.25 },
        { prop: 'food-strawberry', x: -0.2, z: -0.2 }, { prop: 'food-maki', x: -0.85, z: 0.3 },
        { prop: 'food-donut', x: -1.2, z: -0.35, scale: 0.95 },
      ],
    },
    {
      id: 'starter-north-trail', on: ['.'], at: [11, 9], count: 1, radius: 1.25,
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
      id: 'berry-pinwheel', on: ['.'], at: [15, 9], count: 1, radius: 2.15, freeRotation: true,
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
      id: 'brunch-for-two', on: ['.'], at: [4, 12], count: 1, radius: 2.45, rot: -0.35,
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
      id: 'sushi-comet', on: ['.'], at: [2, 10], count: 1, radius: 2.35, rot: 0.6,
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
      id: 'street-food-zigzag', on: ['.'], at: [22, 3], count: 1, radius: 2.75, rot: -0.25,
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
      id: 'orchard-crescent', on: ['.'], at: [3, 3], count: 1, radius: 2.9, freeRotation: true,
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
      id: 'dessert-sunburst', on: ['.'], at: [12, 3], count: 1, radius: 3.15, rot: 0.15,
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
      id: 'cookout-diagonal', on: ['.'], at: [22, 12], count: 1, radius: 3.4, rot: -0.7,
      items: [
        { prop: 'food-burger', x: -1.8, z: -0.75, rot: 0.2 },
        { prop: 'food-hotdog', x: -0.55, z: -0.2, rot: -0.65 },
        { prop: 'food-fries', x: 0.55, z: -0.85, rot: 0.15 },
        { prop: 'food-turkey', x: 1.55, z: 0.05, rot: 0.5 },
        { prop: 'food-soda', x: 1.25, z: 1.35, chance: 0.9 },
        { prop: 'food-taco', x: 0.05, z: 1.3, rot: -0.25 },
        { prop: 'food-burger', x: -1.45, z: 1.25, rot: 0.35 },
      ],
    },
    {
      id: 'lunchbox-crossing', on: ['.'], at: [13, 16], count: 1, radius: 3.0, rot: 0.3,
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
      id: 'harvest-garden', on: ['.'], at: [22, 15], count: 1, radius: 3.05, rot: -0.4,
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
    // Three different compositions mark the late route without acting as mass
    // jackpots. The remaining climb comes from many modest pickups around the
    // district, so clearing one feast cannot skip several growth tiers.
    {
      id: 'harvest-feast', on: ['.'], at: [3, 21], count: 1, radius: 4.2, rot: 0.25,
      items: [
        { prop: 'food-pineapple', x: -2.1, z: -1.3, rot: -0.2 },
        { prop: 'food-pineapple', x: 1.7, z: 1.25, rot: 0.35 },
        { prop: 'food-burger', x: 1.7, z: -1.65, rot: -0.45 },
        { prop: 'food-burger', x: -1.2, z: 1.7, rot: 0.6 },
        { prop: 'food-watermelon', x: 0.15, z: -0.1, rot: 0.1 },
      ],
    },
    {
      id: 'pizza-parade', on: ['.'], at: [11, 21], count: 1, radius: 4.1, rot: -0.2,
      items: [
        { prop: 'food-pizza', x: -2.35, z: -1.15, rot: -0.2 },
        { prop: 'food-pizza', x: 0.15, z: -0.15, rot: 0.45 },
        { prop: 'food-pizza', x: 2.25, z: 1.25, rot: -0.55 },
        { prop: 'food-cake', x: -1.6, z: 1.75, rot: 0.2 },
        { prop: 'food-soda', x: 1.75, z: -1.6, scale: 1.15 },
      ],
    },
    {
      id: 'grand-picnic-finale', on: ['.'], at: [22, 21], count: 1, radius: 4.35, rot: 0.45,
      items: [
        { prop: 'food-cake', x: 0, z: 0, rot: -0.25 },
        { prop: 'food-pizza', x: -2.45, z: -1.4, rot: 0.3 },
        { prop: 'food-pineapple', x: 2.2, z: -1.3, rot: -0.35 },
        { prop: 'food-turkey', x: -1.8, z: 1.65, rot: 0.55 },
        { prop: 'food-burger', x: 1.65, z: 1.75, rot: -0.4 },
        { prop: 'food-cupcake', x: 2.8, z: 0.45, chance: 0.75, scale: 1.1 },
      ],
    },

    // ── Picnic-city set dressing ────────────────────────────────────────
    {
      id: 'park-conversation', on: ['.'], at: [22, 16], count: 1, radius: 3.0, rot: Math.PI / 2,
      items: [
        { prop: 'bench-cushion', x: 0, z: -1.0 }, { prop: 'bench-cushion', x: 0, z: 1.0, rot: Math.PI },
        { prop: 'potted-plant', x: 1.8, z: 0 }, { prop: 'basket', x: -1.65, z: 0.35, rot: 0.35 },
      ],
    },
    {
      id: 'blanket-corner', on: ['.'], at: [3, 16], count: 1, radius: 2.8, rot: -0.2,
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

    // ── Wind fodder ─────────────────────────────────────────────────────
    // Dense, irregular heaps give the wind something worth rearranging. The
    // four families deliberately use different footprints and object mixes;
    // per-item jitter/chance keeps repeated heaps from looking stamped.
    {
      id: 'wind-main-course-heaps', on: ['.', ',', 'C'], count: [7, 9], radius: 2.15,
      minFromStart: 10, freeRotation: true,
      items: [
        { prop: 'food-burger', x: -0.95, z: -0.45, jitter: 0.34, randomRotation: true },
        { prop: 'food-watermelon', x: 0.1, z: -0.75, jitter: 0.28, chance: 0.68, randomRotation: true },
        { prop: 'food-sandwich', x: 0.9, z: -0.55, jitter: 0.3, randomRotation: true },
        { prop: 'food-pizza', x: -0.45, z: 0.05, jitter: 0.32, randomRotation: true },
        { prop: 'food-turkey', x: 0.55, z: 0.15, jitter: 0.3, chance: 0.58, randomRotation: true },
        { prop: 'food-cake', x: -1.15, z: 0.65, jitter: 0.3, chance: 0.7, randomRotation: true },
        { prop: 'food-pineapple', x: -0.1, z: 0.85, jitter: 0.36, chance: 0.62, randomRotation: true },
        { prop: 'food-hotdog', x: 1.05, z: 0.65, jitter: 0.32, chance: 0.72, randomRotation: true },
        { prop: 'food-strawberry', x: -0.8, z: 1.2, jitter: 0.3, chance: 0.82, randomRotation: true },
        { prop: 'food-maki', x: 0.65, z: 1.25, jitter: 0.34, chance: 0.76, randomRotation: true },
        { prop: 'potted-plant', x: 1.35, z: -0.05, jitter: 0.25, chance: 0.6, randomRotation: true },
      ],
    },
    {
      id: 'wind-snack-heaps', on: ['.', ',', 'C'], count: [14, 18], radius: 1.55,
      minFromStart: 7, freeRotation: true,
      items: [
        { prop: 'food-cookie', x: -0.65, z: -0.5, jitter: 0.28, randomRotation: true },
        { prop: 'food-strawberry', x: 0.1, z: -0.7, jitter: 0.24, randomRotation: true },
        { prop: 'food-maki', x: 0.7, z: -0.25, jitter: 0.3, randomRotation: true },
        { prop: 'food-cherries', x: -0.75, z: 0.15, jitter: 0.2, randomRotation: true },
        { prop: 'food-donut', x: 0, z: 0.1, jitter: 0.22, scale: [0.82, 1.04], randomRotation: true },
        { prop: 'food-apple', x: 0.65, z: 0.5, jitter: 0.25, randomRotation: true },
        { prop: 'food-cupcake', x: -0.25, z: 0.75, jitter: 0.2, chance: 0.75, randomRotation: true },
        { prop: 'food-fries', x: 0.85, z: 0.15, jitter: 0.18, chance: 0.55, randomRotation: true },
        { prop: 'food-soda', x: -0.85, z: -0.15, jitter: 0.18, chance: 0.65, randomRotation: true },
      ],
    },
    {
      id: 'wind-chair-tangles', on: ['.', ',', 'C'], count: [9, 13], radius: 2.25,
      minFromStart: 10, freeRotation: true,
      items: [
        { prop: 'chair', x: -0.85, z: -0.6, rot: -0.5, jitter: 0.2 },
        { prop: 'chair-rounded', x: 0.65, z: -0.75, rot: 0.7, jitter: 0.18 },
        { prop: 'stool-bar', x: -0.15, z: 0.15, rot: -0.25, jitter: 0.25 },
        { prop: 'side-table', x: 0.9, z: 0.5, rot: 0.4, jitter: 0.16, chance: 0.75 },
        { prop: 'basket', x: -0.9, z: 0.65, rot: -0.7, jitter: 0.2 },
        { prop: 'food-sandwich', x: 0.1, z: -0.95, jitter: 0.18, randomRotation: true },
        { prop: 'food-croissant', x: 0.25, z: 0.85, jitter: 0.24, randomRotation: true },
        { prop: 'food-cookie', x: -0.35, z: 0.55, jitter: 0.18, chance: 0.8, randomRotation: true },
      ],
    },
    {
      id: 'wind-bench-heaps', on: ['.'], count: [7, 10], radius: 2.75,
      minFromStart: 13, freeRotation: true,
      items: [
        { prop: 'bench-cushion', x: -0.75, z: -0.55, rot: -0.45, jitter: 0.18 },
        { prop: 'bench-cushion', x: 0.75, z: 0.55, rot: 0.7, jitter: 0.18, chance: 0.8 },
        { prop: 'table-cafe', x: 0.65, z: -0.75, rot: 0.3, jitter: 0.15 },
        { prop: 'chair', x: -0.9, z: 0.7, rot: -0.8, jitter: 0.18 },
        { prop: 'chair-rounded', x: 0, z: 0.15, rot: 0.4, jitter: 0.2 },
        { prop: 'food-pizza', x: -0.1, z: -1.05, jitter: 0.18, randomRotation: true },
        { prop: 'food-burger', x: 1.15, z: 0.1, jitter: 0.16, chance: 0.7, randomRotation: true },
      ],
    },
  ],
  lanes: [],
  pedestrianOn: ['.', ',', 'P', 'C'],
  // Citizens join the same collision/absorption system as every other prop:
  // they block the tiny ball, react to it, and become collectible later.
  pedestrians: 14,
  collectibles: [
    { prop: 'food-donut', target: 24, label: 'Donuts' },
    { prop: 'food-cupcake', target: 16, label: 'Cupcakes' },
  ],
  // Rebuilt from a measured run rather than nudged: an autopilot sweep to Roll
  // Master scores about 22,000 here, against the 1,700 the old three-star bar
  // asked for. Three stars now means finishing the job on a long chain.
  stars: [5000, 13000, 28000],
  // The neighbourhood. Sixteen plots where there used to be three, and this is
  // where most of the level's new mass lives: roughly 12,000 units against the
  // 2,800 the old three managed, which is the difference between Roll Master
  // being unreachable and being the point of the last minute.
  //
  // Tier 7 is the displayed eighth size. Capping the fitted plot models there
  // keeps every B/H landmark destructible even when its source mesh is a few
  // centimetres larger than the nominal tier boundary.
  commercial: { kit: 'commercial', models: ['building-a', 'building-c', 'building-d'], demolitionTier: 7 },
  suburban: {
    kit: 'suburban',
    models: ['building-type-a', 'building-type-i', 'building-type-k', 'building-type-m'],
    demolitionTier: 7,
  },
  blockStacks: [
    { at: [4, 5], models: ['wallBrick01', 'wallBrick04', 'stone02'], scale: 0.85, layers: 4 },
    { at: [12, 4], models: ['stone02', 'wallBrick04', 'wallBrick01'], scale: 0.72, layers: 3 },
  ],
  pets: [
    { at: [2, 2], model: 'animal-bunny', scale: 0.95 },
    { at: [22, 10], model: 'animal-chick', scale: 0.8 },
    { at: [4, 21], model: 'animal-dog', scale: 0.9 },
  ],
  // A strong north-westerly slowly pushes snacks and furniture away from the
  // spawn, eventually building changing piles along the far boundary.
  wind: { direction: [-0.86, -0.5], strength: 1.25 },
  surround: { wallHeight: 4, wallThickness: 0.7, skyline: { kit: 'commercial', models: ['building-a'] }, skylineRings: 0, skylineGap: 16 },
};
