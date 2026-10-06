import * as THREE from 'three';

// A press that moves further than this is an orbit drag, not a click.
const CLICK_TOLERANCE_PX = 5;

/**
 * Click to select, double-click to focus. Drags never select.
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
  let down = null;

  function pickAt(event) {
    const rect = dom.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return pick(raycaster.ray);
  }

  function onPointerDown(event) {
    down = event.isPrimary && event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
  }

  function onPointerUp(event) {
    if (!down) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    down = null;
    if (moved > CLICK_TOLERANCE_PX) return;
    const id = pickAt(event);
    if (id) onSelect(id);
  }

  function onDoubleClick(event) {
    const id = pickAt(event);
    if (id) onFocus(id);
  }

  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('dblclick', onDoubleClick);

  return () => {
    dom.removeEventListener('pointerdown', onPointerDown);
    dom.removeEventListener('pointerup', onPointerUp);
    dom.removeEventListener('dblclick', onDoubleClick);
  };
}
