/**
 * Undo / redo for galaxy changes (add, delete, edits). Selection and global
 * settings are not recorded — undo should never "undo" a click or a quality
 * change.
 *
 * Rapid changes (dragging a slider fires many updates) are grouped: a step
 * is committed after `groupMs` of quiet, so one drag = one undo step.
 *
 * @param {ReturnType<typeof import('./store.js').createStore>} store
 * @param {{ limit?: number, groupMs?: number, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} [options]
 */
export function createHistory(store, { limit = 50, groupMs = 400, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const undoStack = [];
  const redoStack = [];
  const listeners = new Set();
  let pendingBefore = null;
  let timer = null;
  let restoring = false;

  const notify = () => {
    for (const fn of listeners) fn();
  };

  function commit() {
    clearTimer(timer);
    timer = null;
    if (pendingBefore === null) return;
    if (pendingBefore !== store.getState().galaxies) {
      undoStack.push(pendingBefore);
      if (undoStack.length > limit) undoStack.shift();
      redoStack.length = 0;
    }
    pendingBefore = null;
    notify();
  }

  const unsubscribe = store.subscribe((next, prev) => {
    if (restoring || next.galaxies === prev.galaxies) return;
    if (pendingBefore === null) {
      pendingBefore = prev.galaxies;
      notify();
    }
    clearTimer(timer);
    timer = setTimer(commit, groupMs);
  });

  function restore(galaxies) {
    restoring = true;
    store.dispatch({ type: 'galaxies/restore', galaxies });
    restoring = false;
    notify();
  }

  return {
    undo() {
      commit();
      if (undoStack.length === 0) return false;
      redoStack.push(store.getState().galaxies);
      restore(undoStack.pop());
      return true;
    },
    redo() {
      commit();
      if (redoStack.length === 0) return false;
      undoStack.push(store.getState().galaxies);
      restore(redoStack.pop());
      return true;
    },
    canUndo: () => undoStack.length > 0 || pendingBefore !== null,
    canRedo: () => redoStack.length > 0,
    /** Forget all steps (e.g. after loading a different scene). */
    clear() {
      clearTimer(timer);
      timer = null;
      pendingBefore = null;
      undoStack.length = 0;
      redoStack.length = 0;
      notify();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      clearTimer(timer);
      unsubscribe();
    },
  };
}
