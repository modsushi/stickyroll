# Roll Masters

A chill, casual Katamari-style game for the browser. You drag a ball through a
living city; anything smaller than the ball sticks to it, the ball grows in
stepped jumps, and eventually you're rolling up the buildings.

Three.js + TypeScript + Vite. No game framework, no physics engine, no audio
files — the whole soundtrack and every sound effect is synthesised at runtime.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

`npm run dev` runs `prepare-assets` first, which copies the slices of the Kenney
packs the game actually uses out of `assets/` and into `public/`. Run it on its
own with `npm run prepare-assets`.

```bash
npm run build      # typecheck + production bundle into dist/
npm run preview    # serve dist/
npm run typecheck
```

**Note:** running `npm run build` while `npm run dev` is live briefly deletes and
recreates `public/models`, and the dev server will answer requests made during
that window with `index.html`. If the city comes up missing roads or buildings,
restart the dev server.

## Playing

- **Touch/mouse:** drag anywhere to steer. The stick is anchor-relative and the
  anchor follows your finger, so you can steer continuously without lifting.
- **Keyboard:** WASD or arrows.
- **F3** (or backtick) toggles the performance overlay.

## Layout

```
scripts/prepare-assets.mjs   copies the needed GLBs + textures into public/
src/
  main.ts        boot, the frame loop, and all the cross-system wiring
  core/          Loop, Input, Assets, Events, Save, Math
  render/        Renderer, FollowCamera, PostFX, Decals, Particles
  audio/         AudioEngine, Sfx, Music — all procedural
  game/          Ball, Sticking, BallBaker, Growth, Score, Collectibles,
                 SpatialHash, Game, city/{CityBuilder,Props,Traffic,Pedestrians}
                 CityBuilder also builds the boundary wall and the skyline
                 beyond it (`buildSurround`)
  data/props.ts  the prop catalog
  levels/        level format + downtown-01
  ui/            DOM overlay: Boot, Hud, Pause, Results, Collection
```

## Things worth knowing before changing anything

**Kits are normalised to metres.** The seven Kenney kits ship at wildly different
scales — a road tile is 1 unit, a sedan 2.55, a commercial building 1.29, a
furniture table 0.33. `KIT_SCALE` in `data/props.ts` bakes a per-kit multiplier
into the geometry at load, so everything downstream works in one world where
1 unit = 1 m. A road tile is 4 m, a sedan 4.3 m long, an office block 11 m tall.

**Prop difficulty is derived, not authored.** `absorbSize`, `mass` and `points`
are computed from each model's measured bounds. Per-prop `absorbBias` /
`massBias` / `pointsBias` are the knobs for when feel should beat physics.

**Every model resolves to one shared material per kit.** That is what makes the
rendering budget work: props instance, absorbed props weld together, and the
ball stays at a handful of draw calls however much city is stuck to it. The city
kits manage it via a shared `colormap.png`; the furniture kit has no textures at
all, so its per-material `baseColorFactor`s are baked into vertex colours at load
(`KIT_MATERIAL` in `data/props.ts`) to reach the same place.

**Road base orientations were measured, not guessed.** Rendering each tile
top-down against known axes is the only reliable way to find them, and one wrong
guess lays every kerb and zebra crossing sideways. They're documented at
`roadTile()` in `city/CityBuilder.ts`. Note that several road models are *not*
1×1 — `road-split` is 1×2 and will silently overhang a grid cell; the 1×1
T-junction is `road-intersection`.

**Growth and star thresholds are derived from the level's own budget.** A map
holds a finite amount of mass and score, and a large share of it is locked behind
the top tier (you cannot eat a shopfront until you are shopfront-sized). Thresholds
set above that curve make the last tiers silently unreachable — which is exactly
what happened when the district was made smaller without re-deriving them. Measure
the budget first; see the comments on `TIERS` and `stars`.

**Levels are data.** `levels/types.ts` defines an ASCII tile map plus scatter
rules, clusters, traffic lanes and goals. Roads autotile from their neighbours,
so a new level is authoring rather than engineering.

**Scatter vs clusters.** Loose scatter produces an even sprinkle, which reads as
debris however dense it is. `ClusterSpec` places hand-arranged groups that rotate
as a unit — a cafe table with its chairs pulled in, a row of shop shelves, a
heap of fly-tipping. Places, not confetti.

Each kind of prop has one home and stays there: outdoor seating only on cafe
terraces (`C`), benches only in parks (`.`), shop fittings only in market
squares (`M`), and ordinary street junk (car-kit debris — never furniture) in
piles on otherwise clean pavement. Roads carry cones and barriers and nothing
else. `canPlaceAt()` enforces the road/building exclusion per cluster *item*,
because a cluster's centre being legal does not mean its 3 m-out chair is.

**Buildings line one side of each street.** The camera is fixed south-west of
the ball, so anything to the ball's south-west sits between it and the lens.
Buildings therefore hug each block's south and west edges only — the far side of
every street from the camera. See the header of `levels/downtown-01.ts`.

**Buildings are collidable, and fitted to their plot.** Static scenery has no
prop-catalog entry, so it is inserted into the spatial hash as `blocker: true`
entries (`insertBuildingBlockers`) — without them the ball drove straight
through every tower. They are also scaled to fit a single tile: the kits' models
are 7-13 m across against a 4 m plot, and at native size their collision spilled
across the carriageway and wedged the ball.

**Adding a level:** copy `downtown-01.ts`, draw a new map, and point
`Game.level` at it.

## Performance

Measured at 1920×775 on one desktop GPU, with `gl.finish()` bracketing the timed
window — without that you are timing CPU submission, not the frame.

Treat the millisecond figures as a range, not a spec: back-to-back runs of an
identical scene on this machine vary by up to 2×, so they are useful for spotting
regressions and useless for fine tuning. Triangle and draw-call counts are exact
and are the numbers worth optimising against.

| | typical | max ball, widest camera |
|---|---|---|
| Frame cost | ~10–12 ms | ~15 ms |
| Draw calls | ~190–220 | ~315 |
| Triangles | ~480–500k | ~630k |
| Crowd of 52 citizens | | 21 draw calls (instanced) |
| Download | | ~6.7 MB models, 182 KB gzipped JS |

At max ball size the camera genuinely frames the whole district, so culling can
do nothing and the cost is simply the scene's content — which is why the district
was cut from 176 m to 136 m and the building count from 350 to 90. The levers, in
the order they pay off:

- Prop and scenery batches are chunked spatially (`CHUNK` in `city/Props.ts`,
  the `chunk` argument to `chunkedScenery`). A batch spanning the map has
  map-sized bounds and is never rejected — in the colour pass *or the shadow
  pass*, which is where it really hurts.
- The shadow frustum is capped (`focusShadow` in `render/Renderer.ts`). Letting
  it track the ball's full framing puts the entire district through the shadow
  map every frame late in a run.
- Small props don't cast shadows (`SHADOW_MIN_SIZE`), and the ball discards
  layers it has grown past (`BallBaker.prune`).
- The building list in a level is a weighted bag: repeating the 188-triangle
  low-detail towers makes them the common case against the 1,200-triangle
  detailed storefronts.
- Pedestrians are instanced: three `InstancedMesh`es per character variant with
  the per-person matrices rewritten each frame, so a crowd costs a flat ~21 draw
  calls whether it is twenty people or two hundred.
- The renderer drops pixel ratio automatically if frames run long.

## Credits

Art: [Kenney](https://kenney.nl) — City Kit (Commercial / Suburban / Roads),
Car Kit, Blocky Characters, Furniture Kit, Mini Market, UI Pack. CC0.
