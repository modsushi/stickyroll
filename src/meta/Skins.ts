/**
 * Ball skins: what gold actually buys.
 *
 * A skin is a material for the core sphere and nothing else — no gameplay
 * effect, no stat, no advantage. That is deliberate. The moment a cosmetic
 * carries a bonus the shop stops being an expression of taste and becomes a
 * power ladder, and a casual game does not want players buying the ugly one
 * because it rolls faster.
 *
 * Most of these are one small GLSL injection into the standard lit shader
 * rather than whole new materials. Patching `<color_fragment>` and
 * `<emissivemap_fragment>` means every skin still gets the game's real lighting,
 * shadows, fog and tone mapping for free; a hand-written ShaderMaterial would
 * have to reimplement all of it and would look pasted-on next to the city.
 *
 * Two rules learned the hard way, both encoded below:
 *
 *  - **Every patched material needs its own `customProgramCacheKey`.** Three
 *    keys compiled programs by material type and defines, and `onBeforeCompile`
 *    is not part of that key — so two skins would silently share one compiled
 *    shader and the second would render as the first.
 *  - **Skins always use `MeshStandardMaterial` directly**, not `makeLit`. The
 *    `?lit=lambert` debug path builds a different shader whose chunks these
 *    patches do not match. The ball is one mesh, so the cost of pinning it to
 *    the PBR path is nothing.
 */

import { Color, MeshStandardMaterial } from 'three';
import { save } from '../core/Save';

export interface SkinDef {
  id: string;
  name: string;
  blurb: string;
  /** Gold cost. 0 means owned from the start. */
  price: number;
  /** Player level required before it can be bought. */
  unlock: number;
  /** Two CSS colours, used for the shop tile's background wash. */
  swatch: [string, string];
  build(): MeshStandardMaterial;
}

/**
 * One shared clock for every animated skin. Assigned into each patched
 * material's uniform block, so a single `tickSkins` drives them all — and a
 * skin that is not on screen costs nothing because its material is not drawn.
 */
const clock = { value: 0 };

export function tickSkins(dt: number) {
  clock.value += dt;
}

/** GLSL available to every patched skin. */
const COMMON = /* glsl */ `
varying vec3 vSkinPos;
varying vec3 vSkinWorld;
varying vec3 vSkinWorldNrm;
uniform float uTime;

float skinHash(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float skinNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(skinHash(i), skinHash(i + vec3(1,0,0)), f.x),
        mix(skinHash(i + vec3(0,1,0)), skinHash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(skinHash(i + vec3(0,0,1)), skinHash(i + vec3(1,0,1)), f.x),
        mix(skinHash(i + vec3(0,1,1)), skinHash(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}

/** Cosine palette: one float in, a saturated rainbow out. */
vec3 skinHue(float h) {
  return 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67)));
}

float skinFresnel() {
  vec3 v = normalize(cameraPosition - vSkinWorld);
  return 1.0 - abs(dot(v, normalize(vSkinWorldNrm)));
}
`;

interface Patch {
  /** Assigns `diffuseColor`, run inside `<color_fragment>`. */
  diffuse?: string;
  /** Adds to `totalEmissiveRadiance`, run inside `<emissivemap_fragment>`. */
  emissive?: string;
}

/**
 * Wraps a material so its fragment shader runs `patch`.
 *
 * The vertex side exists only to carry object-space position and world-space
 * normal into the fragment stage: patterns have to be anchored to the *ball*,
 * not to the screen, or they swim as it rolls — which is exactly the tell that
 * makes a procedural skin look cheap.
 */
function patched(id: string, params: ConstructorParameters<typeof MeshStandardMaterial>[0], patch: Patch) {
  const mat = new MeshStandardMaterial(params);

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = clock;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vSkinPos;
         varying vec3 vSkinWorld;
         varying vec3 vSkinWorldNrm;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vSkinPos = normalize(position);
         vSkinWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vSkinWorldNrm = normalize(mat3(modelMatrix) * normal);`
      );

    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${COMMON}`);

    if (patch.diffuse) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n{\n${patch.diffuse}\n}`
      );
    }
    if (patch.emissive) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n{\n${patch.emissive}\n}`
      );
    }
  };

  // Without this every patched skin shares one compiled program — see the file
  // header. The bug looks like "the shop sells the same ball twelve times".
  mat.customProgramCacheKey = () => `skin:${id}`;
  return mat;
}

