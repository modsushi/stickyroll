import { sfx } from '../audio/Sfx';
import { audio } from '../audio/AudioEngine';
import { save } from '../core/Save';
import { el } from './dom';

export class Pause {
  private root: HTMLElement;
  private diag: HTMLElement;
  /** Set by main so the pause screen can report how the frame is being drawn. */
  describeRenderer: () => string = () => '';
  onResume: () => void = () => {};
  onRestart: () => void = () => {};
  onCollection: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = el('div', { class: 'screen hidden' });

    const music = this.slider('Music', save.data.settings.music, (v) => audio.setMusicVolume(v));
    const sound = this.slider('Sound', save.data.settings.sfx, (v) => audio.setSfxVolume(v));

    const resume = el('button', { class: 'btn' }, 'Resume');
    resume.addEventListener('click', () => {
      sfx.click();
      this.hide();
      this.onResume();
    });

    const restart = el('button', { class: 'btn ghost' }, 'Restart');
    restart.addEventListener('click', () => {
      sfx.click(true);
      this.onRestart();
    });

    const coll = el('button', { class: 'btn ghost' }, 'Collection');
    coll.addEventListener('click', () => {
      sfx.click(true);
      this.hide();
      this.onCollection();
    });

    const row = el('div', { class: 'row' });
    row.append(restart, coll);

    // Reachable on a phone, where there is no F3 key. If the canvas ever comes
    // up black again this is the first thing worth reading.
    this.diag = el('div', {
      style: 'font-size:10px;opacity:.45;letter-spacing:.08em;white-space:pre;text-align:center',
    });

    this.root.append(el('h1', {}, 'Paused'), music, sound, resume, row, this.diag);
    parent.append(this.root);
  }

  private slider(label: string, value: number, onChange: (v: number) => void) {
    const wrap = el('label', { class: 'slider' });
    const input = el('input', {
      type: 'range',
      min: '0',
      max: '1',
      step: '0.05',
      value: String(value),
    }) as HTMLInputElement;
    input.addEventListener('input', () => onChange(parseFloat(input.value)));
    // Only click on release, or dragging the slider machine-guns the sound.
    input.addEventListener('change', () => sfx.click(true));
    wrap.append(el('span', {}, label), input);
    return wrap;
  }

  show() {
    this.diag.textContent = this.describeRenderer();
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  get visible() {
    return !this.root.classList.contains('hidden');
  }
}
