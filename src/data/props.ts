/**
 * The prop catalog.
 *
 * The four Kenney kits are authored at wildly different scales — a road tile is
 * 1 unit but a sedan is 2.55, and a commercial building is 1.29 — so `KIT_SCALE`
 * normalises every kit into one world where **1 unit = 1 metre**. A road tile is
 * 4 m across, a sedan 4.3 m long, an office block 11 m tall.
 *
 * Given that, absorb size / mass / points are *derived* from each model's real
 * measured bounds rather than hand-authored. Authoring three magic numbers per
 * prop across 45 props in four different source scales would drift the moment
 * anyone touched it; deriving them means the difficulty curve stays consistent
 * by construction, and per-prop `*Bias` fields cover the cases where feel should
 * beat physics.
 */

import type { LoadedModel } from '../core/Assets';

export type KitId =
  | 'cars'
  | 'roads'
  | 'commercial'
  | 'suburban'
  | 'characters'
  | 'furniture'
  | 'market';

/** Multiplier that brings each kit into metres. */
export const KIT_SCALE: Record<KitId, number> = {
  roads: 4.0,
  cars: 1.7,
  commercial: 8.5,
  suburban: 6.5,
  // Derived from real-world heights: a furniture-kit table is 0.327 units tall
  // and a table is 0.72 m; a market shelf is 0.89 units and a shop shelf 1.6 m.
  furniture: 2.2,
  market: 1.8,
  // Characters are normalised to a target height at load instead, because the
  // pack's raw units don't relate to the other kits at all.
  characters: 1.0,
};

/**
 * How a kit carries its colour.
 *
 * The city kits all share one `colormap.png` atlas. The furniture kit has no
 * textures at all — it uses a handful of named materials (`wood`, `carpet`,
 * `metal`) with flat `baseColorFactor`s. Rather than let that fork the renderer
 * into per-material draw calls, those factors get baked into vertex colours at
 * load, so a furniture model is still one geometry with one shared material,
 * exactly like everything else.
 */
export const KIT_MATERIAL: Record<KitId, 'atlas' | 'vertexColor'> = {
  roads: 'atlas',
  cars: 'atlas',
  commercial: 'atlas',
  suburban: 'atlas',
  characters: 'atlas',
  market: 'atlas',
  furniture: 'vertexColor',
};

/** Characters are rescaled so a citizen stands this tall. */
export const CHARACTER_HEIGHT = 1.8;

/**
 * Which sound a prop makes when it sticks.
 *
 * Deliberately coarse. Most of the city is `pop` — that is the sound of the
 * game — with `human` for citizens and `chunk` for the heavy things, so the
 * rare pickups stand out against a familiar background rather than every prop
 * having its own timbre.
 */
export type Voice = 'tiny' | 'wood' | 'metal' | 'soft' | 'heavy' | 'human';

export interface PropSpec {
  id: string;
  kit: KitId;
  model: string;
  /** Design tier — when this should first become edible. Sanity-checked at boot. */
  tier: number;
  label: string;
  voice: Voice;
  /** Extra visual scale on top of the kit normalisation. */
  scale?: number;
  /** Nudge how big the ball must be. <1 = easier to eat. */
  absorbBias?: number;
  /** Nudge growth contribution. */
  massBias?: number;
  /** Nudge score. */
  pointsBias?: number;
}

export interface PropDef extends PropSpec {
  /** Effective radius the ball must exceed. Derived from measured bounds. */
  absorbSize: number;
  mass: number;
  points: number;
  /** Measured world-space size in metres, after all scaling. */
  size: { x: number; y: number; z: number };
}

// Growth is superlinear but gentler than volume: true cubic scaling would make
// the first tier take a hundred bolts and the last take three buildings.
const MASS_K = 25;
const MASS_EXP = 2.5;
const POINTS_K = 14;
const POINTS_EXP = 1.5;

/**
 * A prop's "radius" for absorption. Weighted toward footprint rather than
 * height, so a 5 m tree goes down when the ball is wide enough to shoulder its
 * trunk instead of only once the ball is taller than the canopy.
 */
export function computeAbsorbSize(size: { x: number; y: number; z: number }) {
  const horizontal = Math.max(size.x, size.z);
  return 0.5 * (horizontal * 0.65 + size.y * 0.35);
}