export const SKINS: SkinDef[] = [
  {
    id: 'classic',
    name: 'Chalk',
    blurb: 'The original. Honest, matte, unbothered.',
    price: 0,
    unlock: 1,
    swatch: ['#fdfcf7', '#ddd8cb'],
    build: () =>
      new MeshStandardMaterial({
        color: new Color(0xf6f4ef),
        roughness: 0.55,
        metalness: 0.02,
        flatShading: true,
      }),
  },

  {
    id: 'beach',
    name: 'Beach Ball',
    blurb: 'Six bright panels and two white caps.',
    price: 120,
    unlock: 1,
    swatch: ['#ff6b6b', '#4ecdc4'],
    build: () =>
      patched(
        'beach',
        { color: 0xffffff, roughness: 0.32, metalness: 0.0, flatShading: true },
        {
          diffuse: `
            float a = atan(vSkinPos.z, vSkinPos.x) / 6.28318 + 0.5;
            vec3 c = mix(vec3(1.0), skinHue(floor(a * 6.0) / 6.0 + 0.06), 0.88);
            float cap = smoothstep(0.68, 0.9, abs(vSkinPos.y));
            diffuseColor.rgb = mix(c, vec3(1.0), cap);`,
        }
      ),
  },

  {
    id: 'melon',
    name: 'Watermelon',
    blurb: 'Wobbly rind stripes. Suspiciously edible.',
    price: 200,
    unlock: 1,
    swatch: ['#3f8f2c', '#1d4a17'],
    build: () =>
      patched(
        'melon',
        { color: 0xffffff, roughness: 0.4, metalness: 0.0, flatShading: true },
        {
          diffuse: `
            float a = atan(vSkinPos.z, vSkinPos.x);
            float s = sin(a * 8.0 + sin(vSkinPos.y * 3.2) * 1.5);
            diffuseColor.rgb = mix(vec3(0.09, 0.31, 0.11), vec3(0.44, 0.78, 0.27),
                                   smoothstep(-0.18, 0.18, s));`,
        }
      ),
  },

  {
    id: 'pixel',
    name: 'Arcade',
    blurb: 'A checkerboard carved out of the third dimension.',
    price: 280,
    unlock: 1,
    swatch: ['#1ad7b4', '#f43f8e'],
    build: () =>
      patched(
        'pixel',
        { color: 0xffffff, roughness: 0.45, metalness: 0.05, flatShading: true },
        {
          diffuse: `
            vec3 g = floor(vSkinPos * 7.0);
            float c = mod(g.x + g.y + g.z, 2.0);
            diffuseColor.rgb = mix(vec3(0.10, 0.84, 0.70), vec3(0.95, 0.25, 0.56), c);`,
          emissive: `totalEmissiveRadiance += diffuseColor.rgb * 0.14;`,
        }
      ),
  },

  {
    id: 'slime',
    name: 'Slime',
    blurb: 'Drifting blobs and a glowing edge. Slightly alive.',
    price: 380,
    unlock: 2,
    swatch: ['#6ef06a', '#1f7a1b'],
    build: () =>
      patched(
        'slime',
        { color: 0xffffff, roughness: 0.18, metalness: 0.0 },
        {
          diffuse: `
            float n = skinNoise(vSkinPos * 3.2 + vec3(0.0, uTime * 0.28, uTime * 0.1));
            diffuseColor.rgb = mix(vec3(0.16, 0.62, 0.15), vec3(0.60, 0.97, 0.38),
                                   smoothstep(0.38, 0.68, n));`,
          emissive: `
            totalEmissiveRadiance += vec3(0.25, 0.95, 0.32) * pow(skinFresnel(), 2.0) * 0.75;`,
        }
      ),
  },

  {
    id: 'rainbow',
    name: 'Candy Swirl',
    blurb: 'Spiral bands that turn slowly as you roll.',
    price: 500,
    unlock: 2,
    swatch: ['#ff9de2', '#7ad7ff'],
    build: () =>
      patched(
        'rainbow',
        { color: 0xffffff, roughness: 0.3, metalness: 0.0, flatShading: true },
        {
          diffuse: `
            float a = atan(vSkinPos.z, vSkinPos.x) / 6.28318;
            float band = fract(a * 3.0 + vSkinPos.y * 1.6 + uTime * 0.06);
            diffuseColor.rgb = mix(vec3(1.0), skinHue(band), 0.9);`,
        }
      ),
  },

  {
    id: 'disco',
    name: 'Disco Ball',
    blurb: 'Mirrored tiles that catch the light one at a time.',
    price: 700,
    unlock: 3,
    swatch: ['#cfd8ea', '#8fa4c4'],
    build: () =>
      patched(
        'disco',
        { color: 0xffffff, roughness: 0.16, metalness: 0.92, flatShading: true },
        {
          diffuse: `
            vec3 g = floor(vSkinPos * 9.0);
            float h = skinHash(g);
            diffuseColor.rgb = mix(vec3(0.52, 0.58, 0.70), vec3(0.96, 0.98, 1.0), h);`,
          emissive: `
            vec3 g = floor(vSkinPos * 9.0);
            float h = skinHash(g);
            float flash = step(0.94, fract(h * 3.7 + uTime * 0.4));
            totalEmissiveRadiance += skinHue(h) * flash * 1.8;`,
        }
      ),
  },

  {
    id: 'bubble',
    name: 'Soap Bubble',
    blurb: 'Barely there, and shot through with oil-slick colour.',
    price: 850,
    unlock: 4,
    swatch: ['#bff3ff', '#ffc9f2'],
    build: () => {
      const m = patched(
        'bubble',
        { color: 0xffffff, roughness: 0.05, metalness: 0.3, transparent: true },
        {
          diffuse: `
            float film = skinFresnel() * 4.0 + skinNoise(vSkinPos * 3.0 + uTime * 0.2) * 0.9;
            vec3 c = skinHue(film);
            diffuseColor.rgb = mix(vec3(0.92, 0.96, 1.0), c, 0.62);
            diffuseColor.a *= 0.34 + pow(skinFresnel(), 2.0) * 0.66;`,
          emissive: `
            totalEmissiveRadiance += skinHue(skinFresnel() * 4.0) * pow(skinFresnel(), 3.0) * 1.3;`,
        }
      );
      // Depth still writes: the ball is convex and everything welded to it sits
      // outside, so props read correctly through the film. Turning depth write
      // off instead makes the debris on the far side pop in front of the near.
      m.depthWrite = true;
      return m;
    },
  },

  {
    id: 'lava',
    name: 'Magma',
    blurb: 'Cooled crust with something molten still moving under it.',
    price: 1000,
    unlock: 5,
    swatch: ['#ff7a18', '#2b1410'],
    build: () =>
      patched(
        'lava',
        { color: 0xffffff, roughness: 0.72, metalness: 0.0, flatShading: true },
        {
          diffuse: `
            float n = skinNoise(vSkinPos * 3.0 + vec3(uTime * 0.13, uTime * 0.08, 0.0));
            diffuseColor.rgb = mix(vec3(0.08, 0.05, 0.06), vec3(0.34, 0.15, 0.09), n);`,
          emissive: `
            float n = skinNoise(vSkinPos * 3.0 + vec3(uTime * 0.13, uTime * 0.08, 0.0));
            float crack = smoothstep(0.44, 0.52, n) - smoothstep(0.52, 0.60, n);
            totalEmissiveRadiance += mix(vec3(1.0, 0.30, 0.04), vec3(1.0, 0.86, 0.28), crack)
                                   * crack * 3.2;`,
        }
      ),
  },

  {
    id: 'holo',
    name: 'Holofoil',
    blurb: 'The colour depends entirely on where you are standing.',
    price: 1250,
    unlock: 6,
    swatch: ['#c8b8ff', '#9ff2e0'],
    build: () =>
      patched(
        'holo',
        { color: 0xffffff, roughness: 0.2, metalness: 0.65 },
        {
          diffuse: `
            float f = skinFresnel();
            vec3 c = skinHue(f * 3.0 + skinNoise(vSkinPos * 2.0) * 0.4 + uTime * 0.07);
            diffuseColor.rgb = mix(vec3(0.86, 0.89, 0.96), c, 0.78);`,
          emissive: `
            float f = skinFresnel();
            totalEmissiveRadiance += skinHue(f * 3.0 + uTime * 0.07) * pow(f, 2.5) * 0.95;`,
        }
      ),
  },

  {
    id: 'galaxy',
    name: 'Deep Space',
    blurb: 'A nebula with its own weather, and stars that twinkle.',
    price: 1500,
    unlock: 8,
    swatch: ['#3a1d6e', '#0b1030'],
    build: () =>
      patched(
        'galaxy',
        { color: 0xffffff, roughness: 0.42, metalness: 0.2 },
        {
          diffuse: `
            float neb = skinNoise(vSkinPos * 2.4 + vec3(uTime * 0.05));
            vec3 base = mix(vec3(0.04, 0.03, 0.13), vec3(0.30, 0.09, 0.45), neb);
            base = mix(base, vec3(0.05, 0.24, 0.52), skinNoise(vSkinPos * 1.7 + 11.0) * 0.6);
            diffuseColor.rgb = base;`,
          emissive: `
            vec3 g = floor(vSkinPos * 26.0);
            float st = skinHash(g);
            float twinkle = step(0.985, st) * (0.6 + 0.4 * sin(uTime * 3.0 + st * 60.0));
            totalEmissiveRadiance += vec3(twinkle) * 2.4 + diffuseColor.rgb * 0.4;`,
        }
      ),
  },

  {
    id: 'gold',
    name: 'Solid Gold',
    blurb: 'No pattern, no trick. Just the most expensive thing here.',
    price: 1900,
    unlock: 10,
    swatch: ['#ffd75e', '#b8770c'],
    build: () =>
      new MeshStandardMaterial({
        color: new Color(0xffc23a),
        roughness: 0.24,
        metalness: 1.0,
        flatShading: true,
      }),
  },
];

const BY_ID = new Map(SKINS.map((s) => [s.id, s]));

export const skinById = (id: string) => BY_ID.get(id) ?? SKINS[0];

export const ownsSkin = (id: string) => save.meta.skins.includes(id);

export const equippedSkin = () => skinById(save.meta.equipped);

/** True when the player has the level for it, whatever their gold says. */
export const skinUnlocked = (skin: SkinDef, level: number) => skin.unlock <= level;

export function buySkin(id: string): boolean {
  const skin = BY_ID.get(id);
  if (!skin || ownsSkin(id)) return false;
  if (!save.spendGold(skin.price)) return false;
  save.meta.skins.push(id);
  save.flush();
  return true;
}

export function equipSkin(id: string) {
  if (!ownsSkin(id)) return;
  save.meta.equipped = id;
  save.flush();
}
