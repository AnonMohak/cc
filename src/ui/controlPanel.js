import GUI from 'lil-gui';
import { LIMITS, SHAPE_KEYS, MAX_TOTAL_PARTICLES, MAX_GALAXIES } from '../galaxy/params.js';
import { PRESETS, PRESET_NAMES, BLACK_HOLE_TEMPLATE } from '../galaxy/presets.js';
import { CATALOGUE, CATALOGUE_IDS, catalogueParams } from '../galaxy/catalogue.js';
import { canAddGalaxy, totalParticles, SETTINGS_LIMITS } from '../state/store.js';
import { QUALITY, QUALITY_OPTIONS } from '../core/quality.js';
import { LAYOUTS } from '../state/universe.js';
import { debounce } from '../util/debounce.js';
import { BAND_OPTIONS, BANDS } from '../galaxy/bands.js';
import { formatCount } from '../util/formatCount.js';
import { createPanelToggle } from './panelToggle.js';
import { COLLISION_LIMITS, DEFAULT_COLLISION } from '../galaxy/collision.js';

const LABELS = {
  // Stars (rebuild)
  count: 'Stars',
  bulgeFraction: 'Bulge share',
  bulgeSize: 'Bulge size',
  bulgeFlatten: 'Bulge flatness',
  barLength: 'Bar length',
  discScale: 'Disc scale length',
  discThickness: 'Disc thickness',
  youngFraction: 'Young blue stars',
  clumps: 'Star-forming clumps',
  haloFraction: 'Halo share',
  hiiAmount: 'Nebulae (H II)',
  // Structure (live)
  arms: 'Arms',
  armWinding: 'Arm winding',
  eccentricity: 'Density wave',
  armContrast: 'Arm contrast',
  flocculence: 'Flocculence',
  dustStrength: 'Dust',
  glow: 'Diffuse glow',
  bulgeSersic: 'Bulge profile (n)',
  // Look
  radius: 'Size',
  starSize: 'Star size',
  brightness: 'Brightness',
  physicalColor: 'Physical colour',
  tiltX: 'Tilt X°',
  tiltZ: 'Tilt Z°',
  // Motion
  speed: 'Rotation speed',
  differential: 'Differential',
  patternSpeed: 'Pattern speed',
};

// Standalone black hole (params.js LIMITS.hole).
const HOLE_LABELS = {
  size: 'Black hole size',
  discSize: 'Disc size',
  brightness: 'Disc brightness',
  glow: 'Glow (halo + haze)',
};

const POSITION_RANGE = 150;
const SHAPE_DEBOUNCE_MS = 150;
const NARROW_SCREEN = 640;

const presetOptions = Object.fromEntries(PRESET_NAMES.map((n) => [PRESETS[n].label, n]));
const catalogueOptions = Object.fromEntries(CATALOGUE_IDS.map((id) => [CATALOGUE[id].name, id]));

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
 *   history?: ReturnType<typeof import('../state/history.js').createHistory>,
 *   onShare?: () => void,
 *   onExport?: () => void,
 *   onImport?: () => void,
 *   onTour?: () => void,
 *   onFly?: () => void,
 *   onResetView?: () => void,
 *   onToggleVideo?: () => void,
 *   onRecordGif?: () => void,
 *   onGenerateUniverse?: (layout: string, count: number) => void,
 *   collision?: { supported: boolean, start: (idA: string, idB: string, options: { pass: number, speed: number }) => void, stop: () => void, pair: () => string[] | null, subscribe: (fn: () => void) => () => void },
 * }} options
 */
