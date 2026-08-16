/**
 * The two per-level collection sets shown on the HUD cards.
 *
 * When one is absorbed we don't just increment a counter — a ghost copy of the
 * model detaches, arcs across the screen to its card, and the card punches. That
 * flight is the whole reason collectibles feel different from ordinary points:
 * it draws the eye to the card, so the player learns the goal without a tutorial.
 *
 * The flight is simulated here in world space and projected by the HUD, which
 * keeps it correct through camera moves and screen rotations.
 */

import { Vector3 } from 'three';
import { bus } from '../core/Events';
import { clamp01, easeInCubic, easeOutCubic } from '../core/Math';
import type { LevelDef } from '../levels/types';
import type { BuiltCity } from './city/CityBuilder';
import type { PropInstance } from './city/Props';

export interface Flight {
  slot: 0 | 1;
  /** World position, updated each frame until it reaches the card. */
  pos: Vector3;
  from: Vector3;
  t: number;
  duration: number;
  /** Arc apex height. */
  lift: number;
  done: boolean;
}

interface SetState {
  prop: string;
  label: string;
  target: number;
  count: number;
  complete: boolean;
  /** How many exist in the level, for the "12/20 found" readout. */
  available: number;
}

export class Collectibles {
  readonly sets: [SetState, SetState];
  readonly flights: Flight[] = [];

  constructor(
    level: LevelDef,
    city: BuiltCity
  ) {
    this.sets = level.collectibles.map((c) => ({
      prop: c.prop,
      label: c.label,
      target: c.target,
      count: 0,
      complete: false,
      available: city.byProp.get(c.prop)?.length ?? 0,
    })) as [SetState, SetState];
  }

  /** Called by the sticking system for every absorbed prop. */
  onAbsorb(propId: string, inst: PropInstance) {
    for (let i = 0; i < 2; i++) {
      const set = this.sets[i];
      if (set.prop !== propId || set.complete) continue;

      set.count++;
      const slot = i as 0 | 1;

      this.flights.push({
        slot,
        pos: new Vector3(inst.x, inst.y + 0.6, inst.z),
        from: new Vector3(inst.x, inst.y + 0.6, inst.z),
        t: 0,
        duration: 0.62,
        lift: 2.6,
        done: false,
      });

      bus.emit('collect', {
        slot,
        kind: set.prop,
        count: Math.min(set.count, set.target),
        target: set.target,
      });

      if (set.count >= set.target) {
        set.complete = true;
        bus.emit('collectComplete', { slot, kind: set.prop });
      }
      return;
    }
  }

  step(dt: number) {
    void dt;
  }

  /**
   * Advances flights. The world position only handles the launch arc; the HUD
   * blends it toward the card's screen position over the second half, which is
   * what lets a 3D object land precisely on a 2D UI element.
   */
  render(dt: number) {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt / f.duration;
      if (f.t >= 1) {
        f.done = true;
        this.flights.splice(i, 1);
        continue;
      }
      const t = clamp01(f.t);
      // Rise fast, then hang — the hang is what makes the eye follow it.
      f.pos.y = f.from.y + easeOutCubic(Math.min(1, t * 1.8)) * f.lift - easeInCubic(t) * 0.4;
      f.pos.x = f.from.x;
      f.pos.z = f.from.z;
    }
  }

  get completedSets() {
    return this.sets.reduce((n, s) => n + (s.complete ? 1 : 0), 0);
  }

  summary() {
    return this.sets.map((s) => ({
      kind: s.prop,
      label: s.label,
      count: Math.min(s.count, s.target),
      target: s.target,
    }));
  }
}
