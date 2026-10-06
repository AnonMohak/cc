import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from './debounce.js';

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('calls once with the last arguments after the wait', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d(1);
    d(2);
    d(3);
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith(3);
  });

  it('flush runs a pending call at once and only once', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('a');
    d.flush();
    expect(fn).toHaveBeenCalledWith('a');
    vi.advanceTimersByTime(200);
    d.flush();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('cancel drops a pending call', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('a');
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });
});
