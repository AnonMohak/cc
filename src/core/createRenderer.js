import * as THREE from 'three';

/**
 * @param {HTMLElement} container
 * @param {{ maxPixelRatio?: number }} [options] cap from the quality tier
 */
export function createRenderer(container, { maxPixelRatio = 1.5 } = {}) {
  // No MSAA: everything renders through the composer's render targets, so
  // the default framebuffer's multisampling would only cost memory.
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  let cap = maxPixelRatio;
  const ratio = () => Math.min(window.devicePixelRatio || 1, cap);
  renderer.setPixelRatio(ratio());
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  function resize(width, height) {
    renderer.setPixelRatio(ratio());
    renderer.setSize(width, height);
  }

  return {
    renderer,
    resize,
    /** @returns {boolean} true if the effective pixel ratio changed */
    setMaxPixelRatio(value) {
      const before = ratio();
      cap = value;
      return ratio() !== before;
    },
  };
}
