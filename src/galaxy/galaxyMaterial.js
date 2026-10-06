import * as THREE from 'three';
import vertexShader from './shaders/galaxy.vert.glsl?raw';
import fragmentShader from './shaders/galaxy.frag.glsl?raw';

export function createGalaxyMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uPhase: { value: 0 },
      uDifferential: { value: 0.25 },
      uSize: { value: 1 },
      uScale: { value: 1 },
      uPixelRatio: { value: 1 },
      uBrightness: { value: 1 },
      uColorInner: { value: new THREE.Color() },
      uColorOuter: { value: new THREE.Color() },
    },
    blending: THREE.AdditiveBlending,
    // depthWrite on additive points draws black squares over stars behind.
    depthWrite: false,
    transparent: true,
  });
}
