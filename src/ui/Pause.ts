import { sfx } from '../audio/Sfx';
import { audio } from '../audio/AudioEngine';
import { save } from '../core/Save';
import { playerState } from '../meta/Progression';
import { rankOf, UPGRADES } from '../meta/Upgrades';
import { el } from './dom';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

export class Pause {
  private root: HTMLElement;
  private diag: HTMLElement;
  private purse: HTMLElement;
  private perkStrip: HTMLElement;
  /** Set by main so the pause screen can report how the frame is being drawn. */
  describeRenderer: () => string = () => '';
  onResume: () => void = () => {};
  onRestart: () => void = () => {};
  onCollection: () => void = () => {};
  onShop: () => void = () => {};
  onDaily: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = el('div', { class: 'screen hidden' });
    this.purse = el('div', { class: 'purse' });
    this.perkStrip = el('div', { class: 'perk-strip' });

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

    const shop = el('button', { class: 'btn ghost' }, 'Shop');
    shop.addEventListener('click', () => {
      sfx.click(true);
      this.hide();
      this.onShop();
    });

    const daily = el('button', { class: 'btn ghost' }, 'Rewards');
    daily.addEventListener('click', () => {
      sfx.click(true);
      this.hide();
      this.onDaily();
    });

    const row = el('div', { class: 'row' });
    row.append(restart, shop, coll, daily);

    // Reachable on a phone, where there is no F3 key. If the canvas ever comes
    // up black again this is the first thing worth reading.
    this.diag = el('div', {
      style: 'font-size:10px;opacity:.45;letter-spacing:.08em;white-space:pre;text-align:center',
    });

    this.root.append(
      el('h1', {}, 'Paused'), this.purse, this.perkStrip,
      music, sound, resume, row, this.diag
    );
    parent.append(this.root);
  }

  /** Level and gold, repainted every time the panel opens. */
  private paintPurse() {
    const state = playerState();
    this.purse.innerHTML = '';
    this.purse.append(
      el('span', { class: 'lv' }, `Lv ${state.level}`),
      el('span', { class: 'ti' }, state.title),
      el('span', { class: 'coin' }, '●'),
      el('span', { class: 'g' }, save.meta.gold.toLocaleString())
    );
  }

  /**
   * Everything permanently earned so far.
   *
   * Without this the draft is the only place an upgrade is ever seen: you take
   * a card, it works silently forever, and by run ten nobody can say what their
   * ball actually does. The strip is deliberately terse — icon, rank, current
   * value on hover — because it is a reminder, not a spreadsheet.
   */
  private paintPerks() {
    this.perkStrip.innerHTML = '';
    const owned = UPGRADES.filter((u) => rankOf(u.id) > 0);
    if (!owned.length) {
      this.perkStrip.append(
        el('span', { class: 'none' }, 'No perks yet — one is offered every run')
      );
      return;
    }
    for (const u of owned) {
      const rank = rankOf(u.id);
      const chip = el('span', { class: 'perk' });
      chip.append(
        el('span', { class: 'ic' }, u.icon),
        el('span', { class: 'r' }, ROMAN[rank] ?? String(rank))
      );
      chip.title = `${u.name} — ${u.blurb.replace('{v}', u.format(rank))}`;
      this.perkStrip.append(chip);
    }
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
    this.paintPurse();
    this.paintPerks();
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  get visible() {
    return !this.root.classList.contains('hidden');
  }
}
