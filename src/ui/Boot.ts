import { save } from '../core/Save';
import { DailyReward } from './DailyReward';
import { playerState } from '../meta/Progression';
import { el } from './dom';

/**
 * Load screen, and the launch menu.
 *
 * Doubles as the audio unlock gesture — see main.ts. Every button here counts
 * as that gesture, not just Play, so opening the shop first and starting a run
 * afterwards still gets sound.
 *
 * The level badge and gold purse sit above the logo rather than being tucked
 * into a submenu: the two numbers that measure a player's investment should be
 * the first thing they see when they come back, and the daily dot on the Rewards
 * button is the only nudge the game ever gives.
 */
export class Boot {
  private root: HTMLElement;
  private fill: HTMLElement;
  private note: HTMLElement;
  private playBtn: HTMLButtonElement;
  private menu: HTMLElement;
  private purse: HTMLElement;
  private dailyBtn: HTMLButtonElement;

  onPlay: () => void = () => {};
  onShop: () => void = () => {};
  onDaily: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = el('div', { id: 'boot' });

    this.purse = el('div', { class: 'purse' });

    const logo = el('div', { class: 'logo' });
    logo.innerHTML = 'ROLL<br>CITY<small>stick the city to your ball</small>';

    const bar = el('div', { class: 'bar' });
    this.fill = el('i');
    bar.append(this.fill);

    this.note = el('div', { class: 'boot-note' }, 'Building the city…');

    this.playBtn = el('button', { class: 'btn', style: 'display:none' }, 'Play') as HTMLButtonElement;
    this.playBtn.addEventListener('click', () => this.onPlay());

    const shopBtn = el('button', { class: 'btn ghost' }, 'Shop') as HTMLButtonElement;
    shopBtn.addEventListener('click', () => this.onShop());

    this.dailyBtn = el('button', { class: 'btn ghost' }, 'Rewards') as HTMLButtonElement;
    this.dailyBtn.addEventListener('click', () => this.onDaily());

    this.menu = el('div', { class: 'row boot-menu', style: 'display:none' });
    this.menu.append(shopBtn, this.dailyBtn);

    this.root.append(this.purse, logo, bar, this.note, this.playBtn, this.menu);
    parent.append(this.root);
  }

  setProgress(p: number) {
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
  }

  ready(tiers: number) {
    this.note.textContent = `${tiers} sizes to grow through`;
    this.playBtn.style.display = '';
    this.menu.style.display = '';
    // The bar has done its job; the button is the only thing that matters now.
    this.fill.style.width = '100%';
    this.refresh();
  }

  /** Repaints level, gold and the daily dot. Cheap; call it after any change. */
  refresh() {
    const state = playerState();
    this.purse.innerHTML = '';
    this.purse.append(
      el('span', { class: 'lv' }, `Lv ${state.level}`),
      el('span', { class: 'ti' }, state.title),
      el('span', { class: 'coin' }, '●'),
      el('span', { class: 'g' }, save.meta.gold.toLocaleString())
    );
    this.dailyBtn.classList.toggle('nudge', DailyReward.pending);
  }

  fail(message: string) {
    this.note.textContent = `Could not start: ${message}`;
    this.note.style.color = '#ff8a8a';
  }

  hide() {
    this.root.classList.add('gone');
    setTimeout(() => this.root.remove(), 600);
  }
}
