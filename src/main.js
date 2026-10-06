import * as THREE from 'three';
import './style.css';
import { createRenderer } from './core/createRenderer.js';
import { createCamera } from './core/createCamera.js';
import { createLoop } from './core/loop.js';
import { createStarfield } from './scene/starfield.js';
import { GalaxyManager } from './scene/GalaxyManager.js';
import { createStore } from './state/store.js';
import { createActions } from './state/actions.js';
import { createControlPanel } from './ui/controlPanel.js';
import { attachPointerInput } from './ui/pointerInput.js';
import { createCameraFly, framingPosition } from './core/cameraFly.js';
import { pickGalaxy } from './scene/picking.js';
import { CAMERA_LIMITS } from './core/createCamera.js';

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

const store = createStore();
const actions = createActions();
const galaxies = new GalaxyManager({ scene, store, pixelRatio: renderer.getPixelRatio() });

store.dispatch(actions.addGalaxy(store.getState(), 'spiral'));

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
loop.setRender(() => renderer.render(scene, camera));

window.addEventListener('resize', () => {
  const { clientWidth: w, clientHeight: h } = container;
  resizeRenderer(w, h);
  resizeCamera(w, h);
  starfield.setPixelRatio(renderer.getPixelRatio());
  galaxies.setPixelRatio(renderer.getPixelRatio());
});

createControlPanel({
  store,
  actions,
  getTarget: () => controls.target.toArray().map((v) => Math.round(v * 100) / 100),
  onFocus: focusGalaxy,
});

attachPointerInput({
  dom: renderer.domElement,
  camera,
  pick: (ray) => pickGalaxy(ray, galaxies.pickTargets()),
  onSelect: (id) => store.dispatch(actions.selectGalaxy(id)),
  onFocus: focusGalaxy,
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') store.dispatch(actions.selectGalaxy(null));
});

loop.start(renderer);

if (import.meta.env.DEV) {
  window.__app = { scene, camera, controls, renderer, loop, store, actions, galaxies, focusGalaxy };
}
