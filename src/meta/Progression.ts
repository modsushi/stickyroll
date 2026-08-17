/**
 * Player level, experience and the score-to-gold exchange.
 *
 * There are two currencies and they do different jobs, which is the whole point
 * of having both:
 *
 *  - **XP** is unspendable. It only ever goes up, and crossing a level is what
 *    unlocks new *kinds* of upgrade in the mid-run draft and new skins in the
 *    shop. It is the reason to keep playing after you can already afford
 *    everything.
 *  - **Gold** is spendable and therefore always in tension: every purchase is a
 *    choice not to buy something else. It comes from run scores and the daily
 *    claim, so both a good run and simply coming back tomorrow move you
 *    forward.
 *
 * Ten levels is the brief, and the curve is calibrated against the real level:
 * `downtown-01` runs 180 seconds with star thresholds at 4.5k / 12k / 26k, so a
 * competent run scores around 20-30k. At the rates below that is ~2,600 XP and
 * ~210 gold a run, which puts level 10 about eighteen runs out and the most
 * expensive skin about eight. Long enough to be a goal, short enough to be
 * reachable in a week of casual play.
 */

import { save } from '../core/Save';

/** XP needed to advance *from* each level. Index 0 is level 1 -> 2. */
const STEP = [1200, 1800, 2600, 3600, 4800, 6200, 7800, 9600, 11600];

export const MAX_LEVEL = STEP.length + 1;

/**
 * Cumulative XP at the start of each level, derived rather than written out —
 * the two lists drifting apart is exactly the kind of bug nobody notices until
 * a player's level silently moves.
 */
const CUM = STEP.reduce<number[]>((acc, step) => [...acc, acc[acc.length - 1] + step], [0]);

/**
 * A title per level. Names are sizes rather than ranks ("Novice/Expert" implies
 * skill, which is not what this measures) and they deliberately overlap the
 * in-run tier names, so the meta-progression reads as the same fantasy.
 */
export const LEVEL_TITLES = [
  'Rookie Roller',
  'Street Sweeper',
  'Block Buster',
  'Yard Wrecker',
  'District Menace',
  'Skyline Sweeper',
  'City Shaker',
  'Metro Crusher',
  'Continental',
  'Planetary',
];

export interface LevelState {
  /** 1-based. */
  level: number;
  title: string;
  /** XP earned inside the current level. */
  into: number;
  /** XP the current level needs in total; 0 at max level. */
  need: number;
  /** 0..1 through the current level; 1 at max. */
  progress: number;
  maxed: boolean;
}

export function levelFromXp(xp: number): LevelState {
  let level = 1;
  while (level < MAX_LEVEL && xp >= CUM[level]) level++;
  const maxed = level >= MAX_LEVEL;
  const into = xp - CUM[level - 1];
  const need = maxed ? 0 : STEP[level - 1];
  return {
    level,
    title: LEVEL_TITLES[level - 1],
    into,
    need,
    progress: maxed ? 1 : Math.min(1, into / need),
    maxed,
  };
}

/** The player's current level, read straight from the save. */
export const playerLevel = () => levelFromXp(save.meta.xp).level;

export const playerState = () => levelFromXp(save.meta.xp);

/**
 * XP for a finished run.
 *
 * Score dominates, but the flat per-tier and per-star terms matter more than
 * they look: they mean a short, badly-scoring run still moves the bar, which is
 * what stops a bad session feeling like wasted time.
 */
export function xpFromRun(score: number, tier: number, stars: number): number {
  return Math.round(score * 0.1 + tier * 60 + stars * 120);
}

/**
 * Gold for a finished run, before the Gold Rush upgrade.
 *
 * Divisor chosen so a three-star run pays for a mid-priced skin in three or
 * four sessions rather than one — a shop where everything is affordable
 * immediately has nothing to want.
 */
export function goldFromScore(score: number, multiplier = 1): number {
  return Math.max(1, Math.round((score / 120) * multiplier));
}
