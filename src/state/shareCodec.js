import { serialize, deserialize } from './persistence.js';

/**
 * Scene ⇄ URL-safe string. JSON → deflate-raw → base64url, so a full scene
 * (10 galaxies) fits comfortably in a link. Decoding reuses deserialize(),
 * so a shared link gets the same validation and clamping as saved state.
 */

export const HASH_PREFIX = '#scene=';

/** @param {object} state store state */
export async function encodeScene(state) {
  const bytes = new TextEncoder().encode(serialize({ ...state, selectedId: null }));
  return toBase64Url(await transform(bytes, new CompressionStream('deflate-raw')));
}

/**
 * @param {string} code
 * @returns {Promise<object | null>} a valid state, or null for anything broken
 */
export async function decodeScene(code) {
  try {
    const bytes = await transform(fromBase64Url(code), new DecompressionStream('deflate-raw'));
    return deserialize(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** Share link for the current page. */
export async function shareUrl(state, location) {
  const base = `${location.origin}${location.pathname}${location.search}`;
  return `${base}${HASH_PREFIX}${await encodeScene(state)}`;
}

/** The scene code in a location hash, or null. */
export function codeFromHash(hash) {
  return typeof hash === 'string' && hash.startsWith(HASH_PREFIX) ? hash.slice(HASH_PREFIX.length) : null;
}

async function transform(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
