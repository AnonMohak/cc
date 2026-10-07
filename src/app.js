import * as THREE from 'three';
import { createRenderer } from './core/createRenderer.js';
import { createCamera, CAMERA_LIMITS, CAMERA_HOME } from './core/createCamera.js';
import { createComposer } from './core/createComposer.js';
import { createLoop } from './core/loop.js';
import { createCameraFly, framingPosition, easeInOutCubic } from './core/cameraFly.js';
import { createFall, fallPose, fallDistance, orbitRate, R_END, FILM_ELEVATION_DEG } from './core/blackHoleFall.js';
import { captureScreenshot } from './core/screenshot.js';
import { createStarfield } from './scene/starfield.js';
import { createSky } from './scene/sky.js';
import { GalaxyManager } from './scene/GalaxyManager.js';
import { pickGalaxy } from './scene/picking.js';
import { createStore, createInitialState, canAddGalaxy } from './state/store.js';
import { QUALITY, isMobileDevice, startTier, targetFrameMs, activeTier, spikeStyle, cinematicEnabled } from './core/quality.js';
import { createQualityGovernor } from './core/qualityGovernor.js';
import { createRenderGate } from './core/renderGate.js';
import { createActions } from './state/actions.js';
import * as persistence from './state/persistence.js';
import { createControlPanel } from './ui/controlPanel.js';
import { attachPointerInput } from './ui/pointerInput.js';
import { attachKeyboard } from './ui/keyboard.js';
import { debounce } from './util/debounce.js';
import { PRESETS } from './galaxy/presets.js';
import { showNotice, showToast } from './ui/notice.js';
import { createHistory } from './state/history.js';
import { shareUrl, decodeScene, codeFromHash } from './state/shareCodec.js';
import { downloadText, downloadBlob, fileStamp, pickTextFile } from './ui/fileIO.js';
import { createVideoRecorder, createGifCapture, formatClock } from './core/recorder.js';
import { createFpsMeter } from './ui/fpsMeter.js';
import { createGpuTimer, formatTimings, gpuName } from './core/gpuTimer.js';
import { createInfoCard } from './ui/infoCard.js';
import { createFallOverlay } from './ui/fallOverlay.js';
import { createWakeLock } from './ui/wakeLock.js';
import { createSoundscape } from './audio/soundscape.js';
import { createHud } from './ui/hud.js';
import { createTour } from './core/tour.js';
import { createFlyControls } from './core/flyControls.js';
import { universeBounds, LAYOUTS } from './state/universe.js';
import { catalogueViewDirection } from './galaxy/catalogue.js';
import { bandFor, nextBand } from './galaxy/bands.js';
import { meterFrame, targetFactor, adapt } from './core/autoExposure.js';

const SAVE_DEBOUNCE_MS = 500;
// The film shot is this much closer than the "disc fills the view" distance.
const FILM_CLOSER = 0.9;
// Intro fall: seconds for the fly back out, and for the elevation to settle.
const FALL_ESCAPE_SECONDS = 1.5;
const FALL_SETTLE_SECONDS = 10;

// Intro fall scratch objects (no per-frame allocation).
const _fallCenter = new THREE.Vector3();
const _fallNormal = new THREE.Vector3();
const _fallE1 = new THREE.Vector3();
const _fallE2 = new THREE.Vector3();
const _fallOffset = new THREE.Vector3();
const _fallLook = new THREE.Vector3();

/** The intro scene: exactly one standalone black hole (film shot + intro fall). */
function isSingleBlackHole(state) {
  return state.galaxies.length === 1 && state.galaxies[0].kind === 'blackhole';
}

/**
 * Build the scene, state, UI and loop inside `container`.
 * @param {HTMLElement} container
 * @param {{ startScreen?: { ready(): void, isOpen(): boolean } }} [options]
 */
