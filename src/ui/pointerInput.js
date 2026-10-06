import * as THREE from 'three';

// A press that moves further than this is an orbit drag, not a tap.
const TAP_MOVE_PX = 5;
// Two taps this close in time and space are a double tap.
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 24;

/**
 * Classifies pointer down/up pairs as 'tap', 'double', or null (a drag).
 * Pure, so it works the same for mouse and touch and is unit-testable;
 * mobile browsers do not reliably fire `dblclick`.
 */
export function createTapDetector() {
  let down = null;
  let lastTap = null;

  return {
    /** @param {{ x: number, y: number, time: number, primary: boolean }} e */
    down(e) {
      down = e.primary ? e : null;
    },
    /** @param {{ x: number, y: number, time: number }} e @returns {'tap' | 'double' | null} */
    up(e) {
      if (!down) return null;
      const moved = Math.hypot(e.x - down.x, e.y - down.y);
      down = null;
      if (moved > TAP_MOVE_PX) return null;
      if (lastTap && e.time - lastTap.time <= DOUBLE_TAP_MS && Math.hypot(e.x - lastTap.x, e.y - lastTap.y) <= DOUBLE_TAP_PX) {
        lastTap = null;
        return 'double';
      }
      lastTap = e;
      return 'tap';
    },
    cancel() {
      down = null;
    },
  };
}

/**
 * Tap or click to select, double-tap or double-click to focus. Drags never
 * select.
 *
 * @param {{
 *   dom: HTMLElement,
 *   camera: THREE.Camera,
 *   pick: (ray: THREE.Ray) => string | null,
 *   onSelect: (id: string) => void,
 *   onFocus: (id: string) => void,
 * }} options
 */
export function attachPointerInput({ dom, camera, pick, onSelect, onFocus }) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const taps = createTapDetector();

  function pickAt(event) {
    const rect = dom.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return pick(raycaster.ray);
  }

  function onPointerDown(event) {
    taps.down({ x: event.clientX, y: event.clientY, time: event.timeStamp, primary: event.isPrimary && event.button === 0 });
  }

  function onPointerUp(event) {
    const kind = taps.up({ x: event.clientX, y: event.clientY, time: event.timeStamp });
    if (!kind) return;
    const id = pickAt(event);
    if (!id) return;
    if (kind === 'double') onFocus(id);
    else onSelect(id);
  }

  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('pointercancel', taps.cancel);

  return () => {
    dom.removeEventListener('pointerdown', onPointerDown);
    dom.removeEventListener('pointerup', onPointerUp);
    dom.removeEventListener('pointercancel', taps.cancel);
  };
}
