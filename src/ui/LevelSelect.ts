import { sfx } from '../audio/Sfx';
import { save } from '../core/Save';
import { LEVELS } from '../levels';
import type { LevelDef } from '../levels/types';
import { el } from './dom';

/**
 * Small, data-driven selector so adding a level is a registry entry.
 *
 * Reached from the pause menu and the results screen — never on the way *into*
 * a run, which now drops straight onto the map. That is why it has a Back
 * button: it is somewhere you go and come back from, not a gate you pass
 * through.
 */
export class LevelSelect {
  private root: HTMLElement;
  private list: HTMLElement;
  onSelect: (level: LevelDef) => void = () => {};
  onClose: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = el('div', { class: 'screen level-select hidden' });
    this.list = el('div', { class: 'level-list' });

    const back = el('button', { class: 'btn ghost' }, 'Back');
    back.addEventListener('click', () => {
      sfx.click(true);
      this.hide();
      this.onClose();
    });

    this.root.append(el('h1', {}, 'Choose a Level'), this.list, back);
    parent.append(this.root);
  }

  show() {
    this.list.innerHTML = '';
    for (let i = 0; i < LEVELS.length; i++) {
      const level = LEVELS[i];
      const unlocked = save.unlocked(level.id);
      const best = save.best(level.id);
      // Locked copy names the level that opens this one, which follows the
      // array order — the same order `Game.end` unlocks along.
      const previous = LEVELS[Math.max(0, i - 1)];
      const button = el('button', { class: 'level-card' }) as HTMLButtonElement;
      button.disabled = !unlocked;
      button.append(
        el('strong', {}, level.name),
        el('span', {}, level.subtitle),
        el(
          'small',
          {},
          unlocked
            ? best
              ? `Best ${best.score.toLocaleString()} · ${best.stars}★`
              : `${level.time}s · Ready to play`
            : `Earn a star in ${previous.name} to unlock`
        )
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
