/**
 * Selects the lit shader the game compiles to.
 *
 * This was added to chase an Android black screen on the theory that
 * `MeshStandardMaterial`'s fragment cost was the trigger. That theory was
 * wrong: on-device testing showed Lambert failing identically, and a quarter of
 * the pixels making no difference. The real cause was instanced draws reading
 * normals — see `Batch.ts`.
 *
 * The switch is kept because it is genuinely useful (every kit material is
 * `metalness: 0` with high roughness, so Lambert is near-identical here and
 * cheaper), but it no longer changes any default: both platforms get PBR unless
 * `?lit=lambert` asks otherwise. Defaults should not carry the residue of a
 * disproven diagnosis.
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
  return 'standard';
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
