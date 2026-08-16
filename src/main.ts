/**
 * Boot and the top-level frame loop.
 *
 * Order matters here: the AudioContext can only start from a user gesture, so
 * the boot screen's PLAY button doubles as the audio unlock. Assets load behind
 * it, which means the download is free — by the time anyone taps, the city is
 * usually already built.
 */

import { audio } from './audio/AudioEngine';
import { music } from './audio/Music';
import { sfx } from './audio/Sfx';
import { assets } from './core/Assets';
import { bus } from './core/Events';
import { Input } from './core/Input';
import { Loop } from './core/Loop';
import { save } from './core/Save';
import { PROP_SPECS } from './data/props';
import { Game } from './game/Game';
import { TIERS } from './game/Growth';
import { detectQuality, Renderer } from './render/Renderer';
import { PostFX } from './render/PostFX';
import { Boot } from './ui/Boot';
import { Collection } from './ui/Collection';
import { Hud } from './ui/Hud';
import { Pause } from './ui/Pause';
import { Results } from './ui/Results';
import { el } from './ui/dom';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

// `?noui=1` hides the DOM overlay entirely. If the game appears, the canvas was
// being composited under the HUD rather than failing to render — a distinction
// no amount of WebGL diagnostics can make from the inside.
if (/[?&]noui=1/.test(location.search)) document.documentElement.classList.add('no-ui');

const quality = save.data.settings.quality === 'auto' ? detectQuality() : save.data.settings.quality;
const renderer = new Renderer(canvas, quality);
const post = new PostFX(renderer, quality);
const input = new Input(canvas);
const game = new Game(renderer, input);

const boot = new Boot(uiRoot);
const hud = new Hud(uiRoot, game);
const pause = new Pause(uiRoot);
const results = new Results(uiRoot);
const collection = new Collection(uiRoot, renderer);
hud.stickState = () => input.stick;

// ── perf overlay (F3) ─────────────────────────────────────────────────────
const perf = el('div', { id: 'perf' });
uiRoot.append(perf);
let perfOn = false;
addEventListener('keydown', (e) => {
  if (e.key === 'F3' || e.key === '`') {
    perfOn = !perfOn;
    perf.classList.toggle('on', perfOn);
  }
});

// ── sizing ────────────────────────────────────────────────────────────────
function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.resize(w, h);
  post.resize(w, h);
}
/**
 * A lost GL context is invisible from the inside: every GL call becomes a no-op,
 * so the canvas keeps whatever it last held (black) while the loop, the audio
 * and the whole DOM HUD carry on perfectly. Without an explicit banner that is
 * indistinguishable from a rendering bug, so say it out loud on screen.
 */
let glLost = false;
const glBanner = el('div', {
  style:
    'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:200;' +
    'background:#b3261e;color:#fff;font:12px/1.5 ui-monospace,monospace;' +
    'padding:8px 14px;border-radius:10px;display:none;text-align:center;max-width:90vw',
});
uiRoot.append(glBanner);

renderer.handleContextLoss((restored) => {
  glLost = !restored;
  glBanner.style.display = restored ? 'none' : 'block';
  glBanner.textContent = restored
    ? ''
    : 'Graphics context lost — the page needs a reload.';
  if (restored) resize();
});

addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 120));
resize();

// ── audio reacts to gameplay, entirely through the bus ────────────────────
bus.on('stick', (e) => sfx.pickup(e.def, e.combo));
bus.on('reject', (e) => sfx.reject(e.speed));
bus.on('tierUp', (e) => {
  sfx.tierUp(e.tier);
  music.setTier(e.tier);
});
bus.on('collect', () => sfx.collect(0));
bus.on('collectComplete', () => sfx.fanfare());
bus.on('timeUp', () => sfx.countdown(game.timeLeft <= 5));

// ── particles react too ───────────────────────────────────────────────────
bus.on('tierUp', (e) => {
  game.particlesRef()?.confetti(game.ball.pos.x, game.ball.pos.y + e.radius, game.ball.pos.z, 46, 7);
  game.particlesRef()?.shockwave(game.ball.pos.x, game.ball.pos.z, e.prevRadius, e.radius);
});
bus.on('collect', () => {
  const p = game.particlesRef();
  p?.spark(game.ball.pos.x, game.ball.pos.y + game.ball.visualRadius, game.ball.pos.z, 10);
});

// ── screen flow ───────────────────────────────────────────────────────────
// `pauseRequest` is the request; `pause` is Game's notification that it
// happened. Keeping them separate avoids the handler re-entering itself and
// means anything can ask to pause without knowing the current state.
bus.on('pauseRequest', () => {
  if (game.state !== 'playing') return;
  game.setPaused(true);
});
bus.on('pause', ({ paused }) => {
  if (paused) {
    audio.duck(0.6);
    pause.show();
  }
});

