import { DOWNTOWN } from './downtown-01';
import { INTRO } from './intro-01';
import type { LevelDef } from './types';

export const LEVELS: readonly LevelDef[] = [INTRO, DOWNTOWN];
export const INTRO_LEVEL = INTRO.id;
export const DOWNTOWN_LEVEL = DOWNTOWN.id;

export function levelById(id: string): LevelDef {
  return LEVELS.find((level) => level.id === id) ?? INTRO;
}
