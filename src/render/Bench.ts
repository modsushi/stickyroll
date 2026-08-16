/**
 * Honest render benchmark, reached with `?bench=1` (add `&tier=N` to profile a
 * grown ball, `&instancing=on|off` to compare batch backends).
 *
 * Exists to answer performance questions with numbers instead of intuition.
 * Three things make that easy to get wrong:
 *
 * - Timing `render()` with `performance.now()` measures how long it took to
 *   *submit* commands, not to draw. GL is asynchronous, so that figure can be a
 *   fraction of the real cost. Every timing here brackets with `gl.finish()`,
 *   which blocks until the GPU is actually done.
 * - A steady 25 ms and an occasional 200 ms stall look identical in an average
 *   and need completely different fixes, so p95 and a spike count are reported
 *   separately from the median.
 * - Merging trades vertex memory for draw calls, and a draw-call count alone
 *   would hide that, so buffer bytes are counted too.
 */

import type { Mesh, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

export interface BenchSlice {
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

export interface BenchResult {
  frames: number;
  /** Complete game frame: sim + ball bake + scene + post. The honest number. */
  full?: BenchSlice;
  /** Scene render alone: shadow pass + main pass, GPU-inclusive. */
  total: BenchSlice;
  /** Shadow pass alone, measured by rendering with shadows off and differencing. */
  shadowMs: number;
  /** Frames slower than 20 ms — a 60fps budget miss. */
  spikes: number;
  calls: number;
  triangles: number;
  bufferMB: number;
  geometries: number;
  tier: number;
  ballDrawCalls: number;
  ballTriangles: number;
}

function slice(sorted: number[]): BenchSlice {
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    maxMs: sorted[sorted.length - 1],
  };
}

/** Sums attribute and index bytes, counting shared geometry only once. */
function bufferBytes(root: Scene | Mesh): { bytes: number; count: number } {
  const seen = new Set<unknown>();
  let bytes = 0;
  root.traverse((o) => {
    const g = (o as Mesh).geometry;
    if (!g || seen.has(g)) return;
    seen.add(g);
    for (const name of Object.keys(g.attributes)) {
      const a = g.attributes[name] as { array?: ArrayBufferView };
      if (a.array) bytes += a.array.byteLength;
    }
    if (g.index) bytes += g.index.array.byteLength;
  });
  return { bytes, count: seen.size };
}

/** Triangles and draw calls carried by one subtree — used for the ball. */
function subtreeCost(root: Mesh | Scene | undefined): { calls: number; tris: number } {
  let calls = 0;
  let tris = 0;
  root?.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !m.geometry) return;
    calls++;
    const idx = m.geometry.index;
    const pos = m.geometry.getAttribute('position');
    tris += (idx ? idx.count : (pos?.count ?? 0)) / 3;
  });
  return { calls, tris };
}

function timeFrames(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  frames: number
): number[] {
  const gl = renderer.getContext();
  const times: number[] = [];
  for (let i = 0; i < frames; i++) {
    // The renderer drives its shadow map by hand (see Renderer.focusShadow), so
    // without this the shadow pass never runs here and measures as free.
    // Forcing it every frame reports the worst case rather than the alternating
    // cost the real loop pays.
    if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;
    const t0 = performance.now();
    renderer.render(scene, camera);
    gl.finish();
    times.push(performance.now() - t0);
  }
  return times;
}

