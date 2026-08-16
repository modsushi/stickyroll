/**
 * Typed event bus. Systems that need to react to gameplay (audio, HUD, particles)
 * subscribe here instead of being wired into the simulation, so the game loop
 * stays readable and juice can be added without touching physics.
 */

import type { PropDef } from '../data/props';

export interface GameEvents {
  /** A prop was absorbed. `screen` is already projected for the popup layer. */
  stick: { def: PropDef; points: number; combo: number; world: { x: number; y: number; z: number } };
  /** Ball hit something too big to eat. */
  reject: { def: PropDef; speed: number };
  /** Growth crossed a tier boundary. */
  tierUp: { tier: number; radius: number; prevRadius: number };
  /** A level collectible was picked up. */
  collect: { slot: 0 | 1; kind: string; count: number; target: number };
  /** All of one collectible set was gathered. */
  collectComplete: { slot: 0 | 1; kind: string };
  comboChange: { combo: number; best: number };
  scoreChange: { score: number; delta: number };
  timeUp: void;
  /** Level ended; payload feeds the results screen. */
  levelEnd: {
    score: number;
    stars: number;
    bestCombo: number;
    absorbed: number;
    tier: number;
    collected: { kind: string; label: string; count: number; target: number }[];
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
