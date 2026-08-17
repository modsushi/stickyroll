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
import { runBench, showBench } from './render/Bench';
import { FlyCamera } from './render/FlyCamera';
import { on, param } from './core/Debug';
import { runSelfTest, showSelfTest } from './render/SelfTest';
import { skinById, tickSkins } from './meta/Skins';
import { Boot } from './ui/Boot';
import { Collection } from './ui/Collection';
import { DailyReward } from './ui/DailyReward';
import { Hud } from './ui/Hud';
import { Pause } from './ui/Pause';
import { Results } from './ui/Results';
import { RewardPicker } from './ui/RewardPicker';
import { Shop } from './ui/Shop';
import { el } from './ui/dom';

/** Bumped by hand so a screenshot proves which build is being tested. */
const BUILD = 'build 2026-08-18d';

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
const shop = new Shop(uiRoot, renderer);
const daily = new DailyReward(uiRoot);
const rewards = new RewardPicker(uiRoot);
const fly = new FlyCamera(renderer.camera, canvas);
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
bus.on('goldChange', () => boot.refresh());
// The slot picks the starting note, so the two sets are audibly different.
bus.on('collect', (e) => sfx.collect(e.slot));
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

// ── demolitions ───────────────────────────────────────────────────────────
//
// The highlight is a pure reaction to the lock pair, so a building lit up by
// one system and levelled by another can never disagree about which building it
// was: both carry the same PropInstance.
bus.on('lockOn', (e) => {
  game.demolitionRef()?.lock(e.prop);
  sfx.lock();
});
bus.on('lockOff', (e) => game.demolitionRef()?.release(e.prop));
bus.on('demolish', (e) => {
  game.demolitionRef()?.demolish(e.prop, e.impact, e.power, e.ballRadius);
  sfx.demolish(e.power);
  // The hardest *shake* in the game — flattening a building is the one moment
  // that should physically jolt the picture — but only a token dolly. The
  // punch pulls the camera back, and pulling back is the last thing this
  // moment wants: it shrinks the rubble at the exact instant the player is
  // meant to watch it fly. The big dolly stays the tier-up's signature, where
  // the whole point *is* seeing more world.
  game.camera.shake(0.7 + e.power * 0.8);
  game.camera.punch(0.06 + e.power * 0.08);
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
  `${BUILD}\n${renderer.diagnostics()}\npost   ${post.enabled ? (post.hdr ? 'hdr' : 'ldr 8-bit') : 'off'}` +
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
results.onShop = () => shop.show();

// ── meta screens ──────────────────────────────────────────────────────────
//
// All three return to whatever was underneath them. `game.state === 'paused'`
// is the tell that the pause menu opened them, since the results screen leaves
// the game 'ended' and the boot menu leaves it 'ready'.
const backToWhereWeCameFrom = () => {
  if (game.state === 'paused') pause.show();
};

collection.onClose = backToWhereWeCameFrom;
shop.onClose = () => {
  backToWhereWeCameFrom();
  boot.refresh(); // harmless once the boot screen is gone
};
// Equipping re-skins the live ball immediately: the whole point of buying one
// is seeing it, and waiting for the next run to start would bury the payoff.
shop.onEquip = (id) => game.ball.setSkin(skinById(id));

pause.onShop = () => shop.show();
pause.onDaily = () => void daily.show().then(backToWhereWeCameFrom);

/**
 * The mid-run upgrade draft.
 *
 * Suspends rather than pauses, so the pause panel doesn't stack underneath, and
 * ducks the mix the way every other modal does. `rewardOffer` fires from inside
 * the fixed step, so this handler must not assume it can run synchronously —
 * it doesn't; the step finishes and the loop simply finds the game suspended.
 */
bus.on('rewardOffer', async () => {
  game.suspend();
  audio.duck(0.5);
  await rewards.show();
  audio.duck(0);
  game.unsuspend();
});

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
    // Animated skins share one clock, advanced here so a paused game holds its
    // pattern still rather than drifting behind a modal.
    if (game.state === 'playing') tickSkins(dt);

    const speed = Math.hypot(game.ball.vel.x, game.ball.vel.z);
    // Reads the ball's real ceiling, upgrades included, so the rolling loop
    // doesn't max out early on an upgraded ball.
    const maxSpeed = game.ball.maxSpeed;
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

    // After game.render, so it overwrites the follow camera's transform.
    if (fly.enabled) {
      input.enabled = false; // restart() re-enables input, so hold it down here
      fly.update(dt);
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
        `rubble ${s.rubble}\n` +
        `post   ${post.enabled ? (post.hdr ? 'hdr' : 'ldr (8-bit)') : 'off'}` +
        (post.failure ? `\n       ${post.failure}` : '') +
        `\n${renderer.diagnostics()}` +
        `\n${music.describe()}` +
        (fly.enabled ? `\n${fly.describe()}` : '');
    }
  }
);

