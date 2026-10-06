import { describe, it, expect, vi } from 'vitest';
import { keyToCommand, attachKeyboard } from './keyboard.js';
import { screenshotFilename } from '../core/screenshot.js';

describe('keyToCommand', () => {
  it('maps shortcut keys', () => {
    expect(keyToCommand({ key: ' ' })).toBe('togglePause');
    expect(keyToCommand({ key: 'n' })).toBe('addGalaxy');
    expect(keyToCommand({ key: 'F' })).toBe('focusSelected');
    expect(keyToCommand({ key: 'Delete' })).toBe('deleteSelected');
    expect(keyToCommand({ key: 'Escape' })).toBe('deselect');
    expect(keyToCommand({ key: 'q' })).toBeNull();
  });

  it('ignores keys typed into form fields and modifier shortcuts', () => {
    expect(keyToCommand({ key: 'n', target: { tagName: 'INPUT' } })).toBeNull();
    expect(keyToCommand({ key: 'Backspace', target: { tagName: 'TEXTAREA' } })).toBeNull();
    expect(keyToCommand({ key: 'f', target: { isContentEditable: true } })).toBeNull();
    expect(keyToCommand({ key: 'p', ctrlKey: true })).toBeNull();
    expect(keyToCommand({ key: 'n', target: { tagName: 'CANVAS' } })).toBe('addGalaxy');
    expect(keyToCommand({ key: ' ', target: { tagName: 'BUTTON' } })).toBeNull();
    expect(keyToCommand({ key: 'n', target: { tagName: 'BUTTON' } })).toBe('addGalaxy');
  });
});

describe('attachKeyboard', () => {
  it('runs the handler, prevents default, and detaches', () => {
    const listeners = {};
    const win = {
      addEventListener: (type, fn) => (listeners[type] = fn),
      removeEventListener: (type) => delete listeners[type],
    };
    const addGalaxy = vi.fn();
    const detach = attachKeyboard(win, { addGalaxy });
    const event = { key: 'n', preventDefault: vi.fn() };
    listeners.keydown(event);
    expect(addGalaxy).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalled();
    const other = { key: 'q', preventDefault: vi.fn() };
    listeners.keydown(other);
    expect(other.preventDefault).not.toHaveBeenCalled();
    detach();
    expect(listeners.keydown).toBeUndefined();
  });
});

describe('screenshotFilename', () => {
  it('formats a sortable timestamp', () => {
    expect(screenshotFilename(new Date(2026, 9, 6, 9, 5, 3))).toBe('galaxy-20261006-090503.png');
  });
});

describe('undo/redo shortcuts', () => {
  it('maps Ctrl/Cmd+Z, Ctrl+Shift+Z and Ctrl+Y', () => {
    expect(keyToCommand({ key: 'z', ctrlKey: true })).toBe('undo');
    expect(keyToCommand({ key: 'z', metaKey: true })).toBe('undo');
    expect(keyToCommand({ key: 'Z', ctrlKey: true, shiftKey: true })).toBe('redo');
    expect(keyToCommand({ key: 'y', ctrlKey: true })).toBe('redo');
    expect(keyToCommand({ key: 'c', ctrlKey: true })).toBeNull();
    expect(keyToCommand({ key: 'z', ctrlKey: true, altKey: true })).toBeNull();
  });

  it('leaves Ctrl+Z to text fields', () => {
    expect(keyToCommand({ key: 'z', ctrlKey: true, target: { tagName: 'INPUT' } })).toBeNull();
  });
});
