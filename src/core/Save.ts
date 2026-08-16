/**
 * Versioned localStorage save. Anything unreadable is discarded rather than
 * migrated — losing a casual game's progress is better than booting into a
 * broken state, and the schema is young.
 */

const KEY = 'rollmasters.save.v1';

export interface SaveData {
  version: 1;
  /** propId -> lifetime count absorbed, drives the collection gallery. */
  collection: Record<string, number>;
  /** levelId -> best result. */
  levels: Record<string, { score: number; stars: number; bestCombo: number }>;
  settings: { music: number; sfx: number; quality: 'auto' | 'low' | 'high' };
  totalAbsorbed: number;
}

const fresh = (): SaveData => ({
  version: 1,
  collection: {},
  levels: {},
  settings: { music: 0.7, sfx: 0.85, quality: 'auto' },
  totalAbsorbed: 0,
});

function read(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const parsed = JSON.parse(raw) as SaveData;
    if (parsed?.version !== 1) return fresh();
    // Defensive: a partially-written save shouldn't crash the boot path.
    return { ...fresh(), ...parsed, settings: { ...fresh().settings, ...parsed.settings } };
  } catch {
    return fresh();
  }
}

class SaveStore {
  data: SaveData = read();
  private pending = 0;

  /** Coalesces the write bursts that happen while absorbing a pile of props. */
  private schedule() {
    if (this.pending) return;
    this.pending = window.setTimeout(() => {
      this.pending = 0;
      try {
        localStorage.setItem(KEY, JSON.stringify(this.data));
      } catch {
        /* private browsing / quota — gameplay continues without persistence */
      }
    }, 400);
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

  setSetting<K extends keyof SaveData['settings']>(k: K, v: SaveData['settings'][K]) {
    this.data.settings[k] = v;
    this.schedule();
  }

  reset() {
    this.data = fresh();
    this.schedule();
  }
}

export const save = new SaveStore();
