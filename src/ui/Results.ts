/**
 * End-of-level results.
 *
 * Sequenced deliberately: score counts up with an audio tick whose pitch rises
 * with the count, *then* stars pop in one at a time, *then* the experience bar
 * fills and any level-up lands, *then* the gold is offered, *then* the buttons
 * appear. Revealing everything at once would throw away the best few seconds of
 * feedback in the game — the count-up is the payoff for the whole run, and
 * rushing it is the most common mistake in casual game results screens.
 *
 * XP and gold are treated differently on purpose. XP was already banked when the
 * run ended, so the bar here is a *replay* of something that has happened and it
 * cannot be lost by closing the tab. Gold is claimed: the button is the moment,
 * and it is the only thing on this screen the player has to actually do. If they
 * leave without pressing it the claim happens anyway on the way out — the
 * ceremony is optional, the money is not.
 */

import { sfx } from '../audio/Sfx';
import { save } from '../core/Save';
import { bus, type GameEvents } from '../core/Events';
import type { LevelDef } from '../levels/types';
import { TIERS } from '../game/Growth';
import { levelFromXp, MAX_LEVEL } from '../meta/Progression';
import { animate, el, wait } from './dom';

export class Results {
  private root: HTMLElement;
  private title: HTMLElement;
  private scoreEl: HTMLElement;
  private starsEl: HTMLElement;
  private statsEl: HTMLElement;
  private xpWrap: HTMLElement;
  private xpLabel: HTMLElement;
  private xpFill: HTMLElement;
  private xpGain: HTMLElement;
  private goldWrap: HTMLElement;
  private goldBtn: HTMLButtonElement;
  private actions: HTMLElement;
  private token = 0;

  /** Gold earned this run and not yet banked. */
  private pendingGold = 0;

  onRetry: () => void = () => {};
  onLevels: () => void = () => {};
  onCollection: () => void = () => {};
  onShop: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = el('div', { class: 'screen results hidden' });
    this.title = el('h1', {}, 'Time!');
    this.starsEl = el('div', { class: 'stars' });
    this.scoreEl = el('div', { class: 'big-score' }, '0');
    this.statsEl = el('div', { class: 'stat-row' });

    // ── xp bar ──
    this.xpLabel = el('div', { class: 'xp-label' }, '');
    this.xpGain = el('div', { class: 'xp-gain' }, '');
    this.xpFill = el('i');
    const track = el('div', { class: 'xp-track' });
    track.append(this.xpFill);
    this.xpWrap = el('div', { class: 'xp-wrap' });
    this.xpWrap.append(this.xpLabel, track, this.xpGain);

    // ── gold claim ──
    this.goldBtn = el('button', { class: 'btn claim' }, 'Claim') as HTMLButtonElement;
    this.goldBtn.addEventListener('click', () => this.claim());
    this.goldWrap = el('div', { class: 'gold-wrap' });
    this.goldWrap.append(this.goldBtn);

    this.actions = el('div', { class: 'row', style: 'opacity:0;transition:opacity .35s ease' });
    const retry = el('button', { class: 'btn' }, 'Play Again');
    retry.addEventListener('click', () => {
      sfx.click();
      this.onRetry();
    });
    const levels = el('button', { class: 'btn ghost' }, 'Levels');
    levels.addEventListener('click', () => {
      sfx.click(true);
      this.onLevels();
    });
    const shop = el('button', { class: 'btn ghost' }, 'Shop');
    shop.addEventListener('click', () => {
      sfx.click(true);
      this.onShop();
    });
    const coll = el('button', { class: 'btn ghost' }, 'Collection');
    coll.addEventListener('click', () => {
      sfx.click(true);
      this.onCollection();
    });
    this.actions.append(retry, levels, shop, coll);

