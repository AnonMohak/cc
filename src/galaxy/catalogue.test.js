import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CATALOGUE, CATALOGUE_IDS, catalogueParams, radiusForDiameter, formatLightYears, tiltForInclination, catalogueViewDirection } from './catalogue.js';
import { PRESETS } from './presets.js';
import { clampShape, clampStructure, clampLook, clampMotion } from './params.js';

describe('CATALOGUE', () => {
  it('lists the six planned real galaxies', () => {
    expect(CATALOGUE_IDS.sort()).toEqual(['lmc', 'm101', 'm104', 'm31', 'm51', 'm87']);
  });

  it.each(CATALOGUE_IDS)('%s has complete facts and a valid base preset', (id) => {
    const c = CATALOGUE[id];
    expect(PRESETS[c.preset]).toBeDefined();
    for (const key of ['name', 'type', 'constellation', 'fact']) expect(c[key]).toMatch(/\S/);
    expect(c.distanceLy).toBeGreaterThan(0);
    expect(c.diameterLy).toBeGreaterThan(0);
    expect(c.inclination).toBeGreaterThanOrEqual(0);
    expect(c.inclination).toBeLessThanOrEqual(90);
  });

  it.each(CATALOGUE_IDS)('%s params are already within limits (clamping changes nothing)', (id) => {
    const p = catalogueParams(id);
    expect(clampShape(p.shape)).toEqual(p.shape);
    expect(clampStructure(p.structure)).toEqual(p.structure);
    expect(clampMotion(p.motion)).toEqual(p.motion);
    expect(clampLook({ ...p.look, position: [0, 0, 0] })).toEqual({ ...p.look, position: [0, 0, 0] });
  });

  it.each(CATALOGUE_IDS)('%s shows its real inclination from the home view', (id) => {
    const tilt = THREE.MathUtils.degToRad(catalogueParams(id).look.tiltX);
    const normal = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(tilt, 0, 0));
    const angle = THREE.MathUtils.radToDeg(normal.angleTo(catalogueViewDirection()));
    expect(Math.abs(angle - CATALOGUE[id].inclination)).toBeLessThanOrEqual(1);
  });

  it('a face-on galaxy faces the home camera', () => {
    expect(tiltForInclination(0)).toBeGreaterThan(55);
  });

  it('returns null for unknown ids', () => {
    expect(catalogueParams('nope')).toBeNull();
  });
});

describe('radiusForDiameter', () => {
  it('keeps relative sizes and clamps small and huge galaxies', () => {
    expect(radiusForDiameter(170_000)).toBeGreaterThan(radiusForDiameter(76_000));
    expect(radiusForDiameter(14_000)).toBe(2.5);
    expect(radiusForDiameter(10_000_000)).toBe(12);
  });
});

describe('formatLightYears', () => {
  it('formats millions and thousands', () => {
    expect(formatLightYears(2.5e6)).toBe('2.5 million ly');
    expect(formatLightYears(53e6)).toBe('53 million ly');
    expect(formatLightYears(160_000)).toBe('160,000 ly');
  });
});
