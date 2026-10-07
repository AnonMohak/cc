import { describe, it, expect } from 'vitest';
import { createWakeLock } from './wakeLock.js';

function fakeEnv({ refuse = false } = {}) {
  const listeners = {};
  const doc = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => (listeners[type] = fn),
    removeEventListener: (type) => delete listeners[type],
  };
  const locks = [];
  const nav = {
    wakeLock: {
      async request(type) {
        if (refuse) throw new Error('NotAllowedError');
        const lock = {
          type,
          released: false,
          onRelease: null,
          addEventListener: (_t, fn) => (lock.onRelease = fn),
          async release() {
            lock.released = true;
            lock.onRelease?.();
          },
        };
        locks.push(lock);
        return lock;
      },
    },
  };
  return { nav, doc, locks, fire: (type) => listeners[type]?.() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createWakeLock', () => {
  it('takes the screen lock when wanted and releases it after', async () => {
    const env = fakeEnv();
    const wake = createWakeLock(env);
    wake.set(true);
    await tick();
    expect(wake.isHeld()).toBe(true);
    expect(env.locks[0].type).toBe('screen');
    wake.set(false);
    expect(wake.isHeld()).toBe(false);
    expect(env.locks[0].released).toBe(true);
  });

  it('takes it again when the page comes back', async () => {
    const env = fakeEnv();
    const wake = createWakeLock(env);
    wake.set(true);
    await tick();
    // The browser drops the lock when the page is hidden.
    env.doc.visibilityState = 'hidden';
    await env.locks[0].release();
    expect(wake.isHeld()).toBe(false);
    env.doc.visibilityState = 'visible';
    env.fire('visibilitychange');
    await tick();
    expect(wake.isHeld()).toBe(true);
    expect(env.locks).toHaveLength(2);
  });

  it('releases a lock that arrives after it is no longer wanted', async () => {
    const env = fakeEnv();
    const wake = createWakeLock(env);
    wake.set(true);
    wake.set(false);
    await tick();
    expect(wake.isHeld()).toBe(false);
    expect(env.locks[0].released).toBe(true);
  });

  it('is a silent no-op when missing or refused', async () => {
    const missing = createWakeLock({ nav: {}, doc: fakeEnv().doc });
    expect(missing.supported).toBe(false);
    missing.set(true);
    const refused = createWakeLock(fakeEnv({ refuse: true }));
    refused.set(true);
    await tick();
    expect(refused.isHeld()).toBe(false);
  });
});
