// Telescope diffraction spikes inside a point sprite. They come from the
// mirror supports (spider vanes), so they are fixed to the screen, not to the
// star: Hubble's 4-vane spider gives a "+" of 4 spikes; JWST's hexagonal
// mirror segments give 6 long spikes plus 2 faint horizontal ones.
// style: 0 = off, 1 = Hubble, 2 = JWST.

// One line through the sprite centre, as two spikes. p in [-1, 1].
float gk_spikeLine(vec2 p, float angle, float sizePx) {
  vec2 d = vec2(cos(angle), sin(angle));
  float along = abs(dot(p, d));
  // Width in pixels, so spikes stay crisp at every sprite size.
  float perpPx = abs(p.x * d.y - p.y * d.x) * sizePx * 0.5;
  float fall = pow(max(1.0 - along, 0.0), 3.0);
  return exp(-perpPx * perpPx / 0.5) * fall;
}

float gk_spikes(vec2 pointCoord, float sizePx, float style) {
  vec2 p = (pointCoord - 0.5) * 2.0;
  if (style > 1.5) {
    float s = gk_spikeLine(p, 1.5708, sizePx)
      + gk_spikeLine(p, 1.5708 + 1.0472, sizePx)
      + gk_spikeLine(p, 1.5708 - 1.0472, sizePx);
    return s + 0.3 * gk_spikeLine(p, 0.0, sizePx);
  }
  if (style > 0.5) {
    return gk_spikeLine(p, 0.0, sizePx) + gk_spikeLine(p, 1.5708, sizePx);
  }
  return 0.0;
}
