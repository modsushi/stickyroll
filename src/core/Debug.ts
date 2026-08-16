/**
 * Query-string switches for development.
 *
 * These accumulated across debugging sessions (`?selftest=1`, `?bench=1`,
 * `?instancing=off`, `?lit=`, `?tier=`) as ad-hoc regexes scattered through the
 * modules that used them. Reading them through one place keeps the spellings
 * consistent and makes the full list discoverable.
 */

const search = () => (typeof location === 'undefined' ? '' : location.search);

/** Value of `?name=value`, or null when absent. */
export function param(name: string): string | null {
  const m = new RegExp(`[?&]${name}=([^&]*)`).exec(search());
  return m ? decodeURIComponent(m[1]) : null;
}

/** True for `?name=1` or a bare `?name`. */
export function on(name: string): boolean {
  return new RegExp(`[?&]${name}(=1)?(&|$)`).test(search());
}

/**
 * A switch that can be forced either way, with a default when unmentioned.
 * `?name=0` is false, `?name=1` (or bare `?name`) is true.
 */
export function toggle(name: string, fallback: boolean): boolean {
  const v = param(name);
  if (v === null) return on(name) ? true : fallback;
  return v !== '0' && v !== 'false';
}
