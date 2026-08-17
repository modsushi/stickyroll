/**
 * The mid-run upgrade draft: three cards, take one, keep it forever.
 *
 * Presentation carries most of the weight here. The cards are *dealt* — a
 * staggered flip with a sound each — rather than appearing together, because
 * three simultaneous options read as a form to fill in while three arriving
 * options read as a hand being offered. Once one is picked the other two are
 * pushed away and dimmed rather than deleted, so the choice stays visible for a
 * beat: seeing what you turned down is what makes the pick feel like a decision.
 *
 * The screen resolves a promise rather than firing a callback, so the caller
 * reads as "pause, await the pick, resume".
 */

import { sfx } from '../audio/Sfx';
import { bus } from '../core/Events';
import { playerState } from '../meta/Progression';
import { draftUpgrades, grantUpgrade, rankOf, type UpgradeDef } from '../meta/Upgrades';
import { animate, el, wait } from './dom';

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

export class RewardPicker {
  private root: HTMLElement;
  private grid: HTMLElement;
  private sub: HTMLElement;
  private resolve: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', { class: 'screen draft hidden' });
    this.sub = el('h2', {}, '');
    this.grid = el('div', { class: 'draft-grid' });
    this.root.append(
      el('h1', {}, 'Pick a Perk'),
      this.sub,
      this.grid,
      el('div', { class: 'draft-foot' }, 'Yours for good — it will be waiting next run')
    );
    parent.append(this.root);
  }

  /** @returns a promise that resolves once a card has been taken. */
  async show(): Promise<void> {
    const offers = draftUpgrades(3);
    // Every rank of everything is owned. Nothing to choose, so don't interrupt
    // the run to say so.
    if (!offers.length) return;

    const state = playerState();
    this.sub.textContent = `Level ${state.level} · ${state.title}`;
    this.grid.innerHTML = '';
    this.root.classList.remove('hidden');

    const cards = offers.map((u, i) => this.buildCard(u, i));
    for (const c of cards) this.grid.append(c.node);

    // Deal them in.
    for (let i = 0; i < cards.length; i++) {
      await wait(i === 0 ? 120 : 130);
      cards[i].node.classList.add('in');
      sfx.reveal(i);
    }

    return new Promise<void>((resolve) => {
      this.resolve = resolve;
      for (const c of cards) {
        c.node.addEventListener('click', () => this.take(c.def, c.node, cards.map((x) => x.node)));
      }
    });
  }

  private buildCard(def: UpgradeDef, index: number) {
    const owned = rankOf(def.id);
    const next = owned + 1;

    const node = el('div', { class: 'draft-card' });
    node.style.setProperty('--i', String(index));

    const value = def.format(next);
    const delta = owned > 0 ? `${def.format(owned)} → ${value}` : value;

    node.append(
      el('div', { class: 'dc-icon' }, def.icon),
      el('div', { class: 'dc-name' }, def.name),
      el('div', { class: 'dc-blurb' }, def.blurb.replace('{v}', value)),
      el('div', { class: 'dc-delta' }, delta),
      this.pips(def, owned),
      el('div', { class: 'dc-take' }, owned > 0 ? `Rank ${ROMAN[owned]}` : 'New')
    );
    return { node, def };
  }

  /** Rank track. The next rank is drawn as "arriving" so the gain is visible. */
  private pips(def: UpgradeDef, owned: number) {
    const wrap = el('div', { class: 'dc-pips' });
    for (let i = 0; i < def.maxRank; i++) {
      const cls = i < owned ? 'p on' : i === owned ? 'p next' : 'p';
      wrap.append(el('i', { class: cls }));
    }
    return wrap;
  }

  private async take(def: UpgradeDef, chosen: HTMLElement, all: HTMLElement[]) {
    if (this.root.classList.contains('resolving')) return;
    this.root.classList.add('resolving');

    const rank = grantUpgrade(def.id);
    bus.emit('upgradeTaken', { id: def.id, rank });
    sfx.choose();

    for (const n of all) n.classList.toggle('dropped', n !== chosen);
    chosen.classList.add('taken');

    // Fill the newly-earned pip by hand so the gain animates rather than being
    // true the instant the card is clicked.
    const pip = chosen.querySelector('.p.next');
    await animate(0.32, (t) => {
      chosen.style.setProperty('--pop', String(1 + Math.sin(t * Math.PI) * 0.09));
    });
    pip?.classList.add('on');

    await wait(620);
    this.hide();
    this.resolve?.();
    this.resolve = null;
  }

  hide() {
    this.root.classList.add('hidden');
    this.root.classList.remove('resolving');
  }
}