pause.describeRenderer = () =>
  `${renderer.diagnostics()}\npost   ${post.enabled ? (post.hdr ? 'hdr' : 'ldr 8-bit') : 'off'}` +
  (post.checkLog.length ? `\ncheck  ${post.checkLog.join(' | ')}` : '') +
  (post.failure ? `\n${post.failure}` : '') +
  (glLost ? '\nGL CONTEXT LOST' : '');

pause.onResume = () => {
  audio.duck(0);
  game.setPaused(false);
};
pause.onRestart = () => {
  audio.duck(0);
  pause.hide();
  restart();
};
pause.onCollection = () => {
  collection.show();
};

bus.on('levelEnd', async (e) => {
  music.setTier(0);
  audio.duck(0.35);
  hud.show(false);
  await results.show(e, game.level);
});

results.onRetry = () => {
  audio.duck(0);
  restart();
};
results.onCollection = () => collection.show();

collection.onClose = () => {
  if (game.state === 'paused') pause.show();
};

function restart() {
  results.hide();
  pause.hide();
  game.begin();
  hud.reset();
  hud.show(true);
  game.start();
  music.setTier(0);
}

// ── frame ─────────────────────────────────────────────────────────────────
let dustTimer = 0;

const loop = new Loop(
  (dt) => game.step(dt),
  (_alpha, dt) => {
    game.render(dt);

    // Rolling audio + dust are driven from the same speed value, so what you
    // hear and what you see always agree.
    const speed = Math.hypot(game.ball.vel.x, game.ball.vel.z);
    const maxSpeed = 5.6 + game.ball.growth.tier * 1.15;
    music.update(dt);
    music.setRolling(game.state === 'playing' ? speed : 0, maxSpeed, game.ball.visualRadius);

    const particles = game.particlesRef();
    if (particles) {
      particles.billboard.copy(renderer.camera.quaternion);
      if (game.state === 'playing' && speed > 1.2) {
        dustTimer -= dt;
        if (dustTimer <= 0) {
          dustTimer = 0.045;
          particles.dust(game.ball.pos.x, game.ball.pos.z, game.ball.visualRadius, speed);
        }
      }
    }

    hud.update(dt, renderer.camera);
    post.render();
    // Verify by result, not by capability: read back what was actually drawn
    // and step the effect chain down if the canvas came out blank.
    post.selfCheck();
    renderer.adapt(loop.fps, innerWidth, innerHeight);

    if (perfOn) {
      const s = game.stats();
      const info = renderer.renderer.info;
      perf.textContent =
        `fps    ${loop.fps.toFixed(0)}\n` +
        `dpr    ${renderer.pixelRatio.toFixed(2)}\n` +
        `calls  ${info.render.calls}\n` +
        `tris   ${(info.render.triangles / 1000).toFixed(0)}k\n` +
        `props  ${s.props}\n` +
        `stuck  ${s.stuck} (${s.ballDrawCalls} dc)\n` +
        `tier   ${s.tier} r=${s.radius.toFixed(2)}\n` +
        `parts  ${particles?.liveCount ?? 0}\n` +
        `post   ${post.enabled ? (post.hdr ? 'hdr' : 'ldr (8-bit)') : 'off'}` +
        (post.failure ? `\n       ${post.failure}` : '') +
        `\n${renderer.diagnostics()}`;
    }
  }
);

// ── go ────────────────────────────────────────────────────────────────────
(async function start() {
  loop.start();

  await game.load((p) => boot.setProgress(p * 0.92));
  game.begin();
  paintCards();
  boot.setProgress(1);
  boot.ready(TIERS.length);

  boot.onPlay = async () => {
    await audio.unlock();
    music.start();
    music.setTier(0);
    sfx.click();
    boot.hide();
    hud.show(true);
    game.start();
    bus.emit('ready', undefined as never);
  };
})().catch((err) => {
  console.error(err);
  boot.fail(String(err?.message ?? err));
});

// Keep the audio graph honest across tab switches.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') bus.emit('pauseRequest', undefined as never);
});

collection.attachAssets(assets);

/**
 * Paint the two collectible cards with real 3D renders of what they track.
 * A card showing the actual object teaches the goal instantly; a blank purple
 * square teaches nothing.
 */
function paintCards() {
  game.level.collectibles.forEach((c, i) => {
    const spec = PROP_SPECS.find((p) => p.id === c.prop);
    if (!spec) return;
    const thumb = collection.thumbnail(spec.kit, spec.model);
    if (thumb) hud.setCardThumb(i, thumb);
  });
}

// Debug handle. Vite strips this from production builds, and having the live
// objects reachable from the console is worth far more than it costs in dev.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).rm = { game, renderer, post, loop, input, music, sfx, audio };
}
