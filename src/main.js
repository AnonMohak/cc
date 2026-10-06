import * as THREE from 'three';
import './style.css';
import { createRenderer } from './core/createRenderer.js';
import { createCamera } from './core/createCamera.js';
import { createLoop } from './core/loop.js';
import { createStarfield } from './scene/starfield.js';
import { Galaxy } from './galaxy/Galaxy.js';
import { PRESETS } from './galaxy/presets.js';

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

// M3: one fixed galaxy. Replaced by the store-driven GalaxyManager in M4.
const galaxy = new Galaxy({ ...PRESETS.spiral, seed: 1, pixelRatio: renderer.getPixelRatio() });
scene.add(galaxy.group);

const loop = createLoop();
loop.onTick((dt) => {
  galaxy.tick(dt);
  controls.update();
  starfield.update(camera.position);
});
loop.setRender(() => renderer.render(scene, camera));

window.addEventListener('resize', () => {
  const { clientWidth: w, clientHeight: h } = container;
  resizeRenderer(w, h);
  resizeCamera(w, h);
  starfield.setPixelRatio(renderer.getPixelRatio());
  galaxy.setPixelRatio(renderer.getPixelRatio());
});

loop.start(renderer);

if (import.meta.env.DEV) {
  window.__app = { scene, camera, controls, renderer, loop, galaxy };
}
