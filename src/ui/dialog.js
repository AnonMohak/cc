/**
 * In-app dialogs in the panel's glass and type, instead of the browser's
 * window.confirm / window.prompt (white boxes in the system font).
 *
 * While a dialog is open it takes every key (a window capture listener, as
 * the start box does), so Space, N or Delete never reach the app's shortcuts;
 * Esc cancels and Enter confirms.
 */

function open(build) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    const box = document.createElement('div');
    box.className = 'dialog';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    overlay.appendChild(box);

    const previous = document.activeElement;
    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
      resolve(value);
    };
    const { onEnter, focus } = build(box, close);
    const onKey = (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        onEnter();
      }
    };
    window.addEventListener('keydown', onKey, true);
    // A click on the backdrop cancels; clicks inside the box do not.
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) close(false);
    });
    // On <body>: #app is position: fixed (its own stacking context), so a
    // dialog inside it would stay under the panel.
    document.body.appendChild(overlay);
    focus.focus({ preventScroll: true });
  });
}

function button(text, primary) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = primary ? 'dialog-button dialog-primary' : 'dialog-button';
  b.textContent = text;
  return b;
}

/**
 * Ask a yes/no question.
 * @param {string} message
 * @param {{ ok?: string, cancel?: string }} [labels]
 * @returns {Promise<boolean>}
 */
export function confirmDialog(message, { ok = 'OK', cancel = 'Cancel' } = {}) {
  return open((box, close) => {
    const text = document.createElement('p');
    text.className = 'dialog-text';
    text.textContent = message;
    const row = document.createElement('div');
    row.className = 'dialog-buttons';
    const no = button(cancel, false);
    const yes = button(ok, true);
    no.addEventListener('click', () => close(false));
    yes.addEventListener('click', () => close(true));
    row.append(no, yes);
    box.append(text, row);
    return { onEnter: () => close(true), focus: yes };
  });
}

/**
 * Show text to copy by hand (e.g. a share link when the clipboard is
 * refused). The text starts selected.
 * @param {string} message
 * @param {string} value
 * @returns {Promise<boolean>}
 */
export function copyDialog(message, value) {
  return open((box, close) => {
    const text = document.createElement('p');
    text.className = 'dialog-text';
    text.textContent = message;
    const field = document.createElement('input');
    field.className = 'dialog-field';
    field.type = 'text';
    field.readOnly = true;
    field.value = value;
    field.addEventListener('focus', () => field.select());
    const row = document.createElement('div');
    row.className = 'dialog-buttons';
    const done = button('Close', true);
    done.addEventListener('click', () => close(true));
    row.append(done);
    box.append(text, field, row);
    return { onEnter: () => close(true), focus: field };
  });
}
