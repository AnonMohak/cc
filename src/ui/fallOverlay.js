/**
 * Darkness for the intro fall (core/blackHoleFall.js): a vignette that
 * closes in from the edges and a solid black that ends the fall. Plain DOM,
 * so it costs no GPU time and works on every quality tier (the cinematic
 * pass is off on Low/Minimal). Above the canvas and HUD, below the panel.
 *
 * @param {HTMLElement} container
 */
export function createFallOverlay(container) {
  const root = document.createElement('div');
  root.className = 'fall-overlay';
  root.hidden = true;
  const vignette = document.createElement('div');
  vignette.className = 'fall-vignette';
  const black = document.createElement('div');
  black.className = 'fall-black';
  root.append(vignette, black);
  container.appendChild(root);

  let fadeTimer = null;

  return {
    /** @param {number} v vignette 0–1 @param {number} b black 0–1 */
    set(v, b) {
      clearTimeout(fadeTimer);
      root.classList.remove('fading');
      root.hidden = v <= 0 && b <= 0;
      vignette.style.opacity = String(v);
      black.style.opacity = String(b);
    },
    /** Fade both layers out (CSS transition), then hide. */
    fadeOut(seconds = 0.6) {
      if (root.hidden) return;
      root.style.setProperty('--fall-fade', `${seconds}s`);
      root.classList.add('fading');
      vignette.style.opacity = '0';
      black.style.opacity = '0';
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => {
        root.hidden = true;
        root.classList.remove('fading');
      }, seconds * 1000);
    },
    dispose() {
      clearTimeout(fadeTimer);
      root.remove();
    },
  };
}
