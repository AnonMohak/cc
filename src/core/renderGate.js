/**
 * Render on demand. When nothing moves and nothing changed (e.g. paused and
 * the camera at rest), skip the GPU work entirely: phones stay cool and
 * laptops save battery. Anything that changes the picture calls invalidate();
 * anything that animates reports itself as `active` each frame.
 */
export function createRenderGate() {
  let dirty = true;
  return {
    invalidate() {
      dirty = true;
    },
    /** @param {boolean} active something is animating this frame */
    shouldRender(active) {
      const render = dirty || active;
      dirty = false;
      return render;
    },
  };
}
