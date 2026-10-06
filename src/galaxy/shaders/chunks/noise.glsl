// Value noise + fbm (cheap, no textures). Used for flocculent arm structure,
// dust filaments and ray jitter in the volume shader.

#ifndef GALAXY_NOISE
#define GALAXY_NOISE

float gn_hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float gn_noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(gn_hash(i + vec3(0, 0, 0)), gn_hash(i + vec3(1, 0, 0)), f.x),
        mix(gn_hash(i + vec3(0, 1, 0)), gn_hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(gn_hash(i + vec3(0, 0, 1)), gn_hash(i + vec3(1, 0, 1)), f.x),
        mix(gn_hash(i + vec3(0, 1, 1)), gn_hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

// `octaves` is a uniform-driven loop bound (max 5) so quality can trade detail for speed.
float gn_fbm(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    if (i >= octaves) break;
    sum += amp * gn_noise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    amp *= 0.5;
  }
  return sum;
}

// Interleaved gradient noise: per-pixel ray-start jitter that hides banding.
float gn_ign(vec2 pixel) {
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

#endif
