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
import { PROPS, catalogModels, isBuilding, resolveProps, type KitId } from '../data/props';
import { FIRST_LEVEL, nextLevel } from '../levels';
import type { LevelDef } from '../levels/types';
import { goldFromScore, xpFromRun } from '../meta/Progression';
import { chargesOf, spendCharge, type PowerupId } from '../meta/Powerups';
import { perks } from '../meta/Upgrades';
import { FollowCamera } from '../render/Camera';
import type { Renderer } from '../render/Renderer';
import { Ball } from './Ball';
import { BallBaker } from './BallBaker';
import { CityBuilder, ROAD_MODELS, type BuiltCity } from './city/CityBuilder';
import { Collectibles } from './Collectibles';
import { Pedestrians } from './city/Pedestrians';
import { Traffic } from './city/Traffic';
import { Trains } from './city/Trains';
import { Score } from './Score';
import { Sticking, type Award } from './Sticking';
import { TIERS } from './Growth';
import { Decals } from '../render/Decals';
import { Demolition } from '../render/Demolition';
import { Particles } from '../render/Particles';
import { BlockStacks } from './BlockStacks';
import { CubePets } from './CubePets';
import { Magnet } from './Magnet';
import { Wind } from './Wind';

const _dirScreen = { x: 0, y: 0 };
const _dirWorld = new Vector3();

export type GameState = 'loading' | 'ready' | 'playing' | 'paused' | 'ended';

export class Game {
  state: GameState = 'loading';
  readonly ball = new Ball();
  readonly score = new Score();
  readonly camera: FollowCamera;

  level: LevelDef = FIRST_LEVEL;
  city!: BuiltCity;
  private baker!: BallBaker;
  private sticking!: Sticking;
  private traffic!: Traffic;
  private trains!: Trains;
  private peds!: Pedestrians;
  private collectibles!: Collectibles;
  private decals!: Decals;
  private particles!: Particles;
  private demolition!: Demolition;
  private blocks!: BlockStacks;
  private cubePets!: CubePets;
  private wind!: Wind;
  private magnet!: Magnet;

  timeLeft = 0;
  private lastCountdown = -1;

  /**
   * Seconds left in the victory lap, once the ball reaches the top tier.
   *
   * Max tier used to be the end of the run's *pacing* but not of the run: every
   * remaining prop was edible, nothing could tier up any more, and the clock
   * still had a minute or two on it. That last stretch is the only part of the
   * game with no beat in it, so reaching Roll Master now *is* the win — a few
   * seconds to feel enormous, then the results screen.
   *
   * `NaN`-free sentinel: negative means no finale is running.
   */
  private finaleLeft = -1;
  private static readonly FINALE_SECONDS = 5;

  /**
   * The upgrade draft fires once per run, at whichever comes first: the ball
   * reaching `DRAFT_TIER`, or the clock dropping to `DRAFT_TIME_LEFT`.
   *
   * Both conditions are needed. Tier alone means a player having a bad run
   * never sees the reward that would have helped, which is precisely backwards.
   * Time alone means a strong player gets it long after the point where it
   * changes anything.
   *
   * ## Why these numbers moved
   *
   * The pair was tuned when a run always went the full clock. Two things have
   * changed since, and both pushed the draft far too early:
   *
   *  - Reaching the top size now *ends* the run, so a run is a good deal
   *    shorter than its timer. Measured against an autopilot sweep, the old
   *    tier-4 trigger landed 8-21% of the way in — the game stopped to hand you
   *    a menu before you had any sense of the run you were having.
   *  - Half the clock now falls at 133-240% of the actual run length, so the
   *    time condition had quietly stopped firing at all. It was dead code
   *    guarding the one case it exists for — the player having a bad run.
   *
   * City Eater is the trigger now. Over half the run's whole mass climb happens
   * in that one band — tier 7 costs 5,500 and tier 8 costs 12,000 — so it is
   * where a player spends the back half of a run, hunting frontages rather than
   * sweeping litter.
   *
   * The autopilot measures it at 81-84% of the run, but that number flatters:
   * the harness beelines to shopfronts worth a thousand each and crosses the
   * band in ten seconds, which is not how anybody plays. Take it as an upper
   * bound. What matters is that the card now arrives when the ball is already
   * enormous, and never in the opening exchanges.
   *
   * A card taken this late does little for the run in progress, and that is
   * fine: upgrades are permanent, which is what the draft screen says on it.
   * The pick is banked for every run after this one.
   *
   * The clock fallback moved with it — a third of the timer left is late enough
   * that a good run always beats it to the trigger, and early enough that a
   * player still stuck below City Eater gets their card with time to spend it.
   */
  private static readonly DRAFT_TIER = 7;
  private static readonly DRAFT_TIME_LEFT = 0.35;
  private draftOffered = false;

