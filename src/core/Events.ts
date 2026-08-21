/**
 * Typed event bus. Systems that need to react to gameplay (audio, HUD, particles)
 * subscribe here instead of being wired into the simulation, so the game loop
 * stays readable and juice can be added without touching physics.
 */

import type { PropDef } from '../data/props';
import type { PropInstance } from '../game/city/Props';

export interface GameEvents {
  /** A prop was absorbed. `screen` is already projected for the popup layer. */
  stick: { def: PropDef; points: number; combo: number; world: { x: number; y: number; z: number } };
  /** Ball hit something too big to eat. */
  reject: { def: PropDef; speed: number };
  /**
   * A building the ball is now big enough to level came within range, or left
   * it again. The pair drives the highlight; the demolition itself is
   * `demolish`, which may or may not follow.
   *
   * The payload is the live `PropInstance` rather than a copy because the
   * effect needs the thing's geometry, material and exact placement to draw an
   * outline over it — and because identity is what pairs a lock with its
   * release. Type-only import, so nothing in `core/` depends on `game/` at
   * runtime.
   */
  lockOn: { prop: PropInstance };
  lockOff: { prop: PropInstance };
  /**
   * A building was rolled over. Fired from the absorb path *after* the weld, so
   * by the time anything sees this the prop is already hidden and riding the
   * ball — the effect is drawing its funeral, not its last moment.
   *
   * `power` is 0..1 by size, and drives how loud, low and long every part of
   * the demolition is.
   */
  demolish: {
    prop: PropInstance;
    impact: { x: number; z: number };
    power: number;
    /** The ball's visual radius at the moment of impact. */
    ballRadius: number;
  };
  /** A decorative block tower burst into loose, passable pieces. */
  blockCrumble: { blocks: number };
  /** Growth crossed a tier boundary. */
  tierUp: { tier: number; radius: number; prevRadius: number };
  /**
   * The ball reached the top tier, so the run is on its victory lap and will
   * finish in `seconds`. Announced separately from `tierUp` because it is a
   * different message: the first says you grew, this one says you won.
   */
  finaleStart: { seconds: number };
  /** Victory-lap countdown, once per simulation step while it runs. */
  finaleTick: { secondsLeft: number };
  /** A level collectible was picked up. */
  collect: { slot: 0 | 1; kind: string; count: number; target: number };
  /** All of one collectible set was gathered. */
  collectComplete: { slot: 0 | 1; kind: string };
  comboChange: { combo: number; best: number };
  scoreChange: { score: number; delta: number };
  timeUp: void;
  /**
   * The run reached its halfway mark and the player is owed an upgrade pick.
   * Fired once per run; the screen flow pauses the game and shows the draft.
   */
  rewardOffer: void;
  /** A permanent upgrade was taken, so anything showing perks should refresh. */
  upgradeTaken: { id: string; rank: number };
  /** A consumable power-up fired. The HUD repaints its charge count off this. */
  powerupUsed: { id: string };
  /**
   * The player pressed a power-up button. A request, not a fact — the screen
   * flow decides whether it fires, or whether an empty one opens the shop.
   */
  powerupRequest: { id: string };
  /** The player pressed the in-run shop button. */
  shopRequest: void;
  /** Charges changed for some other reason — a purchase, or a fresh run. */
  powerupChange: void;
  /** Gold balance changed — spent, earned or claimed. */
  goldChange: { gold: number; delta: number };
  /** Level ended; payload feeds the results screen. */
  levelEnd: {
    /** True when the level's clear objective was met before time expired. */
    completed: boolean;
    /** Id of the next level in play order, when it is unlocked and playable. */
    next?: string;
    /** True when *this* run is what unlocked it — worth a line on the screen. */
    newlyUnlocked: boolean;
    score: number;
    stars: number;
    bestCombo: number;
    absorbed: number;
    tier: number;
    collected: { kind: string; label: string; count: number; target: number }[];
    /** Gold this run is worth, waiting to be claimed on the results screen. */
    gold: number;
    /** Experience already banked; the results screen only animates it. */
    xp: number;
  };
  /** Someone asked to pause (HUD button, tab hidden). A request, not a fact. */
  pauseRequest: void;
  /** The game's pause state actually changed. A notification, never a request. */
  pause: { paused: boolean };
  /** Emitted once assets are ready and the first frame has rendered. */
  ready: void;
}

type Handler<T> = (payload: T) => void;

export class EventBus<E> {
  private map = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(key: K, fn: Handler<E[K]>): () => void {
    let set = this.map.get(key);
    if (!set) this.map.set(key, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => void set!.delete(fn as Handler<never>);
  }

  once<K extends keyof E>(key: K, fn: Handler<E[K]>): () => void {
    const off = this.on(key, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  emit<K extends keyof E>(key: K, payload: E[K]): void {
    const set = this.map.get(key);
    if (!set) return;
    // Copy so a handler unsubscribing mid-dispatch can't skip its neighbour.
    for (const fn of [...set]) (fn as Handler<E[K]>)(payload);
  }

  clear() {
    this.map.clear();
  }
}

export const bus = new EventBus<GameEvents>();
