uniform float uSpikeStyle; // 0 off, 1 Hubble, 2 JWST (spikes.glsl)

varying vec3 vColor;
varying float vCorePx; // diameter of the core glow
varying float vSizePx; // sprite diameter (larger when spikes are on)

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float rPx = length(d) * vSizePx;
  float r2 = rPx * rPx / (0.25 * vCorePx * vCorePx);
  // Bright core and a soft halo, so it still glows on tiers without bloom.
  float a = r2 < 1.0 ? exp(-r2 * 14.0) + 0.18 * exp(-r2 * 3.0) * (1.0 - r2) : 0.0;
  a += 0.35 * gk_spikes(gl_PointCoord, vSizePx, uSpikeStyle);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vColor * a, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
