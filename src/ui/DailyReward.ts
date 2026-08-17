/**
 * The daily reward screen: seven cards, one claim.
 *
 * Shown automatically on the boot screen when something is waiting, and
 * reachable from the pause menu the rest of the day so it can always explain
 * itself rather than silently disappearing.
 *
 * The animation does one specific job: it shows the *whole week* before it
 * shows today. Claiming day 3 in isolation is 130 gold and forgettable; claiming
 * day 3 with day 7's 600 sitting visibly four cards along is a reason to come
 * back on Thursday. So the row is dealt left to right, past days stamped as
 * taken, and only then does today's card flip and pay out.
 */

import { sfx } from '../audio/Sfx';
import { bus } from '../core/Events';
import { save } from '../core/Save';
import { claimDaily, CYCLE, DAILY_GOLD, dailyState } from '../meta/Daily';
import { perks } from '../meta/Upgrades';
import { animate, el, wait } from './dom';

export class DailyReward {
  private root: HTMLElement;
  private row: HTMLElement;
  private sub: HTMLElement;
  private action: HTMLButtonElement;
  private resolve: (() => void) | null = null;
  private busy = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', { class: 'screen daily hidden' });
    this.sub = el('h2', {}, '');
    this.row = el('div', { class: 'daily-row' });
    this.action = el('button', { class: 'btn' }, 'Claim') as HTMLButtonElement;
    this.action.addEventListener('click', () => this.claim());

    this.root.append(el('h1', {}, 'Daily Reward'), this.sub, this.row, this.action);
    parent.append(this.root);
  }

  /** True when there is something to claim today. */
  static get pending() {
    return dailyState().claimable;
  }

  async show(): Promise<void> {
    const state = dailyState();
    this.busy = false;

    this.sub.textContent = state.claimable
      ? state.broken
        ? 'Streak reset — starting again'
        : `Day ${state.index + 1} of ${CYCLE}`
      : `Claimed — come back tomorrow for ${DAILY_GOLD[(state.index + 1) % CYCLE]}`;

    this.row.innerHTML = '';
    const cards: HTMLElement[] = [];
    for (let i = 0; i < CYCLE; i++) {
      // Days before today's index in this cycle are already banked; the rest are
      // ahead. `taken` is per-cycle, not lifetime — the row is a week, not a log.
      const done = i < state.index || (!state.claimable && i <= state.index);
      const today = state.claimable && i === state.index;
      const card = el('div', {
        class: `day${done ? ' done' : ''}${today ? ' today' : ''}${i === CYCLE - 1 ? ' big' : ''}`,
      });
      card.style.setProperty('--i', String(i));
      card.append(
        el('div', { class: 'd-n' }, `Day ${i + 1}`),
        el('div', { class: 'd-coin' }, '●'),
        el('div', { class: 'd-v' }, String(Math.round(DAILY_GOLD[i] * perks().dailyMult)))
      );
      if (done) card.append(el('div', { class: 'd-tick' }, '✓'));
      this.row.append(card);
      cards.push(card);
    }

    this.action.textContent = state.claimable ? `Claim ${state.amount}` : 'Back';
    this.action.disabled = false;
    this.root.classList.remove('hidden');

    // Deal the week in.
    for (let i = 0; i < cards.length; i++) {
      await wait(70);
      cards[i].classList.add('in');
      if (i === state.index && state.claimable) sfx.reveal(2);
      else sfx.tick(0.7 + i * 0.14);
    }

    return new Promise<void>((r) => {
      this.resolve = r;
    });
  }

  private async claim() {
    if (this.busy) return;
    const state = dailyState();
    if (!state.claimable) {
      sfx.click();
      return this.finish();
    }

    this.busy = true;
    this.action.disabled = true;
    const amount = claimDaily();
    if (!amount) return this.finish();

    bus.emit('goldChange', { gold: save.meta.gold, delta: amount });

    const card = this.row.children[state.index] as HTMLElement;
    card.classList.add('claimed');
    sfx.purchase();

    // Coin shower out of the claimed card. Purely decorative and entirely the
    // point: the number was already added, this is the part people remember.
    const rect = card.getBoundingClientRect();
    for (let i = 0; i < 14; i++) this.spawnCoin(rect.left + rect.width / 2, rect.top + rect.height / 2, i);

    let ticks = 0;
    await animate(0.9, (t) => {
      const want = Math.floor(t * 9);
      while (ticks < want) {
        ticks++;
        sfx.coin(0.85 + ticks * 0.06);
      }
    });

    this.sub.textContent = `+${amount} gold · streak ${state.streak}`;
    this.action.textContent = 'Nice';
    this.action.disabled = false;
    this.busy = false;
  }

  private spawnCoin(x: number, y: number, i: number) {
    const coin = el('div', { class: 'coin-fly' }, '●');
    const angle = (-90 + (i - 7) * 11) * (Math.PI / 180);
    const dist = 90 + Math.random() * 120;
    coin.style.left = `${x}px`;
    coin.style.top = `${y}px`;
    coin.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    coin.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    coin.style.setProperty('--d', `${i * 24}ms`);
    this.root.append(coin);
    setTimeout(() => coin.remove(), 1200 + i * 24);
  }

  private finish() {
    this.hide();
    this.resolve?.();
    this.resolve = null;
  }

  hide() {
    this.root.classList.add('hidden');
  }
}
