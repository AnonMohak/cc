import { describe, it, expect } from 'vitest';
import { discFields, bakeDiscFields, createDiscMapTexture, DISC_MAP_EXTENT } from './discMap.js';
import { armPhase, crest } from './densityModel.js';
import { PRESETS } from './presets.js';
import { clampShape, clampStructure } from './params.js';

const spiral = { shape: clampShape(PRESETS.spiral.shape), structure: clampStructure(PRESETS.spiral.structure) };

/** Sample the fields around a ring of radius R. */
function ring(R, fields, n = 360) {
  return Array.from({ length: n }, (_, i) => {
    const th = (i / n) * Math.PI * 2;
    return { th, ...fields(R * Math.cos(th), R * Math.sin(th)) };
  });
}

describe('discFields', () => {
  const f = (x, z) => discFields(x, z, spiral.shape, spiral.structure);

  it('emission peaks on the arm crests predicted by the density-wave model', () => {
    const samples = ring(0.5, f);
    const peak = samples.reduce((a, b) => (b.emission > a.emission ? b : a));
    const { arms, armWinding } = spiral.structure;
    expect(crest(armPhase(peak.th, 0.5, arms, armWinding, 0, 0), armWinding)).toBeGreaterThan(0.95);
    expect(peak.crest).toBeGreaterThan(0.9);
  });

  it('dust lanes sit just inside the arms (offset from the emission peak)', () => {
    const samples = ring(0.5, f);
    const em = samples.reduce((a, b) => (b.emission > a.emission ? b : a));
    const du = samples.reduce((a, b) => (b.dust > a.dust ? b : a));
    // Lane is shifted along the arm by ~0.6/m rad, not on the crest itself.
    const delta = Math.abs(Math.atan2(Math.sin(du.th - em.th), Math.cos(du.th - em.th)));
    expect(delta).toBeGreaterThan(0.1);
    expect(delta).toBeLessThan(0.8);
  });

  it('is empty beyond the disc and has no dust in the bulge', () => {
    expect(f(1.4, 0).emission).toBeLessThan(1e-3);
    expect(f(0.01, 0).dust).toBe(0);
  });

  it('adds the bar only for barred galaxies', () => {
    const barred = { shape: clampShape(PRESETS.barred.shape), structure: clampStructure(PRESETS.barred.structure) };
    const atCentreBarred = discFields(0.15, 0, barred.shape, barred.structure).emission;
    const maxOnBarRing = Math.max(...ring(0.15, (x, z) => discFields(x, z, barred.shape, barred.structure)).map((s) => s.emission));
    expect(maxOnBarRing).toBeGreaterThan(atCentreBarred * 0.99);
    expect(maxOnBarRing).toBeGreaterThan(Math.max(...ring(0.15, f).map((s) => s.emission)));
  });

  it('has no arm crest without arms', () => {
    const e = PRESETS.elliptical;
    expect(discFields(0.5, 0, clampShape(e.shape), clampStructure(e.structure)).crest).toBe(0);
  });
});

describe('bakeDiscFields', () => {
  it('is deterministic, sized size²×4, and centred on the disc', () => {
    const a = bakeDiscFields(PRESETS.spiral.shape, PRESETS.spiral.structure, 32);
    expect(a.length).toBe(32 * 32 * 4);
    expect(a).toEqual(bakeDiscFields(PRESETS.spiral.shape, PRESETS.spiral.structure, 32));
    // The corner texel is outside the disc; the centre region is bright.
    expect(a[0]).toBeLessThan(1e-3);
    const mid = (16 * 32 + 16) * 4;
    expect(a[mid]).toBeGreaterThan(0.1);
    expect(DISC_MAP_EXTENT).toBeGreaterThanOrEqual(1.45);
  });

  it('creates a half-float texture', () => {
    const tex = createDiscMapTexture(PRESETS.spiral.shape, PRESETS.spiral.structure, 16);
    expect(tex.image.width).toBe(16);
    expect(tex.image.data).toBeInstanceOf(Uint16Array);
  });
});
