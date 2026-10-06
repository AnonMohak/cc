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
import { createStore, createInitialState, canAddGalaxy } from './state/store.js';
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
import { downloadText, pickTextFile } from './ui/fileIO.js';
import { createFpsMeter } from './ui/fpsMeter.js';
import { createInfoCard } from './ui/infoCard.js';
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
  const post = createComposer(renderer, scene, camera, { bloomStrength: store.getState().settings.bloomStrength });

  // ── Loop and camera ────────────────────────────────────────────────────
  const loop = createLoop();
  const cameraFly = createCameraFly(camera, controls);
  // Any user orbit/zoom takes over from an automatic camera move.
  controls.addEventListener('start', () => cameraFly.cancel());

  function focusGalaxy(id) {
    const galaxy = galaxies.get(id);
    if (!galaxy) return;
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
    cameraFly.flyTo(center, position);
  }

  function applySettings(settings) {
    loop.setPaused(settings.paused);
    loop.setTimeScale(settings.timeScale);
    controls.autoRotate = settings.autoRotate;
    post.setBloomStrength(settings.bloomStrength);
    post.setExposure(settings.exposure);
  }
  applySettings(store.getState().settings);
  store.subscribe((next, prev) => {
    if (next.settings !== prev.settings) applySettings(next.settings);
  });

  loop.onTick((dt, _elapsed, realDt) => {
    galaxies.tick(dt, realDt);
    cameraFly.update(realDt);
    controls.update();
    galaxies.updateCamera(camera, container.clientWidth, container.clientHeight);
    starfield.update(camera.position);
  });
  if (new URLSearchParams(window.location.search).has('fps')) {
    const meter = createFpsMeter(container);
    loop.onTick(() => meter.update());
  }
  loop.setRender(() => post.render());

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
    deselect: () => store.dispatch(actions.selectGalaxy(null)),
    togglePause: () => store.dispatch(actions.updateSettings({ paused: !store.getState().settings.paused })),
    screenshot: () => captureScreenshot({ canvas: renderer.domElement, render: () => post.render() }),
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
  });
  commands.togglePanel = () => panel.toggle();
  createInfoCard(container, store);

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
    window.__app = { scene, camera, controls, renderer, loop, store, actions, galaxies, focusGalaxy, post, commands, history };
  }
}