    this.root.append(
      this.title, this.starsEl, this.scoreEl, this.statsEl,
      this.xpWrap, this.goldWrap, this.actions
    );
    parent.append(this.root);
  }

  async show(e: GameEvents['levelEnd'], level: LevelDef) {
    const run = ++this.token;
    const best = save.best(level.id);

    this.root.classList.remove('hidden');
    this.title.textContent = e.completed
      ? (e.score >= level.stars[2] ? 'Perfect Sweep!' : 'Level Complete!')
      : 'Time!';
    this.scoreEl.textContent = '0';
    this.actions.style.opacity = '0';
    this.xpWrap.classList.remove('on');
    this.goldWrap.classList.remove('on');

    this.starsEl.innerHTML = '';
    const starNodes = [0, 1, 2].map(() => {
      const s = el('div', { class: 's' }, '★');
      this.starsEl.append(s);
      return s;
    });

    this.statsEl.innerHTML = '';
    const stat = (k: string, v: string) => {
      const n = el('div', { class: 'stat' });
      n.append(el('span', { class: 'k' }, k), el('span', { class: 'v' }, v));
      this.statsEl.append(n);
    };
    stat('Absorbed', String(e.absorbed));
    stat('Best Combo', `×${e.bestCombo}`);
    stat('Size', TIERS[e.tier].name);
    for (const c of e.collected) stat(c.label, `${c.count}/${c.target}`);
    if (best) stat('Best', best.score.toLocaleString());

    // ── count up ──
    const total = e.score;
    const duration = Math.min(1.9, 0.7 + total / 22000);
    let lastTick = 0;
    await animate(duration, (t) => {
      if (run !== this.token) return;
      // Ease out so it sprints then settles — a linear count feels mechanical.
      const shown = Math.floor(total * (1 - Math.pow(1 - t, 3)));
      this.scoreEl.textContent = shown.toLocaleString();
      const now = performance.now();
      if (now - lastTick > 45) {
        lastTick = now;
        // Pitch climbs with the count, so the ticker sounds like it's winding up.
        sfx.tick(0.8 + t * 1.5);
      }
    });
    if (run !== this.token) return;
    this.scoreEl.textContent = total.toLocaleString();

    // ── stars ──
    await wait(180);
    for (let i = 0; i < e.stars; i++) {
      if (run !== this.token) return;
      starNodes[i].classList.add('lit');
      sfx.star(i);
      await wait(340);
    }

    if (run !== this.token) return;
    await this.playXp(run, e.xp);
    if (run !== this.token) return;
    await this.offerGold(run, e.gold);

    if (run !== this.token) return;
    await wait(120);
    this.actions.style.opacity = '1';
  }

  /**
   * Fills the experience bar from where the run started to where it ended,
   * crossing as many level boundaries as the run earned.
   *
   * Driven off a single interpolated XP value rather than a percentage, which is
   * what makes multi-level runs work: the bar simply reads whatever level that
   * XP falls in, so it empties and refills once per boundary without any
   * special-casing.
   */
  private async playXp(run: number, gained: number) {
    // The run's XP is already in the save, so the *start* of the animation is
    // wherever it was before.
    const after = save.meta.xp;
    const before = Math.max(0, after - gained);
    const startState = levelFromXp(before);

    this.xpGain.textContent = gained > 0 ? `+${gained.toLocaleString()} XP` : '';
    this.paintXp(startState);
    this.xpWrap.classList.add('on');
    await wait(340);
    if (run !== this.token) return;
    if (gained <= 0) return;

    let shownLevel = startState.level;
    await animate(Math.min(2.2, 0.9 + gained / 4000), (t) => {
      if (run !== this.token) return;
      const eased = 1 - Math.pow(1 - t, 2.4);
      const state = levelFromXp(before + (after - before) * eased);
      this.paintXp(state);
      if (state.level !== shownLevel) {
        shownLevel = state.level;
        sfx.levelUp();
        this.xpWrap.classList.remove('levelled');
        void this.xpWrap.offsetWidth; // restart the flash on back-to-back levels
        this.xpWrap.classList.add('levelled');
      }
    });
    if (run !== this.token) return;
    this.paintXp(levelFromXp(after));
    await wait(shownLevel !== startState.level ? 700 : 220);
  }

  private paintXp(state: ReturnType<typeof levelFromXp>) {
    this.xpLabel.innerHTML = '';
    this.xpLabel.append(
      el('span', { class: 'lv' }, `Lv ${state.level}`),
      el('span', { class: 'ti' }, state.title),
      el(
        'span',
        { class: 'nx' },
        state.maxed ? 'MAX' : `${Math.floor(state.into).toLocaleString()} / ${state.need.toLocaleString()}`
      )
    );
    this.xpFill.style.width = `${state.progress * 100}%`;
    this.xpWrap.classList.toggle('maxed', state.level >= MAX_LEVEL);
  }

  /** Reveals the claim button and waits for it — or moves on after a while. */
  private async offerGold(run: number, gold: number) {
    this.pendingGold = gold;
    this.goldBtn.disabled = false;
    this.goldBtn.classList.remove('done');
    this.goldBtn.innerHTML = `<span class="coin">●</span> Claim ${gold.toLocaleString()}`;
    this.goldWrap.classList.add('on');
    sfx.whoosh(true);

    // Waits for the press, but never blocks the screen forever: the buttons
    // appear after a beat either way, and leaving banks the gold regardless.
    for (let i = 0; i < 30 && this.pendingGold > 0 && run === this.token; i++) {
      await wait(100);
    }
  }

  private async claim() {
    const amount = this.pendingGold;
    if (amount <= 0) return;
    this.pendingGold = 0;
    this.goldBtn.disabled = true;
    this.goldBtn.classList.add('done');

    save.addGold(amount);
    bus.emit('goldChange', { gold: save.meta.gold, delta: amount });
    sfx.purchase();

    const rect = this.goldBtn.getBoundingClientRect();
    for (let i = 0; i < 16; i++) {
      this.spawnCoin(rect.left + rect.width / 2, rect.top + rect.height / 2, i);
    }

    let ticks = 0;
    const shown = save.meta.gold;
    await animate(0.85, (t) => {
      const want = Math.floor(t * 10);
      while (ticks < want) {
        ticks++;
        sfx.coin(0.8 + ticks * 0.07);
      }
      this.goldBtn.innerHTML =
        `<span class="coin">●</span> ${Math.round(shown - amount * (1 - t)).toLocaleString()}`;
    });
    this.goldBtn.innerHTML = `<span class="coin">●</span> ${shown.toLocaleString()}`;
  }

  private spawnCoin(x: number, y: number, i: number) {
    const coin = el('div', { class: 'coin-fly' }, '●');
    const angle = (-90 + (i - 8) * 10) * (Math.PI / 180);
    const dist = 100 + Math.random() * 130;
    coin.style.left = `${x}px`;
    coin.style.top = `${y}px`;
    coin.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    coin.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    coin.style.setProperty('--d', `${i * 22}ms`);
    this.root.append(coin);
    setTimeout(() => coin.remove(), 1200 + i * 22);
  }

  hide() {
    this.token++;
    // Anything still owed is banked on the way out. The claim button is a
    // ceremony, not a gate — a player who taps Play Again immediately must not
    // lose the run's gold for being in a hurry.
    if (this.pendingGold > 0) {
      save.addGold(this.pendingGold);
      bus.emit('goldChange', { gold: save.meta.gold, delta: this.pendingGold });
      this.pendingGold = 0;
    }
    this.root.classList.add('hidden');
  }
}
