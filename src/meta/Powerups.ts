/**
 * Consumable power-ups.
 *
 * Deliberately a different currency from the upgrade draft, and a different
 * shape. A draft card is permanent, passive and free — it makes every future
 * run a bit better and you never think about it again. A power-up is spent,
 * active and costs gold: you decide *when*, the run visibly changes for a few
 * seconds, and then it is gone. One is progression, the other is agency, and a
 * casual game wants both.
 *
 * Everyone gets a handful free. That is not generosity — a consumable nobody
 * has ever used is a button nobody understands, and a shop entry for a button
 * nobody understands does not sell. The free charges exist so the first
 * purchase is a decision to have *more* of something you already like, which is
 * the only kind of purchase that feels good.
 */

import { save } from '../core/Save';

export type PowerupId = 'magnet' | 'grow';

export interface PowerupDef {
  id: PowerupId;
  name: string;
  /** One emoji; the in-run buttons are thumb-sized and an icon reads faster. */
  icon: string;
  /** What it does, in the player's words. */
  blurb: string;
  /** Charges a brand-new save is seeded with, once, for nothing. */
  free: number;
  /** Gold for one bundle. */
  price: number;
  /** Charges per purchase. */
  bundle: number;
}

export const POWERUPS: PowerupDef[] = [
  {
    id: 'magnet',
    name: 'Magnetic Pull',
    icon: '🧲',
    blurb: 'Every loose thing nearby swirls in and sticks. Trees and buildings stay put.',
    free: 3,
    // Thirty gold a charge, against roughly 170 from a good run. Cheap enough
    // to use without agonising, dear enough that spamming it costs you a skin.
    price: 90,
    bundle: 3,
  },
  {
    id: 'grow',
    name: 'Size Up',
    icon: '⏫',
    blurb: 'Jump straight to the next size, whatever the ball has eaten so far.',
    free: 1,
    // Pricier per charge: skipping a tier is the strongest thing you can buy,
    // and near the top it can hand you the run's finish outright.
    price: 100,
    bundle: 1,
  },
];

const BY_ID = new Map(POWERUPS.map((p) => [p.id, p]));

export const powerupById = (id: string) => BY_ID.get(id as PowerupId);

/**
 * Charges in hand.
 *
 * An absent key is not zero — it means this save has never been offered this
 * power-up, and the free grant is due. That is what makes the grant work for
 * players whose save predates the feature, and for power-ups added later,
 * without a migration or a "seeded" flag to keep in sync. Spending writes an
 * explicit number, so a player who has burned all three magnets stays at zero.
 */
export function chargesOf(id: PowerupId): number {
  const stored = save.meta.powerups[id];
  return stored === undefined ? BY_ID.get(id)?.free ?? 0 : stored;
}

/**
 * Spends one charge.
 *
 * @returns false and spends nothing when the player has none, so callers can
 *          treat a refusal as "offer the shop" rather than having to pre-check.
 */
export function spendCharge(id: PowerupId): boolean {
  const have = chargesOf(id);
  if (have <= 0) return false;
  save.setCharges(id, have - 1);
  return true;
}

/** @returns false (and spends nothing) if the player cannot afford the bundle. */
export function buyPowerup(id: PowerupId): boolean {
  const def = BY_ID.get(id);
  if (!def || !save.spendGold(def.price)) return false;
  save.setCharges(id, chargesOf(id) + def.bundle);
  return true;
}
