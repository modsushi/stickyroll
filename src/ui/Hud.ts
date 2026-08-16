/**
 * In-game HUD.
 *
 * Everything reacts to the event bus rather than polling the game, so juice is
 * additive: a new effect is a new listener, not a new branch in the game loop.
 *
 * The `+N` popups and the collectible flyers are pooled DOM nodes positioned by
 * projecting world coordinates through the live camera each frame — which is
 * what lets a 3D pickup land exactly on a 2D card, through camera moves,
 * rotations and resizes.
 */

import { Vector3, type PerspectiveCamera } from 'three';
import { sfx } from '../audio/Sfx';
import { bus } from '../core/Events';
import { clamp01, easeInCubic, easeOutCubic, lerp } from '../core/Math';
import { TIERS } from '../game/Growth';
import type { Game } from '../game/Game';
import { el } from './dom';

const _v = new Vector3();

interface Pop {
  node: HTMLElement;
  world: Vector3;
  t: number;
  life: number;
  drift: number;
  rise: number;
}

interface Flyer {
  node: HTMLElement;
  slot: 0 | 1;
  world: Vector3;
  t: number;
  life: number;
  /** Screen position captured at launch, blended toward the card. */
  sx: number;
  sy: number;
}

export class Hud {
  readonly root: HTMLElement;
  private timerEl: HTMLElement;
  private timerText: HTMLElement;
  private scoreEl: HTMLElement;
  private cardEls: HTMLElement[] = [];
  private cardCounts: HTMLElement[] = [];
  private pips: HTMLElement[] = [];
  private tierName: HTMLElement;
  private growthFill: HTMLElement;
  private comboEl: HTMLElement;
  private comboN: HTMLElement;
  private comboCount!: HTMLElement;
  private comboRing: HTMLElement;
  private banner: HTMLElement;
  private layer: HTMLElement;
  private stick: HTMLElement;
  private stickBase: HTMLElement;
  private stickKnob: HTMLElement;

  private pops: Pop[] = [];
  private popPool: HTMLElement[] = [];
  private flyers: Flyer[] = [];
  private flyerPool: HTMLElement[] = [];

  private shownScore = 0;
  private offs: (() => void)[] = [];

  constructor(
    parent: HTMLElement,
    private game: Game
  ) {
    this.root = el('div', { id: 'hud' });

    // ── timer ──
    this.timerEl = el('div', { class: 'pill timer' });
    this.timerText = el('span', {}, '0:00');
    this.timerEl.append(el('span', { class: 'glyph' }, '⏳'), this.timerText);

    // ── score ──
    this.scoreEl = el('div', { class: 'score' }, '0');

    // ── collectible cards ──
    const cards = el('div', { class: 'cards' });
    this.game.level.collectibles.forEach((c, i) => {
      const card = el('div', { class: 'card' });
      const thumb = el('canvas', { class: 'thumb', width: '96', height: '96' });
      const count = el('div', { class: 'count' });
      count.innerHTML = `<b>0</b>/${c.target}`;
      card.append(thumb, count);
      card.title = c.label;
      cards.append(card);
      this.cardEls[i] = card;
      this.cardCounts[i] = count;
    });

    // ── tier pips ──
    const tiers = el('div', { class: 'tiers' });
    TIERS.forEach((_, i) => {
      const pip = el('div', { class: 'pip' }, String(i + 1));
      this.pips.push(pip);
      tiers.append(pip);
    });
    this.tierName = el('div', { class: 'tier-name' }, TIERS[0].name);
    const growth = el('div', { class: 'growth' });
    this.growthFill = el('i');
    growth.append(this.growthFill);

    // ── combo ──
    this.comboEl = el('div', { class: 'combo' });
    this.comboN = el('span', { class: 'n' }, '0');
    this.comboRing = el('i');
    const ring = el('div', { class: 'ring' });
    ring.append(this.comboRing);
    this.comboCount = el('span', { class: 'label' }, '0 chain');
    this.comboEl.append(this.comboN, this.comboCount, ring);

    // ── banner + popup layer ──
    this.banner = el('div', { class: 'banner' });
    this.layer = el('div', { style: 'position:absolute;inset:0;pointer-events:none' });

    // ── virtual stick ──
    this.stick = el('div', { id: 'stick' });
    this.stickBase = el('div', { class: 'base' });
    this.stickKnob = el('div', { class: 'knob' });
    this.stick.append(this.stickBase, this.stickKnob);

    const pauseBtn = el('button', { class: 'icon-btn', id: 'pause-btn', 'aria-label': 'Pause' }, '❚❚');
    pauseBtn.addEventListener('click', () => {
      sfx.click();
      bus.emit('pauseRequest', undefined as never);
    });

    this.root.append(
      this.timerEl, this.scoreEl, cards, tiers, this.tierName, growth,
      this.comboEl, this.banner, this.layer, this.stick, pauseBtn
    );
    parent.append(this.root);

    this.listen();
  }