export function startApp(container, { startScreen } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#02030a');

  // ── Quality: a fixed tier, or Auto (the governor picks from frame times) ─
  const mobile = isMobileDevice();
  const makeGovernor = (start) => createQualityGovernor({ start, targetMs: targetFrameMs(mobile), minTier: mobile ? 'minimal' : 'medium' });
  let governor = makeGovernor(startTier(mobile));
  // Start from the device default; applyTier() below switches to the saved
  // setting (and resizes) as soon as the store exists.
  const initialTier = governor.tier();

  const { renderer, resize: resizeRenderer, setMaxPixelRatio } = createRenderer(container, {
    maxPixelRatio: QUALITY[initialTier].maxPixelRatio,
  });
  const { camera, controls, resize: resizeCamera } = createCamera(
    renderer.domElement,
    container.clientWidth / container.clientHeight,
  );
  // The normal field of view (the intro fall widens it for a while).
  const baseFov = camera.fov;

  const starfield = createStarfield({ pixelRatio: renderer.getPixelRatio() });
  scene.add(starfield.object);
  // The sky texture bakes in a worker; redraw once it arrives (even when paused).
  const sky = createSky({ onReady: () => gate.invalidate() });
  scene.add(sky.object);

  // ── State ──────────────────────────────────────────────────────────────
  const storage = window.localStorage;
  const actions = createActions();
  const store = createStore(undefined, persistence.load(storage) ?? createInitialState());
  // A fresh scene starts with one standalone black hole, framed like the film shot.
  if (store.getState().galaxies.length === 0) store.dispatch(actions.addBlackHole(store.getState()));

  const save = debounce(() => persistence.save(store.getState(), storage), SAVE_DEBOUNCE_MS);
  store.subscribe(save);
  window.addEventListener('pagehide', () => save.flush());

  const history = createHistory(store);

  /** Replace the whole scene (share link or imported file). */
  function loadScene(state, message) {
    store.dispatch(actions.loadState(state));
    history.clear();
    showToast(container, message);
  }

  async function loadFromHash() {
    const code = codeFromHash(window.location.hash);
    if (!code) return;
    // Drop the hash so a reload does not re-apply it over later edits.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const state = await decodeScene(code);
    if (state) loadScene(state, 'Shared scene loaded');
    else showToast(container, 'This share link is broken or from a newer version');
  }
  loadFromHash();
  window.addEventListener('hashchange', loadFromHash);

  const galaxies = new GalaxyManager({ scene, store, pixelRatio: renderer.getPixelRatio() });

  /**
   * Camera for the "Interstellar" view of a standalone black hole: a few
   * degrees above its disc plane (FILM_ELEVATION_DEG), close enough that the
   * disc fills most of the width (FILM_CLOSER brings it a bit nearer).
   */
  function filmShot(id) {
    const galaxy = galaxies.get(id);
    if (!galaxy?.standalone) return null;
    const { center, normal } = galaxy.pickTarget();
    const outer = galaxy.hole.discSize * galaxy.rsUnit * galaxy.radius;
    const tanY = Math.tan(THREE.MathUtils.degToRad(baseFov / 2));
    const tanX = tanY * camera.aspect;
    const distance = THREE.MathUtils.clamp(
      Math.max(outer / tanY, outer / (0.9 * tanX)) * FILM_CLOSER,
      CAMERA_LIMITS.minDistance,
      CAMERA_LIMITS.maxDistance,
    );
    // Toward +z in the disc plane (any in-plane direction if the disc faces z).
    const side = new THREE.Vector3(0, 0, 1).addScaledVector(normal, -normal.z);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0).addScaledVector(normal, -normal.x);
    side.normalize();
    const elevation = THREE.MathUtils.degToRad(FILM_ELEVATION_DEG);
    const dir = side.multiplyScalar(Math.cos(elevation)).addScaledVector(normal, Math.sin(elevation));
    return { center, position: center.clone().addScaledVector(dir, distance) };
  }
  // The camera is not saved: every load of a single-black-hole scene starts
  // at the film shot (the home view would be far away).
  if (isSingleBlackHole(store.getState())) {
    const shot = filmShot(store.getState().galaxies[0].id);
    if (shot) {
      controls.target.copy(shot.center);
      camera.position.copy(shot.position);
      controls.update();
    }
  }
  const post = createComposer(renderer, scene, camera, {
    bloomStrength: store.getState().settings.bloomStrength,
    volumeScale: QUALITY[initialTier].volumeScale,
  });
  // Rays bent off the screen by a black hole see the same Milky Way.
  post.setBlackHoleSky(sky.uniforms);

  // Render on demand: skip GPU work when nothing moves or changes.
  const gate = createRenderGate();
  galaxies.onChange = () => gate.invalidate(); // e.g. a debounced disc-map rebake

  let currentTier = null;
  let onTierChange = () => {};
  function applyTier(name) {
    if (name === currentTier) return;
    currentTier = name;
    const tier = QUALITY[name];
    galaxies.setQuality(tier);
    post.setVolumeScale(tier.volumeScale);
    post.setBloomMode(tier.bloom);
    if (setMaxPixelRatio(tier.maxPixelRatio)) resizeAll();
    gate.invalidate();
    onTierChange(name);
    applySpikes();
    applyCinematic();
  }

  // Standalone black holes are objects in the scene: they draw on every tier.
  post.setBlackHoles((slots) => galaxies.blackHoleCandidates(slots), true);

  function applyCinematic() {
    const settings = store.getState().settings;
    post.setCinematic(settings, cinematicEnabled(settings, currentTier));
  }

  function applySpikes() {
    const style = spikeStyle(store.getState().settings.spikes, currentTier);
    galaxies.setSpikeStyle(style);
    starfield.setSpikeStyle(style);
  }

  // ── Loop and camera ────────────────────────────────────────────────────
  const loop = createLoop();
  const cameraFly = createCameraFly(camera, controls);
  // Any user orbit/zoom takes over from an automatic camera move or a tour.
  controls.addEventListener('start', () => {
    cameraFly.cancel();
    if (cameraMode === 'tour') setCameraMode('orbit');
  });

  // ── Camera modes: orbit (default), free-fly, guided tour ─────────────
  const fly = createFlyControls(camera, renderer.domElement);
  const tour = createTour(() => store.getState().galaxies.map((g) => g.id));
  const TOUR_FLY_SECONDS = 3;
  const TOUR_ORBIT_SPEED = 1.2;
  const badge = document.createElement('div');
  badge.className = 'mode-badge';
  badge.hidden = true;
  container.appendChild(badge);
  const BADGE_TEXT = {
    fly: 'Free-fly · WASD move · Q/E down/up · Shift fast · drag to look · Esc or G to exit',
    tour: 'Guided tour · drag, scroll or Esc to stop',
  };
  let cameraMode = 'orbit';

  function setCameraMode(next) {
    if (next === cameraMode) return;
    if (cameraMode === 'fall') {
      controls.enabled = true;
      controls.autoRotate = store.getState().settings.autoRotate;
      fallRun?.galaxy.setHoleSpin(1);
      fallRun = null;
    }
    if (cameraMode === 'fly') {
      fly.disable();
      fly.lookTarget(Math.max(camera.position.distanceTo(controls.target), 8), controls.target);
      controls.enabled = true;
    }
    if (cameraMode === 'tour') {
      tour.stop();
      controls.autoRotateSpeed = 0.4;
      controls.autoRotate = store.getState().settings.autoRotate;
    }
    cameraMode = next;
    if (next === 'fly') {
      cameraFly.cancel();
      controls.enabled = false;
      fly.enable();
    }
    if (next === 'tour') handleTourEvent(tour.start());
    if (next === 'fall') {
      cameraFly.cancel();
      controls.enabled = false;
      controls.autoRotate = false;
    }
    badge.hidden = !BADGE_TEXT[cameraMode];
    badge.textContent = BADGE_TEXT[cameraMode] ?? '';
  }

  function handleTourEvent(event) {
    if (!event) return;
    if (event.type === 'end') {
      setCameraMode('orbit');
    } else if (event.type === 'fly') {
      controls.autoRotate = false;
      focusGalaxy(event.id, TOUR_FLY_SECONDS);
    } else if (event.type === 'dwell') {
      controls.autoRotateSpeed = TOUR_ORBIT_SPEED;
      controls.autoRotate = true;
    }
  }

  function focusGalaxy(id, seconds = 1.2) {
    const galaxy = galaxies.get(id);
    if (!galaxy) return;
    // Free-fly owns the camera orientation; focusing hands it back to orbit.
    if (cameraMode === 'fly') setCameraMode('orbit');
    store.dispatch(actions.selectGalaxy(id));
    const shot = filmShot(id);
    if (shot) {
      cameraFly.flyTo(shot.center, shot.position, seconds);
      return;
    }
    const { center, normal, radius } = galaxy.pickTarget();
    const entry = store.getState().galaxies.find((g) => g.id === id);
    // Real galaxies are framed from the direction that shows their true inclination.
    const viewDir = entry?.catalog ? catalogueViewDirection() : undefined;
    const position = framingPosition(
      camera.position,
      center,
      normal,
      radius,
      { min: CAMERA_LIMITS.minDistance, max: CAMERA_LIMITS.maxDistance },
      viewDir,
    );
    cameraFly.flyTo(center, position, seconds);
  }

  // ── Intro fall into the black hole (core/blackHoleFall.js) ─────────────
  // Idle after the start box on a single-black-hole scene: the camera
  // spirals in with the disc and falls in. A click, tap, wheel or the
  // controls panel ends it and flies back out. Once per page load, for
  // everyone (also with reduced motion: it is the intro, and any click ends it).
  const fall = createFall();
  const fallOverlay = createFallOverlay(container);
  // Phones would sleep before the minute is over, and the waking tap would
  // end the fall: keep the screen on while it waits and falls.
  const wakeLock = createWakeLock();
  // Sound: a quiet generated drone, and the fall music during the intro fall.
  // Browsers allow audio only after a gesture: unlock on the first one (the
  // start-box click or tap), then stop listening.
  const soundscape = createSoundscape();
  const unlockEvents = ['pointerup', 'touchend', 'click', 'keydown'];
  const unlockSound = () => {
    if (!soundscape.unlock()) return;
    for (const type of unlockEvents) window.removeEventListener(type, unlockSound, true);
  };
  for (const type of unlockEvents) window.addEventListener(type, unlockSound, true);
  // The start box hint ("Stay still…") only fits the intro scene.
  document.getElementById('start-hint')?.toggleAttribute('hidden', !isSingleBlackHole(store.getState()));
  /** The running fall: hole, basis and start pose (see beginFall). */
  let fallRun = null;
  let fallU = 0;
  let fovEase = null; // { from, t } while the fov returns to baseFov

  function fallEligible() {
    return isSingleBlackHole(store.getState()) && (cameraMode === 'orbit' || cameraMode === 'fall');
  }

  /** Start from wherever the camera is (after a reload it is at CAMERA_HOME). */
  function beginFall() {
    const id = store.getState().galaxies[0]?.id;
    const galaxy = galaxies.get(id);
    if (!galaxy) return;
    const { center, normal } = galaxy.pickTarget();
    _fallCenter.copy(center);
    _fallNormal.copy(normal);
    // In-plane basis with e2 = n x e1: the angle grows in the disc's spin direction.
    _fallE1.set(1, 0, 0).addScaledVector(_fallNormal, -_fallNormal.x);
    if (_fallE1.lengthSq() < 1e-6) _fallE1.set(0, 0, 1).addScaledVector(_fallNormal, -_fallNormal.z);
    _fallE1.normalize();
    _fallE2.crossVectors(_fallNormal, _fallE1);
    _fallOffset.subVectors(camera.position, _fallCenter);
    const r0 = Math.max(_fallOffset.length(), 1e-3);
    fallRun = {
      id,
      galaxy,
      r0,
      rEnd: R_END * galaxy.rsUnit * galaxy.radius,
      angle: Math.atan2(_fallOffset.dot(_fallE2), _fallOffset.dot(_fallE1)),
      elevation0: Math.asin(THREE.MathUtils.clamp(_fallOffset.dot(_fallNormal) / r0, -1, 1)),
      clock: 0,
    };
    fovEase = null;
    setCameraMode('fall');
    controls.target.copy(_fallCenter);
  }

  /** Place the camera for fall progress u (loop, real time). */
  function updateFallCamera(realDt, u) {
    const run = fallRun;
    if (!run) return;
    const pose = fallPose(u);
    run.clock += realDt;
    const r = fallDistance(run.r0, run.rEnd, pose.distanceT);
    run.angle += orbitRate(r, run.r0) * realDt;
    const settle = easeInOutCubic(Math.min(1, run.clock / FALL_SETTLE_SECONDS));
    const elevation = THREE.MathUtils.lerp(run.elevation0, THREE.MathUtils.degToRad(FILM_ELEVATION_DEG), settle);
    const ring = Math.cos(elevation) * r;
    camera.position
      .copy(_fallCenter)
      .addScaledVector(_fallE1, Math.cos(run.angle) * ring)
      .addScaledVector(_fallE2, Math.sin(run.angle) * ring)
      .addScaledVector(_fallNormal, Math.sin(elevation) * r);
    // Tidal shake near the end: the look point wobbles (sums of sines).
    const k = pose.shake * r * 0.02;
    const c = run.clock;
    _fallLook
      .copy(_fallCenter)
      .addScaledVector(_fallE1, k * Math.sin(c * 13.1))
      .addScaledVector(_fallE2, k * Math.sin(c * 17.3 + 1.1))
      .addScaledVector(_fallNormal, k * Math.sin(c * 11.7 + 2.3));
    camera.lookAt(_fallLook);
    const fov = baseFov + pose.fovAdd;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    run.galaxy.setHoleSpin(pose.spin);
    fallOverlay.set(pose.vignette, pose.black);
  }

  /** Leave the fall: fade in, ease the fov back and (optionally) fly out. */
  function escapeFall(flyBack = true) {
    const id = fallRun?.id;
    setCameraMode('orbit');
    fallOverlay.fadeOut(0.6);
    if (camera.fov !== baseFov) fovEase = { from: camera.fov, t: 0 };
    const shot = flyBack && id ? filmShot(id) : null;
    if (shot) cameraFly.flyTo(shot.center, shot.position, FALL_ESCAPE_SECONDS);
  }

  /** A real interaction (or a command that takes the camera) ends the fall for good. */
  function interruptFall(flyBack = true) {
    if (!fall || (startScreen?.isOpen() ?? false)) return false;
    const result = fall.interact();
    if (result === 'escape') escapeFall(flyBack);
    return result === 'escape';
  }

  if (fall) {
    // Capture phase: an escaping click must not also select or orbit, and an
    // escaping wheel must not zoom while the camera flies back.
    const onInput = (event) => {
      if (fall.phase() === 'done') return;
      if (interruptFall() && event.target === renderer.domElement) {
        event.stopPropagation();
        event.preventDefault();
      }
    };
    window.addEventListener('pointerdown', onInput, true);
    window.addEventListener('wheel', onInput, { capture: true, passive: false });
  }

  let currentBand = null;
  function applyBand(name) {
    if (name === currentBand) return;
    currentBand = name;
    const { skyTint, fieldGain } = bandFor(name);
    galaxies.setBand(name);
    post.setBlackHoleBand(bandFor(name));
    sky.setBandTint(...skyTint);
    starfield.setBandTint(...skyTint.map((c) => c * fieldGain));
  }

  // Auto exposure: the meter sets a target; the loop eases toward it.
  let autoFactor = 1;
  let autoTarget = 1;
  function onExposureReading(bytes) {
    const { autoExposure, exposure } = store.getState().settings;
    if (!autoExposure) return;
    autoTarget = targetFactor(meterFrame(bytes), exposure);
    // The reading can land after the gate went idle: wake it to adapt.
    if (autoTarget !== autoFactor) gate.invalidate();
  }
  function applyAutoExposure(on) {
    post.setAutoExposure(on, onExposureReading);
    if (!on) {
      // Fully manual again, at once.
      autoFactor = autoTarget = 1;
      post.setAutoExposureFactor(1);
    }
  }

  function applySettings(settings) {
    loop.setPaused(settings.paused);
    loop.setTimeScale(settings.timeScale);
    if (cameraMode !== 'tour' && cameraMode !== 'fall') controls.autoRotate = settings.autoRotate;
    post.setBloomStrength(settings.bloomStrength);
    post.setExposure(settings.exposure);
    applyAutoExposure(settings.autoExposure);
    post.setFlare(settings.flare);
    sky.setVisible(settings.sky);
    post.setBlackHoleSkyVisible(settings.sky);
    soundscape.setEnabled(settings.sound);
    applyBand(settings.band);
    if (currentTier) {
      applySpikes();
      applyCinematic();
    }
  }
  applySettings(store.getState().settings);
  applyTier(activeTier(store.getState().settings.quality, governor.tier()));
  store.subscribe((next, prev) => {
    if (next.settings !== prev.settings) applySettings(next.settings);
    if (next.settings.quality !== prev.settings.quality) {
      // Switching to Auto starts measuring from the tier in use now.
      if (next.settings.quality === 'auto') governor = makeGovernor(currentTier);
      applyTier(activeTier(next.settings.quality, governor.tier()));
    }
  });

  store.subscribe(() => gate.invalidate());
  controls.addEventListener('change', () => gate.invalidate());

  loop.onTick((dt, _elapsed, realDt) => {
    galaxies.tick(dt, realDt);
    if (cameraMode === 'tour') handleTourEvent(tour.tick(realDt));
    if (fall && fall.phase() !== 'done' && !(startScreen?.isOpen() ?? false)) {
      // Opening the controls panel is an interaction too.
      if (panel.isOpen()) interruptFall();
      const { phase, u } = fall.tick(realDt, fallEligible());
      if ((phase === 'falling' || phase === 'fallen') && cameraMode !== 'fall') beginFall();
      if (cameraMode === 'fall') fallU = u;
      // The scene changed under the fall (e.g. N added a galaxy): leave it.
      if (phase === 'done' && cameraMode === 'fall') escapeFall();
    }
    soundscape.setMode(cameraMode === 'fall' ? 'fall' : 'ambient');
    // Fallen in (held black) or done: the screen may sleep again.
    const fallPhase = fall.phase();
    wakeLock.set(fallPhase === 'falling' || (fallPhase === 'waiting' && !(startScreen?.isOpen() ?? false)));
    if (fovEase) {
      fovEase.t = Math.min(1, fovEase.t + realDt / FALL_ESCAPE_SECONDS);
      camera.fov = THREE.MathUtils.lerp(fovEase.from, baseFov, easeInOutCubic(fovEase.t));
      camera.updateProjectionMatrix();
      if (fovEase.t >= 1) fovEase = null;
    }
    cameraFly.update(realDt);
    if (cameraMode === 'fly') fly.update(realDt);
    else if (cameraMode === 'fall') updateFallCamera(realDt, fallU);
    else controls.update();
    galaxies.updateCamera(camera, container.clientWidth, container.clientHeight);
    starfield.update(camera.position);
    sky.update(camera.position);
    // Real time: it adapts while the simulation is paused, too.
    if (post.autoExposureFailed()) autoTarget = 1;
    if (autoFactor !== autoTarget) {
      autoFactor = adapt(autoFactor, autoTarget, realDt);
      post.setAutoExposureFactor(autoFactor);
    }
  });
  if (new URLSearchParams(window.location.search).has('fps')) {
    const gl = renderer.getContext();
    const timer = createGpuTimer(gl);
    post.attachTimer(timer);
    const gpu = gpuName(gl);
    const meter = createFpsMeter(container, undefined, () => [
      gpu,
      `quality ${store.getState().settings.quality} → ${currentTier}`,
      `exposure ×${autoFactor.toFixed(2)}${post.autoExposureFailed() ? ' (auto unavailable)' : ''}`,
      timer.supported ? formatTimings(timer.results()) : 'GPU timings unavailable',
    ]);
    loop.onTick(() => {
      timer.poll();
      meter.update();
    });
  }
  // ── Recording: video (MediaRecorder) and short GIFs ──────────────────
  const video = createVideoRecorder(renderer.domElement, {
    onStop: (blob, ext) => {
      downloadBlob(blob, `galaxy-${fileStamp()}.${ext}`);
      showToast(container, 'Video saved');
    },
  });
  const gif = createGifCapture(renderer.domElement);
  const recBadge = document.createElement('div');
  recBadge.className = 'rec-badge';
  recBadge.hidden = true;
  container.appendChild(recBadge);
  let lastBadge = 0;
  loop.onTick(() => {
    const now = performance.now();
    if (now - lastBadge < 250) return;
    lastBadge = now;
    const progress = gif.progress();
    let text = '';
    if (video.isRecording()) text = `REC ${formatClock(video.elapsed())}`;
    else if (progress) text = `GIF ${progress.frames}/${progress.total}`;
    else if (gif.isEncoding()) text = 'Encoding GIF…';
    recBadge.hidden = !text;
    recBadge.textContent = text;
  });

  let lastRender = null;
  loop.setRender(() => {
    const active =
      !loop.isPaused() ||
      cameraFly.isFlying() ||
      cameraMode !== 'orbit' ||
      fovEase !== null ||
      controls.autoRotate ||
      galaxies.isEasing() ||
      autoFactor !== autoTarget ||
      video.isRecording() ||
      gif.isCapturing();
    const now = performance.now();
    // Fallen in: the screen is held black by the overlay, so draw nothing.
    if (fall?.phase() === 'fallen') {
      lastRender = null;
      return;
    }
    if (!gate.shouldRender(active)) {
      lastRender = null;
      return;
    }
    // Auto quality: measure only back-to-back rendered frames (real time; the
    // loop's dt is capped), so idle frames never look "fast". Frames behind
    // the start box also pay for its CSS blur, so they are not measured.
    const starting = startScreen?.isOpen() ?? false;
    if (lastRender !== null && !starting && store.getState().settings.quality === 'auto') {
      const next = governor.sample(now - lastRender);
      if (next) applyTier(next);
    }
    lastRender = starting ? null : now;
    post.render();
    if (starting) startScreen.ready();
    // Copy GIF frames in the same task as the render (drawing buffer still valid).
    gif.afterRender(now);
  });

  function resizeAll() {
    const { clientWidth: w, clientHeight: h } = container;
    resizeRenderer(w, h);
    resizeCamera(w, h);
    post.resize(w, h);
    starfield.setPixelRatio(renderer.getPixelRatio());
    galaxies.setPixelRatio(renderer.getPixelRatio());
    gate.invalidate();
  }
  window.addEventListener('resize', resizeAll);

  // ── Commands ───────────────────────────────────────────────────────────
  const getTarget = () => controls.target.toArray().map((v) => Math.round(v * 100) / 100);

  const commands = {
    addGalaxy() {
      const state = store.getState();
      if (canAddGalaxy(state, PRESETS.spiral.shape.count)) {
        store.dispatch(actions.addGalaxy(state, 'spiral', getTarget()));
      }
    },
    deleteSelected() {
      const { selectedId } = store.getState();
      if (selectedId) store.dispatch(actions.removeGalaxy(selectedId));
    },
    focusSelected() {
      interruptFall(false);
      const { selectedId } = store.getState();
      if (selectedId) focusGalaxy(selectedId);
    },
    // Esc leaves a camera mode first, then clears the selection.
    deselect() {
      if (cameraMode !== 'orbit') setCameraMode('orbit');
      else store.dispatch(actions.selectGalaxy(null));
    },
    nextBand() {
      const band = nextBand(store.getState().settings.band);
      store.dispatch(actions.updateSettings({ band }));
      showToast(container, `View: ${bandFor(band).label}`);
    },
    toggleFly() {
      interruptFall(false);
      setCameraMode(cameraMode === 'fly' ? 'orbit' : 'fly');
    },
    toggleTour() {
      interruptFall(false);
      setCameraMode(cameraMode === 'tour' ? 'orbit' : 'tour');
    },
    resetView() {
      interruptFall(false);
      setCameraMode('orbit');
      cameraFly.flyTo(CAMERA_HOME.target, CAMERA_HOME.position);
    },
    togglePause: () => store.dispatch(actions.updateSettings({ paused: !store.getState().settings.paused })),
    toggleSound() {
      const sound = !store.getState().settings.sound;
      store.dispatch(actions.updateSettings({ sound }));
      showToast(container, sound ? 'Sound on' : 'Sound off');
    },
    screenshot: () => captureScreenshot({ canvas: renderer.domElement, render: () => post.render() }),
    toggleVideo() {
      if (!video.isSupported()) {
        showToast(container, 'Video recording is not supported in this browser');
      } else if (video.isRecording()) {
        video.stop();
      } else {
        video.start();
      }
    },
    async recordGif() {
      if (gif.isCapturing() || gif.isEncoding()) return;
      const capture = gif.start();
      const total = gif.progress().total;
      downloadBlob(await capture, `galaxy-${fileStamp()}.gif`);
      showToast(container, `GIF saved (${total} frames)`);
    },
    generateUniverse(layout = 'cluster', count = 8) {
      const hasGalaxies = store.getState().galaxies.length > 0;
      if (hasGalaxies && !window.confirm(`Replace the scene with a generated ${LAYOUTS[layout].label.toLowerCase()}? (Ctrl+Z undoes it)`)) return;
      setCameraMode('orbit');
      store.dispatch(actions.generateUniverse(layout, count));
      const { galaxies: list } = store.getState();
      const { center, radius } = universeBounds(list);
      const target = new THREE.Vector3(...center);
      const distance = THREE.MathUtils.clamp(radius * 2.2, 30, CAMERA_LIMITS.maxDistance * 0.9);
      const dir = CAMERA_HOME.position.clone().sub(CAMERA_HOME.target).normalize();
      cameraFly.flyTo(target, target.clone().addScaledVector(dir, distance), 2);
      showToast(container, `Generated a ${LAYOUTS[layout].label.toLowerCase()} of ${list.length} galaxies · Ctrl+Z to undo`);
    },
    undo: () => history.undo(),
    redo: () => history.redo(),
    async copyShareLink() {
      const url = await shareUrl(store.getState(), window.location);
      try {
        await navigator.clipboard.writeText(url);
        showToast(container, 'Share link copied');
      } catch {
        // Clipboard needs a secure context and permission; let the user copy.
        window.prompt('Copy this share link:', url);
      }
    },
    exportJson() {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadText(`galaxy-scene-${stamp}.json`, JSON.stringify(JSON.parse(persistence.serialize(store.getState())), null, 2));
    },
    async importJson() {
      const text = await pickTextFile();
      if (text === null) return;
      const state = persistence.deserialize(text);
      if (state) loadScene(state, 'Scene imported');
      else showToast(container, 'That file is not a valid Galaxy Sandbox scene');
    },
    reset() {
      if (!window.confirm('Delete everything and start again with one black hole?')) return;
      interruptFall(false);
      setCameraMode('orbit');
      store.dispatch(actions.resetScene());
      store.dispatch(actions.addBlackHole(store.getState()));
      const shot = filmShot(store.getState().selectedId);
      if (shot) cameraFly.flyTo(shot.center, shot.position);
      else cameraFly.flyTo(CAMERA_HOME.target, CAMERA_HOME.position);
    },
  };

  const panel = createControlPanel({
    store,
    actions,
    getTarget,
    onFocus: focusGalaxy,
    onReset: commands.reset,
    onScreenshot: commands.screenshot,
    history,
    onShare: commands.copyShareLink,
    onExport: commands.exportJson,
    onImport: commands.importJson,
    onTour: commands.toggleTour,
    onFly: commands.toggleFly,
    onResetView: commands.resetView,
    onToggleVideo: commands.toggleVideo,
    onRecordGif: commands.recordGif,
    onGenerateUniverse: commands.generateUniverse,
  });
  commands.togglePanel = () => panel.toggle();
  onTierChange = (name) => panel.setActiveTier(name);
  panel.setActiveTier(currentTier);
  createInfoCard(container, store);
  const hud = createHud({
    container,
    store,
    camera,
    controls,
    onSelect: (id) => store.dispatch(actions.selectGalaxy(id)),
    onFocus: focusGalaxy,
  });
  loop.onTick(() => hud.update());

  attachPointerInput({
    dom: renderer.domElement,
    camera,
    pick: (ray) => pickGalaxy(ray, galaxies.pickTargets()),
    onSelect: (id) => store.dispatch(actions.selectGalaxy(id)),
    onFocus: focusGalaxy,
  });
  attachKeyboard(window, commands);

  // The browser may drop the GPU context (driver reset, too many tabs).
  // preventDefault() asks it to restore; three re-uploads everything then.
  let hideLostNotice = null;
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    loop.stop(renderer);
    hideLostNotice = showNotice(container, 'The graphics context was lost. Trying to restore it…');
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    hideLostNotice?.();
    loop.start(renderer);
  });

  loop.start(renderer);

  if (import.meta.env.DEV) {
    window.__app = { scene, camera, controls, renderer, loop, store, actions, galaxies, focusGalaxy, post, commands, history, soundscape, getCameraMode: () => cameraMode };
  }
}
