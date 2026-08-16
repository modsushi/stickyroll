/**
 * End-of-level results.
 *
 * Sequenced deliberately: score counts up with an audio tick whose pitch rises
 * with the count, *then* stars pop in one at a time, *then* the buttons appear.
 * Revealing everything at once would throw away the best few seconds of feedback
 * in the game — the count-up is the payoff for the whole run, and rushing it is
 * the most common mistake in casual game results screens.
 */

import { sfx } from '../audio/Sfx';
import { save } from '../core/Save';
import type { GameEvents } from '../core/Events';
import type { LevelDef } from '../levels/types';
import { TIERS } from '../game/Growth';
import { animate, el, wait } from './dom';

export class Results {
  private root: HTMLElement;
  private title: HTMLElement;
  private scoreEl: HTMLElement;
  private starsEl: HTMLElement;
  private statsEl: HTMLElement;
  private actions: HTMLElement;
  private token = 0;

  onRetry: () => void = () => {};
  onCollection: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = el('div', { class: 'screen hidden' });
    this.title = el('h1', {}, 'Time!');
    this.starsEl = el('div', { class: 'stars' });
    this.scoreEl = el('div', { class: 'big-score' }, '0');
    this.statsEl = el('div', { class: 'stat-row' });
    this.actions = el('div', { class: 'row', style: 'opacity:0;transition:opacity .35s ease' });

    const retry = el('button', { class: 'btn' }, 'Play Again');
    retry.addEventListener('click', () => {
      sfx.click();
      this.onRetry();
    });
    const coll = el('button', { class: 'btn ghost' }, 'Collection');
    coll.addEventListener('click', () => {
      sfx.click(true);
      this.onCollection();
    });
    this.actions.append(retry, coll);

    this.root.append(this.title, this.starsEl, this.scoreEl, this.statsEl, this.actions);
    parent.append(this.root);
  }

  async show(e: GameEvents['levelEnd'], level: LevelDef) {
    const run = ++this.token;
    const best = save.best(level.id);

    this.root.classList.remove('hidden');
    this.title.textContent = e.score >= level.stars[2] ? 'Perfect Sweep!' : 'Time!';
    this.scoreEl.textContent = '0';
    this.actions.style.opacity = '0';

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
    await wait(120);
    this.actions.style.opacity = '1';
  }

  hide() {
    this.token++;
    this.root.classList.add('hidden');
  }
}