  private listen() {
    this.offs.push(
      bus.on('stick', (e) => {
        this.spawnPop(e.world.x, e.world.y, e.world.z, e.points, e.combo);
      }),
      bus.on('scoreChange', () => {
        this.scoreEl.classList.add('bump');
        setTimeout(() => this.scoreEl.classList.remove('bump'), 130);
      }),
      bus.on('comboChange', (e) => {
        this.comboEl.classList.toggle('on', e.combo >= 5);
        this.comboN.textContent = `x${this.game.score.multiplier}`;
        this.comboCount.textContent = `${e.combo} chain`;
      }),
      bus.on('collect', (e) => {
        const card = this.cardEls[e.slot];
        const set = this.game.level.collectibles[e.slot];
        this.cardCounts[e.slot].innerHTML = `<b>${e.count}</b>/${set.target}`;
        card.classList.remove('punch');
        // Force reflow so the animation restarts on rapid pickups.
        void card.offsetWidth;
        card.classList.add('punch');
        setTimeout(() => card.classList.remove('punch'), 190);
      }),
      bus.on('collectComplete', (e) => {
        this.cardEls[e.slot].classList.add('done');
      }),
      bus.on('tierUp', (e) => {
        this.showBanner(TIERS[e.tier].name);
        this.tierName.textContent = TIERS[e.tier].name;
      })
    );
  }

  private showBanner(name: string) {
    this.banner.innerHTML = '';
    this.banner.append(el('div', { class: 'k' }, 'Level Up'), el('span', { class: 'v' }, name));
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
  }

  // ── floating +N ─────────────────────────────────────────────────────────

  private spawnPop(x: number, y: number, z: number, points: number, comboTier: number) {
    // More than a handful of simultaneous popups is visual noise; the score
    // readout already carries the total.
    if (this.pops.length > 14) return;

    const node = this.popPool.pop() ?? el('div', { class: 'pop' });
    const mult = this.game.score.multiplier;
    node.className = comboTier >= 3 ? 'pop big' : 'pop';
    node.innerHTML =
      mult > 1 ? `+${points}<span class="x"> ×${mult}</span>` : `+${points}`;
    node.style.opacity = '1';
    this.layer.append(node);

    this.pops.push({
      node,
      world: new Vector3(x, y + 0.5, z),
      t: 0,
      life: 0.85,
      drift: (Math.random() - 0.5) * 46,
      rise: 44 + Math.random() * 26,
    });
  }

  // ── collectible flyers ──────────────────────────────────────────────────

  private spawnFlyer(slot: 0 | 1, world: Vector3) {
    const node = this.flyerPool.pop() ?? el('div', { class: 'flyer' });
    node.style.opacity = '1';
    this.layer.append(node);
    this.flyers.push({ node, slot, world: world.clone(), t: 0, life: 0.62, sx: 0, sy: 0 });
  }

  /** Projects a world point to CSS pixels. Returns false if behind the camera. */
  private project(cam: PerspectiveCamera, world: Vector3, out: { x: number; y: number }): boolean {
    _v.copy(world).project(cam);
    out.x = (_v.x * 0.5 + 0.5) * innerWidth;
    out.y = (-_v.y * 0.5 + 0.5) * innerHeight;
    return _v.z < 1;
  }

  update(dt: number, cam: PerspectiveCamera) {
    const g = this.game;

    // ── timer ──
    const t = Math.max(0, g.timeLeft);
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    this.timerText.textContent = `${m}:${String(s).padStart(2, '0')}`;
    this.timerEl.classList.toggle('warn', t <= 10 && g.state === 'playing');

    // ── score, eased so it counts up rather than jumping ──
    if (this.shownScore !== g.score.score) {
      this.shownScore = Math.ceil(lerp(this.shownScore, g.score.score, 1 - Math.pow(0.001, dt)));
      if (Math.abs(this.shownScore - g.score.score) < 2) this.shownScore = g.score.score;
      this.scoreEl.textContent = this.shownScore.toLocaleString();
    }

    // ── growth meter + pips ──
    this.growthFill.style.width = `${g.ball.growth.progress * 100}%`;
    const tier = g.ball.growth.tier;
    for (let i = 0; i < this.pips.length; i++) {
      this.pips[i].classList.toggle('on', i <= tier);
      this.pips[i].classList.toggle('current', i === tier);
    }

    // ── combo ring drains with the window ──
    this.comboRing.style.transform = `scaleX(${g.score.comboFraction})`;

    // ── stick ──
    const st = (g as unknown as { inputStick?: never }) && this.stickState();
    if (st) {
      this.stick.classList.toggle('on', st.active && st.touch);
      if (st.active) {
        this.stickBase.style.transform = `translate(${st.originX}px, ${st.originY}px) translate(-50%,-50%)`;
        const kx = st.originX + st.x * st.strength * 40;
        const ky = st.originY + st.y * st.strength * 40;
        this.stickKnob.style.transform = `translate(${kx}px, ${ky}px) translate(-50%,-50%)`;
      }
    }

    this.updatePops(dt, cam);
    this.updateFlyers(dt, cam);
    this.pumpCollectibleFlights(cam);
  }

