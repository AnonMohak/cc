import * as THREE from 'three';
import { glsl, CHUNKS } from './shaders/glsl.js';
import starsChunk from './shaders/chunks/stars.glsl?raw';
import consumeChunk from './shaders/chunks/consume.glsl?raw';
import streamVert from './shaders/stream.vert.glsl?raw';
import starsVert from './shaders/stars.vert.glsl?raw';
import starsFrag from './shaders/stars.frag.glsl?raw';
import hiiVert from './shaders/hii.vert.glsl?raw';
import hiiFrag from './shaders/hii.frag.glsl?raw';
import supernovaVert from './shaders/supernova.vert.glsl?raw';
import supernovaFrag from './shaders/supernova.frag.glsl?raw';
import jetVert from './shaders/jet.vert.glsl?raw';
import jetFrag from './shaders/jet.frag.glsl?raw';
import { SHADOW_B, DISC_INNER } from './blackHole.js';

const additive = {
  blending: THREE.AdditiveBlending,
  // depthWrite on additive points draws black squares over stars behind.
  depthWrite: false,
  transparent: true,
};

/**
 * @param {ReturnType<typeof import('./galaxyUniforms.js').createGalaxyUniforms>} uniforms shared, by reference
 * @param {{ afterLens?: boolean }} [options] afterLens: the stars in front of a
 *   winning black hole, drawn after the lens pass (consume.glsl cs_afterLens)
 */
export function createStarMaterial(uniforms, { afterLens = false } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: glsl(CHUNKS.model, starsChunk, consumeChunk, starsVert),
    fragmentShader: starsFrag,
    uniforms,
    defines: afterLens ? { AFTER_LENS: '' } : {},
    ...additive,
  });
}

/**
 * The gold stream off a victim black hole (stream.vert.glsl). `uniforms`:
 * uStreamPos, uHot, uCool, uGain, uPixelRatio, uMaxPointPx, uHoleWorld,
 * uSplit (the caller shares them between the two layers).
 * @param {object} uniforms
 * @param {{ afterLens?: boolean }} [options]
 */
export function createStreamMaterial(uniforms, { afterLens = false } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: glsl(consumeChunk, streamVert),
    fragmentShader: starsFrag,
    uniforms,
    defines: afterLens ? { AFTER_LENS: '' } : {},
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

/** @param {ReturnType<typeof import('./galaxyUniforms.js').createGalaxyUniforms>} uniforms shared, by reference */
export function createSupernovaMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: glsl(CHUNKS.model, starsChunk, supernovaVert),
    fragmentShader: glsl(CHUNKS.spikes, supernovaFrag),
    uniforms,
    ...additive,
  });
}

/** @param {ReturnType<typeof import('./galaxyUniforms.js').createGalaxyUniforms>} uniforms shared, by reference */
export function createJetMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: jetVert,
    fragmentShader: jetFrag,
    uniforms,
    defines: { SHADOW_B: SHADOW_B.toFixed(4), DISC_INNER: DISC_INNER.toFixed(4) },
    side: THREE.DoubleSide,
    ...additive,
    // Drawn by JetPass into the composer buffer, whose depth is stale: the
    // jet hides behind the hole's shadow in its own shader instead.
    depthTest: false,
  });
}
