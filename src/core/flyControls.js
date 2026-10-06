import * as THREE from 'three';

const BASE_SPEED = 12; // world units per second
const FAST_FACTOR = 4;
const LOOK_SENSITIVITY = 0.0035; // radians per pixel
const MAX_PITCH = THREE.MathUtils.degToRad(89);

const MOVE_KEYS = {
  KeyW: [0, 0, -1],
  KeyS: [0, 0, 1],
  KeyA: [-1, 0, 0],
  KeyD: [1, 0, 0],
  KeyE: [0, 1, 0],
  KeyQ: [0, -1, 0],
};

/**
 * Local-space move direction for the held keys (x right, y up, z back),
 * normalised so diagonals are not faster.
 * @param {Set<string>} held KeyboardEvent.code values
 */
export function moveDirection(held) {
  const v = [0, 0, 0];
  for (const code of held) {
    const d = MOVE_KEYS[code];
    if (!d) continue;
    v[0] += d[0];
    v[1] += d[1];
    v[2] += d[2];
  }
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 0 ? v.map((c) => c / len) : v;
}

/** New yaw/pitch after a mouse drag of (dx, dy) pixels; pitch is clamped. */
export function applyLook(yaw, pitch, dx, dy, sensitivity = LOOK_SENSITIVITY) {
  return {
    yaw: yaw - dx * sensitivity,
    pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch - dy * sensitivity)),
  };
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _move = new THREE.Vector3();

/**
 * First-person free-fly: WASD move, Q/E down/up, Shift fast, drag to look.
 * Disabled by default; the app turns OrbitControls off while it is on.
 *
 * @param {THREE.PerspectiveCamera} camera
 * @param {HTMLElement} dom canvas (drag to look)
 */
export function createFlyControls(camera, dom) {
  const held = new Set();
  let enabled = false;
  let yaw = 0;
  let pitch = 0;
  let drag = null;

  const onKeyDown = (e) => {
    if (!enabled || TYPING_TAGS.has(e.target?.tagName)) return;
    if (MOVE_KEYS[e.code] || e.code.startsWith('Shift')) {
      held.add(e.code);
      e.preventDefault();
    }
  };
  const onKeyUp = (e) => held.delete(e.code);
  const onBlur = () => held.clear();
  const onPointerDown = (e) => {
    if (enabled && e.isPrimary) drag = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e) => {
    if (!enabled || !drag) return;
    ({ yaw, pitch } = applyLook(yaw, pitch, e.clientX - drag.x, e.clientY - drag.y));
    drag = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = () => {
    drag = null;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  dom.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  return {
    enable() {
      _euler.setFromQuaternion(camera.quaternion, 'YXZ');
      yaw = _euler.y;
      pitch = _euler.x;
      held.clear();
      enabled = true;
    },
    disable() {
      enabled = false;
      held.clear();
      drag = null;
    },
    isEnabled: () => enabled,
    /** @param {number} realDt seconds */
    update(realDt) {
      if (!enabled) return;
      _euler.set(pitch, yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(_euler);
      const dir = moveDirection(held);
      if (dir[0] || dir[1] || dir[2]) {
        const fast = held.has('ShiftLeft') || held.has('ShiftRight');
        const speed = BASE_SPEED * (fast ? FAST_FACTOR : 1) * realDt;
        _move.set(dir[0], dir[1], dir[2]).applyQuaternion(camera.quaternion).multiplyScalar(speed);
        camera.position.add(_move);
      }
    },
    /** Point in front of the camera, for handing back to OrbitControls. */
    lookTarget(distance, out) {
      return out.set(0, 0, -distance).applyQuaternion(camera.quaternion).add(camera.position);
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    },
  };
}
