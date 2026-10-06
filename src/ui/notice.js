/**
 * Show a centred message over the app. Returns a function that removes it.
 * @param {HTMLElement} container
 * @param {string} text
 */
export function showNotice(container, text) {
  const el = document.createElement('div');
  el.className = 'notice';
  el.setAttribute('role', 'alert');
  el.textContent = text;
  container.appendChild(el);
  return () => el.remove();
}
