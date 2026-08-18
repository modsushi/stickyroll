import { Rand, clamp } from '../core/Math';
import type { LevelDef } from '../levels/types';
import type { BuiltCity } from './city/CityBuilder';
import type { PropInstance } from './city/Props';

interface Drifter {
  prop: PropInstance;
  speed: number;
  phase: number;
  sway: number;
}

/** Kits whose objects sit loose on the ground rather than being anchored. */
const LOOSE_KITS = new Set(['food', 'furniture', 'market']);

/**
 * Gusting ground wind for the picnic level.
 *
 * Props remain normal collectible instances: every visual translation updates
 * the same world coordinates used by sticking and then re-hashes only if the
 * object crossed a broadphase cell. Heavy furniture creeps; food skitters. At
 * the downwind wall the clamp naturally gathers objects into changing heaps.
 */
export class Wind {
  private drifters: Drifter[] = [];
  private dirX = 0;
  private dirZ = 0;
  private sideX = 0;
  private sideZ = 0;
  private strength = 0;
  private time = 0;
  private tick = 0;
  private boundsTimer = 0;

  constructor(level: LevelDef, private city: BuiltCity) {
    const spec = level.wind;
    if (!spec) return;

    const len = Math.hypot(spec.direction[0], spec.direction[1]);
    if (len < 1e-4) return;
    this.dirX = spec.direction[0] / len;
    this.dirZ = spec.direction[1] / len;
    this.sideX = -this.dirZ;
    this.sideZ = this.dirX;
    this.strength = Math.max(0, spec.strength ?? 1);

    const rand = new Rand(0x57a0d);
    for (const prop of city.props.all) {
      if (prop.blocker || !LOOSE_KITS.has(prop.def.kit)) continue;

      // Food has little ground friction. Chairs and baskets slide visibly;
      // benches, tables and market fixtures move slowly enough to retain mass.
      let base: number;
      if (prop.def.kit === 'food') {
        base = 0.34;
      } else if (prop.def.kit === 'furniture') {
        base = prop.def.absorbSize < 0.65 ? 0.17 : prop.def.absorbSize < 1.2 ? 0.095 : 0.045;
      } else {
        base = prop.def.absorbSize < 0.8 ? 0.12 : 0.06;
      }

      this.drifters.push({
        prop,
        speed: base * rand.range(0.72, 1.28),
        phase: rand.angle(),
        sway: rand.range(0.45, 1.25),
      });
    }
  }

  step(dt: number) {
    if (!this.drifters.length || this.strength <= 0) return;
    // Twenty position updates per second are visually continuous at these
    // drift speeds and avoid rewriting hundreds of merged vertex ranges at the
    // simulation's much higher fixed-step rate.
    this.tick += dt;
    if (this.tick < 1 / 20) return;
    const moveDt = Math.min(this.tick, 0.1);
    this.tick = 0;
    this.time += moveDt;
    let moved = false;
    const b = this.city.bounds;

    for (const item of this.drifters) {
      const p = item.prop;
      if (p.absorbed || !p.translate) continue;

      // Two incommensurate waves avoid the whole map accelerating in lockstep.
      const gust = 0.72
        + Math.sin(this.time * 0.83 + item.phase) * 0.2
        + Math.sin(this.time * 2.17 + item.phase * 1.7) * 0.08;
      const forward = item.speed * this.strength * Math.max(0.28, gust) * moveDt;
      const sideways = Math.sin(this.time * item.sway + item.phase) * item.speed * 0.18 * moveDt;

      const inset = clamp(p.def.absorbSize * 0.22, 0.45, 1.8);
      const nx = clamp(p.x + this.dirX * forward + this.sideX * sideways, b.minX + inset, b.maxX - inset);
      const nz = clamp(p.z + this.dirZ * forward + this.sideZ * sideways, b.minZ + inset, b.maxZ - inset);
      const dx = nx - p.x;
      const dz = nz - p.z;
      if (Math.abs(dx) + Math.abs(dz) < 1e-6) continue;

      p.x = nx;
      p.z = nz;
      p.translate(dx, dz);
      this.city.hash.update(p);
      moved = true;
    }

    // The map is one culling chunk, so bounds can be refreshed infrequently.
    // This keeps the moving merged/instanced batches correct without turning a
    // cheap visual effect into hundreds of bounds scans per second.
    this.boundsTimer += moveDt;
    if (moved && this.boundsTimer >= 0.75) {
      this.boundsTimer = 0;
      this.city.props.refitBounds();
    }
  }

  dispose() {
    this.drifters.length = 0;
  }
}
