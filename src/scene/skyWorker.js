// Bakes the background sky off the main thread (~1 s of JS on a laptop).
import { bakeSkyMap } from './skyMap.js';

self.onmessage = ({ data: { width, height } }) => {
  const pixels = bakeSkyMap(width, height);
  self.postMessage({ width, height, pixels }, [pixels.buffer]);
};
