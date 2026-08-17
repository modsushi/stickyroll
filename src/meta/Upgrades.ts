/**
 * Permanent upgrades and the mid-run draft that grants them.
 *
 * The loop: halfway through every run the game pauses and offers three cards.
 * You take one, and it is yours for good — the next run starts with it already
 * applied. One pick per run, ten upgrades, five ranks each, so the catalogue is
 * fifty picks deep and no single session comes close to exhausting it.
 *
 * Two rules keep it from collapsing:
 *
 *  - **Every card is a gain.** Nothing here is a trade-off or a downside, and
 *    nothing is a dud. A draft where one of the three options is obviously
 *    worthless is really a draft of two, and the player learns to resent the
 *    third slot.
 *  - **Later upgrades unlock by player level.** At level 1 the pool is four
 *    simple, legible perks; the fiddlier ones (starting mass, end-of-run
 *    bonuses) appear once the player has enough runs behind them to know what
 *    those words mean. That is what makes levelling up worth something beyond a
 *    number going up.
 *
 * Effects are read live through `perks()` rather than baked in at run start, so
 * a card taken mid-run applies to the second half of that same run. Taking
 * Overtime and immediately watching the clock jump is the single most
 * satisfying moment in the draft, and it costs nothing to allow.
 */

import { save } from '../core/Save';
import { playerLevel } from './Progression';

export interface UpgradeDef {
  id: string;
  name: string;
  /** One emoji; the cards are small and an icon reads faster than a label. */
  icon: string;
  /** What it does, in the player's words. `{v}` is replaced by the rank value. */
  blurb: string;
  maxRank: number;
  /** Player level required before this can appear in a draft. */
  unlock: number;
  /** Value added per rank; meaning depends on the upgrade. */
  per: number;
  /** Renders the value at a given rank for the card and the shop list. */
  format: (rank: number) => string;
}

const pct = (per: number) => (rank: number) => `+${Math.round(per * rank * 100)}%`;

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'score',
    name: 'Big Numbers',
    icon: '✨',
    blurb: '{v} score from everything you eat',
    maxRank: 5,
    unlock: 1,
    per: 0.08,
    format: pct(0.08),
  },
  {
    id: 'speed',
    name: 'Greased Wheels',
    icon: '💨',
    blurb: '{v} rolling speed',
    maxRank: 5,
    unlock: 1,
    per: 0.05,
    format: pct(0.05),
  },
  {
    id: 'time',
    name: 'Overtime',
    icon: '⏰',
    blurb: '{v} on the clock',
    maxRank: 5,
    unlock: 1,
    per: 8,
    format: (r) => `+${8 * r}s`,
  },
  {
    id: 'combo',
    name: 'Chain Keeper',
    icon: '🔗',
    blurb: 'Combos last {v} longer',
    maxRank: 5,
    unlock: 1,
    per: 0.12,
    format: pct(0.12),
  },
  {
    id: 'reach',
    name: 'Magnetism',
    icon: '🧲',
    blurb: '{v} pickup reach',
    maxRank: 5,
    unlock: 2,
    per: 0.07,
    format: pct(0.07),
  },
  {
    id: 'gold',
    name: 'Gold Rush',
    icon: '💰',
    blurb: '{v} gold from every run',
    maxRank: 5,
    unlock: 3,
    per: 0.1,
    format: pct(0.1),
  },
  {
    id: 'mass',
    name: 'Snowballing',
    icon: '⛄',
    blurb: 'Grow {v} faster',
    maxRank: 5,
    unlock: 4,
    per: 0.06,
    format: pct(0.06),
  },
  {
    id: 'start',
    name: 'Head Start',
    icon: '🚀',
    blurb: 'Begin each run with {v} mass',
    maxRank: 5,
    unlock: 5,
    per: 90,
    format: (r) => `${90 * r}`,
  },
  {
    id: 'finale',
    name: 'Grand Finale',
    icon: '🎆',
    blurb: '{v} time and set bonuses',
    maxRank: 5,
    unlock: 6,
    per: 0.4,
    format: pct(0.4),
  },
  {
    id: 'daily',
    name: 'Lucky Day',
    icon: '🍀',
    blurb: '{v} from daily rewards',
    maxRank: 5,
    unlock: 8,
    per: 0.15,
    format: pct(0.15),
  },
];

const BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

export const upgradeById = (id: string) => BY_ID.get(id);

/** Rank currently owned, 0 if never taken. */
export const rankOf = (id: string) => save.meta.upgrades[id] ?? 0;

export const isMaxed = (u: UpgradeDef) => rankOf(u.id) >= u.maxRank;

/** Total ranks taken across everything — the "picks made" counter. */
export const totalRanks = () =>
  Object.values(save.meta.upgrades).reduce((n, r) => n + r, 0);

/** Grants one rank. Returns the new rank, or 0 if it was already maxed. */
export function grantUpgrade(id: string): number {
  const def = BY_ID.get(id);
  if (!def) return 0;
  const next = rankOf(id) + 1;
  if (next > def.maxRank) return 0;
  save.meta.upgrades[id] = next;
  save.flush();
  invalidatePerks();
  return next;
}

/**
 * Picks the cards for one draft.
 *
 * Weighted toward upgrades the player has *fewer* ranks in, which quietly keeps
 * the build broad without ever forbidding a choice — someone determined to max
 * one line still can, it just takes longer to be offered. Unowned upgrades get
 * the strongest pull, because seeing something genuinely new is the part of a
 * draft that people remember.
 */
export function draftUpgrades(count = 3): UpgradeDef[] {
  const level = playerLevel();
  const pool = UPGRADES.filter((u) => u.unlock <= level && !isMaxed(u));
  // Everything the player is eligible for is already maxed: fall back to the
  // full list minus maxed, so the draft never comes up empty. If literally all
  // fifty ranks are taken there are no cards, and the caller skips the screen.
  const source = pool.length ? pool : UPGRADES.filter((u) => !isMaxed(u));

  const picks: UpgradeDef[] = [];
  const remaining = [...source];
  while (picks.length < count && remaining.length) {
    const weights = remaining.map((u) => (rankOf(u.id) === 0 ? 3 : 1 / (1 + rankOf(u.id))));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let i = 0;
    while (i < weights.length - 1 && roll > weights[i]) roll -= weights[i++];
    picks.push(remaining[i]);
    remaining.splice(i, 1);
  }
  return picks;
}

// ── applied effects ───────────────────────────────────────────────────────

export interface Perks {
  /** Multiplies every points award. */
  scoreMult: number;
  /** Multiplies top speed and acceleration together, so handling is unchanged. */
  speedMult: number;
  /** Seconds added to the level's clock. */
  extraTime: number;
  /** Multiplies the combo window. */
  comboMult: number;
  /** Multiplies the absorb reach. */
  reachMult: number;
  /** Multiplies gold earned from a run's score. */
  goldMult: number;
  /** Multiplies mass gained, so tiers arrive sooner. */
  massMult: number;
  /** Mass granted at the start of a run. */
  startMass: number;
  /** Multiplies the end-of-run time and set bonuses. */
  finaleMult: number;
  /** Multiplies daily reward gold. */
  dailyMult: number;
}

/**
 * Reads the owned ranks into one flat set of numbers.
 *
 * Called from the hot path — `Score.award` per pickup, `Ball.step` and
 * `Sticking.update` per frame — so the result is cached and only rebuilt when
 * something invalidates it. Ten object lookups per pickup would not have
 * mattered; ten per frame per system would.
 *
 * Invalidation is an explicit counter rather than "did the rank total change".
 * The total is not a safe fingerprint: a reset takes it back to a number it has
 * already been, and the cache would happily serve the pre-reset perks.
 */
let cached: Perks | null = null;

export function invalidatePerks() {
  cached = null;
}

export function perks(): Perks {
  if (cached) return cached;
  const v = (id: string) => rankOf(id) * (BY_ID.get(id)?.per ?? 0);
  cached = {
    scoreMult: 1 + v('score'),
    speedMult: 1 + v('speed'),
    extraTime: v('time'),
    comboMult: 1 + v('combo'),
    reachMult: 1 + v('reach'),
    goldMult: 1 + v('gold'),
    massMult: 1 + v('mass'),
    startMass: v('start'),
    finaleMult: 1 + v('finale'),
    dailyMult: 1 + v('daily'),
  };
  return cached;
}
