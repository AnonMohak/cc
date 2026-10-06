import * as THREE from 'three';
import vertexShader from './shaders/galaxy.vert.glsl?raw';
import fragmentShader from './shaders/dust.frag.glsl?raw';

/**
 * Dust-lane material. Reuses the star vertex shader and SHARES the rotation
 * and scale uniform objects with the star material, so dust always turns
 * with its stars without extra per-frame work.
 *
 * @param {THREE.ShaderMaterial} starMaterial
 */
export function createDustMaterial(starMaterial) {
  const s = starMaterial.uniforms;
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uPhase: s.uPhase,
      uDifferential: s.uDifferential,
      uScale: s.uScale,
      uPixelRatio: s.uPixelRatio,
      uSize: { value: 1 },
      uOpacity: { value: 0.6 },
    },
    // Normal blending darkens what is behind it; additive could not.
    blending: THREE.NormalBlending,
    depthWrite: false,
    transparent: true,
  });
}
