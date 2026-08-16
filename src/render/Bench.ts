/**
 * Honest render benchmark, reached with `?bench=1`.
 *
 * Exists to answer "did de-instancing cost us anything" with numbers instead of
 * intuition. Two things make that easy to get wrong:
 *
 * - Timing `render()` with `performance.now()` measures how long it took to
 *   *submit* commands, not to draw. GL is asynchronous, so that figure can be a
 *   fraction of the real cost. Every timing here brackets the frame with
 *   `gl.finish()`, which blocks until the GPU is actually done.
 * - Merging trades vertex memory for draw calls, and a draw-call count alone
 *   would hide that entirely. So buffer bytes are counted too.
 *
 * Run the same URL with `?bench=1&instancing=on` and `?bench=1&instancing=off`
 * to compare the two paths on one machine.
 */

import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { Mesh } from 'three';

export interface BenchResult {
  frames: number;
  medianMs: number;
  p95Ms: number;
  calls: number;
  triangles: number;
  /** Vertex + index buffer bytes for everything reachable from the scene. */
  bufferMB: number;
  geometries: number;
}

/** Sums attribute and index bytes, counting shared geometry only once. */
function bufferBytes(scene: Scene): { bytes: number; count: number } {
  const seen = new Set<unknown>();
  let bytes = 0;
  scene.traverse((o) => {
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

export function runBench(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  frames = 120
): BenchResult {
  const gl = renderer.getContext();
  const times: number[] = [];

  // Warm-up: the first frames compile shaders and upload buffers, which would
  // otherwise dominate the median.
  for (let i = 0; i < 10; i++) {
    renderer.render(scene, camera);
  }
  gl.finish();

  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    renderer.render(scene, camera);
    gl.finish();
    times.push(performance.now() - t0);
  }

  times.sort((a, b) => a - b);
  renderer.info.reset();
  renderer.render(scene, camera);
  gl.finish();

  const mem = bufferBytes(scene);
  return {
    frames,
    medianMs: times[Math.floor(times.length / 2)],
    p95Ms: times[Math.floor(times.length * 0.95)],
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    bufferMB: mem.bytes / (1024 * 1024),
    geometries: mem.count,
  };
}

/** Prints the result as large on-screen text, for reading on a phone. */
export function showBench(parent: HTMLElement, r: BenchResult, header: string) {
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;inset:0;z-index:9999;background:#0b0b12;color:#e8e8f0;' +
    'font:13px/1.7 ui-monospace,monospace;padding:16px;overflow:auto;' +
    'white-space:pre-wrap;pointer-events:auto';
  panel.textContent =
    `RENDER BENCH\n${header}\n\n` +
    `frames     ${r.frames} (gl.finish per frame)\n` +
    `median     ${r.medianMs.toFixed(2)} ms\n` +
    `p95        ${r.p95Ms.toFixed(2)} ms\n` +
    `calls      ${r.calls}\n` +
    `triangles  ${(r.triangles / 1000).toFixed(0)}k\n` +
    `buffers    ${r.bufferMB.toFixed(1)} MB across ${r.geometries} geometries\n\n` +
    `Compare ?bench=1&instancing=on against ?bench=1&instancing=off.\n` +
    `Times include gl.finish(), so they are GPU-inclusive, not submission-only.`;
  parent.append(panel);
}
