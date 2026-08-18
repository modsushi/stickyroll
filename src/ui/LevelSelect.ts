import { save } from '../core/Save';
import { LEVELS } from '../levels';
import type { LevelDef } from '../levels/types';
import { el } from './dom';

/** Small, data-driven selector so adding a third level is a registry entry. */
export class LevelSelect {
  private root: HTMLElement;
  private list: HTMLElement;
  onSelect: (level: LevelDef) => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = el('div', { class: 'screen level-select hidden' });
    this.list = el('div', { class: 'level-list' });
    this.root.append(el('h1', {}, 'Choose a Level'), this.list);
    parent.append(this.root);
  }

  show() {
    this.list.innerHTML = '';
    for (let i = 0; i < LEVELS.length; i++) {
      const level = LEVELS[i];
      const unlocked = save.unlocked(level.id);
      const best = save.best(level.id);
      const previous = LEVELS[Math.max(0, i - 1)];
      const lockedCopy = level.id === 'rail-city-01'
        ? 'Earn a star in Downtown Sweep to unlock'
        : `Complete ${previous.name} to unlock`;
      const button = el('button', { class: 'level-card' }) as HTMLButtonElement;
      button.disabled = !unlocked;
      button.append(
        el('strong', {}, level.name),
        el('span', {}, level.subtitle),
        el('small', {}, unlocked ? (best ? `Best ${best.score.toLocaleString()} · ${best.stars}★` : `${level.time}s · Ready to play`) : lockedCopy)
      );
      if (unlocked) button.addEventListener('click', () => this.onSelect(level));
      this.list.append(button);
    }
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }
}
