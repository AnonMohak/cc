// Bakes the intro disc's 3D noise off the main thread (~200 ms of JS).
import { bakeNoise3d } from './noise3d.js';

self.onmessage = ({ data: { size } }) => {
  const data = bakeNoise3d(size);
  self.postMessage({ size, data }, [data.buffer]);
};
