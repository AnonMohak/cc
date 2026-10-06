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

/**
 * Short message that fades out by itself (e.g. "Link copied").
 * @param {HTMLElement} container
 * @param {string} text
 */
export function showToast(container, text, ms = 2200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  container.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
