/**
 * Trailing-edge debounce with flush() and cancel().
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @param {number} ms
 */
export function debounce(fn, ms) {
  let timer = null;
  let pendingArgs = null;

  function debounced(...args) {
    pendingArgs = args;
    clearTimeout(timer);
    timer = setTimeout(debounced.flush, ms);
  }

  debounced.flush = () => {
    clearTimeout(timer);
    timer = null;
    if (pendingArgs) {
      const args = pendingArgs;
      pendingArgs = null;
      fn(...args);
    }
  };

  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };

  return debounced;
}
