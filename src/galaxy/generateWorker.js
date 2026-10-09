// Builds a galaxy and bakes its disc map off the main thread
// (generationCache.js prepareGalaxy: a merger's remnant).
import { generateGalaxy } from './generateGalaxy.js';
import { bakeDiscFields } from './discMap.js';

/** Every typed array's buffer in the result, for a zero-copy transfer. */
function buffers(value, out = []) {
  if (ArrayBuffer.isView(value)) out.push(value.buffer);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) buffers(v, out);
  return out;
}

self.onmessage = ({ data: { shape, seed, structure } }) => {
  const galaxy = generateGalaxy(shape, seed);
  const disc = bakeDiscFields(shape, structure);
  self.postMessage({ galaxy, disc }, [...new Set(buffers({ galaxy, disc }))]);
};
