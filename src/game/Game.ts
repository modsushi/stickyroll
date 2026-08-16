/**
 * Orchestrates a level run: owns the world, the ball, and the systems that
 * connect them. Everything that produces feedback (audio, HUD, particles)
 * listens on the event bus instead of being called from here, so this file
 * stays a readable description of the simulation.
 */

import { Vector3 } from 'three';
import { assets } from '../core/Assets';
import { bus } from '../core/Events';
import { Input } from '../core/Input';
import { save } from '../core/Save';
import { PROPS, catalogModels, resolveProps, type KitId } from '../data/props';
import { DOWNTOWN } from '../levels/downtown-01';
import type { LevelDef } from '../levels/types';
import { FollowCamera } from '../render/Camera';
import type { Renderer } from '../render/Renderer';
import { Ball } from './Ball';
import { BallBaker } from './BallBaker';
import { CityBuilder, ROAD_MODELS, type BuiltCity } from './city/CityBuilder';
import { Collectibles } from './Collectibles';
import { Pedestrians } from './city/Pedestrians';
import { Traffic } from './city/Traffic';
import { Score } from './Score';
import { Sticking, type Award } from './Sticking';
import { TIERS } from './Growth';
import { Decals } from '../render/Decals';
import { Particles } from '../render/Particles';

const _dirScreen = { x: 0, y: 0 };
const _dirWorld = new Vector3();

export type GameState = 'loading' | 'ready' | 'playing' | 'paused' | 'ended';

export class Game {
  state: GameState = 'loading';
  readonly ball = new Ball();
  readonly score = new Score();
  readonly camera: FollowCamera;

  level: LevelDef = DOWNTOWN;
  city!: BuiltCity;
  private baker!: BallBaker;
  private sticking!: Sticking;
  private traffic!: Traffic;
  private peds!: Pedestrians;
  private collectibles!: Collectibles;
  private decals!: Decals;
  private particles!: Particles;

  timeLeft = 0;
  private lastCountdown = -1;

  constructor(
    private renderer: Renderer,
    private input: Input
  ) {
    this.camera = new FollowCamera(renderer.camera);
  }

  /** Loads every model the catalog and level need. */
  async load(onProgress?: (p: number) => void) {
    const models = new Map<string, { kit: KitId; model: string }>();
    const want = (kit: KitId, model: string) => models.set(`${kit}/${model}`, { kit, model });

    for (const m of catalogModels()) want(m.kit, m.model);
    for (const m of ROAD_MODELS) want('roads', m);
    for (const m of this.level.commercial.models) want('commercial', m);
    for (const m of this.level.suburban.models) want('suburban', m);
    const sky = this.level.surround?.skyline;
    if (sky) for (const m of sky.models) want(sky.kit, m);
    for (const m of Traffic.MODELS) want('cars', m);
    for (const m of Pedestrians.MODELS) want('characters', m);

    const list = [...models.values()];
    let done = 0;

    // allSettled, not all. `Promise.all` rejects the moment any single model
    // fails, which would let `resolveProps` run while the rest are still in
    // flight — and a catalog resolved against unloaded models yields a city
    // with no props at all. One missing GLB must cost us that one prop, not
    // the entire level.
    const results = await Promise.allSettled(
      list.map((m) =>
        assets.load(m.kit, m.model).finally(() => {
          done++;
          onProgress?.(done / list.length);
        })
      )
    );

    const failed = results.filter((r) => r.status === 'rejected');
    for (const f of failed) console.warn('[assets]', (f as PromiseRejectedResult).reason);
    if (failed.length === list.length) {
      throw new Error(`no models could be loaded (${list.length} failed)`);
    }

    resolveProps((kit, model) => (assets.has(kit, model) ? assets.get(kit, model) : undefined));

    if (Object.keys(PROPS).length === 0) {
      throw new Error('prop catalog resolved empty — every model failed to load');
    }
  }

  /** Builds the world. Safe to call again to restart the level. */
  begin() {
    const scene = this.renderer.scene;
    if (this.city) this.teardown();

    this.city = new CityBuilder(this.level).build();
    scene.add(this.city.group);

    this.baker = new BallBaker(this.ball.spinner);
    this.sticking = new Sticking(this.ball, this.baker, this.city.hash);
    this.traffic = new Traffic(this.level, this.city);
    this.peds = new Pedestrians(this.level, this.city);
    this.collectibles = new Collectibles(this.level, this.city);
    this.decals = new Decals(this.city);
    this.particles = new Particles();

    scene.add(this.traffic.group, this.peds.group, this.decals.group, this.particles.group);
    scene.add(this.ball.group);

    this.ball.reset();
    this.ball.pos.set(this.city.start.x, this.ball.radius, this.city.start.z);
    this.score.reset();
    this.timeLeft = this.level.time;
    this.lastCountdown = -1;
    // `end()` disables input so the results screen can't be played behind.
    // A fresh run has to hand it back, or Play Again deals you a ball that
    // ignores every drag.
    this.input.enabled = true;

    this.camera.snapTo(this.ball.pos, this.ball.radius);
    this.state = 'ready';
  }

