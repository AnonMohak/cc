import * as THREE from 'three';
import { createRenderer } from './core/createRenderer.js';
import { createCamera, CAMERA_LIMITS, CAMERA_HOME } from './core/createCamera.js';
import { createComposer } from './core/createComposer.js';
import { createLoop } from './core/loop.js';
import { createCameraFly, framingPosition, easeInOutCubic } from './core/cameraFly.js';
import { createFall, fallPose, fallDistance, fallAngle, R_END, FILM_ELEVATION_DEG } from './core/blackHoleFall.js';
import { captureScreenshot } from './core/screenshot.js';
import { createStarfield } from './scene/starfield.js';
import { createSky } from './scene/sky.js';
import { GalaxyManager } from './scene/GalaxyManager.js';
import { pickGalaxy } from './scene/picking.js';
import { createStore, canAddGalaxy, isIntroScene, splitIntroStart, restorePending, reducer } from './state/store.js';
import { QUALITY, TIER_ORDER, isMobileDevice, startTier, targetFrameMs, activeTier, spikeStyle, cinematicEnabled, dofEnabled } from './core/quality.js';
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
import { confirmDialog, copyDialog } from './ui/dialog.js';
import { createHistory } from './state/history.js';
import { shareUrl, decodeScene, codeFromHash } from './state/shareCodec.js';
import { downloadText, downloadBlob, fileStamp, pickTextFile } from './ui/fileIO.js';
import { createVideoRecorder, createGifCapture, formatClock } from './core/recorder.js';
import { createFpsMeter } from './ui/fpsMeter.js';
import { createGpuTimer, formatTimings, gpuName } from './core/gpuTimer.js';
import { createInfoCard } from './ui/infoCard.js';
import { createFallOverlay } from './ui/fallOverlay.js';
import { easeFocus, easeRange, focusSpan } from './core/dof.js';
import { createWakeLock } from './ui/wakeLock.js';
import { createSoundscape } from './audio/soundscape.js';
import { createHud } from './ui/hud.js';
import { createTour } from './core/tour.js';
import { createFlyControls } from './core/flyControls.js';
import { universeBounds, LAYOUTS } from './state/universe.js';
import { catalogueViewDirection } from './galaxy/catalogue.js';
import { bandFor, nextBand } from './galaxy/bands.js';
import { meterFrame, targetFactor, adapt } from './core/autoExposure.js';
import { CollisionSim, collisionSupported } from './scene/CollisionSim.js';
import { collisionBroken } from './galaxy/collision.js';
import { consumeResult } from './galaxy/consumption.js';
import { frameRadius, framingDistance, raiseDirection, easeValue, MIN_ELEVATION_DEG, TARGET_RATE, DISTANCE_RATE, DIRECTION_RATE } from './core/consumeCamera.js';
import { rumbleLevel, rumbleCutoff } from './audio/soundMix.js';

const SAVE_DEBOUNCE_MS = 500;
// The film shot is this much closer than the "disc fills the view" distance.
const FILM_CLOSER = 0.9;
// Intro fall: seconds for the fly back out, and for the elevation to settle.
const FALL_ESCAPE_SECONDS = 1.5;
const FALL_SETTLE_SECONDS = 10;
// Intro fall: idle seconds after the start box before the fall starts.
const FALL_IDLE_SECONDS = 5;

