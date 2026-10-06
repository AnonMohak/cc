import * as THREE from 'three';
import { armPhase, crest, barAngle, smoothstep } from './densityModel.js';
import { clampShape, clampStructure } from './params.js';

/**
 * Baked in-plane fields of a galaxy disc, in the PATTERN frame.
 *
 * The density-wave pattern only turns rigidly (φ(a) gets `phase·patternSpeed`
 * added), so everything that depends on the arms can be computed once here
 * and sampled by the volume shader at the position rotated by
 * −phase·patternSpeed. This replaces ~1,000 ops of arm/dust maths per raymarch
 * step with one texture fetch. Rebuilt only when shape or structure changes.
 *
 * Channels (half float):
 *   R = in-plane emission: disc × arms (× (1 − bulge share) × DISC_I) + bar × BAR_I
 *   G = arm-crest strength (0 = between arms / no arms, 1 = on a crest), for colour
 *   B = dust surface density, with lanes on the inner arm edges
 */

/** Half-extent of the map in unit space; covers every volume box. */
export const DISC_MAP_EXTENT = 1.45;
export const DISC_MAP_SIZE = 256;

// Must match the volume shader's emission scales.
export const DISC_I = 4.2;
export const BAR_I = 6.0;

/** In-plane fields at one point (pattern frame). Pure. */
export function discFields(x, z, shape, structure) {
  const R = Math.hypot(x, z);
  const theta = Math.atan2(z, x);
  const { arms, armWinding: winding, eccentricity, armContrast } = structure;
  const hasArms = (arms >= 0.5 ? 1 : 0) * Math.min(1, Math.max(0, eccentricity / 0.08));

  // Disc: exponential, smoothly truncated, modulated by the arm crest.
  let disc = Math.exp(-R / shape.discScale) * (1 - smoothstep(0.95, 1.3, R));
  let c = 0;
  if (hasArms > 0) {
    c = crest(armPhase(theta, R, arms, winding, 0, 0), winding);
    const armMask = smoothstep(shape.barLength * 0.7, shape.barLength + 0.12, R);
    disc *= mix(1, 0.35 + 2.2 * Math.pow(c, 2.5), armContrast * hasArms * armMask);
  }

  // Bar: elongated, along the pattern-frame bar axis.
  let bar = 0;
  if (shape.barLength > 0) {
    const ang = barAngle(shape.barLength, arms, winding, 0, 0);
    const along = x * Math.cos(ang) + z * Math.sin(ang);
    const across = -x * Math.sin(ang) + z * Math.cos(ang);
    bar = Math.exp(-Math.pow(Math.abs(along) / shape.barLength, 4)) * Math.exp((-across * across) / 0.004);
  }

  // Dust: exponential, empty bulge, concentrated on the inner (concave) arm edge.
  let dust = Math.exp(-R / (shape.discScale * 1.3)) * smoothstep(shape.bulgeSize * 0.5, shape.bulgeSize * 1.8, R);
  if (arms > 0.5) {
    const sgn = winding < 0 ? -1 : 1;
    const lane = Math.pow(crest(armPhase(theta, R, arms, winding, 0, 0) - 0.6 * sgn, winding), 4);
    dust *= mix(1, 0.15 + 2.2 * lane, armContrast);
  }

  return {
    emission: (1 - shape.bulgeFraction) * DISC_I * disc + BAR_I * bar,
    crest: c * hasArms,
    dust,
  };
}

/**
 * Bake the fields into a Float32Array (RGBA, size² texels). Pure.
 * Texel (i, j) covers x = (i + 0.5)/size·2E − E, z likewise with j.
 */
export function bakeDiscFields(shapeInput, structureInput, size = DISC_MAP_SIZE) {
  const shape = clampShape(shapeInput);
  const structure = clampStructure(structureInput);
  const data = new Float32Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    const z = ((j + 0.5) / size) * 2 * DISC_MAP_EXTENT - DISC_MAP_EXTENT;
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size) * 2 * DISC_MAP_EXTENT - DISC_MAP_EXTENT;
      const f = discFields(x, z, shape, structure);
      const k = (j * size + i) * 4;
      data[k] = f.emission;
      data[k + 1] = f.crest;
      data[k + 2] = f.dust;
      data[k + 3] = 1;
    }
  }
  return data;
}

/** GPU texture for the baked fields (half float: filterable on WebGL 2). */
export function createDiscMapTexture(shape, structure, size = DISC_MAP_SIZE) {
  const floats = bakeDiscFields(shape, structure, size);
  const half = new Uint16Array(floats.length);
  for (let i = 0; i < floats.length; i++) half[i] = THREE.DataUtils.toHalfFloat(floats[i]);
  const tex = new THREE.DataTexture(half, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function mix(a, b, t) {
  return a + (b - a) * t;
}