  /**
   * Debug autopilot, used by `fastForward` to reach a high tier for profiling.
   * Steers the ball directly in world space, bypassing input and the camera's
   * screen-to-world mapping.
   */
  private autopilot = false;
  private apTarget = new Vector3();
  private apLeg = 0;

  constructor(
    private renderer: Renderer,
    private input: Input
  ) {
    this.camera = new FollowCamera(renderer.camera);
  }

  /** Selects the definition to build on the next `begin()`. */
  setLevel(level: LevelDef) {
    this.level = level;
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
    for (const m of Trains.MODELS) want('trains', m);
    for (const m of Pedestrians.MODELS) want('characters', m);
    for (const stack of this.level.blockStacks ?? []) {
      for (const m of stack.models) want('blocks', m);
    }
    for (const pet of this.level.pets ?? []) want('pets', pet.model);

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
    this.trains = new Trains(this.level, this.city);
    this.collectibles = new Collectibles(this.level, this.city);
    this.decals = new Decals(this.city);
    this.particles = new Particles();
    this.demolition = new Demolition(this.particles);
    this.blocks = new BlockStacks(this.level, this.city.hash);
    this.cubePets = new CubePets(this.level);
    this.wind = new Wind(this.level, this.city);
    this.magnet = new Magnet(this.ball, this.city);

    scene.add(
      this.traffic.group,
      this.peds.group,
      this.trains.group,
      this.decals.group,
      this.particles.group,
      this.demolition.group
      , this.blocks.group, this.cubePets.group
    );
    scene.add(this.ball.group);

    this.ball.reset(perks().startMass);
    this.ball.pos.set(this.city.start.x, this.ball.radius, this.city.start.z);
    this.score.reset();
    this.timeLeft = this.level.time + perks().extraTime;
    this.lastCountdown = -1;
    this.finaleLeft = -1;
    this.draftOffered = false;
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

  /**
   * Freezes the simulation for a modal that is *not* the pause menu — the
   * mid-run upgrade draft.
   *
   * Deliberately silent: `setPaused` emits `pause`, which is what opens the
   * pause panel, so reusing it here would stack the pause screen underneath the
   * draft. Two ways to stop the world is one more than ideal, but the
   * alternative is a `reason` argument threaded through every pause listener.
   */
  suspend() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
  }

  unsuspend() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.input.enabled = true;
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

    if (this.autopilot) {
      this.autopilotDir(_dirWorld);
    } else {
      this.input.direction(_dirScreen);
      this.camera.screenToWorld(_dirScreen.x, _dirScreen.y, _dirWorld);
    }
    this.ball.step(_dirWorld, dt);

    const b = this.city.bounds;
    this.ball.clampToBounds(b.minX, b.minZ, b.maxX, b.maxZ);

    this.traffic.step(dt, this.ball);
    this.peds.step(dt, this.ball);
    this.trains.step(dt, this.ball);
    this.wind.step(dt);
    // Before sticking, so anything the pull delivers this step is eaten this
    // step rather than sitting inside the ball for a frame.
    this.magnet.step(dt);
    const crumbled = this.blocks.step(dt, this.ball);
    if (crumbled) {
      this.camera.shake(0.28);
      this.camera.punch(0.05);
      this.particles.spark(this.ball.pos.x, this.ball.pos.y, this.ball.pos.z, 14 * crumbled);
      bus.emit('blockCrumble', { blocks: crumbled });
    }

    const before = this.ball.growth.tier;
    this.sticking.update((p, def): Award => {
      const points = this.score.award(def.points, def.id);
      this.collectibles.onAbsorb(def.id, p);
      const crossed = this.ball.growth.add(def.mass * perks().massMult);
      if (crossed >= 0) this.onTierUp(crossed);
      return { points, combo: this.score.comboTier };
    });
    if (this.ball.growth.tier !== before) this.ball.beginGrow();

    this.sticking.tick(dt);
    this.score.update(dt);
    this.collectibles.step(dt);

