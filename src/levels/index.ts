import { DOWNTOWN } from './downtown-01';
import { INTRO } from './intro-01';
import { RAIL_CITY } from './rail-city-01';
import type { LevelDef } from './types';

/**
 * Play order, and the only place it is written down.
 *
 * Downtown leads because it is the level that shows what the game *is*: a full
 * district, cars, buildings, both collection sets. Pocket Park is a smaller,
 * softer map and opening on it undersold the game to anyone deciding in the
 * first thirty seconds whether to keep playing. It now sits third, where its
 * clear-the-whole-block objective reads as a change of pace rather than a
 * tutorial.
 *
 * Unlocks follow this array rather than naming ids, so reordering is a one-line
 * change here — see `nextLevel` and `Game.end`.
 */
export const LEVELS: readonly LevelDef[] = [DOWNTOWN, RAIL_CITY, INTRO];

/** The level a fresh save starts on, and the fallback for an unknown id. */
export const FIRST_LEVEL = LEVELS[0];

export function levelById(id: string): LevelDef {
  return LEVELS.find((level) => level.id === id) ?? FIRST_LEVEL;
}

/** The next level in play order, or undefined at the end of the run of levels. */
export function nextLevel(id: string): LevelDef | undefined {
  const i = LEVELS.findIndex((level) => level.id === id);
  return i < 0 ? undefined : LEVELS[i + 1];
}
