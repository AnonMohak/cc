import { describe, it, expect, afterEach } from 'vitest';
import { prepareGalaxy, cachedGalaxyData, cachedDiscFields, isGalaxyReady, clearGalaxyCache, discKey } from './generationCache.js';
import { generateGalaxy } from './generateGalaxy.js';
import { DEFAULT_SHAPE, DEFAULT_STRUCTURE } from './params.js';

describe('generationCache', () => {
  afterEach(() => clearGalaxyCache());

  it('holds one prepared build, the same as generating it now', async () => {
    const shape = { ...DEFAULT_SHAPE, count: 3000 };
    expect(isGalaxyReady(shape, 5)).toBe(false);
    await prepareGalaxy(shape, 5, DEFAULT_STRUCTURE, { useWorker: false });
    expect(isGalaxyReady(shape, 5)).toBe(true);
    const data = cachedGalaxyData(shape, 5);
    const fresh = generateGalaxy(shape, 5);
    expect(data.count).toBe(fresh.count);
    expect(data.orbit).toEqual(fresh.orbit);
    expect(cachedGalaxyData(shape, 6)).toBeNull();
    expect(cachedGalaxyData({ ...shape, count: 4000 }, 5)).toBeNull();
    expect(cachedDiscFields(shape, DEFAULT_STRUCTURE)).toBeInstanceOf(Float32Array);
    clearGalaxyCache();
    expect(cachedGalaxyData(shape, 5)).toBeNull();
  });

  it('the disc-map key ignores the star count (a merger only adds stars)', () => {
    expect(discKey({ ...DEFAULT_SHAPE, count: 1000 }, DEFAULT_STRUCTURE)).toBe(discKey({ ...DEFAULT_SHAPE, count: 9000 }, DEFAULT_STRUCTURE));
    expect(discKey({ ...DEFAULT_SHAPE, barLength: 0.2 }, DEFAULT_STRUCTURE)).not.toBe(discKey(DEFAULT_SHAPE, DEFAULT_STRUCTURE));
  });
});
