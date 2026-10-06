import { describe, it, expect } from 'vitest';
import { createTapDetector } from './pointerInput.js';

const press = (d, x, y, time, { dx = 0, dy = 0, primary = true } = {}) => {
  d.down({ x, y, time, primary });
  return d.up({ x: x + dx, y: y + dy, time: time + 50 });
};

describe('createTapDetector', () => {
  it('a short press without movement is a tap', () => {
    expect(press(createTapDetector(), 10, 10, 0)).toBe('tap');
  });

  it('a press that moves is a drag, not a tap', () => {
    expect(press(createTapDetector(), 10, 10, 0, { dx: 40 })).toBeNull();
  });

  it('ignores secondary pointers and up without down', () => {
    const d = createTapDetector();
    expect(press(d, 10, 10, 0, { primary: false })).toBeNull();
    expect(d.up({ x: 0, y: 0, time: 0 })).toBeNull();
  });

  it('two quick taps in the same place are a double tap', () => {
    const d = createTapDetector();
    expect(press(d, 100, 100, 0)).toBe('tap');
    expect(press(d, 104, 102, 200)).toBe('double');
    // The pair is consumed: a third tap starts over.
    expect(press(d, 104, 102, 400)).toBe('tap');
  });

  it('slow or distant second taps are separate taps', () => {
    const d = createTapDetector();
    press(d, 100, 100, 0);
    expect(press(d, 100, 100, 1000)).toBe('tap');
    expect(press(d, 300, 100, 1100)).toBe('tap');
  });

  it('cancel drops a pending press', () => {
    const d = createTapDetector();
    d.down({ x: 0, y: 0, time: 0, primary: true });
    d.cancel();
    expect(d.up({ x: 0, y: 0, time: 10 })).toBeNull();
  });
});
