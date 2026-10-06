import { describe, it, expect } from 'vitest';
import { encodeScene, decodeScene, shareUrl, codeFromHash, HASH_PREFIX } from './shareCodec.js';
import { createStore } from './store.js';
import { createActions } from './actions.js';

function sceneWith(n) {
  let i = 0;
  const actions = createActions({ makeId: () => `g${++i}`, makeSeed: () => 1234 + i });
  const store = createStore();
  for (let k = 0; k < n; k++) store.dispatch(actions.addGalaxy(store.getState(), ['spiral', 'barred', 'elliptical', 'irregular'][k % 4]));
  store.dispatch(actions.addCatalogueGalaxy(store.getState(), 'm31'));
  store.dispatch(actions.updateSettings({ timeScale: 2 }));
  return store.getState();
}

describe('shareCodec', () => {
  it('round-trips a scene through a URL-safe code', async () => {
    const state = sceneWith(3);
    const code = await encodeScene(state);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = await decodeScene(code);
    expect(back.galaxies).toEqual(state.galaxies);
    expect(back.settings.timeScale).toBe(2);
    expect(back.selectedId).toBeNull();
  });

  it('keeps a full 10-galaxy scene short enough for a link', async () => {
    const code = await encodeScene(sceneWith(9));
    expect(code.length).toBeLessThan(6000);
  });

  it('returns null for broken or tampered codes', async () => {
    expect(await decodeScene('not-a-scene')).toBeNull();
    expect(await decodeScene('')).toBeNull();
    const code = await encodeScene(sceneWith(1));
    expect(await decodeScene(code.slice(0, -10))).toBeNull();
  });

  it('builds a share URL and reads the code back from the hash', async () => {
    const url = await shareUrl(sceneWith(1), { origin: 'https://x.test', pathname: '/app/', search: '?fps' });
    expect(url.startsWith(`https://x.test/app/?fps${HASH_PREFIX}`)).toBe(true);
    const hash = url.slice(url.indexOf('#'));
    expect(await decodeScene(codeFromHash(hash))).not.toBeNull();
    expect(codeFromHash('#other')).toBeNull();
    expect(codeFromHash('')).toBeNull();
  });
});
