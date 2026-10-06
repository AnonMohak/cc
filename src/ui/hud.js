import * as THREE from 'three';
import { LY_PER_WORLD_UNIT, formatLightYears } from '../galaxy/catalogue.js';
import { niceScaleBar, pxPerUnitAt, labelPlacement, minimapLayout, minimapHit } from './hudMath.js';

const MINIMAP_SIZE = 168;
const MINIMAP_INTERVAL_MS = 100;

const _v = new THREE.Vector3();
const _toTarget = new THREE.Vector3();

/**
 * Heads-up display: galaxy name labels, a light-year scale bar and a
 * top-down minimap. Reads the store and the camera; never touches galaxy
 * objects. Call update() once per frame.
 *
 * @param {{
 *   container: HTMLElement,
 *   store: ReturnType<typeof import('../state/store.js').createStore>,
 *   camera: THREE.PerspectiveCamera,
 *   controls: { target: THREE.Vector3 },
 *   onSelect: (id: string) => void,
 *   onFocus: (id: string) => void,
 * }} options
 */
export function createHud({ container, store, camera, controls, onSelect, onFocus }) {
  const root = document.createElement('div');
  root.className = 'hud';

  const labelsLayer = document.createElement('div');
  labelsLayer.className = 'hud-labels';

  const scale = document.createElement('div');
  scale.className = 'hud-scale';
  const scaleBar = document.createElement('div');
  scaleBar.className = 'hud-scale-bar';
  const scaleText = document.createElement('span');
  scale.append(scaleBar, scaleText);

  const minimap = document.createElement('canvas');
  minimap.className = 'hud-minimap';
  minimap.title = 'Minimap — click a galaxy to fly to it';
  const ctx = minimap.getContext('2d');

  root.append(labelsLayer, scale, minimap);
  container.appendChild(root);

  /** @type {Map<string, HTMLButtonElement>} */
  const labels = new Map();
  let layout = null;
  let lastMinimap = 0;

  function syncLabels(state) {
    const ids = new Set(state.galaxies.map((g) => g.id));
    for (const [id, el] of labels) {
      if (!ids.has(id)) {
        el.remove();
        labels.delete(id);
      }
    }
    for (const g of state.galaxies) {
      let el = labels.get(g.id);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'hud-label';
        el.addEventListener('click', () => onSelect(g.id));
        el.addEventListener('dblclick', () => onFocus(g.id));
        labelsLayer.appendChild(el);
        labels.set(g.id, el);
      }
      el.textContent = g.name;
      el.classList.toggle('is-selected', g.id === state.selectedId);
    }
  }

  function applySettings(settings) {
    labelsLayer.hidden = !settings.labels;
    scale.hidden = !settings.scaleBar;
    minimap.hidden = !settings.minimap;
  }

  function sizeMinimap() {
    const size = window.innerWidth < 640 ? 112 : MINIMAP_SIZE;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    minimap.style.width = `${size}px`;
    minimap.style.height = `${size}px`;
    minimap.width = Math.round(size * dpr);
    minimap.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return size;
  }
  let minimapSize = sizeMinimap();
  window.addEventListener('resize', () => {
    minimapSize = sizeMinimap();
  });

  minimap.addEventListener('click', (event) => {
    if (!layout) return;
    const rect = minimap.getBoundingClientRect();
    const id = minimapHit(layout.dots, event.clientX - rect.left, event.clientY - rect.top);
    if (id) onFocus(id);
  });

  function updateLabels(state, width, height) {
    for (const g of state.galaxies) {
      const el = labels.get(g.id);
      if (!el) continue;
      _v.fromArray(g.look.position);
      const distance = camera.position.distanceTo(_v);
      const radiusPx = g.look.radius * pxPerUnitAt(distance, camera.fov, height);
      _v.project(camera);
      const p = labelPlacement(_v, radiusPx, width, height);
      el.style.visibility = p.visible ? 'visible' : 'hidden';
      if (!p.visible) continue;
      el.style.opacity = String(p.opacity);
      el.style.transform = `translate(${p.left}px, ${p.top}px) translateX(-50%)`;
    }
  }

  function updateScale(height) {
    const distance = camera.position.distanceTo(controls.target);
    const bar = niceScaleBar(pxPerUnitAt(distance, camera.fov, height), LY_PER_WORLD_UNIT);
    if (!bar) return;
    scaleBar.style.width = `${Math.round(bar.px)}px`;
    scaleText.textContent = formatLightYears(bar.ly);
  }

  function drawMinimap(state) {
    _toTarget.subVectors(controls.target, camera.position);
    const items = state.galaxies.map((g) => ({
      id: g.id,
      x: g.look.position[0],
      z: g.look.position[2],
      r: g.look.radius,
      color: g.look.colorInner,
      selected: g.id === state.selectedId,
    }));
    layout = minimapLayout(items, { x: camera.position.x, z: camera.position.z, dirX: _toTarget.x, dirZ: _toTarget.z }, minimapSize);

    const s = minimapSize;
    ctx.clearRect(0, 0, s, s);
    for (const d of layout.dots) {
      const glow = ctx.createRadialGradient(d.px, d.py, 0, d.px, d.py, d.pr);
      glow.addColorStop(0, d.color);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(d.px, d.py, d.pr, 0, Math.PI * 2);
      ctx.fill();
      if (d.selected) {
        ctx.strokeStyle = 'rgba(160, 190, 255, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    // Camera: a dot with a view wedge toward the orbit target.
    const c = layout.camera;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.moveTo(c.px, c.py);
    ctx.arc(c.px, c.py, 22, c.angle - 0.45, c.angle + 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(c.px, c.py, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  syncLabels(store.getState());
  applySettings(store.getState().settings);
  const unsubscribe = store.subscribe((next, prev) => {
    if (next.galaxies !== prev.galaxies || next.selectedId !== prev.selectedId) syncLabels(next);
    if (next.settings !== prev.settings) applySettings(next.settings);
  });

  return {
    update(now = performance.now()) {
      const state = store.getState();
      const { clientWidth: width, clientHeight: height } = container;
      if (state.settings.labels) updateLabels(state, width, height);
      if (state.settings.scaleBar) updateScale(height);
      if (state.settings.minimap && now - lastMinimap >= MINIMAP_INTERVAL_MS) {
        lastMinimap = now;
        drawMinimap(state);
      }
    },
    dispose() {
      unsubscribe();
      root.remove();
    },
  };
}
