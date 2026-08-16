// Copies the slices of the Kenney packs the game actually loads into public/.
// GLBs reference their textures by relative URI ("Textures/colormap.png"), so each
// kit's `Textures/` folder must land as a sibling of its .glb files or materials
// silently fall back to untextured white.
import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'assets');
const out = join(root, 'public');

/** kit id used at runtime -> source pack folder */
export const KITS = {
  cars: 'kenney_car-kit',
  roads: 'kenney_city-kit-roads',
  commercial: 'kenney_city-kit-commercial_2.1',
  suburban: 'kenney_city-kit-suburban_20',
  characters: 'kenney_blocky-characters_20',
  market: 'kenney_mini-market',
  furniture: 'kenney_furniture-kit',
};

/** Packs disagree on what they call the folder holding the .glb files. */
const MODEL_DIRS = ['GLB format', 'GLTF format'];

// UI sprites we reference from CSS. Kenney ships 164 files per colour; we only
// want a handful, and shipping the rest would triple the static payload.
const UI_FILES = [
  'Yellow/Default/button_rectangle_depth_gradient.png',
  'Yellow/Default/button_round_depth_gradient.png',
  'Yellow/Default/button_square_depth_gradient.png',
  'Blue/Default/button_rectangle_depth_gradient.png',
  'Blue/Default/button_round_depth_gradient.png',
  'Blue/Default/button_square_depth_gradient.png',
  'Grey/Default/button_rectangle_depth_flat.png',
  'Grey/Default/button_square_depth_flat.png',
  'Grey/Default/button_round_depth_flat.png',
  'Grey/Default/star.png',
  'Yellow/Default/star.png',
  'Extra/Default/icon_play_light.png',
  'Extra/Default/icon_repeat_light.png',
  'Extra/Default/icon_arrow_down_light.png',
];

const FONTS = ['Kenney Future.ttf', 'Kenney Future Narrow.ttf'];

/**
 * Every model name in the game appears as a string literal in `src/` — prop
 * catalog entries, level building lists, the traffic and pedestrian rosters.
 * So rather than maintaining a second list here (which would silently drift),
 * read the source and copy the intersection with what each pack actually ships.
 *
 * Over-inclusion is harmless; under-inclusion is loud, because a missing model
 * logs an asset warning and drops that prop from the level.
 */
async function referencedNames() {
  const dir = join(root, 'src');
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  let text = '';
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.ts')) continue;
    text += await readFile(join(e.parentPath ?? e.path, e.name), 'utf8');
  }
  // Any single- or double-quoted literal is a candidate model name. The
  // character class must allow capitals: the furniture kit names its models in
  // camelCase (`loungeSofa`, `plantSmall1`), and a lowercase-only pattern would
  // silently skip the entire pack.
  return new Set(text.match(/['"`][A-Za-z0-9_-]+['"`]/g)?.map((s) => s.slice(1, -1)) ?? []);
}

async function copyKit(id, pack, wanted) {
  const from = MODEL_DIRS.map((d) => join(src, pack, 'Models', d)).find(existsSync);
  if (!from) throw new Error(`no model folder in pack: ${pack}`);
  const to = join(out, 'models', id);
  await mkdir(to, { recursive: true });

  const entries = await readdir(from, { withFileTypes: true });
  let models = 0;
  let skipped = 0;
  for (const e of entries) {
    if (e.isDirectory() && e.name === 'Textures') {
      // The character pack has one texture per character (`character-f` ->
      // `texture-f`), and the game only uses a handful of the eighteen. Every
      // other kit shares a single atlas, so it copies wholesale.
      await cp(join(from, e.name), join(to, 'Textures'), {
        recursive: true,
        filter: (p) => {
          if (id !== 'characters') return true;
          const m = /texture-([a-z])\.png$/.exec(p);
          return !m || wanted.has(`character-${m[1]}`);
        },
      });
    } else if (e.isFile() && e.name.endsWith('.glb')) {
      if (!wanted.has(e.name.slice(0, -4))) {
        skipped++;
        continue;
      }
      await cp(join(from, e.name), join(to, e.name));
      models++;
    }
  }
  return { models, skipped };
}

async function copyUi() {
  const from = join(src, 'kenney_ui-pack', 'PNG');
  const to = join(out, 'ui');
  let n = 0;
  for (const rel of UI_FILES) {
    const s = join(from, rel);
    if (!existsSync(s)) continue; // pack contents vary slightly by version
    const d = join(to, rel);
    await mkdir(dirname(d), { recursive: true });
    await cp(s, d);
    n++;
  }
  return n;
}

async function copyFonts() {
  const from = join(src, 'kenney_ui-pack', 'Font');
  const to = join(out, 'fonts');
  await mkdir(to, { recursive: true });
  let n = 0;
  for (const f of FONTS) {
    if (!existsSync(join(from, f))) continue;
    await cp(join(from, f), join(to, f));
    n++;
  }
  return n;
}

async function dirSize(p) {
  let total = 0;
  for (const e of await readdir(p, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    total += (await stat(join(e.parentPath ?? e.path, e.name))).size;
  }
  return total;
}

await rm(join(out, 'models'), { recursive: true, force: true });
await rm(join(out, 'ui'), { recursive: true, force: true });

const wanted = await referencedNames();
let models = 0;
let skipped = 0;
for (const [id, pack] of Object.entries(KITS)) {
  const r = await copyKit(id, pack, wanted);
  models += r.models;
  skipped += r.skipped;
}
const ui = await copyUi();
const fonts = await copyFonts();

const mb = (await dirSize(out)) / 1024 / 1024;
console.log(
  `[assets] ${models} models across ${Object.keys(KITS).length} kits ` +
    `(${skipped} unreferenced skipped), ${ui} ui sprites, ${fonts} fonts ` +
    `-> public/ (${mb.toFixed(1)} MB)`
);