  /** Set by main once Input exists; avoids a circular import. */
  stickState: () => {
    active: boolean; touch: boolean; x: number; y: number;
    strength: number; originX: number; originY: number;
  } | null = () => null;

  private updatePops(dt: number, cam: PerspectiveCamera) {
    const p2 = { x: 0, y: 0 };
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt / p.life;
      if (p.t >= 1) {
        p.node.remove();
        this.popPool.push(p.node);
        this.pops.splice(i, 1);
        continue;
      }
      // Popups track their world point but drift up the *screen*, so they stay
      // attached to what you ate while remaining readable.
      this.project(cam, p.world, p2);
      const e = easeOutCubic(p.t);
      const x = p2.x + p.drift * e;
      const y = p2.y - p.rise * e;
      const scale = p.t < 0.18 ? lerp(0.6, 1.14, p.t / 0.18) : lerp(1.14, 0.92, (p.t - 0.18) / 0.82);
      p.node.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%) scale(${scale})`;
      p.node.style.opacity = String(1 - easeInCubic(clamp01((p.t - 0.45) / 0.55)));
    }
  }

  /** Pulls new flights out of the game and spawns a DOM chip for each. */
  private pumpCollectibleFlights(cam: PerspectiveCamera) {
    void cam;
    const flights = this.game.collectibleFlights();
    for (const f of flights) {
      if ((f as { _spawned?: boolean })._spawned) continue;
      (f as { _spawned?: boolean })._spawned = true;
      this.spawnFlyer(f.slot, f.pos);
    }
  }

  private updateFlyers(dt: number, cam: PerspectiveCamera) {
    const p2 = { x: 0, y: 0 };
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.t += dt / f.life;
      if (f.t >= 1) {
        f.node.remove();
        this.flyerPool.push(f.node);
        this.flyers.splice(i, 1);
        continue;
      }

      this.project(cam, f.world, p2);
      if (f.t < 0.02) {
        f.sx = p2.x;
        f.sy = p2.y;
      }

      // Target the centre of the destination card, measured live so it stays
      // correct across orientation changes.
      const card = this.cardEls[f.slot].getBoundingClientRect();
      const tx = card.left + card.width / 2;
      const ty = card.top + card.height / 2;

      // Blend from the world-tracked launch point into the card, with an arc.
      const e = easeInCubic(f.t);
      const x = lerp(p2.x, tx, e);
      const y = lerp(p2.y, ty, e) - Math.sin(f.t * Math.PI) * 90;
      const scale = lerp(1.25, 0.55, f.t);
      f.node.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%) scale(${scale}) rotate(${f.t * 320}deg)`;
      f.node.style.opacity = String(1 - easeInCubic(clamp01((f.t - 0.7) / 0.3)));
    }
    void dt;
  }

  /** Renders the small model thumbnails onto the collectible cards. */
  setCardThumb(slot: number, source: HTMLCanvasElement) {
    const canvas = this.cardEls[slot].querySelector('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }

  /**
   * Clears everything a finished run left behind. Without this a restart shows
   * the previous run's collectible counts (and their completed-set glow), which
   * makes the new level look already-won.
   */
  reset() {
    this.shownScore = 0;
    this.scoreEl.textContent = '0';
    this.game.level.collectibles.forEach((c, i) => {
      this.cardCounts[i].innerHTML = `<b>0</b>/${c.target}`;
      this.cardEls[i].classList.remove('done', 'punch');
    });
    this.comboEl.classList.remove('on');
    this.comboN.textContent = 'x1';
    this.comboCount.textContent = '0 chain';
    this.banner.classList.remove('show');
    this.tierName.textContent = TIERS[0].name;
    for (const p of this.pops) p.node.remove();
    this.pops.length = 0;
    for (const f of this.flyers) f.node.remove();
    this.flyers.length = 0;
  }

  show(on: boolean) {
    this.root.classList.toggle('on', on);
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.root.remove();
  }
}
