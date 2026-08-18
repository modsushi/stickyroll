/**
 * Uniform-grid broadphase over static props.
 *
 * The ball only ever queries a small disc around itself, so a flat hash with a
 * cell size near the largest query radius keeps stick tests O(1) regardless of
 * how many thousand props the level holds. Removal is O(1) via swap-pop because
 * absorbed props are pulled out constantly and array splice would dominate.
 */

export interface HashItem {
  x: number;
  z: number;
  /** Index within its cell's array, maintained for swap-pop removal. */
  _cell?: number;
  _slot?: number;
  _removed?: boolean;
}

export class SpatialHash<T extends HashItem> {
  private cells: T[][] = [];
  private cols: number;
  private rows: number;
  private items = 0;

  constructor(
    private minX: number,
    private minZ: number,
    width: number,
    depth: number,
    private cell = 3
  ) {
    this.cols = Math.max(1, Math.ceil(width / cell));
    this.rows = Math.max(1, Math.ceil(depth / cell));
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }

  private index(x: number, z: number) {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cell)));
    const cz = Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.minZ) / this.cell)));
    return cz * this.cols + cx;
  }

  insert(item: T) {
    const ci = this.index(item.x, item.z);
    const arr = this.cells[ci];
    item._cell = ci;
    item._slot = arr.length;
    item._removed = false;
    arr.push(item);
    this.items++;
  }

  remove(item: T) {
    if (item._removed || item._cell === undefined || item._slot === undefined) return;
    const arr = this.cells[item._cell];
    const slot = item._slot;
    const last = arr.pop()!;
    if (last !== item) {
      arr[slot] = last;
      last._slot = slot;
    }
    item._removed = true;
    item._cell = item._slot = undefined;
    this.items--;
  }

  /** Re-hashes a moving item only when it actually crosses a cell boundary. */
  update(item: T) {
    if (item._removed || item._cell === undefined) return;
    const next = this.index(item.x, item.z);
    if (next === item._cell) return;
    this.remove(item);
    this.insert(item);
  }

  /**
   * Visits every item whose cell overlaps the query disc. Callers still do the
   * precise distance test; this only rejects the obviously-far.
   */
  query(x: number, z: number, radius: number, visit: (item: T) => void) {
    const x0 = Math.max(0, Math.floor((x - radius - this.minX) / this.cell));
    const x1 = Math.min(this.cols - 1, Math.floor((x + radius - this.minX) / this.cell));
    const z0 = Math.max(0, Math.floor((z - radius - this.minZ) / this.cell));
    const z1 = Math.min(this.rows - 1, Math.floor((z + radius - this.minZ) / this.cell));
    for (let cz = z0; cz <= z1; cz++) {
      const row = cz * this.cols;
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.cells[row + cx];
        for (let i = 0; i < arr.length; i++) visit(arr[i]);
      }
    }
  }

  get size() {
    return this.items;
  }

  clear() {
    for (const c of this.cells) c.length = 0;
    this.items = 0;
  }
}