// ── go ────────────────────────────────────────────────────────────────────
(async function start() {
  loop.start();

  await game.load((p) => boot.setProgress(p * 0.92));
  game.begin();
  paintCards();

  // `?bench=1` measures the render path with gl.finish, so the numbers include
  // GPU time rather than command submission alone.
  if (/[?&]bench=1/.test(location.search)) {
    loop.stop();
    // `&tier=N` drives the real simulation up to that tier first, so the ball
    // carries genuine absorbed geometry rather than merely claiming a radius.
    const want = /[?&]tier=(\d)/.exec(location.search);
    let ff = { seconds: 0, tier: 0 };
    if (want) {
      game.start(); // fastForward only runs the sim while the game is playing
      const cap = /[?&]ffmax=(\d+)/.exec(location.search);
      ff = game.fastForward(parseInt(want[1], 10), cap ? parseInt(cap[1], 10) : undefined);
      game.camera.snapTo(game.ball.pos, game.ball.visualRadius);
      renderer.focusShadow(game.ball.pos, game.ball.visualRadius);
    }
    const r = runBench(renderer.renderer, renderer.scene, renderer.camera, {
      tier: ff.tier,
      ball: game.ball.spinner as never,
      // The same work the real loop does, so the number matches what the player
      // feels rather than just the scene draw.
      frame: (dt) => {
        game.step(dt);
        game.render(dt);
        post.render();
      },
    });
    showBench(
      uiRoot,
      r,
      `${BUILD}\n${renderer.diagnostics().replace(/\n/g, ' | ')}` +
        (want ? `\nfast-forward ${ff.seconds.toFixed(0)}s sim -> tier ${ff.tier}` : '')
    );
    return;
  }

  // `?tier=N` on its own fast-forwards then hands control back, for eyeballing
  // how the ball and city look at a high tier without playing there.
  const jump = /[?&]tier=(\d)/.exec(location.search);
  if (jump && !/[?&]bench=1/.test(location.search)) {
    game.start();
    game.fastForward(parseInt(jump[1], 10));
    // The fast-forward relocates the ball to wherever the food was, which can
    // be tucked behind a tower. Park it back at the open start point so the
    // grown ball is actually visible.
    const at = /[?&]at=edge/.test(location.search);
    game.ball.pos.set(
      at ? game.city.bounds.minX + 10 : game.city.start.x,
      game.ball.visualRadius,
      at ? game.city.bounds.minZ + 10 : game.city.start.z
    );
    game.ball.vel.set(0, 0, 0);
    game.camera.snapTo(game.ball.pos, game.ball.visualRadius);
  }

  // `?fly=1` frees the camera from the ball for inspecting the level.
  if (on('fly')) {
    fly.attach();
    const sp = param('flyspeed');
    if (sp) fly.speed = parseFloat(sp);
    // `?flyat=x,y,z` starts the camera somewhere specific, looking at the map
    // centre — handy for an overhead read of the whole district. Six numbers
    // aim it somewhere else instead: `?flyat=x,y,z,lookX,lookY,lookZ`.
    const at = param('flyat');
    if (at) {
      const n = at.split(',').map(Number);
      fly.placeAt(n[0], n[1], n[2], {
        x: n[3] ?? 0,
        y: n[4] ?? 0,
        z: n[5] ?? 0,
      });
    }
    // Exposed so the camera can be driven or inspected from the console.
    (window as unknown as { fly: FlyCamera }).fly = fly;
    perfOn = true; // the overlay carries the fly controls hint
    perf.classList.add('on');
    uiRoot.append(
      el(
        'div',
        {
          style:
            'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:200;' +
            'background:rgba(12,10,24,.82);color:#e8e8f0;font:11px/1.6 ui-monospace,monospace;' +
            'padding:8px 14px;border-radius:10px;text-align:center;pointer-events:none',
        },
        'FLY  ·  click to capture mouse, Esc to release  ·  WASD move  ·  ' +
          'Space/E up, Q/C down  ·  Shift fast, Alt slow  ·  wheel speed'
      )
    );
  }

  // `?selftest=1` bisects the render path on the device and prints the result.
  if (/[?&]selftest=1/.test(location.search)) {
    loop.stop();
    const steps = runSelfTest(renderer.renderer, renderer.scene, renderer.camera);
    showSelfTest(uiRoot, steps, `${BUILD}\n${renderer.diagnostics().replace(/\n/g, ' | ')}`);
    return;
  }
  boot.setProgress(1);
  boot.ready(TIERS.length);

  // Every boot button doubles as the audio unlock gesture, not just Play — a
  // player who opens the shop first and starts a run afterwards would otherwise
  // get a silent game.
  const unlock = async () => {
    await audio.unlock();
    sfx.click();
  };

  boot.onShop = async () => {
    await unlock();
    shop.show();
  };
  boot.onDaily = async () => {
    await unlock();
    await daily.show();
    boot.refresh();
  };

  boot.onPlay = async () => {
    await unlock();
    // Today's reward is offered on the way into the first run rather than on
    // arrival: before Play there has been no gesture, so the claim would happen
    // in silence. One extra tap, and it lands with its coin shower intact.
    if (DailyReward.pending) {
      await daily.show();
      boot.refresh();
    }
    music.start();
    music.setTier(0);
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
