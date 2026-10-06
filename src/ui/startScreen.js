const START_KEYS = new Set(['Enter', ' ', 'Escape']);
const FADE_MS = 300;

/** True for the keys that close the start box. */
export function isStartKey(key) {
  return START_KEYS.has(key);
}

/**
 * PURE start-box state: 'loading' → 'ready' → 'closed'. A dismiss before the
 * first frame is ignored, so the user never starts on a black screen.
 */
export function createStartState() {
  let phase = 'loading';
  return {
    phase: () => phase,
    ready() {
      if (phase === 'loading') phase = 'ready';
    },
    /** @returns {boolean} true when this call closed the box */
    dismiss() {
      if (phase !== 'ready') return false;
      phase = 'closed';
      return true;
    },
  };
}

/**
 * Wire the static start box from index.html. While it is open it swallows
 * pointer and key input, so the starting click never selects a galaxy or
 * turns the camera, and the starting Space never pauses.
 *
 * @param {HTMLElement | null} el the `.start` element
 * @param {Window} win
 */
export function attachStartScreen(el, win = window) {
  const state = createStartState();
  if (!el) {
    state.ready();
    state.dismiss();
    return { ready() {}, isOpen: () => false, close() {} };
  }
  const button = el.querySelector('.start-go');

  function close() {
    if (!state.dismiss()) return;
    win.removeEventListener('keydown', onKeyDown, true);
    el.classList.add('is-closing');
    // Keep the box under the finger during the fade, so the synthetic
    // mouse events after a tap land on it and not on the canvas.
    const remove = () => el.remove();
    const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    win.setTimeout(remove, reduced ? 0 : FADE_MS);
  }

  function onKeyDown(event) {
    // Capture phase on window: runs before the app's keyboard shortcuts.
    event.stopImmediatePropagation();
    if (isStartKey(event.key)) {
      event.preventDefault();
      close();
    }
  }

  el.addEventListener('pointerup', (event) => {
    event.preventDefault();
    close();
  });
  for (const type of ['pointerdown', 'wheel', 'contextmenu']) {
    el.addEventListener(type, (event) => event.preventDefault(), { passive: false });
  }
  win.addEventListener('keydown', onKeyDown, true);

  return {
    /** Call after the first frame is on screen. */
    ready() {
      if (state.phase() !== 'loading') return;
      state.ready();
      el.classList.add('is-ready');
      // Keys are caught on window, so the button needs no focus (and no ring).
      if (button) button.disabled = false;
    },
    isOpen: () => state.phase() !== 'closed',
    close,
  };
}
