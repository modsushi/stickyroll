/**
 * The one place that decides which lit shader the game compiles to.
 *
 * Chrome on Android drives Samsung's GPU through ANGLE's Vulkan backend, and on
 * that path a full scene of `MeshStandardMaterial` intermittently loses whole
 * tiles: completed tiles show correct city, dropped ones come back black, and
 * because the dropped tiles take the clear with them the sky disappears too.
 * The result is a black screen flickering hard-edged wedges of the real game.
 *
 * This was isolated on-device with `?selftest=1`, which rendered the identical
 * scene — same 86 draw calls, same 251k triangles, same camera — twice:
 *
 *   PASS 9/9  full: basic override      [86 calls, 251k tris]
 *   FAIL 0/9  full: standard override   [86 calls, 251k tris]
 *
 * Geometry, instancing, fog, and both lights were each ruled out separately.
 * Fragment cost is the only axis left, so the city uses Lambert on touch
 * devices. Every kit material is `metalness: 0` with high roughness — purely
 * diffuse — so Lambert is visually near-identical here and dramatically
 * cheaper; the ACES grade and bloom do the work that PBR is not doing.
 *
 * `?lit=standard` forces PBR back on for comparison, `?lit=lambert` forces it
 * off on desktop.
 */

import {
  type Color,
  MeshLambertMaterial,
  MeshStandardMaterial,
  type Texture,
} from 'three';

export type LitMaterial = MeshStandardMaterial | MeshLambertMaterial;

export interface LitParams {
  color?: Color | number;
  map?: Texture | null;
  vertexColors?: boolean;
  flatShading?: boolean;
  /** Ignored on the Lambert path, which has no microfacet model. */
  roughness?: number;
  metalness?: number;
}

export type LitMode = 'standard' | 'lambert';

function detectMode(): LitMode {
  const forced = /[?&]lit=(standard|lambert)/.exec(
    typeof location === 'undefined' ? '' : location.search
  );
  if (forced) return forced[1] as LitMode;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse ? 'lambert' : 'standard';
}

export const litMode: LitMode = detectMode();

/** Builds a lit material in whichever shader this device can actually finish. */
export function makeLit(params: LitParams): LitMaterial {
  const { roughness, metalness, ...shared } = params;
  if (litMode === 'lambert') return new MeshLambertMaterial(shared);
  return new MeshStandardMaterial({
    ...shared,
    roughness: roughness ?? 1,
    metalness: metalness ?? 0,
  });
}
