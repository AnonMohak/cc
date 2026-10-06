import GUI from 'lil-gui';
import { LIMITS, SHAPE_KEYS, MAX_TOTAL_PARTICLES, MAX_GALAXIES } from '../galaxy/params.js';
import { PRESETS, PRESET_NAMES } from '../galaxy/presets.js';
import { canAddGalaxy, totalParticles, SETTINGS_LIMITS } from '../state/store.js';
import { debounce } from '../util/debounce.js';

const LABELS = {
  count: 'Stars',
  arms: 'Arms',
  spin: 'Arm winding',
  armSpread: 'Arm spread',
  randomnessPower: 'Arm sharpness',
  armContrast: 'Stars on arms',
  bulgeFraction: 'Bulge share',
  bulgeSize: 'Bulge size',
  bulgeFlatten: 'Bulge flatness',
  barLength: 'Bar length',
  thickness: 'Disc thickness',
  clumps: 'Star clusters',
  haloFraction: 'Halo share',
  dustAmount: 'Dust lanes',
  radius: 'Size',
  starSize: 'Star size',
  brightness: 'Brightness',
  tiltX: 'Tilt X°',
  tiltZ: 'Tilt Z°',
  speed: 'Rotation speed',
  differential: 'Differential',
};

const POSITION_RANGE = 150;
const SHAPE_DEBOUNCE_MS = 150;
const NARROW_SCREEN = 640;

const presetOptions = Object.fromEntries(PRESET_NAMES.map((n) => [PRESETS[n].label, n]));

/**
 * lil-gui control panel. Reads the store and dispatches actions; it never
 * touches Three.js objects.
 *
 * @param {{
 *   store: ReturnType<typeof import('../state/store.js').createStore>,
 *   actions: ReturnType<typeof import('../state/actions.js').createActions>,
 *   getTarget: () => number[],
 *   onFocus?: (id: string) => void,
 *   onReset?: () => void,
 *   onScreenshot?: () => void,
 * }} options
 */
