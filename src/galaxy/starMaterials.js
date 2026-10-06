import * as THREE from 'three';
import { glsl, CHUNKS } from './shaders/glsl.js';
import starsChunk from './shaders/chunks/stars.glsl?raw';
import starsVert from './shaders/stars.vert.glsl?raw';
import starsFrag from './shaders/stars.frag.glsl?raw';
import hiiVert from './shaders/hii.vert.glsl?raw';
import hiiFrag from './shaders/hii.frag.glsl?raw';

const additive = {
  blending: THREE.AdditiveBlending,
  // depthWrite on additive points draws black squares over stars behind.
  depthWrite: false,
  transparent: true,
};

/** @param {ReturnType<typeof import('./galaxyUniforms.js').createGalaxyUniforms>} uniforms shared, by reference */
export function createStarMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: glsl(CHUNKS.model, starsChunk, starsVert),
    fragmentShader: starsFrag,
    uniforms,
    ...additive,
  });
}

/** @param {ReturnType<typeof import('./galaxyUniforms.js').createGalaxyUniforms>} uniforms shared, by reference */
export function createHiiMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: glsl(CHUNKS.model, starsChunk, hiiVert),
    fragmentShader: hiiFrag,
    uniforms,
    ...additive,
  });
}
