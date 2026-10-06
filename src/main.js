import * as THREE from 'three';
import './style.css';
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

const SAVE_DEBOUNCE_MS = 500;

const container = document.getElementById('app');

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
  const position = framingPosition(camera.position, center, normal, radius, {
    min: CAMERA_LIMITS.minDistance,
    max: CAMERA_LIMITS.maxDistance,
  });
  cameraFly.flyTo(center, position);
}

function applySettings(settings) {
  loop.setPaused(settings.paused);
  loop.setTimeScale(settings.timeScale);
  controls.autoRotate = settings.autoRotate;
  post.setBloomStrength(settings.bloomStrength);
}
applySettings(store.getState().settings);
store.subscribe((next, prev) => {
  if (next.settings !== prev.settings) applySettings(next.settings);
});

loop.onTick((dt, _elapsed, realDt) => {
  galaxies.tick(dt);
  cameraFly.update(realDt);
  controls.update();
  starfield.update(camera.position);
});
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
});
commands.togglePanel = () => panel.toggle();

attachPointerInput({
  dom: renderer.domElement,
  camera,
  pick: (ray) => pickGalaxy(ray, galaxies.pickTargets()),
  onSelect: (id) => store.dispatch(actions.selectGalaxy(id)),
  onFocus: focusGalaxy,
});
attachKeyboard(window, commands);

loop.start(renderer);

if (import.meta.env.DEV) {
  window.__app = { scene, camera, controls, renderer, loop, store, actions, galaxies, focusGalaxy, post, commands };
}