const SPECS: PropSpec[] = [
  // ── Tier 0 · litter you can eat from the first second ──────────────────
  { id: 'bolt', kit: 'cars', model: 'debris-bolt', tier: 0, label: 'Loose Bolt', voice: 'tiny' },
  { id: 'nut', kit: 'cars', model: 'debris-nut', tier: 0, label: 'Hex Nut', voice: 'tiny' },
  { id: 'road-cone', kit: 'roads', model: 'construction-cone', tier: 0, label: 'Road Cone', voice: 'soft' },
  { id: 'plate-small-a', kit: 'cars', model: 'debris-plate-small-a', tier: 0, label: 'Scrap Plate', voice: 'metal' },
  { id: 'plate-small-b', kit: 'cars', model: 'debris-plate-small-b', tier: 0, label: 'Bent Plate', voice: 'metal' },

  // ── Tier 1 · street litter ────────────────────────────────────────────
  { id: 'barrier-small', kit: 'roads', model: 'construction-barrier', tier: 1, label: 'Barrier', voice: 'wood' },
  { id: 'cone', kit: 'cars', model: 'cone', tier: 1, label: 'Traffic Cone', voice: 'soft' },
  { id: 'cone-flat', kit: 'cars', model: 'cone-flat', tier: 1, label: 'Squashed Cone', voice: 'soft' },
  { id: 'plate-a', kit: 'cars', model: 'debris-plate-a', tier: 1, label: 'Steel Plate', voice: 'metal' },
  { id: 'plate-b', kit: 'cars', model: 'debris-plate-b', tier: 1, label: 'Panel', voice: 'metal' },

  // ── Tier 2 · junk ─────────────────────────────────────────────────────
  { id: 'tire', kit: 'cars', model: 'debris-tire', tier: 2, label: 'Spare Tire', voice: 'soft' },
  { id: 'wheel', kit: 'cars', model: 'wheel-default', tier: 2, label: 'Wheel', voice: 'soft' },
  { id: 'box', kit: 'cars', model: 'box', tier: 2, label: 'Cardboard Box', voice: 'wood' },
  { id: 'bumper', kit: 'cars', model: 'debris-bumper', tier: 2, label: 'Bumper', voice: 'metal' },
  { id: 'spoiler', kit: 'cars', model: 'debris-spoiler-a', tier: 2, label: 'Spoiler', voice: 'metal' },
  { id: 'axle', kit: 'cars', model: 'debris-drivetrain-axle', tier: 2, label: 'Axle', voice: 'metal' },

  // ── Tier 3 · street furniture ─────────────────────────────────────────
  { id: 'door', kit: 'cars', model: 'debris-door', tier: 3, label: 'Car Door', voice: 'metal' },
  { id: 'door-window', kit: 'cars', model: 'debris-door-window', tier: 3, label: 'Door & Glass', voice: 'metal' },
  { id: 'drivetrain', kit: 'cars', model: 'debris-drivetrain', tier: 3, label: 'Drivetrain', voice: 'heavy' },
  { id: 'work-light', kit: 'roads', model: 'construction-light', tier: 3, label: 'Work Light', voice: 'metal' },
  { id: 'street-light', kit: 'roads', model: 'light-square', tier: 3, label: 'Street Light', voice: 'metal', massBias: 1.6 },

  // ── Tier 4 · the city starts coming loose ─────────────────────────────
  { id: 'planter', kit: 'suburban', model: 'planter', tier: 4, label: 'Planter', voice: 'wood' },
  { id: 'tree-small', kit: 'suburban', model: 'tree-small', tier: 4, label: 'Sapling', voice: 'soft' },
  { id: 'pedestrian', kit: 'characters', model: 'character-a', tier: 4, label: 'Citizen', voice: 'human', massBias: 3, pointsBias: 4 },

  // ── Tier 5 · big street furniture and small vehicles ──────────────────
  { id: 'fence', kit: 'suburban', model: 'fence', tier: 5, label: 'Picket Fence', voice: 'wood' },
  { id: 'tree-large', kit: 'suburban', model: 'tree-large', tier: 5, label: 'Oak Tree', voice: 'soft', pointsBias: 1.4 },
  { id: 'kart', kit: 'cars', model: 'kart-oobi', tier: 5, label: 'Go-Kart', voice: 'heavy' },
  { id: 'parasol', kit: 'commercial', model: 'detail-parasol-a', tier: 5, label: 'Cafe Parasol', voice: 'soft' },
  { id: 'parasol-b', kit: 'commercial', model: 'detail-parasol-b', tier: 5, label: 'Patio Parasol', voice: 'soft' },

  // ── Tier 6 · cars. The moment the game changes gear. ──────────────────
  { id: 'sedan', kit: 'cars', model: 'sedan', tier: 6, label: 'Sedan', voice: 'heavy' },
  { id: 'taxi', kit: 'cars', model: 'taxi', tier: 6, label: 'Taxi', voice: 'heavy', pointsBias: 1.3 },
  { id: 'police', kit: 'cars', model: 'police', tier: 6, label: 'Police Car', voice: 'heavy', pointsBias: 1.5 },
  { id: 'suv', kit: 'cars', model: 'suv', tier: 6, label: 'SUV', voice: 'heavy' },
  { id: 'hatchback', kit: 'cars', model: 'hatchback-sports', tier: 6, label: 'Hatchback', voice: 'heavy' },
  { id: 'sign-highway', kit: 'roads', model: 'sign-highway', tier: 6, label: 'Road Sign', voice: 'metal' },
  { id: 'van', kit: 'cars', model: 'van', tier: 6, label: 'Van', voice: 'heavy' },

  // ── Street life: furniture kit ────────────────────────────────────────
  // These are what turn a scatter of debris into somewhere people were. Tiers
  // are spread on purpose so a cafe cluster keeps giving as the ball grows:
  // the little plant goes first, then the chairs, then finally the table.
  { id: 'plant-small', kit: 'furniture', model: 'plantSmall1', tier: 0, label: 'Little Plant', voice: 'soft' },
  { id: 'plant-small-b', kit: 'furniture', model: 'plantSmall3', tier: 0, label: 'Herb Pot', voice: 'soft' },
  { id: 'books', kit: 'furniture', model: 'books', tier: 0, label: 'Stack of Books', voice: 'wood' },
  { id: 'toaster', kit: 'furniture', model: 'toaster', tier: 0, label: 'Toaster', voice: 'metal' },
  { id: 'radio', kit: 'furniture', model: 'radio', tier: 1, label: 'Radio', voice: 'wood' },
  { id: 'chair', kit: 'furniture', model: 'chair', tier: 1, label: 'Cafe Chair', voice: 'wood' },
  { id: 'chair-rounded', kit: 'furniture', model: 'chairRounded', tier: 1, label: 'Round Chair', voice: 'wood' },
  { id: 'stool-bar', kit: 'furniture', model: 'stoolBar', tier: 1, label: 'Bar Stool', voice: 'wood' },
  { id: 'trashcan', kit: 'furniture', model: 'trashcan', tier: 1, label: 'Trash Can', voice: 'metal' },
  { id: 'box-open', kit: 'furniture', model: 'cardboardBoxOpen', tier: 1, label: 'Open Box', voice: 'wood' },
  { id: 'box-closed', kit: 'furniture', model: 'cardboardBoxClosed', tier: 1, label: 'Packed Box', voice: 'wood' },
  { id: 'potted-plant', kit: 'furniture', model: 'pottedPlant', tier: 2, label: 'Potted Plant', voice: 'soft' },
  { id: 'lamp-floor', kit: 'furniture', model: 'lampSquareFloor', tier: 2, label: 'Floor Lamp', voice: 'metal' },
  { id: 'tv', kit: 'furniture', model: 'televisionModern', tier: 2, label: 'Television', voice: 'metal' },
  { id: 'bench-cushion', kit: 'furniture', model: 'benchCushion', tier: 2, label: 'Padded Bench', voice: 'wood' },
  { id: 'side-table', kit: 'furniture', model: 'sideTable', tier: 2, label: 'Side Table', voice: 'wood' },
  { id: 'table-cafe', kit: 'furniture', model: 'tableRound', tier: 3, label: 'Cafe Table', voice: 'wood' },
  { id: 'table', kit: 'furniture', model: 'table', tier: 3, label: 'Dining Table', voice: 'wood' },
  { id: 'rug', kit: 'furniture', model: 'rugSquare', tier: 3, label: 'Rug', voice: 'soft' },
  { id: 'fridge', kit: 'furniture', model: 'kitchenFridge', tier: 3, label: 'Fridge', voice: 'metal' },
  { id: 'bookcase', kit: 'furniture', model: 'bookcaseOpen', tier: 3, label: 'Bookcase', voice: 'wood' },
  { id: 'sofa', kit: 'furniture', model: 'loungeSofa', tier: 4, label: 'Sofa', voice: 'soft' },
  { id: 'sofa-long', kit: 'furniture', model: 'loungeSofaLong', tier: 4, label: 'Long Sofa', voice: 'soft' },

  // ── Street life: mini-market kit ──────────────────────────────────────
  { id: 'basket', kit: 'market', model: 'shopping-basket', tier: 1, label: 'Shopping Basket', voice: 'wood' },
  { id: 'cart', kit: 'market', model: 'shopping-cart', tier: 1, label: 'Shopping Cart', voice: 'metal' },
  { id: 'market-fence', kit: 'market', model: 'fence', tier: 1, label: 'Stall Rail', voice: 'wood' },
  { id: 'display-fruit', kit: 'market', model: 'display-fruit', tier: 2, label: 'Fruit Stand', voice: 'wood' },
  { id: 'display-bread', kit: 'market', model: 'display-bread', tier: 2, label: 'Bread Stand', voice: 'wood' },
  { id: 'freezer', kit: 'market', model: 'freezer', tier: 2, label: 'Chest Freezer', voice: 'metal' },
  { id: 'bottle-return', kit: 'market', model: 'bottle-return', tier: 3, label: 'Bottle Return', voice: 'metal' },
  { id: 'cash-register', kit: 'market', model: 'cash-register', tier: 3, label: 'Checkout', voice: 'metal' },
  { id: 'shelf-bags', kit: 'market', model: 'shelf-bags', tier: 3, label: 'Snack Shelf', voice: 'wood' },
  { id: 'shelf-boxes', kit: 'market', model: 'shelf-boxes', tier: 3, label: 'Stock Shelf', voice: 'wood' },
  { id: 'shelf-end', kit: 'market', model: 'shelf-end', tier: 3, label: 'End Cap', voice: 'wood' },
  { id: 'freezers-standing', kit: 'market', model: 'freezers-standing', tier: 4, label: 'Drinks Cooler', voice: 'metal' },
  { id: 'market-column', kit: 'market', model: 'column', tier: 4, label: 'Shop Column', voice: 'heavy' },

  // ── Tier 7 · trucks and houses ────────────────────────────────────────
  { id: 'ambulance', kit: 'cars', model: 'ambulance', tier: 7, label: 'Ambulance', voice: 'heavy', pointsBias: 1.4 },
  { id: 'firetruck', kit: 'cars', model: 'firetruck', tier: 7, label: 'Fire Truck', voice: 'heavy', pointsBias: 1.5 },
  { id: 'garbage-truck', kit: 'cars', model: 'garbage-truck', tier: 7, label: 'Garbage Truck', voice: 'heavy' },
  { id: 'house-a', kit: 'suburban', model: 'building-type-a', tier: 7, label: 'Cottage', voice: 'heavy' },
  { id: 'house-k', kit: 'suburban', model: 'building-type-k', tier: 7, label: 'Family Home', voice: 'heavy' },

  // ── Tier 8 · the skyline ──────────────────────────────────────────────
  { id: 'shop-a', kit: 'commercial', model: 'building-a', tier: 8, label: 'Corner Shop', voice: 'heavy' },
  { id: 'shop-d', kit: 'commercial', model: 'building-d', tier: 8, label: 'Boutique', voice: 'heavy' },
];