  start() {
    if (this.state === 'ready' || this.state === 'paused') this.state = 'playing';
  }

  setPaused(paused: boolean) {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    this.state = paused ? 'paused' : 'playing';
    this.input.enabled = !paused;
    bus.emit('pause', { paused });
  }

  /** Fixed-step simulation. */
  step(dt: number) {
    if (this.state !== 'playing') return;

    this.input.direction(_dirScreen);
    this.camera.screenToWorld(_dirScreen.x, _dirScreen.y, _dirWorld);
    this.ball.step(_dirWorld, dt);

    const b = this.city.bounds;
    this.ball.clampToBounds(b.minX, b.minZ, b.maxX, b.maxZ);

    this.traffic.step(dt, this.ball);
    this.peds.step(dt, this.ball);

    const before = this.ball.growth.tier;
    this.sticking.update((p, def): Award => {
      const points = this.score.award(def.points, def.id);
      this.collectibles.onAbsorb(def.id, p);
      const crossed = this.ball.growth.add(def.mass);
      if (crossed >= 0) this.onTierUp(crossed);
      return { points, combo: this.score.comboTier };
    });
    if (this.ball.growth.tier !== before) this.ball.beginGrow();

    this.sticking.tick(dt);
    this.score.update(dt);
    this.collectibles.step(dt);

    this.timeLeft -= dt;
    const secs = Math.ceil(this.timeLeft);
    if (secs <= 10 && secs !== this.lastCountdown && secs > 0) {
      this.lastCountdown = secs;
      bus.emit('timeUp', undefined as never);
    }
    if (this.timeLeft <= 0) this.end();
  }

  private onTierUp(tier: number) {
    const prev = TIERS[Math.max(0, tier - 1)].radius;
    this.baker.prune(TIERS[tier].radius);
    this.ball.beginGrow();
    this.camera.punch(0.85);
    this.camera.shake(0.5);
    bus.emit('tierUp', { tier, radius: TIERS[tier].radius, prevRadius: prev });
  }

  /** Render-rate update: visuals only, safe to run at any framerate. */
  render(dt: number) {
    this.ball.render(dt);
    this.baker?.update(dt);
    this.camera.update(this.ball.pos, this.ball.vel, this.ball.visualRadius, dt);
    this.renderer.focusShadow(this.ball.pos, this.ball.visualRadius);
    this.traffic?.render(dt);
    this.peds?.render(dt);
    this.decals?.update(this.ball);
    this.particles?.update(dt);
    this.collectibles?.render(dt);
  }

  end() {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.input.enabled = false;

    // Time bonus rewards finishing early on a cleared street; set bonuses reward
    // completing a collection.
    const timeBonus = Math.max(0, Math.floor(this.timeLeft) * 10);
    const setBonus = this.collectibles.completedSets * 2500;
    if (timeBonus + setBonus > 0) this.score.addBonus(timeBonus + setBonus);

    const stars = this.level.stars.reduce((n, t) => (this.score.score >= t ? n + 1 : n), 0);
    save.recordLevel(this.level.id, this.score.score, stars, this.score.bestCombo);

    bus.emit('levelEnd', {
      score: this.score.score,
      stars,
      bestCombo: this.score.bestCombo,
      absorbed: this.score.absorbed,
      tier: this.ball.growth.tier,
      collected: this.collectibles.summary(),
    });
  }

  private teardown() {
    const scene = this.renderer.scene;
    this.baker?.clear();
    this.traffic?.dispose();
    this.peds?.dispose();
    this.particles?.dispose();
    scene.remove(
      this.city.group,
      this.traffic.group,
      this.peds.group,
      this.decals.group,
      this.particles.group,
      this.ball.group
    );
    this.city.props.clear();
  }

  /** Effects layer, for systems that react to gameplay events. */
  particlesRef() {
    return this.particles;
  }

  /** Live collectible flights, consumed by the HUD to spawn its chips. */
  collectibleFlights() {
    return this.collectibles?.flights ?? [];
  }

  /** Stats for the perf HUD. */
  stats() {
    return {
      props: this.city?.hash.size ?? 0,
      stuck: this.baker?.count ?? 0,
      ballDrawCalls: this.baker?.drawCalls ?? 0,
      tier: this.ball.growth.tier,
      radius: this.ball.visualRadius,
    };
  }
}
