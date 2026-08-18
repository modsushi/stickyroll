/**
 * Versioned localStorage save.
 *
 * v1 was allowed to discard anything it could not read, on the grounds that a
 * casual game's progress is cheap. That stopped being true the moment the save
 * started holding gold, upgrade ranks and purchased skins: dropping those is
 * deleting something the player spent hours earning, and "the schema is young"
 * is no longer an excuse. v1 saves are therefore *migrated*, and only genuinely
 * corrupt JSON is discarded.
 */

const KEY = 'rollmasters.save.v1';

/** Persistent meta-progression. Everything here survives between runs. */
export interface MetaData {
  /** Lifetime experience; the player level is derived from it. */
  xp: number;
  /** Spendable currency, claimed from run scores and daily rewards. */
  gold: number;
  /** upgradeId -> rank owned (1-based; absent means not owned). */
  upgrades: Record<string, number>;
  /** Skin ids the player owns. `classic` is always present. */
  skins: string[];
  /** Currently equipped skin id. */
  equipped: string;
  /** Local date (YYYY-MM-DD) of the last daily claim; '' if never. */
  lastClaim: string;
  /** Consecutive days claimed, 1-based. 0 before the first claim. */
  streak: number;
  /** Runs finished. Drives "first run" special-casing in the UI. */
  runs: number;
  /** Lifetime gold earned, for the shop header. */
  earned: number;
}

export interface SaveData {
  version: 2;
  /** propId -> lifetime count absorbed, drives the collection gallery. */
  collection: Record<string, number>;
  /** levelId -> best result. */
  levels: Record<string, { score: number; stars: number; bestCombo: number }>;
  /** Level ids available from the level selector. */
  unlockedLevels: string[];
  /** One-time teaching cues already dismissed. */
  tutorials: Record<string, boolean>;
  settings: {
    music: number;
    sfx: number;
    quality: 'auto' | 'low' | 'high';
    /**
     * Device vibration on a demolition. Stored for every platform, honoured
     * only where the Vibration API exists (see `core/Haptics.ts`), so a save
     * carried from a phone to a desktop keeps the preference rather than
     * silently losing it.
     */
    haptics: boolean;
  };
  totalAbsorbed: number;
  meta: MetaData;
}

const freshMeta = (): MetaData => ({
  xp: 0,
  gold: 0,
  upgrades: {},
  skins: ['classic'],
  equipped: 'classic',
  lastClaim: '',
  streak: 0,
  runs: 0,
  earned: 0,
});

const fresh = (): SaveData => ({
  version: 2,
  collection: {},
  levels: {},
  unlockedLevels: ['intro-01'],
  tutorials: {},
  settings: { music: 0.7, sfx: 0.85, quality: 'auto', haptics: true },
  totalAbsorbed: 0,
  meta: freshMeta(),
});

function read(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const parsed = JSON.parse(raw) as Partial<SaveData> & { version?: number };
    // A save written by a newer build cannot be read correctly, and guessing at
    // it would write back a mangled version. Starting fresh is the only honest
    // option — but it only happens to someone who has downgraded.
    if (typeof parsed?.version !== 'number' || parsed.version > 2) return fresh();

    // v1 -> v2 is purely additive, so the migration is the same merge the
    // defensive path already does. Collection, best scores and settings all
    // carry across untouched, and a setting added later (haptics) picks up its
    // default from `fresh()` for a save written before it existed — which is
    // why new settings do not need a version bump, only additive ones.
    const base = fresh();
    const unlocked = Array.isArray(parsed.unlockedLevels)
      ? [...new Set(['intro-01', ...parsed.unlockedLevels])]
      : ['intro-01', 'downtown-01'];
    // Existing players who already earned a Downtown star should not have to
    // replay it merely because Rail City shipped after their save was written.
    if ((parsed.levels?.['downtown-01']?.stars ?? 0) > 0 && !unlocked.includes('rail-city-01')) {
      unlocked.push('rail-city-01');
    }

    return {
      ...base,
      ...parsed,
      version: 2,
      settings: { ...base.settings, ...parsed.settings },
      // Existing players already had Downtown as their only option, so never
      // make an update appear to take content away from them.
      unlockedLevels: unlocked,
      tutorials: { ...base.tutorials, ...parsed.tutorials },
      meta: { ...base.meta, ...parsed.meta, skins: dedupeSkins(parsed.meta?.skins) },
    };
  } catch {
    return fresh();
  }
}

/** The free skin must always be owned, whatever the stored array says. */
function dedupeSkins(list: string[] | undefined): string[] {
  const set = new Set(Array.isArray(list) ? list.filter((s) => typeof s === 'string') : []);
  set.add('classic');
  return [...set];
}

class SaveStore {
  data: SaveData = read();
  private pending = 0;

  /** Coalesces the write bursts that happen while absorbing a pile of props. */
  private schedule() {
    if (this.pending) return;
    this.pending = window.setTimeout(() => {
      this.pending = 0;
      this.flush();
    }, 400);
  }

  /**
   * Writes immediately. Spending gold or claiming a reward must survive the tab
   * being closed the instant after the button is pressed, and a 400 ms debounce
   * does not guarantee that.
   */
  flush() {
    if (this.pending) {
      clearTimeout(this.pending);
      this.pending = 0;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* private browsing / quota — gameplay continues without persistence */
    }
  }

  addToCollection(propId: string, n = 1) {
    this.data.collection[propId] = (this.data.collection[propId] ?? 0) + n;
    this.data.totalAbsorbed += n;
    this.schedule();
  }

  countOf(propId: string) {
    return this.data.collection[propId] ?? 0;
  }

  discoveredCount() {
    return Object.keys(this.data.collection).length;
  }

  recordLevel(levelId: string, score: number, stars: number, bestCombo: number) {
    const prev = this.data.levels[levelId];
    this.data.levels[levelId] = {
      score: Math.max(prev?.score ?? 0, score),
      stars: Math.max(prev?.stars ?? 0, stars),
      bestCombo: Math.max(prev?.bestCombo ?? 0, bestCombo),
    };
    this.schedule();
  }

  best(levelId: string) {
    return this.data.levels[levelId];
  }

  unlocked(levelId: string) {
    return this.data.unlockedLevels.includes(levelId);
  }

  unlock(levelId: string) {
    if (this.unlocked(levelId)) return false;
    this.data.unlockedLevels.push(levelId);
    this.flush();
    return true;
  }

  sawTutorial(id: string) {
    return Boolean(this.data.tutorials[id]);
  }

  completeTutorial(id: string) {
    if (this.data.tutorials[id]) return;
    this.data.tutorials[id] = true;
    this.flush();
  }

  setSetting<K extends keyof SaveData['settings']>(k: K, v: SaveData['settings'][K]) {
    this.data.settings[k] = v;
    this.schedule();
  }

  // ── meta ────────────────────────────────────────────────────────────────

  get meta() {
    return this.data.meta;
  }

  addXp(n: number) {
    this.data.meta.xp += Math.max(0, Math.round(n));
    this.flush();
  }

  addGold(n: number) {
    const amount = Math.max(0, Math.round(n));
    this.data.meta.gold += amount;
    this.data.meta.earned += amount;
    this.flush();
  }

  /** @returns false (and spends nothing) if the player cannot afford it. */
  spendGold(n: number): boolean {
    if (this.data.meta.gold < n) return false;
    this.data.meta.gold -= n;
    this.flush();
    return true;
  }

  countRun() {
    this.data.meta.runs++;
    this.flush();
  }

  reset() {
    this.data = fresh();
    this.flush();
  }
}

export const save = new SaveStore();
