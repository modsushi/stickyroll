import { DOWNTOWN } from './downtown-01';
import { INTRO } from './intro-01';
import { RAIL_CITY } from './rail-city-01';
import type { LevelDef } from './types';

export const LEVELS: readonly LevelDef[] = [INTRO, DOWNTOWN, RAIL_CITY];
export const INTRO_LEVEL = INTRO.id;
export const DOWNTOWN_LEVEL = DOWNTOWN.id;
export const RAIL_CITY_LEVEL = RAIL_CITY.id;

export function levelById(id: string): LevelDef {
  return LEVELS.find((level) => level.id === id) ?? INTRO;
}