    this.timeLeft -= dt;
    this.checkDraft();
    const secs = Math.ceil(this.timeLeft);
    if (secs <= 10 && secs !== this.lastCountdown && secs > 0) {
      this.lastCountdown = secs;
      bus.emit('timeUp', undefined as never);
    }

    // The victory lap. Running it down here rather than on a timer means it
    // stops with the simulation: a player who pauses or takes an upgrade card
    // in the last second does not come back to a finished run.
    if (this.finaleLeft >= 0) {
      this.finaleLeft -= dt;
      bus.emit('finaleTick', { secondsLeft: Math.max(0, this.finaleLeft) });
      if (this.finaleLeft <= 0) {
        this.end(true);
        return;
      }
    }

    // Pocket Park finishes as soon as its clearable props are gone. Buildings
    // are landmarks here: they deliberately do not turn a gentle level into
    // a tier-seven demolition grind.
    if (this.level.clearToComplete && this.city.props.all.every((p) => p.absorbed || isBuilding(p.def))) {
      this.end(true);
    } else if (this.timeLeft <= 0) {
      // Pocket Park is a welcoming tour rather than a pass/fail test. Its timer
      // keeps the run brisk, but either clearing it or reaching time-up earns
      // the completion.
      this.end(Boolean(this.level.clearToComplete));
    }
  }

  /**
   * Fires the one mid-run upgrade draft. See `DRAFT_TIER` for why there are two
   * triggers.
   *
   * Emits a request and returns; pausing and showing the cards is the screen
   * flow's job, exactly like `pauseRequest`. The simulation deliberately does
   * not know that an upgrade screen exists.
   */
  private checkDraft() {
    if (this.draftOffered || this.autopilot) return;
    const total = this.level.time + perks().extraTime;
    if (this.ball.growth.tier < Game.DRAFT_TIER && this.timeLeft > total * Game.DRAFT_TIME_LEFT) return;
    this.draftOffered = true;
    bus.emit('rewardOffer', undefined as never);
  }

  /**
   * Steers toward the nearest thing the ball can currently eat, falling back to
   * a lawnmower sweep when the area is picked clean.
   *
   * Hunting rather than sweeping matters: a fixed sweep spends most of its time
   * crossing ground it has already cleared, and could not reach even tier 1 in
   * 300 simulated seconds. This reaches the top tiers in a time comparable to a
   * competent player, which is the state worth profiling.
   */
  private autopilotDir(out: Vector3) {
    const r = this.ball.growth.radius;
    let bestX = 0;
    let bestZ = 0;
    let found = false;
    let bestD = Infinity;
    this.city.hash.query(this.ball.pos.x, this.ball.pos.z, 22, (p) => {
      if (p.absorbed || p.blocker || p.def.absorbSize > r) return;
      const dx = p.x - this.ball.pos.x;
      const dz = p.z - this.ball.pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        bestX = p.x;
        bestZ = p.z;
        found = true;
      }
    });

    if (found) {
      out.set(bestX - this.ball.pos.x, 0, bestZ - this.ball.pos.z);
    } else {
      const b = this.city.bounds;
      const inset = 6;
      if (this.ball.pos.distanceTo(this.apTarget) < 4 || this.apLeg === 0) {
        const legs = 12;
        const i = this.apLeg % (legs * 2);
        const row = Math.floor(i / 2);
        const z = b.minZ + inset + ((b.maxZ - b.minZ - inset * 2) * row) / (legs - 1);
        const x = i % 2 === 0 ? b.minX + inset : b.maxX - inset;
        this.apTarget.set(x, 0, z);
        this.apLeg++;
      }
      out.copy(this.apTarget).sub(this.ball.pos);
      out.y = 0;
    }
    if (out.lengthSq() > 1e-6) out.normalize();
  }

  /**
   * Debug only: drives the real simulation until the ball reaches `tier`.
   *
   * Deliberately runs the actual step/render loop rather than just setting a
   * radius, because the expensive things at high tiers — chunk consolidation,
   * pruning, batch state, the absorbed-prop count — are all produced by the
   * real path. A ball that merely *claims* to be tier 8 would profile nothing.
   */
  fastForward(tier: number, maxSeconds = 2400): { seconds: number; tier: number } {
    if (this.state !== 'playing') return { seconds: 0, tier: this.ball.growth.tier };
    const dt = 1 / 120;
    const frozen = this.timeLeft;
    this.autopilot = true;
    this.apLeg = 0;

    let elapsed = 0;
    let starved = 0;
    let lastMass = -1;
    while (this.ball.growth.tier < tier && elapsed < maxSeconds) {
      // The ball can wedge against a building with its target unreachable, and
      // then eats nothing for the rest of the budget. When no mass has been
      // gained for a few seconds, relocate it onto something it can still eat.
      // Teleporting is fine here — this is a profiling harness, and everything
      // already absorbed (which is what we are profiling) is preserved.
      if (this.ball.growth.mass === lastMass) {
        if (++starved > 120 * 3) {
          if (!this.relocateToFood()) break; // nothing edible left anywhere
          starved = 0;
        }
      } else {
        starved = 0;
        lastMass = this.ball.growth.mass;
      }
      this.step(dt);
      // Render-rate work too: pop-in animations retire props into chunks here,
      // and skipping it would leave the ball's geometry in an unreal state.
      this.render(dt);
      this.timeLeft = frozen; // the clock must not run out mid fast-forward
      elapsed += dt;
    }

    this.autopilot = false;
    this.timeLeft = frozen;
    return { seconds: elapsed, tier: this.ball.growth.tier };
  }

  /** Debug: drops the ball onto a random prop it can still absorb. */
  private relocateToFood(): boolean {
    const r = this.ball.growth.radius;
    const candidates: { x: number; z: number }[] = [];
    for (const list of this.city.byProp.values()) {
      for (const p of list) {
        if (p.absorbed || p.def.absorbSize > r) continue;
        candidates.push({ x: p.x, z: p.z });
      }
      if (candidates.length > 400) break;
    }
    if (!candidates.length) return false;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    this.ball.pos.set(pick.x, this.ball.pos.y, pick.z);
    this.ball.vel.set(0, 0, 0);
    this.apLeg = 0;
    return true;
  }

  private onTierUp(tier: number) {
    const prev = TIERS[Math.max(0, tier - 1)].radius;
    this.baker.prune(TIERS[tier].radius);
    this.ball.beginGrow();
    this.camera.punch(0.85);
    this.camera.shake(0.5);
    bus.emit('tierUp', { tier, radius: TIERS[tier].radius, prevRadius: prev });

    // Reaching the top tier ends the run — see `finaleLeft`. The lap is not
    // skipped when the clock is nearly out: whichever runs down first wins, and
    // a Roll Master finish with two seconds on the timer still gets its two
    // seconds of being enormous.
    if (this.ball.growth.isMax && this.finaleLeft < 0 && !this.autopilot) {
      this.finaleLeft = Game.FINALE_SECONDS;
      bus.emit('finaleStart', { seconds: Game.FINALE_SECONDS });
    }
  }

  // ── power-ups ───────────────────────────────────────────────────────────

  /**
   * Spends a charge and applies it, or reports why it could not.
   *
   * Returns a reason rather than throwing or silently doing nothing, because
   * the two failure cases want opposite responses from the UI: out of charges
   * is an invitation to the shop, while "nothing left to grow into" is just a
   * button that should have been disabled and needs a shrug, not a sales pitch.
   * Nothing is spent unless the effect actually lands.
   */
  usePowerup(id: PowerupId): 'used' | 'empty' | 'unavailable' {
    if (this.state !== 'playing') return 'unavailable';
    if (chargesOf(id) <= 0) return 'empty';

    if (id === 'grow') {
      // Refused at the top rather than eaten silently: a charge that buys
      // nothing is the worst possible outcome for a paid consumable.
      if (this.ball.growth.isMax) return 'unavailable';
      if (!spendCharge(id)) return 'empty';
      this.growOneTier();
      bus.emit('powerupUsed', { id });
      return 'used';
    }

    if (!spendCharge(id)) return 'empty';
    this.magnet.start();
    bus.emit('powerupUsed', { id });
    return 'used';
  }

  /**
   * Size Up: hands over exactly the mass the next tier is still waiting on.
   *
   * Setting the radius directly would be one line and wrong — the growth meter,
   * the tier banner, the music layer, the baker's prune and the top-tier finale
   * all hang off `growth.add` crossing a threshold. Paying the shortfall means
   * a bought tier and an earned one are the same event, and the mass ledger
   * stays honest for every tier after it.
   */
  private growOneTier() {
    const g = this.ball.growth;
    const shortfall = TIERS[g.tier + 1].mass - g.mass;
    const crossed = g.add(Math.max(0, shortfall));
    if (crossed >= 0) {
      this.onTierUp(crossed);
      this.ball.beginGrow();
    }
  }

  /** Live magnet state for the HUD ring and the effect layer. */
  magnetState() {
    return {
      active: this.magnet?.active ?? false,
      progress: this.magnet?.progress ?? 0,
      radius: this.magnet?.radius ?? 0,
    };
  }

  /** Render-rate update: visuals only, safe to run at any framerate. */
  render(dt: number) {
    this.ball.render(dt);
    this.baker?.update(dt, this.ball.growth.radius);
    this.camera.update(this.ball.pos, this.ball.vel, this.ball.visualRadius, dt);
    this.renderer.focusShadow(this.ball.pos, this.ball.visualRadius);
    this.renderer.fitFog(this.camera.viewDistance);
    this.traffic?.render(dt);
    this.trains?.render(dt);
    if (this.peds) {
      // The `!` marks are CPU-billboarded, same as the particle layer.
      this.peds.billboard.copy(this.renderer.camera.quaternion);
      this.peds.render(dt);
    }
    this.decals?.update(this.ball);
    this.particles?.update(dt);
    this.demolition?.update(dt);
    this.cubePets?.update(dt);
    this.collectibles?.render(dt);
  }

  end(completed = false) {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.input.enabled = false;

    // Reaching the top tier *is* the win, so it counts as one however the run
    // actually stopped. Without this, hitting Roll Master with four seconds on
    // the clock ended in "Time!" — the clock beat the victory lap to `end`, and
    // the best possible finish read as the worst one.
    completed = completed || this.finaleLeft >= 0;

    // Time bonus rewards finishing early on a cleared street; set bonuses reward
    // completing a collection. Grand Finale scales both.
    const finale = perks().finaleMult;
    const timeBonus = Math.max(0, Math.floor(this.timeLeft) * 10);
    const setBonus = this.collectibles.completedSets * 2500;
    const bonus = Math.round((timeBonus + setBonus) * finale);
    if (bonus > 0) this.score.addBonus(bonus);

    const stars = this.level.stars.reduce((n, t) => (this.score.score >= t ? n + 1 : n), 0);
    save.recordLevel(this.level.id, this.score.score, stars, this.score.bestCombo);

    // One rule for every level, following the order in `levels/index.ts`:
    // finishing the objective *or* earning a single star opens the next map.
    // Score attacks have no clear condition, so a star is their gate; Pocket
    // Park has no meaningful score floor, so clearing it is enough.
    const next = nextLevel(this.level.id);
    const newlyUnlocked = next && (completed || stars > 0) ? save.unlock(next.id) : false;

    // XP is banked here rather than on the results screen: it is not a choice,
    // it cannot be declined, and a player who closes the tab during the count-up
    // should still have earned it. Gold is the opposite — it is *claimed*, so it
    // stays pending until the button is pressed.
    const xp = xpFromRun(this.score.score, this.ball.growth.tier, stars);
    save.addXp(xp);
    save.countRun();

    bus.emit('levelEnd', {
      completed,
      // Where "Next Level" goes. Reads the save rather than this run's result,
      // so replaying a level you have already beaten still offers the hop
      // forward instead of stranding you on the results screen.
      next: next && save.unlocked(next.id) ? next.id : undefined,
      newlyUnlocked,
      score: this.score.score,
      stars,
      bestCombo: this.score.bestCombo,
      absorbed: this.score.absorbed,
      tier: this.ball.growth.tier,
      collected: this.collectibles.summary(),
      gold: goldFromScore(this.score.score, perks().goldMult),
      xp,
    });
  }

  private teardown() {
    const scene = this.renderer.scene;
    this.baker?.clear();
    this.traffic?.dispose();
    this.trains?.dispose();
    this.peds?.dispose();
    this.particles?.dispose();
    this.demolition?.dispose();
    this.blocks?.dispose();
    this.cubePets?.dispose();
    this.wind?.dispose();
    scene.remove(
      this.city.group,
      this.traffic.group,
      this.peds.group,
      this.trains.group,
      this.decals.group,
      this.particles.group,
      this.demolition.group,
      this.blocks.group,
      this.cubePets.group,
      this.ball.group
    );
    this.city.props.clear();
  }

  /** Effects layer, for systems that react to gameplay events. */
  particlesRef() {
    return this.particles;
  }

  /** Building demolitions, driven from the `lockOn`/`lockOff`/`demolish` events. */
  demolitionRef() {
    return this.demolition;
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
      rubble: this.demolition?.liveChunks ?? 0,
    };
  }
}
