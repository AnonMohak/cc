// Per-pixel ray-start jitter for the volume shader. (Flocculence and dust
// noise come from the shared tileable texture in noiseTexture.js.)

#ifndef GALAXY_NOISE
#define GALAXY_NOISE

// Interleaved gradient noise: cheap, well-distributed jitter that hides banding.
float gn_ign(vec2 pixel) {
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

#endif