export function createControlPanel({ store, actions, getTarget, onFocus, onReset, onScreenshot }) {
  const gui = new GUI({ title: 'Galaxy Sandbox', width: 300 });
  if (window.innerWidth < NARROW_SCREEN) gui.close();

  const dispatch = (action) => store.dispatch(action);

  // ── Scene ────────────────────────────────────────────────────────────
  const sceneFolder = gui.addFolder('Scene');
  const sceneProxy = {
    preset: 'spiral',
    selected: '',
    particles: '',
    add() {
      const state = store.getState();
      dispatch(actions.addGalaxy(state, sceneProxy.preset, getTarget()));
    },
  };
  sceneFolder
    .add(sceneProxy, 'preset', presetOptions)
    .name('New galaxy type')
    .onChange(() => refreshSceneFolder(store.getState()));
  const addButton = sceneFolder.add(sceneProxy, 'add').name('➕ Add galaxy');
  let selectController = null;
  const particlesController = sceneFolder.add(sceneProxy, 'particles').name('Stars in scene').disable();

  function galaxyOptions(state) {
    return {
      '(none)': '',
      ...Object.fromEntries(state.galaxies.map((g) => [g.name, g.id])),
    };
  }

  function rebuildSelector(state) {
    selectController?.destroy();
    sceneProxy.selected = state.selectedId ?? '';
    selectController = sceneFolder
      .add(sceneProxy, 'selected', galaxyOptions(state))
      .name('Selected')
      .onChange((id) => dispatch(actions.selectGalaxy(id || null)));
    // Keep the selector directly under the add button.
    addButton.domElement.after(selectController.domElement);
  }

  function refreshSceneFolder(state) {
    const preset = PRESETS[sceneProxy.preset];
    const allowed = canAddGalaxy(state, preset.shape.count);
    addButton.enable(allowed);
    addButton.name(allowed ? '➕ Add galaxy' : `Limit reached (${MAX_GALAXIES} galaxies / ${fmt(MAX_TOTAL_PARTICLES)} stars)`);
    sceneProxy.particles = `${fmt(totalParticles(state))} / ${fmt(MAX_TOTAL_PARTICLES)}`;
    particlesController.updateDisplay();
  }

  // ── Selected galaxy ──────────────────────────────────────────────────
  let selectedFolder = null;
  let proxy = null;
  let lastEntry = null;
  let pendingShape = null;

  function buildSelectedFolder(entry) {
    pendingShape?.cancel();
    selectedFolder?.destroy();
    selectedFolder = null;
    lastEntry = entry;
    if (!entry) return;

    const id = entry.id;
    proxy = {
      name: entry.name,
      preset: entry.preset,
      shape: { ...entry.shape },
      look: { ...entry.look },
      position: { x: entry.look.position[0], y: entry.look.position[1], z: entry.look.position[2] },
      motion: { ...entry.motion },
      focus: () => onFocus?.(id),
      reseed: () => dispatch(actions.reseedGalaxy(id)),
      reverse: () => dispatch(actions.updateGalaxy(id, { motion: { speed: -proxy.motion.speed } })),
      remove: () => dispatch(actions.removeGalaxy(id)),
    };

    const folder = gui.addFolder(`Selected: ${entry.name}`);
    selectedFolder = folder;

    folder
      .add(proxy, 'name')
      .name('Name')
      .onFinishChange((name) => dispatch(actions.updateGalaxy(id, { name })));
    folder
      .add(proxy, 'preset', presetOptions)
      .name('Apply preset')
      .onChange((name) => dispatch(actions.applyPreset(store.getState().galaxies.find((g) => g.id === id), name)));
    if (onFocus) folder.add(proxy, 'focus').name('🎯 Focus camera');
    folder.add(proxy, 'reseed').name('🎲 New random layout');
    folder.add(proxy, 'remove').name('🗑️ Delete galaxy');

    // Shape changes rebuild geometry, so debounce while dragging.
    pendingShape = debounce((patch) => dispatch(actions.updateGalaxy(id, { shape: patch })), SHAPE_DEBOUNCE_MS);
    const shapeFolder = folder.addFolder('Shape').close();
    for (const key of SHAPE_KEYS) {
      const l = LIMITS.shape[key];
      shapeFolder
        .add(proxy.shape, key, l.min, l.max, l.step)
        .name(LABELS[key])
        .onChange((v) => pendingShape({ [key]: v }))
        .onFinishChange(() => pendingShape.flush());
    }

    const lookFolder = folder.addFolder('Look');
    const look = (patch) => dispatch(actions.updateGalaxy(id, { look: patch }));
    for (const key of ['radius', 'starSize', 'brightness']) {
      const l = LIMITS.look[key];
      lookFolder.add(proxy.look, key, l.min, l.max, l.step).name(LABELS[key]).onChange((v) => look({ [key]: v }));
    }
    lookFolder.addColor(proxy.look, 'colorInner').name('Core color').onChange((v) => look({ colorInner: v }));
    lookFolder.addColor(proxy.look, 'colorOuter').name('Edge color').onChange((v) => look({ colorOuter: v }));
    for (const key of ['tiltX', 'tiltZ']) {
      const l = LIMITS.look[key];
      lookFolder.add(proxy.look, key, l.min, l.max, l.step).name(LABELS[key]).onChange((v) => look({ [key]: v }));
    }

    const posFolder = folder.addFolder('Position').close();
    const setPosition = () => look({ position: [proxy.position.x, proxy.position.y, proxy.position.z] });
    for (const axis of ['x', 'y', 'z']) {
      posFolder.add(proxy.position, axis, -POSITION_RANGE, POSITION_RANGE, 0.1).onChange(setPosition);
    }

    const motionFolder = folder.addFolder('Motion');
    for (const key of ['speed', 'differential']) {
      const l = LIMITS.motion[key];
      motionFolder
        .add(proxy.motion, key, l.min, l.max, l.step)
        .name(LABELS[key])
        .onChange((v) => dispatch(actions.updateGalaxy(id, { motion: { [key]: v } })));
    }
    motionFolder.add(proxy, 'reverse').name('⇄ Reverse direction');
  }

  /** Copy changed groups from the store into the proxy and refresh widgets. */
  function refreshSelectedFolder(entry) {
    if (!entry || !proxy) return;
    if (entry.shape !== lastEntry.shape) Object.assign(proxy.shape, entry.shape);
    if (entry.look !== lastEntry.look) {
      Object.assign(proxy.look, entry.look);
      [proxy.position.x, proxy.position.y, proxy.position.z] = entry.look.position;
    }
    if (entry.motion !== lastEntry.motion) Object.assign(proxy.motion, entry.motion);
    proxy.preset = entry.preset;
    if (entry.name !== lastEntry.name) {
      proxy.name = entry.name;
      selectedFolder.title(`Selected: ${entry.name}`);
    }
    lastEntry = entry;
    for (const c of selectedFolder.controllersRecursive()) c.updateDisplay();
  }

  // ── Settings ─────────────────────────────────────────────────────────
  const settingsFolder = gui.addFolder('Settings');
  const settingsProxy = { ...store.getState().settings };
  const setting = (patch) => dispatch(actions.updateSettings(patch));
  settingsFolder.add(settingsProxy, 'paused').name('Pause').onChange((v) => setting({ paused: v }));
  settingsFolder
    .add(settingsProxy, 'timeScale', SETTINGS_LIMITS.timeScale.min, SETTINGS_LIMITS.timeScale.max, SETTINGS_LIMITS.timeScale.step)
    .name('Time scale')
    .onChange((v) => setting({ timeScale: v }));
  settingsFolder.add(settingsProxy, 'autoRotate').name('Auto-rotate camera').onChange((v) => setting({ autoRotate: v }));
  settingsFolder
    .add(settingsProxy, 'bloomStrength', SETTINGS_LIMITS.bloomStrength.min, SETTINGS_LIMITS.bloomStrength.max, SETTINGS_LIMITS.bloomStrength.step)
    .name('Glow (bloom)')
    .onChange((v) => setting({ bloomStrength: v }));
  settingsFolder.add(settingsProxy, 'dust').name('Dust lanes').onChange((v) => setting({ dust: v }));
  settingsFolder
    .add(settingsProxy, 'dustOpacity', SETTINGS_LIMITS.dustOpacity.min, SETTINGS_LIMITS.dustOpacity.max, SETTINGS_LIMITS.dustOpacity.step)
    .name('Dust opacity')
    .onChange((v) => setting({ dustOpacity: v }));
  const sceneActions = {
    screenshot: () => onScreenshot?.(),
    reset: () => onReset?.(),
  };
  if (onScreenshot) settingsFolder.add(sceneActions, 'screenshot').name('📷 Screenshot (P)');
  if (onReset) settingsFolder.add(sceneActions, 'reset').name('↺ Reset scene');
  const help = settingsFolder.addFolder('Keyboard').close();
  const keys = { Space: 'pause', N: 'add galaxy', F: 'focus selected', Del: 'delete selected', Esc: 'deselect', H: 'hide panel', P: 'screenshot' };
  for (const [key, text] of Object.entries(keys)) help.add({ [key]: text }, key).disable();

  // ── Store wiring ─────────────────────────────────────────────────────
  function galaxyListKey(state) {
    return state.galaxies.map((g) => `${g.id}:${g.name}`).join('|');
  }

  function render(state, prev) {
    if (!prev || galaxyListKey(state) !== galaxyListKey(prev) || state.selectedId !== prev.selectedId) {
      rebuildSelector(state);
    }
    if (!prev || state.galaxies !== prev.galaxies) refreshSceneFolder(state);

    const entry = state.galaxies.find((g) => g.id === state.selectedId) ?? null;
    if (!prev || state.selectedId !== prev.selectedId || (entry === null) !== (lastEntry === null)) {
      buildSelectedFolder(entry);
      // Keep folder order stable: Scene, Selected, Settings.
      if (selectedFolder) settingsFolder.domElement.before(selectedFolder.domElement);
    } else if (entry && entry !== lastEntry) {
      refreshSelectedFolder(entry);
    }

    if (!prev || state.settings !== prev.settings) {
      Object.assign(settingsProxy, state.settings);
      for (const c of settingsFolder.controllersRecursive()) c.updateDisplay();
    }
  }

  render(store.getState(), null);
  const unsubscribe = store.subscribe(render);

  return {
    gui,
    settingsFolder,
    toggle() {
      gui.show(gui._hidden);
    },
    dispose() {
      unsubscribe();
      pendingShape?.cancel();
      gui.destroy();
    },
  };
}

function fmt(n) {
  return n.toLocaleString('en-US');
}