export function createControlPanel({ store, actions, getTarget, onFocus, onReset, onScreenshot, history, onShare, onExport, onImport, onTour, onFly, onResetView, onToggleVideo, onRecordGif, onGenerateUniverse, collision }) {
  const narrow = window.innerWidth < NARROW_SCREEN;
  // On phones the width comes from style.css (a narrow panel); an inline
  // width from lil-gui would override it.
  const gui = new GUI({ title: 'Galaxy Sandbox', width: narrow ? undefined : 300 });
  // Hidden behind a "Controls" button until asked for (desktop and phone).
  const visibility = createPanelToggle(gui);

  const dispatch = (action) => store.dispatch(action);

  // ── Scene ────────────────────────────────────────────────────────────
  const sceneFolder = gui.addFolder('Scene');
  const sceneProxy = {
    preset: 'spiral',
    real: CATALOGUE_IDS[0],
    selected: '',
    particles: '',
    add() {
      const state = store.getState();
      dispatch(actions.addGalaxy(state, sceneProxy.preset, getTarget()));
    },
    addReal() {
      const state = store.getState();
      dispatch(actions.addCatalogueGalaxy(state, sceneProxy.real, getTarget()));
    },
    addHole() {
      const state = store.getState();
      dispatch(actions.addBlackHole(state, getTarget()));
    },
  };
  sceneFolder
    .add(sceneProxy, 'preset', presetOptions)
    .name('New galaxy type')
    .onChange(() => refreshSceneFolder(store.getState()));
  const addButton = sceneFolder.add(sceneProxy, 'add').name('Add galaxy');
  sceneFolder
    .add(sceneProxy, 'real', catalogueOptions)
    .name('Real galaxy')
    .onChange(() => refreshSceneFolder(store.getState()));
  const addRealButton = sceneFolder.add(sceneProxy, 'addReal').name('Add real galaxy');
  const addHoleButton = sceneFolder.add(sceneProxy, 'addHole').name('Add black hole');
  let selectController = null;
  const undoButtons = [];
  if (history) {
    const h = { undo: () => history.undo(), redo: () => history.redo() };
    undoButtons.push(sceneFolder.add(h, 'undo').name('Undo (Ctrl+Z)'), sceneFolder.add(h, 'redo').name('Redo (Ctrl+Shift+Z)'));
    const refreshUndo = () => {
      undoButtons[0].enable(history.canUndo());
      undoButtons[1].enable(history.canRedo());
    };
    history.onChange(refreshUndo);
    refreshUndo();
  }
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
    // Keep the selector directly under the add buttons.
    addHoleButton.domElement.after(selectController.domElement);
  }

  function refreshSceneFolder(state) {
    const preset = PRESETS[sceneProxy.preset];
    const allowed = canAddGalaxy(state, preset.shape.count);
    addButton.enable(allowed);
    addButton.name(allowed ? 'Add galaxy' : `Limit reached (${MAX_GALAXIES} galaxies / ${formatCount(MAX_TOTAL_PARTICLES)} stars)`);
    addRealButton.enable(canAddGalaxy(state, catalogueParams(sceneProxy.real).shape.count));
    addHoleButton.enable(canAddGalaxy(state, BLACK_HOLE_TEMPLATE.shape.count));
    sceneProxy.particles = `${formatCount(totalParticles(state))} / ${formatCount(MAX_TOTAL_PARTICLES)}`;
    particlesController.updateDisplay();
  }

  // ── Selected galaxy ──────────────────────────────────────────────────
  let selectedFolder = null;
  let proxy = null;
  let lastEntry = null;
  let pendingShape = null;
  // Controllers that move or reshape the galaxy: locked while it collides.
  let lockable = [];
  let collisionFolder = null;
  // Collide settings are UI state only (a collision is never saved).
  const collideProxy = { target: '', ...DEFAULT_COLLISION };

  function buildSelectedFolder(entry) {
    pendingShape?.cancel();
    selectedFolder?.destroy();
    selectedFolder = null;
    collisionFolder = null;
    lockable = [];
    lastEntry = entry;
    if (!entry) return;

    const id = entry.id;
    if (entry.kind === 'blackhole') {
      buildHoleFolder(entry);
      return;
    }
    proxy = {
      name: entry.name,
      preset: entry.preset,
      shape: { ...entry.shape },
      structure: { ...entry.structure },
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
    const presetController = folder
      .add(proxy, 'preset', presetOptions)
      .name('Apply preset')
      .onChange((name) => dispatch(actions.applyPreset(store.getState().galaxies.find((g) => g.id === id), name)));
    if (onFocus) folder.add(proxy, 'focus').name('Focus camera');
    lockable.push(presetController, folder.add(proxy, 'reseed').name('New random layout'));
    folder.add(proxy, 'remove').name('Delete galaxy');
    if (collision) buildCollisionFolder(folder, entry);

    // Shape changes rebuild geometry, so debounce while dragging.
    pendingShape = debounce((patch) => dispatch(actions.updateGalaxy(id, { shape: patch })), SHAPE_DEBOUNCE_MS);
    const structureFolder = folder.addFolder('Structure');
    for (const key of Object.keys(LIMITS.structure)) {
      const l = LIMITS.structure[key];
      lockable.push(
        structureFolder
          .add(proxy.structure, key, l.min, l.max, l.step)
          .name(LABELS[key])
          .onChange((v) => dispatch(actions.updateGalaxy(id, { structure: { [key]: v } }))),
      );
    }

    const shapeFolder = folder.addFolder('Stars (rebuild)').close();
    for (const key of SHAPE_KEYS) {
      const l = LIMITS.shape[key];
      lockable.push(
        shapeFolder
          .add(proxy.shape, key, l.min, l.max, l.step)
          .name(LABELS[key])
          .onChange((v) => pendingShape({ [key]: v }))
          .onFinishChange(() => pendingShape.flush()),
      );
    }

    const lookFolder = folder.addFolder('Look');
    const look = (patch) => dispatch(actions.updateGalaxy(id, { look: patch }));
    for (const key of ['radius', 'starSize', 'brightness', 'physicalColor']) {
      const l = LIMITS.look[key];
      const c = lookFolder.add(proxy.look, key, l.min, l.max, l.step).name(LABELS[key]).onChange((v) => look({ [key]: v }));
      if (key === 'radius') lockable.push(c);
    }
    lookFolder.addColor(proxy.look, 'colorInner').name('Core color').onChange((v) => look({ colorInner: v }));
    lookFolder.addColor(proxy.look, 'colorOuter').name('Edge color').onChange((v) => look({ colorOuter: v }));
    for (const key of ['tiltX', 'tiltZ']) {
      const l = LIMITS.look[key];
      lockable.push(lookFolder.add(proxy.look, key, l.min, l.max, l.step).name(LABELS[key]).onChange((v) => look({ [key]: v })));
    }

    const posFolder = folder.addFolder('Position').close();
    const setPosition = () => look({ position: [proxy.position.x, proxy.position.y, proxy.position.z] });
    for (const axis of ['x', 'y', 'z']) {
      lockable.push(posFolder.add(proxy.position, axis, -POSITION_RANGE, POSITION_RANGE, 0.1).onChange(setPosition));
    }

    const motionFolder = folder.addFolder('Motion');
    for (const key of ['speed', 'differential', 'patternSpeed']) {
      const l = LIMITS.motion[key];
      lockable.push(
        motionFolder
          .add(proxy.motion, key, l.min, l.max, l.step)
          .name(LABELS[key])
          .onChange((v) => dispatch(actions.updateGalaxy(id, { motion: { [key]: v } }))),
      );
    }
    lockable.push(motionFolder.add(proxy, 'reverse').name('Reverse direction'));
    applyCollisionLock();
  }

  /**
   * Collision: pick a partner and collide, or stop the running collision.
   * Rebuilt when the galaxy list or the collision changes.
   */
  function buildCollisionFolder(parent, entry) {
    const open = collisionFolder ? !collisionFolder._closed : false;
    // Rebuilt in place (addFolder appends at the end).
    const next = collisionFolder?.domElement.nextSibling ?? null;
    collisionFolder?.destroy();
    const folder = parent.addFolder('Collision');
    if (next) parent.$children.insertBefore(folder.domElement, next);
    collisionFolder = folder;
    if (!open) folder.close();
    const id = entry.id;
    const pair = collision.pair();
    if (pair?.includes(id)) {
      folder.add({ stop: () => collision.stop() }, 'stop').name('Stop collision (back to start)');
      return;
    }
    if (!collision.supported) {
      folder.add({ note: 'Not supported on this device' }, 'note').name('Collide').disable();
      return;
    }
    const partners = store.getState().galaxies.filter((g) => g.id !== id && g.kind !== 'blackhole');
    if (partners.length === 0) {
      folder.add({ note: 'Add another galaxy first' }, 'note').name('Collide').disable();
      return;
    }
    if (!partners.some((g) => g.id === collideProxy.target)) collideProxy.target = partners[0].id;
    folder.add(collideProxy, 'target', Object.fromEntries(partners.map((g) => [g.name, g.id]))).name('Collide with');
    const L = COLLISION_LIMITS;
    folder.add(collideProxy, 'pass', L.pass.min, L.pass.max, L.pass.step).name('Pass distance');
    folder.add(collideProxy, 'speed', L.speed.min, L.speed.max, L.speed.step).name('Approach speed');
    folder
      .add({ go: () => collision.start(id, collideProxy.target, { pass: collideProxy.pass, speed: collideProxy.speed }) }, 'go')
      .name(pair ? 'Collide (stops the other one)' : 'Collide');
  }

  /** Lock the controls that move or reshape a colliding galaxy. */
  function applyCollisionLock() {
    const locked = Boolean(lastEntry && collision?.pair()?.includes(lastEntry.id));
    for (const c of lockable) c.enable(!locked);
  }

  function refreshCollision() {
    if (!selectedFolder || !lastEntry || lastEntry.kind === 'blackhole' || !collision) return;
    buildCollisionFolder(selectedFolder, lastEntry);
    applyCollisionLock();
  }
  const unsubscribeCollision = collision?.subscribe(refreshCollision);

  /** The selected standalone black hole: the hole and its star cloud. */
  function buildHoleFolder(entry) {
    const id = entry.id;
    proxy = {
      name: entry.name,
      shape: { ...entry.shape },
      look: { ...entry.look },
      position: { x: entry.look.position[0], y: entry.look.position[1], z: entry.look.position[2] },
      hole: { ...entry.hole },
      focus: () => onFocus?.(id),
      reseed: () => dispatch(actions.reseedGalaxy(id)),
      remove: () => dispatch(actions.removeGalaxy(id)),
    };
    const folder = gui.addFolder(`Selected: ${entry.name}`);
    selectedFolder = folder;
    folder
      .add(proxy, 'name')
      .name('Name')
      .onFinishChange((name) => dispatch(actions.updateGalaxy(id, { name })));
    if (onFocus) folder.add(proxy, 'focus').name('Focus camera');
    folder.add(proxy, 'remove').name('Delete black hole');

    const holeFolder = folder.addFolder('Black hole');
    const hole = (patch) => dispatch(actions.updateGalaxy(id, { hole: patch }));
    for (const key of Object.keys(LIMITS.hole)) {
      const l = LIMITS.hole[key];
      holeFolder.add(proxy.hole, key, l.min, l.max, l.step).name(HOLE_LABELS[key]).onChange((v) => hole({ [key]: v }));
    }
    holeFolder.addColor(proxy.hole, 'colorHot').name('Inner (hot) colour').onChange((v) => hole({ colorHot: v }));
    holeFolder.addColor(proxy.hole, 'colorCool').name('Outer (cool) colour').onChange((v) => hole({ colorCool: v }));
    holeFolder.add(proxy.hole, 'jets').name('Jets').onChange((v) => hole({ jets: v }));
    holeFolder.add(proxy.hole, 'streak').name('Lens streak').onChange((v) => hole({ streak: v }));

    const starsFolder = folder.addFolder('Star cloud').close();
    pendingShape = debounce((patch) => dispatch(actions.updateGalaxy(id, { shape: patch })), SHAPE_DEBOUNCE_MS);
    const count = LIMITS.shape.count;
    starsFolder
      .add(proxy.shape, 'count', count.min, 50_000, count.step)
      .name(LABELS.count)
      .onChange((v) => pendingShape({ count: v }))
      .onFinishChange(() => pendingShape.flush());
    const look = (patch) => dispatch(actions.updateGalaxy(id, { look: patch }));
    for (const [key, name] of [['radius', 'Size (whole object)'], ['brightness', 'Star brightness'], ['starSize', LABELS.starSize]]) {
      const l = LIMITS.look[key];
      starsFolder.add(proxy.look, key, l.min, l.max, l.step).name(name).onChange((v) => look({ [key]: v }));
    }
    starsFolder.add(proxy, 'reseed').name('New random stars');

    const posFolder = folder.addFolder('Position').close();
    const setPosition = () => look({ position: [proxy.position.x, proxy.position.y, proxy.position.z] });
    for (const axis of ['x', 'y', 'z']) {
      posFolder.add(proxy.position, axis, -POSITION_RANGE, POSITION_RANGE, 0.1).onChange(setPosition);
    }
  }

  /** Copy changed groups from the store into the proxy and refresh widgets. */
  function refreshSelectedFolder(entry) {
    if (!entry || !proxy) return;
    if (entry.hole && entry.hole !== lastEntry.hole) Object.assign(proxy.hole, entry.hole);
    if (entry.shape !== lastEntry.shape) Object.assign(proxy.shape, entry.shape);
    if (entry.look !== lastEntry.look) {
      Object.assign(proxy.look, entry.look);
      [proxy.position.x, proxy.position.y, proxy.position.z] = entry.look.position;
    }
    if (proxy.motion && entry.motion !== lastEntry.motion) Object.assign(proxy.motion, entry.motion);
    if (proxy.structure && entry.structure !== lastEntry.structure) Object.assign(proxy.structure, entry.structure);
    proxy.preset = entry.preset;
    if (entry.name !== lastEntry.name) {
      proxy.name = entry.name;
      selectedFolder.title(`Selected: ${entry.name}`);
    }
    lastEntry = entry;
    for (const c of selectedFolder.controllersRecursive()) c.updateDisplay();
  }

  // ── Universe generator ───────────────────────────────────────────────
  if (onGenerateUniverse) {
    const universeFolder = gui.addFolder('Universe').close();
    const u = {
      layout: 'cluster',
      count: 8,
      generate: () => onGenerateUniverse(u.layout, u.count),
    };
    universeFolder.add(u, 'layout', Object.fromEntries(Object.entries(LAYOUTS).map(([k, l]) => [l.label, k]))).name('Layout');
    universeFolder.add(u, 'count', 2, MAX_GALAXIES, 1).name('Galaxies');
    universeFolder.add(u, 'generate').name('Generate universe');
  }

  // ── Share ────────────────────────────────────────────────────────────
  if (onShare || onExport || onImport) {
    const shareFolder = gui.addFolder('Share').close();
    const s = { share: () => onShare?.(), exportJson: () => onExport?.(), importJson: () => onImport?.() };
    if (onShare) shareFolder.add(s, 'share').name('Copy share link');
    if (onExport) shareFolder.add(s, 'exportJson').name('Export scene (JSON)');
    if (onImport) shareFolder.add(s, 'importJson').name('Import scene (JSON)');
  }

  // ── Camera ───────────────────────────────────────────────────────────
  if (onTour || onFly || onResetView) {
    const cameraFolder = gui.addFolder('Camera').close();
    const c = { tour: () => onTour?.(), fly: () => onFly?.(), reset: () => onResetView?.() };
    if (onTour) cameraFolder.add(c, 'tour').name('Guided tour (T)');
    if (onFly) cameraFolder.add(c, 'fly').name('Free-fly mode (G)');
    if (onResetView) cameraFolder.add(c, 'reset').name('Reset view');
  }

  // ── Record ───────────────────────────────────────────────────────────
  if (onToggleVideo || onRecordGif || onScreenshot) {
    const recordFolder = gui.addFolder('Record').close();
    const r = { video: () => onToggleVideo?.(), gif: () => onRecordGif?.(), shot: () => onScreenshot?.() };
    if (onToggleVideo) recordFolder.add(r, 'video').name('Start / stop video (R)');
    if (onRecordGif) recordFolder.add(r, 'gif').name('Record 4-second GIF');
    if (onScreenshot) recordFolder.add(r, 'shot').name('Screenshot (P)');
  }

  // ── Settings ─────────────────────────────────────────────────────────
  const settingsFolder = gui.addFolder('Settings');
  const settingsProxy = { ...store.getState().settings };
  const setting = (patch) => dispatch(actions.updateSettings(patch));
  settingsFolder.add(settingsProxy, 'paused').name('Pause').onChange((v) => setting({ paused: v }));
  settingsFolder
    .add(settingsProxy, 'quality', Object.fromEntries(QUALITY_OPTIONS.map((k) => [k === 'auto' ? 'Auto (adapts to your device)' : QUALITY[k].label, k])))
    .name('Quality')
    .onChange((v) => setting({ quality: v }));
  settingsFolder
    .add(settingsProxy, 'band', Object.fromEntries(BAND_OPTIONS.map((k) => [BANDS[k].label, k])))
    .name('View (V)')
    .onChange((v) => setting({ band: v }));
  const tierProxy = { active: '' };
  const tierController = settingsFolder.add(tierProxy, 'active').name('Active tier').disable();
  settingsFolder
    .add(settingsProxy, 'exposure', SETTINGS_LIMITS.exposure.min, SETTINGS_LIMITS.exposure.max, SETTINGS_LIMITS.exposure.step)
    .name('Exposure')
    .onChange((v) => setting({ exposure: v }));
  settingsFolder.add(settingsProxy, 'autoExposure').name('Auto exposure').onChange((v) => setting({ autoExposure: v }));
  settingsFolder
    .add(settingsProxy, 'timeScale', SETTINGS_LIMITS.timeScale.min, SETTINGS_LIMITS.timeScale.max, SETTINGS_LIMITS.timeScale.step)
    .name('Time scale')
    .onChange((v) => setting({ timeScale: v }));
  settingsFolder.add(settingsProxy, 'autoRotate').name('Auto-rotate camera').onChange((v) => setting({ autoRotate: v }));
  settingsFolder
    .add(settingsProxy, 'bloomStrength', SETTINGS_LIMITS.bloomStrength.min, SETTINGS_LIMITS.bloomStrength.max, SETTINGS_LIMITS.bloomStrength.step)
    .name('Glow (bloom)')
    .onChange((v) => setting({ bloomStrength: v }));
  settingsFolder
    .add(settingsProxy, 'flare', SETTINGS_LIMITS.flare.min, SETTINGS_LIMITS.flare.max, SETTINGS_LIMITS.flare.step)
    .name('Lens flare (needs glow)')
    .onChange((v) => setting({ flare: v }));
  settingsFolder.add(settingsProxy, 'dust').name('Dust lanes').onChange((v) => setting({ dust: v }));
  settingsFolder
    .add(settingsProxy, 'dustOpacity', SETTINGS_LIMITS.dustOpacity.min, SETTINGS_LIMITS.dustOpacity.max, SETTINGS_LIMITS.dustOpacity.step)
    .name('Dust amount')
    .onChange((v) => setting({ dustOpacity: v }));
  settingsFolder.add(settingsProxy, 'sky').name('Milky Way sky').onChange((v) => setting({ sky: v }));
  settingsFolder.add(settingsProxy, 'supernovae').name('Supernovae').onChange((v) => setting({ supernovae: v }));
  settingsFolder.add(settingsProxy, 'sound').name('Sound (M)').onChange((v) => setting({ sound: v }));
  settingsFolder
    .add(settingsProxy, 'spikes', { 'JWST (6)': 'jwst', 'Hubble (4)': 'hubble', Off: 'off' })
    .name('Star spikes')
    .onChange((v) => setting({ spikes: v }));
  const cineFolder = settingsFolder.addFolder('Cinematic (Medium/High)').close();
  for (const [key, name] of [['vignette', 'Vignette'], ['grain', 'Film grain'], ['aberration', 'Chromatic aberration']]) {
    const limit = SETTINGS_LIMITS[key];
    cineFolder
      .add(settingsProxy, key, limit.min, limit.max, limit.step)
      .name(name)
      .onChange((v) => setting({ [key]: v }));
  }
  const hudFolder = settingsFolder.addFolder('HUD');
  hudFolder.add(settingsProxy, 'labels').name('Galaxy labels').onChange((v) => setting({ labels: v }));
  hudFolder.add(settingsProxy, 'scaleBar').name('Scale bar (ly)').onChange((v) => setting({ scaleBar: v }));
  hudFolder.add(settingsProxy, 'minimap').name('Minimap').onChange((v) => setting({ minimap: v }));
  const sceneActions = {
    screenshot: () => onScreenshot?.(),
    reset: () => onReset?.(),
  };
  if (onReset) settingsFolder.add(sceneActions, 'reset').name('Reset scene');
  const help = settingsFolder.addFolder('Keyboard').close();
  const keys = { Space: 'pause', N: 'add galaxy', F: 'focus selected', Del: 'delete selected', Esc: 'deselect', H: 'hide panel', P: 'screenshot', 'Ctrl+Z': 'undo', 'Ctrl+Shift+Z': 'redo', T: 'guided tour', G: 'free-fly', R: 'record video', V: 'next view (wavelength)', M: 'sound on / off' };
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
      // Keep folder order stable: Scene, Selected, Share, Settings.
      if (selectedFolder) sceneFolder.domElement.after(selectedFolder.domElement);
    } else if (entry && entry !== lastEntry) {
      refreshSelectedFolder(entry);
    }
    // New or renamed galaxies: refresh the collision partner list.
    if (prev && galaxyListKey(state) !== galaxyListKey(prev)) refreshCollision();

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
    /** Show the tier in use (Auto changes it). */
    setActiveTier(name) {
      tierProxy.active = QUALITY[name]?.label ?? '';
      tierController.updateDisplay();
    },
    /** H key: open or hide the panel (the Controls / Hide buttons do the same). */
    toggle() {
      visibility.toggle();
    },
    /** Whether the panel is shown (the intro fall ends when it opens). */
    isOpen: () => visibility.isOpen(),
    dispose() {
      unsubscribe();
      unsubscribeCollision?.();
      visibility.dispose();
      pendingShape?.cancel();
      gui.destroy();
    },
  };
}
