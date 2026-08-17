/**
 * Score and combo.
 *
 * The combo is the game's dopamine spine: every pickup inside the window bumps
 * a counter that both multiplies points and raises the pitch of the pickup
 * chime. Chasing a rising pitch is a stronger pull than chasing a number, which
 * is exactly the trick slot machines use — so the audio and the multiplier are
 * driven from the same value on purpose.
 *
 * The window is generous (and *grows* slightly with the combo) so that a good
 * run through a dense street doesn't die on one thin patch of road.
 */

import { bus } from '../core/Events';
import { save } from '../core/Save';
import { perks } from '../meta/Upgrades';

/**
 * The window has to be short enough that *stopping* breaks the chain. Tuned
 * against real runs: at 2.6s a competent player never dropped a combo for a
 * whole three-minute level, which turns the multiplier into a constant and
 * throws away the tension the system exists to create.
 */
const BASE_WINDOW = 1.1;
const MAX_WINDOW = 1.7;
/** Pickups per combo tier. Each tier is a multiplier step and a pitch step. */
const PER_TIER = 8;
/** Multiplier steps, indexed by combo tier. Reaching the top is a real run. */
const MULT_AT = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export class Score {
  score = 0;
  combo = 0;
  bestCombo = 0;
  absorbed = 0;
  private timer = 0;

  get multiplier() {
    return MULT_AT[Math.min(this.comboTier, MULT_AT.length - 1)];
  }

  /** Combo tier drives both the multiplier and the pickup chime's pitch. */
  get comboTier() {
    return Math.floor(this.combo / PER_TIER);
  }

  /**
   * The Chain Keeper upgrade scales the whole window, ceiling included. Leaving
   * MAX_WINDOW fixed would have made the upgrade quietly stop working once the
   * combo was a few tiers deep — the exact moment the player is relying on it.
   */
  get window() {
    const mult = perks().comboMult;
    return Math.min(MAX_WINDOW * mult, (BASE_WINDOW + this.comboTier * 0.07) * mult);
  }

  /** Fraction of the combo window remaining — the HUD ring drains with this. */
  get comboFraction() {
    return this.combo > 0 ? Math.max(0, this.timer / this.window) : 0;
  }

  /** @returns points awarded, already multiplied. */
  award(basePoints: number, propId: string): number {
    this.combo++;
    this.absorbed++;
    this.timer = this.window;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    bus.emit('comboChange', { combo: this.combo, best: this.bestCombo });

    const points = Math.max(1, Math.round(basePoints * this.multiplier * perks().scoreMult));
    this.score += points;
    save.addToCollection(propId);
    bus.emit('scoreChange', { score: this.score, delta: points });
    return points;
  }

  update(dt: number) {
    if (this.combo === 0) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0;
      this.combo = 0;
      bus.emit('comboChange', { combo: 0, best: this.bestCombo });
    }
  }

  /** Bonus applied at level end for unspent time and completed sets. */
  addBonus(points: number) {
    this.score += points;
    bus.emit('scoreChange', { score: this.score, delta: points });
  }

  reset() {
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.absorbed = 0;
    this.timer = 0;
  }
}
