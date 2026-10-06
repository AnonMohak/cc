const KEY_COMMANDS = {
  ' ': 'togglePause',
  n: 'addGalaxy',
  N: 'addGalaxy',
  f: 'focusSelected',
  F: 'focusSelected',
  Delete: 'deleteSelected',
  Backspace: 'deleteSelected',
  Escape: 'deselect',
  h: 'togglePanel',
  H: 'togglePanel',
  p: 'screenshot',
  P: 'screenshot',
};

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Map a keydown event to a command name, or null. Typing in a panel field
 * and shortcuts with modifier keys never trigger commands.
 *
 * @param {{ key: string, target?: { tagName?: string, isContentEditable?: boolean } | null, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean }} event
 */
export function keyToCommand(event) {
  const target = event.target;
  if (target && (TYPING_TAGS.has(target.tagName) || target.isContentEditable)) return null;
  if (event.altKey) return null;
  if (event.ctrlKey || event.metaKey) {
    // Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo.
    const k = event.key.toLowerCase();
    if (k === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (k === 'y') return 'redo';
    return null;
  }
  // Space on a focused panel button presses that button.
  if (event.key === ' ' && target?.tagName === 'BUTTON') return null;
  return KEY_COMMANDS[event.key] ?? null;
}

/**
 * @param {Window} win
 * @param {Record<string, () => void>} handlers command name → handler
 */
export function attachKeyboard(win, handlers) {
  function onKeyDown(event) {
    const command = keyToCommand(event);
    if (!command || !handlers[command]) return;
    event.preventDefault();
    handlers[command]();
  }
  win.addEventListener('keydown', onKeyDown);
  return () => win.removeEventListener('keydown', onKeyDown);
}
