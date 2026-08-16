import { el } from './dom';

/** Load screen. Doubles as the audio unlock gesture — see main.ts. */
export class Boot {
  private root: HTMLElement;
  private fill: HTMLElement;
  private note: HTMLElement;
  private playBtn: HTMLButtonElement;
  onPlay: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = el('div', { id: 'boot' });

    const logo = el('div', { class: 'logo' });
    logo.innerHTML = 'ROLL<br>CITY<small>stick the city to your ball</small>';

    const bar = el('div', { class: 'bar' });
    this.fill = el('i');
    bar.append(this.fill);

    this.note = el('div', { class: 'boot-note' }, 'Building the city…');

    this.playBtn = el('button', { class: 'btn', style: 'display:none' }, 'Play') as HTMLButtonElement;
    this.playBtn.addEventListener('click', () => this.onPlay());

    this.root.append(logo, bar, this.note, this.playBtn);
    parent.append(this.root);
  }

  setProgress(p: number) {
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
  }

  ready(tiers: number) {
    this.note.textContent = `${tiers} sizes to grow through`;
    this.playBtn.style.display = '';
    // The bar has done its job; the button is the only thing that matters now.
    this.fill.style.width = '100%';
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
