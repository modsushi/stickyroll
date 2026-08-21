import { save } from '../core/Save';
import { playerState } from '../meta/Progression';
import { el } from './dom';

/**
 * Load screen, then the start prompt — and nothing else.
 *
 * It used to be a menu: Play, Shop, Rewards, then a level list, then a daily
 * reward modal, and only then a ball you could move. Four taps and two modals
 * between opening the page and playing the game is a lot to ask of someone who
 * has not yet been shown why they should care.
 *
 * So the district is built *behind* this screen and the backdrop drops away as
 * soon as it is ready. What is left is a logo, the drag instruction, and a
 * surface that starts the run wherever you touch it. Shop, Rewards, Collection
 * and the level list all moved to the pause menu, which is now the game's only
 * menu — see `Pause`.
 *
 * Doubles as the audio unlock gesture, which is why the tap goes through
 * `onPlay` in main rather than starting the game directly.
 */
export class Boot {
  private root: HTMLElement;
  private fill: HTMLElement;
  private note: HTMLElement;
  private prompt: HTMLElement;
  private purse: HTMLElement;
  private bar: HTMLElement;
  private top: HTMLElement;
  private started = false;

  onPlay: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = el('div', { id: 'boot' });

    this.purse = el('div', { class: 'purse' });

    const logo = el('div', { class: 'logo' });
    logo.innerHTML = 'ROLL<br>CITY<small>stick the city to your ball</small>';

    this.bar = el('div', { class: 'bar' });
    this.fill = el('i');
    this.bar.append(this.fill);

    this.note = el('div', { class: 'boot-note' }, 'Building the city…');

    // The drag instruction and the start gesture are the same element on
    // purpose: whatever a first-time player reaches for, they hit the thing
    // that begins the run.
    this.prompt = el('div', { class: 'start-prompt', style: 'display:none' });
    this.prompt.append(
      el('span', { class: 'finger' }, '👇'),
      el('span', { class: 'lead' }, 'Drag anywhere to roll'),
      el('span', { class: 'tap' }, 'Tap to start')
    );

    // Two stacked groups pinned to the top and bottom edges, so the middle of
    // the screen — where the ball is — stays clear.
    this.top = el('div', { class: 'boot-top' });
    this.top.append(this.purse, logo);
    const bottom = el('div', { class: 'boot-bottom' });
    bottom.append(this.bar, this.note, this.prompt);
    this.root.append(this.top, bottom);

    // `pointerdown` first, because on a phone the run should begin on touchdown
    // so the drag that follows is already steering the ball rather than being
    // swallowed as the gesture that dismissed a menu.
    //
    // `click` and the keyboard are backstops, not niceties. This overlay is the
    // only way into the game now, so a device or an assistive tool that does
    // not deliver a pointer event the way we expect must not leave the player
    // staring at an unstartable title screen. `onPlay` is guarded against being
    // run twice, so overlapping events are harmless.
    const go = () => {
      if (this.started) this.onPlay();
    };
    this.root.addEventListener('pointerdown', go);
    this.root.addEventListener('click', go);
    this.root.tabIndex = 0;
    this.root.setAttribute('role', 'button');
    this.root.setAttribute('aria-label', 'Tap to start');
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });

    parent.append(this.root);
  }

  setProgress(p: number) {
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
  }

  /**
   * Drops the loading backdrop, revealing the built city underneath.
   *
   * The progress bar goes with it, and the caption stops describing the
   * download and starts selling the game — but it moves up under the logo to do
   * it, because stacked above the drag prompt it crowded the one instruction
   * that still matters.
   */
  ready(tiers: number) {
    this.started = true;
    this.note.textContent = `${tiers} sizes to grow through`;
    this.top.append(this.note);
    this.bar.style.display = 'none';
    this.prompt.style.display = '';
    this.root.classList.add('live');
    this.refresh();
  }

  /** Repaints level and gold. Cheap; call it after any change. */
  refresh() {
    const state = playerState();
    this.purse.innerHTML = '';
    this.purse.append(
      el('span', { class: 'lv' }, `Lv ${state.level}`),
      el('span', { class: 'ti' }, state.title),
      el('span', { class: 'coin' }, '●'),
      el('span', { class: 'g' }, save.meta.gold.toLocaleString())
    );
  }

  fail(message: string) {
    this.note.textContent = `Could not start: ${message}`;
    this.note.style.color = '#ff8a8a';
  }

  hide() {
    this.started = false;
    this.root.classList.add('gone');
    setTimeout(() => this.root.remove(), 600);
  }
}