// Intro fall scratch objects (no per-frame allocation).
const _fallCenter = new THREE.Vector3();
const _fallNormal = new THREE.Vector3();
const _fallE1 = new THREE.Vector3();
const _fallE2 = new THREE.Vector3();
const _fallOffset = new THREE.Vector3();
// Depth-of-field focus scratch (no per-frame allocation).
const _focusForward = new THREE.Vector3();
const _focusPoint = new THREE.Vector3();
const _focusOther = new THREE.Vector3();
// Consumption auto-camera scratch.
const _consumeTarget = new THREE.Vector3();
const _consumeVec = new THREE.Vector3();
const _consumeVec2 = new THREE.Vector3();
const _consumeDir = [0, 0, 0];
const _consumeRaised = [0, 0, 0];
const _consumeStatus = {};

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
  // Every load starts with the animation black hole, framed like the film
  // shot. A saved scene waits in pendingScene and comes back when the intro
  // ends (restoreSavedScene); on a fresh scene the first add replaces the
  // hole (store.js withoutIntro).
  const intro = splitIntroStart(persistence.load(storage));
  const store = createStore(undefined, intro.state);
  let pendingScene = intro.pending;
  if (store.getState().galaxies.length === 0) store.dispatch(actions.addBlackHole(store.getState(), undefined, { intro: true }));

  // While the saved scene waits, keep saving it (with the current settings), not the intro.
  const save = debounce(() => {
    const state = store.getState();
    persistence.save(pendingScene ? restorePending(state, pendingScene) : state, storage);
  }, SAVE_DEBOUNCE_MS);
  store.subscribe(save);
  window.addEventListener('pagehide', () => save.flush());

  const history = createHistory(store);

  /** Replace the whole scene (share link or imported file). */
  function loadScene(state, message) {
    // A shared or imported scene replaces the waiting saved one.
    pendingScene = null;
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
  // The camera is not saved: every load of the intro scene starts at the
  // film shot (the home view would be far away).
  if (isIntroScene(store.getState())) {
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
    post.setBlackHoleMarch(Boolean(tier.holeMarch), tier.holeSteps);
    post.setBlackHoleSamples(tier.holeSamples ?? 1);
    if (setMaxPixelRatio(tier.maxPixelRatio)) resizeAll();
    gate.invalidate();
    onTierChange(name);
    applySpikes();
    applyCinematic();
  }

  // Standalone black holes are objects in the scene: they draw on every tier.
  post.setBlackHoles((slots) => galaxies.blackHoleCandidates(slots), true);
  // Jets, and stars or stream matter in front of a consuming black hole.
  post.setJetSource(() => galaxies.hasVisibleJets() || (collision?.drawsAfterLens() ?? false));

  let dofOn = false;
  function applyCinematic() {
    const settings = store.getState().settings;
    post.setCinematic(settings, cinematicEnabled(settings, currentTier));
    dofOn = dofEnabled(settings.depthOfField, currentTier);
    post.setDof(settings.depthOfField, dofOn);
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
    if (cameraMode === 'tour' || cameraMode === 'consume') setCameraMode('orbit');
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
    consume: 'Auto camera · drag, scroll or Esc to take over',
  };
  let cameraMode = 'orbit';

  function setCameraMode(next) {
    if (next === cameraMode) return;
    if (cameraMode === 'fall') {
      controls.enabled = true;
      controls.autoRotate = store.getState().settings.autoRotate;
      fallRun?.galaxy.setHoleSpin(1);
      // The lens warp eases out with the fov (no pop on escape).
      if (fallRun && fallRun.galaxy.holeWarp > 0) warpEase = { galaxy: fallRun.galaxy, from: fallRun.galaxy.holeWarp, t: 0 };
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
    if (cameraMode === 'consume') {
      consumeCam = null;
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
    if (next === 'consume') {
      // OrbitControls stays on (its 'start' event hands the camera back) but
      // is not updated: the loop places the camera (updateConsumeCamera).
      cameraFly.cancel();
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
  // Idle after the start box on the intro scene (the animation black hole): the camera
  // spirals in with the disc and falls in. A click, tap, wheel or the
  // controls panel ends it and flies back out. Once per page load, for
  // everyone (also with reduced motion: it is the intro, and any click ends it).
  const fall = createFall({ idleSeconds: FALL_IDLE_SECONDS });
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
  document.getElementById('start-hint')?.toggleAttribute('hidden', !isIntroScene(store.getState()));
  /** The running fall: hole, basis and start pose (see beginFall). */
  let fallRun = null;
  let fallU = 0;
  let fallTau = 0;
  let fovEase = null; // { from, t } while the fov returns to baseFov
  let warpEase = null; // { galaxy, from, t } while the lens warp returns to 0

  /** Soundscape mode (audio/soundMix.js) for the intro state. */
  function soundMode() {
    const phase = fall.phase();
    if (phase === 'done' || cameraMode !== 'fall' || (startScreen?.isOpen() ?? false)) return 'ambient';
    return { waiting: 'wait', falling: 'fall', fallen: 'end' }[phase];
  }

  function fallEligible() {
    return isIntroScene(store.getState()) && (cameraMode === 'orbit' || cameraMode === 'fall');
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
    warpEase = null;
    setCameraMode('fall');
    controls.target.copy(_fallCenter);
  }

  /**
   * Place the camera for fall progress u and orbit clock tau (loop, real
   * time). In the wait u is 0: the camera circles at the start distance.
   */
  function updateFallCamera(realDt, u, tau) {
    const run = fallRun;
    if (!run) return;
    const pose = fallPose(u);
    run.clock += realDt;
    const r = fallDistance(run.r0, run.rEnd, pose.distanceT);
    const angle = run.angle + fallAngle(tau);
    const settle = easeInOutCubic(Math.min(1, run.clock / FALL_SETTLE_SECONDS));
    const elevation = THREE.MathUtils.lerp(run.elevation0, THREE.MathUtils.degToRad(FILM_ELEVATION_DEG), settle);
    const ring = Math.cos(elevation) * r;
    camera.position
      .copy(_fallCenter)
      .addScaledVector(_fallE1, Math.cos(angle) * ring)
      .addScaledVector(_fallE2, Math.sin(angle) * ring)
      .addScaledVector(_fallNormal, Math.sin(elevation) * r);
    camera.lookAt(_fallCenter);
    const fov = baseFov + pose.fovAdd;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    run.galaxy.setHoleSpin(pose.spin);
    run.galaxy.setHoleWarp(pose.warp);
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
    // Cancelled in the wait: hand the camera back where it is (the same
    // press then orbits; OrbitControls is enabled again before it sees it).
    if (result === 'cancel' && cameraMode === 'fall') setCameraMode('orbit');
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

  // An add replaced the animation black hole: end the intro and frame the
  // new object (the film-shot camera would sit inside a galaxy).
  let restoring = false;
  store.subscribe((next, prev) => {
    if (restoring || !prev.galaxies.some((g) => g.intro) || next.galaxies.some((g) => g.intro)) return;
    const added = next.galaxies.filter((g) => !prev.galaxies.some((p) => p.id === g.id));
    if (added.length !== 1) return;
    interruptFall(false);
    setCameraMode('orbit');
    focusGalaxy(added[0].id);
  });

  /** The intro is over: bring back the saved scene, seen from the home view. */
  function restoreSavedScene() {
    if (!pendingScene) return;
    const pending = pendingScene;
    pendingScene = null;
    restoring = true;
    store.dispatch(actions.loadState(restorePending(store.getState(), pending)));
    restoring = false;
    history.clear();
    if (cameraMode !== 'orbit') setCameraMode('orbit');
    cameraFly.flyTo(CAMERA_HOME.target, CAMERA_HOME.position, 2);
  }

  // Depth of field: focus on the selected object (else the orbit target), as
  // a view depth to match the proxies, with a smooth focus pull. During a
  // collision every object in it stays sharp (a focus range over their depths).
  let focus = 0;
  let focusTarget = 0;
  let focusRange = 0;
  let focusRangeTarget = 0;
  const _focusDepths = new Float32Array(4);
  const _focusSpan = { focus: 0, range: 0 };
  const viewDepth = (point) => Math.max(_focusPoint.copy(point).sub(camera.position).dot(_focusForward), CAMERA_LIMITS.near);
  function updateFocus(realDt) {
    camera.getWorldDirection(_focusForward);
    const members = collision?.members() ?? null;
    if (members && members.length > 0) {
      let n = 0;
      for (const g of members) if (n < _focusDepths.length) _focusDepths[n++] = viewDepth(g.group.getWorldPosition(_focusOther));
      focusSpan(_focusDepths, n, _focusSpan);
      focusTarget = _focusSpan.focus;
      focusRangeTarget = _focusSpan.range;
    } else {
      const selected = galaxies.get(store.getState().selectedId);
      focusTarget = viewDepth(selected ? selected.group.getWorldPosition(_focusOther) : controls.target);
      focusRangeTarget = 0;
    }
    focus = easeFocus(focus, focusTarget, realDt);
    focusRange = easeRange(focusRange, focusRangeTarget, focus, realDt);
    post.setDofFocus(focus, focusRange);
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
    if (cameraMode !== 'tour' && cameraMode !== 'fall' && cameraMode !== 'consume') controls.autoRotate = settings.autoRotate;
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
  /** The tier for the state: the intro scene gets the intro tier on every setting. */
  const tierFor = (state) => activeTier(state.settings.quality, governor.tier(), { intro: isIntroScene(state), mobile });
  applySettings(store.getState().settings);
  applyTier(tierFor(store.getState()));
  store.subscribe((next, prev) => {
    if (next.settings !== prev.settings) applySettings(next.settings);
    if (next.settings.quality !== prev.settings.quality) {
      // Switching to Auto starts measuring from the tier in use now (a real
      // tier: the intro tier is not on the governor's list).
      if (next.settings.quality === 'auto') governor = makeGovernor(TIER_ORDER.includes(currentTier) ? currentTier : governor.tier());
    }
    applyTier(tierFor(next));
  });

  store.subscribe(() => gate.invalidate());
  controls.addEventListener('change', () => gate.invalidate());

  loop.onTick((dt, _elapsed, realDt) => {
    galaxies.tick(dt, realDt);
    if (collision) {
      try {
        const event = collision.update(dt);
        if (event) commitCollision(event);
        if (collision?.isDone()) {
          collision.dispose();
          collision = null;
          notifyCollision();
        }
      } catch (error) {
        // A driver may refuse the GPU star simulation (it starts at the orbit entry).
        console.error(error);
        stopCollision();
        showToast(container, 'Collisions are not supported on this device');
      }
    }
    soundscape.setRumble(rumbleLevel(collision ? collision.status(_consumeStatus) : null), rumbleCutoff(collision ? _consumeStatus.orbitHz : 0));
    if (cameraMode === 'tour') handleTourEvent(tour.tick(realDt));
    if (fall && fall.phase() !== 'done' && !(startScreen?.isOpen() ?? false)) {
      // Opening the controls panel is an interaction too.
      if (panel.isOpen()) interruptFall();
      const { phase, u, tau } = fall.tick(realDt, fallEligible());
      // The orbit starts in the wait already.
      if (phase !== 'done' && cameraMode !== 'fall') beginFall();
      if (cameraMode === 'fall') {
        fallU = u;
        fallTau = tau;
      }
      // The scene changed under the fall (e.g. N added a galaxy): leave it.
      if (phase === 'done' && cameraMode === 'fall') escapeFall();
    }
    // Watched, skipped or interrupted: the saved scene comes back.
    if (pendingScene && fall.phase() === 'done') restoreSavedScene();
    // The fall music starts at the start-box click and rises through the
    // wait (timed so the fall itself is unchanged), and fades out once fallen.
    soundscape.setMode(soundMode(), FALL_IDLE_SECONDS - fallTau);
    // Fallen in (held black) or done: the screen may sleep again.
    const fallPhase = fall.phase();
    wakeLock.set(fallPhase === 'falling' || (fallPhase === 'waiting' && !(startScreen?.isOpen() ?? false)));
    if (fovEase) {
      fovEase.t = Math.min(1, fovEase.t + realDt / FALL_ESCAPE_SECONDS);
      camera.fov = THREE.MathUtils.lerp(fovEase.from, baseFov, easeInOutCubic(fovEase.t));
      camera.updateProjectionMatrix();
      if (fovEase.t >= 1) fovEase = null;
    }
    if (warpEase) {
      warpEase.t = Math.min(1, warpEase.t + realDt / FALL_ESCAPE_SECONDS);
      warpEase.galaxy.setHoleWarp(warpEase.from * (1 - easeInOutCubic(warpEase.t)));
      if (warpEase.t >= 1) warpEase = null;
    }
    cameraFly.update(realDt);
    if (cameraMode === 'fly') fly.update(realDt);
    else if (cameraMode === 'fall') updateFallCamera(realDt, fallU, fallTau);
    else if (cameraMode === 'consume') updateConsumeCamera(realDt);
    else controls.update();
    galaxies.updateCamera(camera, container.clientWidth, container.clientHeight);
    if (dofOn) updateFocus(realDt);
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
      warpEase !== null ||
      (dofOn && (focus !== focusTarget || focusRange !== focusRangeTarget)) ||
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
    // The intro tier is fixed: nothing to measure.
    const measuring = store.getState().settings.quality === 'auto' && TIER_ORDER.includes(currentTier);
    if (lastRender !== null && !starting && measuring) {
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

  // ── Collisions: consumption (one at a time; galaxy/consumption.js) ────
  // A black hole eats a black hole or a galaxy, or a galaxy merges into a
  // galaxy. Transient until the end: then the result goes into the store in
  // one change (one undo step); Stop part-way puts both back.
  let collision = null;
  let committing = false;
  const collisionListeners = new Set();
  const collisionOk = collisionSupported(renderer);
  const notifyCollision = () => {
    for (const fn of collisionListeners) fn();
    gate.invalidate();
  };
  function stopCollision() {
    if (!collision) return;
    collision.dispose();
    collision = null;
    if (cameraMode === 'consume') setCameraMode('orbit');
    notifyCollision();
  }
  /** The winner's store patch and its entry after the commit (the remnant). */
  function consumePlan(winnerId, victimId) {
    const state = store.getState();
    const winner = state.galaxies.find((g) => g.id === winnerId);
    const victim = state.galaxies.find((g) => g.id === victimId);
    const patch = consumeResult(winner, victim);
    const next = reducer(state, actions.consumeGalaxy(winnerId, victimId, patch));
    return { patch, remnant: next.galaxies.find((g) => g.id === winnerId) };
  }
  /**
   * @param {string} starterId the object whose panel started it (wins a tie)
   * @param {{ pass?: number, speed?: number }} [options] the opening pass (collision.js COLLISION_LIMITS)
   */
  function startCollision(starterId, partnerId, options = {}) {
    stopCollision();
    const a = galaxies.get(starterId);
    const b = galaxies.get(partnerId);
    if (!collisionOk || !a || !b || a === b) return;
    try {
      collision = new CollisionSim({
        renderer,
        starter: a,
        partner: b,
        plan: consumePlan,
        createPreview: (entry) => galaxies.createDetached(entry),
        removePreview: (g) => galaxies.removeDetached(g),
        streamCount: mobile ? 4000 : 12000,
        pass: options.pass,
        speed: options.speed,
      });
    } catch (error) {
      console.error(error);
      collision = null;
      for (const g of [a, b]) {
        g.endCollision();
        g.clearConsumeEffects();
      }
      showToast(container, 'Collisions are not supported on this device');
      return;
    }
    interruptFall(false);
    startConsumeCamera();
    notifyCollision();
  }
  /** The end: the result goes into the store; the after-effects keep running. */
  function commitCollision(event) {
    committing = true;
    store.dispatch(actions.consumeGalaxy(event.winnerId, event.victimId, event.patch));
    committing = false;
    collision.committed();
    if (cameraMode === 'consume') setCameraMode('orbit');
    notifyCollision();
  }
  // Any change that moves, reshapes or removes either object ends it.
  store.subscribe((next, prev) => {
    if (committing || !collision || next.galaxies === prev.galaxies) return;
    if (collisionBroken(prev.galaxies, next.galaxies, collision.pair())) stopCollision();
  });
  // The simulation textures do not survive a lost context.
  renderer.domElement.addEventListener('webglcontextlost', stopCollision);

  // Auto camera: close on the pair; the winner once it starts eating, moving
  // in as the victim spirals in (core/consumeCamera.js).
  let consumeCam = null;
  function startConsumeCamera() {
    const winner = galaxies.get(collision.pair()[0]);
    const { normal } = winner.pickTarget();
    consumeCam = { normal: normal.toArray(), distance: camera.position.distanceTo(controls.target) };
    setCameraMode('consume');
  }
  function updateConsumeCamera(realDt) {
    if (!collision || !consumeCam) {
      setCameraMode('orbit');
      return;
    }
    const st = collision.status(_consumeStatus);
    const cam = consumeCam;
    collision.centre(_consumeTarget);
    controls.target.lerp(_consumeTarget, 1 - Math.exp(-TARGET_RATE * realDt));
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const want = THREE.MathUtils.clamp(
      framingDistance(frameRadius(st), Math.min(tanY, tanY * camera.aspect)),
      CAMERA_LIMITS.minDistance,
      CAMERA_LIMITS.maxDistance * 0.9,
    );
    cam.distance = easeValue(cam.distance, want, DISTANCE_RATE, realDt);
    _consumeVec.subVectors(camera.position, controls.target).normalize().toArray(_consumeDir);
    raiseDirection(_consumeDir, cam.normal, MIN_ELEVATION_DEG, _consumeRaised);
    const k = 1 - Math.exp(-DIRECTION_RATE * realDt);
    _consumeVec.fromArray(_consumeDir).lerp(_consumeVec2.fromArray(_consumeRaised), k).normalize();
    camera.position.copy(controls.target).addScaledVector(_consumeVec, cam.distance);
    camera.lookAt(controls.target);
  }

  // ── Commands ───────────────────────────────────────────────────────────
  const getTarget = () => controls.target.toArray().map((v) => Math.round(v * 100) / 100);

  const commands = {
    addGalaxy() {
      // N during the intro adds to the saved scene, not in place of the hole.
      restoreSavedScene();
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
    async generateUniverse(layout = 'cluster', count = 8) {
      const hasGalaxies = store.getState().galaxies.length > 0;
      const question = `Replace the scene with a generated ${LAYOUTS[layout].label.toLowerCase()}? Ctrl+Z undoes it.`;
      if (hasGalaxies && !(await confirmDialog(question, { ok: 'Replace' }))) return;
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
        copyDialog('Copy this share link:', url);
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
    async reset() {
      if (!(await confirmDialog('Delete everything and start again with one black hole?', { ok: 'Delete all' }))) return;
      interruptFall(false);
      setCameraMode('orbit');
      store.dispatch(actions.resetScene());
      store.dispatch(actions.addBlackHole(store.getState(), undefined, { intro: true }));
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
    collision: {
      supported: collisionOk,
      start: startCollision,
      stop: stopCollision,
      pair: () => collision?.pair() ?? null,
      subscribe(fn) {
        collisionListeners.add(fn);
        return () => collisionListeners.delete(fn);
      },
    },
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
    // Colliding galaxies move away from their stored positions.
    getPosition: (id) => galaxies.get(id)?.group.position ?? null,
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
    window.__app = { scene, camera, controls, renderer, loop, store, actions, galaxies, focusGalaxy, post, commands, history, soundscape, getCameraMode: () => cameraMode, startCollision, stopCollision, getCollision: () => collision };
  }
}
