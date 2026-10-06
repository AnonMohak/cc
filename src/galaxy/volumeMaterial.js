import * as THREE from 'three';
import { glsl, CHUNKS } from './shaders/glsl.js';
import starsChunk from './shaders/chunks/stars.glsl?raw';
import volumeVert from './shaders/volume.vert.glsl?raw';
import volumeFrag from './shaders/volume.frag.glsl?raw';

/**
 * Raymarched galaxy body. Output is (emitted light, transmittance), blended
 * as  dst = src.rgb + dst · src.a  so dust dims everything drawn behind it
 * (starfield, farther galaxies) while the body adds its own glow.
 *
 * Rendered on the BACK faces of its box so it still works with the camera
 * inside the galaxy.
 *
 * @param {ReturnType<typeof import('./galaxyUniforms.js').createGalaxyUniforms>} uniforms shared, by reference
 */
export function createVolumeMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: volumeVert,
    fragmentShader: glsl(CHUNKS.model, CHUNKS.noise, starsChunk, volumeFrag),
    uniforms,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.SrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}
