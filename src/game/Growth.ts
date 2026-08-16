/**
 * Stepped growth.
 *
 * The brief is explicit: the ball must NOT grow smoothly as things stick. Mass
 * accumulates invisibly and the radius only changes when a threshold is crossed,
 * which turns growth from ambient drift into a repeatable *event* we can score,
 * sound, and shake the camera for. That event is the game's main dopamine beat.
 *
 * Thresholds rise faster than mass income so each tier takes slightly longer,
 * which is what stops the last third of a level feeling like a formality.
 */

export interface Tier {
  radius: number;
  /** Cumulative mass required to enter this tier. */
  mass: number;
  /** Shown on the tier-up banner. */
  name: string;
}

/**
 * Radii are metres and are matched against `PropDef.absorbSize`, which is derived
 * from measured geometry — so each tier unlocks a readable, nameable class of
 * object. The mass thresholds were set from the derived masses so every tier
 * takes roughly 8-15 pickups: short enough that a tier-up never feels far away,
 * long enough that it still feels earned.
 *
 * They are calibrated against the level's actual mass budget, not guessed. The
 * district holds ~35,000 units, but 43% of that is locked behind the top tier
 * (you cannot eat a shopfront until you are shopfront-sized), so only ~20,000
 * is reachable on the way up. Thresholds set above that curve make the last
 * tiers quietly unreachable — which is exactly what happened when the map was
 * made smaller without re-deriving them.
 */
export const TIERS: Tier[] = [
  { radius: 0.4, mass: 0, name: 'Pebble' }, //    bolts, road cones
  { radius: 0.58, mass: 12, name: 'Marble' }, //  traffic cones, scrap
  { radius: 0.82, mass: 40, name: 'Snowball' }, //tires, boxes
  { radius: 1.15, mass: 110, name: 'Boulder' }, //car doors, cafe chairs
  { radius: 1.65, mass: 300, name: 'Wrecking Ball' }, // tables, citizens
  { radius: 2.35, mass: 850, name: 'Juggernaut' }, //   oaks, shelves, karts
  { radius: 3.3, mass: 2200, name: 'Colossus' }, //     cars
  { radius: 4.5, mass: 5500, name: 'City Eater' }, //   trucks, houses
  { radius: 5.8, mass: 12000, name: 'Roll Master' }, // the shopfronts
];

export class Growth {
  tier = 0;
  mass = 0;
  /** Authoritative radius; `Ball` animates its visual scale toward this. */
  radius = TIERS[0].radius;

  /** @returns the new tier index if one was crossed, else -1. */
  add(mass: number): number {
    this.mass += mass;
    let crossed = -1;
    while (this.tier + 1 < TIERS.length && this.mass >= TIERS[this.tier + 1].mass) {
      this.tier++;
      crossed = this.tier;
    }
    if (crossed >= 0) this.radius = TIERS[this.tier].radius;
    return crossed;
  }

  get name() {
    return TIERS[this.tier].name;
  }

  get isMax() {
    return this.tier >= TIERS.length - 1;
  }

  /** 0..1 toward the next tier — drives the HUD growth meter. */
  get progress(): number {
    if (this.isMax) return 1;
    const from = TIERS[this.tier].mass;
    const to = TIERS[this.tier + 1].mass;
    return Math.min(1, (this.mass - from) / (to - from));
  }

  get nextRadius() {
    return TIERS[Math.min(this.tier + 1, TIERS.length - 1)].radius;
  }

  reset() {
    this.tier = 0;
    this.mass = 0;
    this.radius = TIERS[0].radius;
  }
}
