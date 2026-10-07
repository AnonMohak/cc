/**
 * Show/hide for the lil-gui panel. The panel starts hidden behind a
 * "Controls" button in the top-right corner; a "Hide" button in the panel's
 * title bar puts it away again. UI state only: never saved or shared.
 *
 * The two elements fade with opacity + visibility (style.css), not
 * display: none, so the fade runs both ways and hidden ones take no clicks.
 *
 * @param {import('lil-gui').GUI} gui the root GUI
 * @param {{ doc?: Document }} [options]
 */
export function createPanelToggle(gui, { doc = document } = {}) {
  const panel = gui.domElement;
  panel.id ||= 'control-panel';

  // One way to close the panel: the title no longer collapses it.
  gui.openAnimated = () => gui;
  gui.$title.tabIndex = -1;
  gui.$title.removeAttribute('aria-expanded');

  const openButton = doc.createElement('button');
  openButton.type = 'button';
  openButton.className = 'panel-open';
  openButton.textContent = 'Controls';
  openButton.setAttribute('aria-controls', panel.id);

  const hideButton = doc.createElement('button');
  hideButton.type = 'button';
  hideButton.className = 'panel-hide';
  hideButton.textContent = 'Hide ✕';
  hideButton.setAttribute('aria-label', 'Hide controls');
  // Not inside the title: that is a <button>, and buttons cannot nest.
  panel.appendChild(hideButton);
  doc.body.appendChild(openButton);

  let open = false;
  function apply(focus) {
    panel.classList.toggle('panel-hidden', !open);
    openButton.classList.toggle('panel-hidden', open);
    openButton.setAttribute('aria-expanded', String(open));
    panel.inert = !open;
    openButton.inert = open;
    // Keep keyboard focus on the visible control (not for the H key: the
    // focus would then sit on a button and Space would press it).
    if (focus) (open ? hideButton : openButton).focus({ preventScroll: true });
    else if (doc.activeElement === (open ? openButton : hideButton)) doc.activeElement.blur();
  }

  openButton.addEventListener('click', () => toggle(true, true));
  hideButton.addEventListener('click', () => toggle(false, true));

  /** @param {boolean} [next] open (true) or hide (false); omit to flip. */
  function toggle(next = !open, focus = false) {
    open = next;
    apply(focus);
  }

  apply(false);

  return {
    toggle,
    isOpen: () => open,
    dispose() {
      openButton.remove();
      hideButton.remove();
    },
  };
}
