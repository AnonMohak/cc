import * as THREE from 'three';
import { createRenderer } from './core/createRenderer.js';
import { createCamera, CAMERA_LIMITS, CAMERA_HOME } from './core/createCamera.js';
import { createComposer } from './core/createComposer.js';
import { createLoop } from './core/loop.js';
import { createCameraFly, framingPosition } from './core/cameraFly.js';
import { captureScreenshot } from './core/screenshot.js';
import { createStarfield } from './scene/starfield.js';
import { GalaxyManager } from './scene/GalaxyManager.js';
import { pickGalaxy } from './scene/picking.js';
import { createStore, createInitialState, canAddGalaxy, QUALITY } from './state/store.js';
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
import { createHud } from './ui/hud.js';
import { createTour } from './core/tour.js';
import { createFlyControls } from './core/flyControls.js';
import { universeBounds, LAYOUTS } from './state/universe.js';
import { catalogueViewDirection } from './galaxy/catalogue.js';

const SAVE_DEBOUNCE_MS = 500;

/**
 * Build the scene, state, UI and loop inside `container`.
 * @param {HTMLElement} container
 */
export function startApp(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#02030a');

  const { renderer, resize: resizeRenderer } = createRenderer(container);
  const { camera, controls, resize: resizeCamera } = createCamera(
    renderer.domElement,
    container.clientWidth / container.clientHeight,
  );

  const starfield = createStarfield({ pixelRatio: renderer.getPixelRatio() });
  scene.add(starfield.object);

  // ── State ──────────────────────────────────────────────────────────────
  const storage = window.localStorage;
  const actions = createActions();
  const store = createStore(undefined, persistence.load(storage) ?? createInitialState());
  if (store.getState().galaxies.length === 0) {
    store.dispatch(actions.addGalaxy(store.getState(), 'spiral'));
  }

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
  const post = createComposer(renderer, scene, camera, {
    bloomStrength: store.getState().settings.bloomStrength,
    volumeScale: QUALITY[store.getState().settings.quality].volumeScale,
  });

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
    badge.hidden = cameraMode === 'orbit';
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

  function applySettings(settings) {
    loop.setPaused(settings.paused);
    loop.setTimeScale(settings.timeScale);
    if (cameraMode !== 'tour') controls.autoRotate = settings.autoRotate;
    post.setBloomStrength(settings.bloomStrength);
    post.setExposure(settings.exposure);
    post.setVolumeScale(QUALITY[settings.quality].volumeScale);
  }
  applySettings(store.getState().settings);
  store.subscribe((next, prev) => {
    if (next.settings !== prev.settings) applySettings(next.settings);
  });

  loop.onTick((dt, _elapsed, realDt) => {
    galaxies.tick(dt, realDt);
    if (cameraMode === 'tour') handleTourEvent(tour.tick(realDt));
    cameraFly.update(realDt);
    if (cameraMode === 'fly') fly.update(realDt);
    else controls.update();
    galaxies.updateCamera(camera, container.clientWidth, container.clientHeight);
    starfield.update(camera.position);
  });
  if (new URLSearchParams(window.location.search).has('fps')) {
    const gl = renderer.getContext();
    const timer = createGpuTimer(gl);
    post.attachTimer(timer);
    const gpu = gpuName(gl);
    const meter = createFpsMeter(container, undefined, () => [
      gpu,
      `quality ${store.getState().settings.quality}`,
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
    if (video.isRecording()) text = `● REC ${formatClock(video.elapsed())}`;
    else if (progress) text = `● GIF ${progress.frames}/${progress.total}`;
    else if (gif.isEncoding()) text = 'Encoding GIF…';
    recBadge.hidden = !text;
    recBadge.textContent = text;
  });

  loop.setRender(() => {
    post.render();
    // Copy GIF frames in the same task as the render (drawing buffer still valid).
    gif.afterRender(performance.now());
  });

  window.addEventListener('resize', () => {
    const { clientWidth: w, clientHeight: h } = container;
    resizeRenderer(w, h);
    resizeCamera(w, h);
    post.resize(w, h);
    starfield.setPixelRatio(renderer.getPixelRatio());
    galaxies.setPixelRatio(renderer.getPixelRatio());
  });

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
      const { selectedId } = store.getState();
      if (selectedId) focusGalaxy(selectedId);
    },
    // Esc leaves a camera mode first, then clears the selection.
    deselect() {
      if (cameraMode !== 'orbit') setCameraMode('orbit');
      else store.dispatch(actions.selectGalaxy(null));
    },
    toggleFly: () => setCameraMode(cameraMode === 'fly' ? 'orbit' : 'fly'),
    toggleTour: () => setCameraMode(cameraMode === 'tour' ? 'orbit' : 'tour'),
    resetView() {
      setCameraMode('orbit');
      cameraFly.flyTo(CAMERA_HOME.target, CAMERA_HOME.position);
    },
    togglePause: () => store.dispatch(actions.updateSettings({ paused: !store.getState().settings.paused })),
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
      if (!window.confirm('Delete all galaxies and start again with one spiral?')) return;
      store.dispatch(actions.resetScene());
      store.dispatch(actions.addGalaxy(store.getState(), 'spiral'));
      cameraFly.flyTo(CAMERA_HOME.target, CAMERA_HOME.position);
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
    window.__app = { scene, camera, controls, renderer, loop, store, actions, galaxies, focusGalaxy, post, commands, history, getCameraMode: () => cameraMode };
  }
}