export function runBench(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  opts: {
    frames?: number;
    tier?: number;
    ball?: Mesh | Scene;
    /** One complete game frame: simulation, ball bake, scene render, post. */
    frame?: (dt: number) => void;
  } = {}
): BenchResult {
  const frames = opts.frames ?? 120;
  const gl = renderer.getContext();

  // Warm-up: the first frames compile shaders and upload buffers, which would
  // otherwise dominate the median.
  for (let i = 0; i < 10; i++) renderer.render(scene, camera);
  gl.finish();

  const withShadows = timeFrames(renderer, scene, camera, frames);

  // Shadow cost by difference. Toggling forces a shader recompile, so this is
  // re-warmed before timing.
  const hadShadows = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = false;
  for (let i = 0; i < 10; i++) renderer.render(scene, camera);
  gl.finish();
  const withoutShadows = timeFrames(renderer, scene, camera, Math.floor(frames / 2));
  renderer.shadowMap.enabled = hadShadows;

  const sortedTotal = [...withShadows].sort((a, b) => a - b);
  const sortedNoShadow = [...withoutShadows].sort((a, b) => a - b);

  // The whole frame, when the caller can supply one. Timing `render()` alone
  // omits simulation, the ball's chunk merges and the entire post chain — which
  // is most of the budget, and reports a frame rate the game never achieves.
  //
  // Runs last on purpose: it advances the simulation, so any scene-only figure
  // taken afterwards would describe a different frame and the split would not
  // add up (it briefly reported a shadow pass costing 117% of the frame).
  let full: number[] = [];
  if (opts.frame) {
    const dt = 1 / 60;
    for (let i = 0; i < 10; i++) opts.frame(dt);
    gl.finish();
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      opts.frame(dt);
      gl.finish();
      full.push(performance.now() - t0);
    }
  }

  // Counted on shadow-updating frames, so these describe the heavier of the two
  // frame kinds rather than silently omitting the shadow pass.
  renderer.info.reset();
  for (let i = 0; i < 5; i++) {
    if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
  }
  gl.finish();
  const calls = Math.round(renderer.info.render.calls / 5);
  const triangles = Math.round(renderer.info.render.triangles / 5);

  const mem = bufferBytes(scene);
  const ball = subtreeCost(opts.ball);

  return {
    frames,
    full: full.length ? slice([...full].sort((a, b) => a - b)) : undefined,
    total: slice(sortedTotal),
    shadowMs: slice(sortedTotal).medianMs - slice(sortedNoShadow).medianMs,
    spikes: (full.length ? full : withShadows).filter((t) => t > 20).length,
    calls,
    triangles,
    bufferMB: mem.bytes / (1024 * 1024),
    geometries: mem.count,
    tier: opts.tier ?? 0,
    ballDrawCalls: ball.calls,
    ballTriangles: ball.tris,
  };
}

/** Prints the result as large on-screen text, for reading on a phone. */
export function showBench(parent: HTMLElement, r: BenchResult, header: string) {
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;inset:0;z-index:9999;background:#0b0b12;color:#e8e8f0;' +
    'font:13px/1.7 ui-monospace,monospace;padding:16px;overflow:auto;' +
    'white-space:pre-wrap;pointer-events:auto';
  const base = r.full?.medianMs ?? r.total.medianMs;
  const pct = (v: number) => ((v / base) * 100).toFixed(0);
  const rest = r.full ? r.full.medianMs - r.total.medianMs : 0;
  panel.textContent =
    `RENDER BENCH\n${header}\n\n` +
    `tier       ${r.tier}\n` +
    `frames     ${r.frames} (gl.finish per frame)\n\n` +
    (r.full
      ? `FULL FRAME (sim + ball + scene + post)\n` +
        `median     ${r.full.medianMs.toFixed(2)} ms   (60fps budget = 16.7)\n` +
        `p95        ${r.full.p95Ms.toFixed(2)} ms\n` +
        `worst      ${r.full.maxMs.toFixed(2)} ms\n` +
        `implied    ${(1000 / r.full.medianMs).toFixed(0)} fps\n\n`
      : '') +
    `scene      ${r.total.medianMs.toFixed(2)} ms (${pct(r.total.medianMs)}%)\n` +
    `  shadow   ${r.shadowMs.toFixed(2)} ms (${pct(r.shadowMs)}%)\n` +
    (r.full ? `sim+post   ${rest.toFixed(2)} ms (${pct(rest)}%)\n` : '') +
    `spikes     ${r.spikes} frames over 20 ms\n\n` +
    `calls      ${r.calls}\n` +
    `triangles  ${(r.triangles / 1000).toFixed(0)}k\n` +
    `ball       ${r.ballDrawCalls} calls, ${(r.ballTriangles / 1000).toFixed(0)}k tris\n` +
    `buffers    ${r.bufferMB.toFixed(1)} MB across ${r.geometries} geometries\n\n` +
    `?bench=1&tier=8 profiles a grown ball.\n` +
    `Times include gl.finish(), so they are GPU-inclusive.`;
  parent.append(panel);
}