export const PROP_SPECS: readonly PropSpec[] = SPECS;

/** Populated by `resolveProps` once models are loaded. */
export const PROPS: Record<string, PropDef> = {};

/**
 * Fills in the derived fields from measured geometry. Must run after the
 * catalog's models are loaded and before any level is built.
 */
export function resolveProps(lookup: (kit: KitId, model: string) => LoadedModel | undefined) {
  for (const spec of SPECS) {
    const m = lookup(spec.kit, spec.model);
    if (!m) continue; // a missing model just drops that prop from the level
    const s = spec.scale ?? 1;
    const size = { x: m.size.x * s, y: m.size.y * s, z: m.size.z * s };
    const absorbSize = computeAbsorbSize(size) * (spec.absorbBias ?? 1);
    PROPS[spec.id] = {
      ...spec,
      size,
      absorbSize,
      mass: MASS_K * Math.pow(absorbSize, MASS_EXP) * (spec.massBias ?? 1),
      points: Math.max(
        1,
        Math.round(POINTS_K * Math.pow(absorbSize, POINTS_EXP) * (spec.pointsBias ?? 1))
      ),
    };
  }
}

export const prop = (id: string): PropDef => {
  const d = PROPS[id];
  if (!d) throw new Error(`unknown or unresolved prop: ${id}`);
  return d;
};

export const hasProp = (id: string) => id in PROPS;

/** Every model the catalog needs, for the boot loader. */
export const catalogModels = () => SPECS.map((s) => ({ kit: s.kit, model: s.model }));
