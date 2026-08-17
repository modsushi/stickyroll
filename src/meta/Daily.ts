/**
 * Daily rewards.
 *
 * Seven days on a loop, escalating steeply toward the end so that the seventh
 * claim is worth roughly as much as the first four combined. That shape is the
 * whole mechanism: the reason to come back on day 5 is day 7.
 *
 * Deliberately gentle about breaking the streak. Missing a day sends you back
 * to day 1 rather than wiping anything you own, and the game never nags — there
 * is no notification, no penalty, and the button simply isn't there when there
 * is nothing to claim. A daily reward that punishes you for having a life is a
 * daily reason to stop playing.
 *
 * Dates are compared as **local** calendar days, not elapsed hours. "Come back
 * tomorrow" has to mean what the player's calendar says, and a 24-hour timer
 * started at 11pm means they have to play later every single day to keep a
 * streak — a well-documented way to make a reward feel like a chore.
 */

import { save } from '../core/Save';
import { perks } from './Upgrades';

/** Gold for each day of the cycle. */
export const DAILY_GOLD = [60, 90, 130, 180, 250, 350, 600];

export const CYCLE = DAILY_GOLD.length;

/** Local YYYY-MM-DD. Deliberately not ISO/UTC — see the file header. */
export function dayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dayKey(d);
}

export interface DailyState {
  /** True when today's reward has not been taken yet. */
  claimable: boolean;
  /** 0-based index into the cycle that the *next* claim will pay out. */
  index: number;
  /** Consecutive days already claimed. */
  streak: number;
  /** Gold the next claim is worth, upgrades included. */
  amount: number;
  /** True when the streak will restart because a day was missed. */
  broken: boolean;
}

export function dailyState(): DailyState {
  const meta = save.meta;
  const today = dayKey();
  const claimable = meta.lastClaim !== today;
  const continues = meta.lastClaim === yesterdayKey() || meta.lastClaim === today;
  const broken = claimable && meta.lastClaim !== '' && !continues;

  // If today is already claimed the cycle shows the day just taken as the
  // current one; otherwise it shows the day about to be taken.
  const nextStreak = claimable ? (continues ? meta.streak + 1 : 1) : meta.streak;
  const index = (Math.max(1, nextStreak) - 1) % CYCLE;

  return {
    claimable,
    index,
    streak: nextStreak,
    amount: Math.round(DAILY_GOLD[index] * perks().dailyMult),
    broken,
  };
}

/** @returns gold awarded, or 0 if today was already claimed. */
export function claimDaily(): number {
  const state = dailyState();
  if (!state.claimable) return 0;
  save.meta.lastClaim = dayKey();
  save.meta.streak = state.streak;
  save.addGold(state.amount);
  return state.amount;
}
