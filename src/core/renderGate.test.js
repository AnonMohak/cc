import { describe, it, expect } from 'vitest';
import { createRenderGate } from './renderGate.js';

describe('createRenderGate', () => {
  it('renders the first frame, then only when active or invalidated', () => {
    const gate = createRenderGate();
    expect(gate.shouldRender(false)).toBe(true);
    expect(gate.shouldRender(false)).toBe(false);
    expect(gate.shouldRender(true)).toBe(true);
    gate.invalidate();
    expect(gate.shouldRender(false)).toBe(true);
    expect(gate.shouldRender(false)).toBe(false);
  });

  it('renders once for several invalidations in one frame', () => {
    const gate = createRenderGate();
    gate.shouldRender(false);
    gate.invalidate();
    gate.invalidate();
    expect(gate.shouldRender(false)).toBe(true);
    expect(gate.shouldRender(false)).toBe(false);
  });
});
