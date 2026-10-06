import { describe, it, expect } from 'vitest';
import { createStartState, isStartKey } from './startScreen.js';

describe('createStartState', () => {
  it('ignores a dismiss while loading', () => {
    const state = createStartState();
    expect(state.dismiss()).toBe(false);
    expect(state.phase()).toBe('loading');
  });

  it('closes on the first dismiss after ready, then ignores more', () => {
    const state = createStartState();
    state.ready();
    expect(state.phase()).toBe('ready');
    expect(state.dismiss()).toBe(true);
    expect(state.phase()).toBe('closed');
    expect(state.dismiss()).toBe(false);
  });

  it('never reopens once closed', () => {
    const state = createStartState();
    state.ready();
    state.dismiss();
    state.ready();
    expect(state.phase()).toBe('closed');
  });
});

describe('isStartKey', () => {
  it('accepts Enter, Space and Escape only', () => {
    for (const key of ['Enter', ' ', 'Escape']) expect(isStartKey(key)).toBe(true);
    for (const key of ['n', 'h', 'Tab', 'Delete']) expect(isStartKey(key)).toBe(false);
  });
});
