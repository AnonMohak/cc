import * as THREE from 'three';
import { clampShape, clampStructure, clampLook, clampMotion } from './params.js';
import { getNoiseTexture } from './noiseTexture.js';
import { bandFor } from './bands.js';

/**
 * One uniform set per galaxy, shared BY REFERENCE between the star, H II and
 * volume materials, so a single write updates every layer.
 */
export function createGalaxyUniforms() {
  const u = {
    // Motion
    uPhase: { value: 0 },
    uSnTime: { value: 0 }, // galaxy simulation time, for supernova flashes
    uSpikeStyle: { value: 0 }, // diffraction spikes: 0 off, 1 Hubble, 2 JWST
    uDifferential: { value: 0.6 },
    uPatternSpeed: { value: 0.3 },
    // Structure
    uArms: { value: 2 },
    uWinding: { value: 0.55 },
    uEccentricity: { value: 0.2 },
    uArmContrast: { value: 0.7 },
    uFlocculence: { value: 0.45 },
    uDustStrength: { value: 1 },
    uGlow: { value: 1 },
    uBulgeSersic: { value: 2.5 },
    // Shape (set on rebuild)
    uBar: { value: 0 },
    uDiscScale: { value: 0.3 },
    uDiscThickness: { value: 0.022 },
    uBulgeSize: { value: 0.09 },
    uBulgeFlatten: { value: 0.7 },
    uBulgeFraction: { value: 0.16 },
    uBoxHalf: { value: new THREE.Vector3(1.3, 0.3, 1.3) },
    // Volume march bounds (densityModel.js marchBounds)
    uDiscHalfHeight: { value: 0.2 },
    uDiscRadius: { value: 1.3 },
    uBulgeRadii: { value: new THREE.Vector3(0.2, 0.15, 0.2) },
    uStepLength: { value: 0.05 },
    // Look
    uSize: { value: 1 },
    uScale: { value: 1 },
    uBrightness: { value: 1 },
    uPhysical: { value: 0.75 },
    uColorInner: { value: new THREE.Color() },
    uColorOuter: { value: new THREE.Color() },
    // Per-frame / environment
    uEmphasis: { value: 1 },
    uLodGain: { value: 1 }, // star LOD: fewer, brighter stars far away (lod.js starLod)
    uPixelRatio: { value: 1 },
    uCameraLocal: { value: new THREE.Vector3(0, 10, 0) },
    // Baked textures for the volume (see discMap.js, noiseTexture.js)
    uDiscMap: { value: null },
    uNoise: { value: getNoiseTexture() },
    // Volume quality (see settings.quality)
    uSteps: { value: 48 },
    uVolumeDust: { value: 1 },
    uMaxPointPx: { value: 14 },
    // Wavelength band (bands.js; applyBandUniforms)
    uBandDustPass: { value: 1 },
    uBandStarGain: { value: 1 },
    uBandStarKeep: { value: 1 },
    uBandStarColor: { value: new THREE.Matrix3() },
    uBandHiiGain: { value: 1 },
    uBandHiiColor: { value: new THREE.Color() },
    uBandHiiCore: { value: new THREE.Color() },
    uBandSnGain: { value: 1 },
    uBandDiscGain: { value: 1 },
    uBandDiscFalloff: { value: 0 },
    uBandBulgeGain: { value: 1 },
    uBandLightColor: { value: new THREE.Matrix3() },
    uBandGasColor: { value: new THREE.Color(0, 0, 0) },
    uBandGasHole: { value: 0 },
    uBandJetGain: { value: 1 },
    // Black hole jets (blackHole.js; Galaxy sets them)
    uJetRs: { value: 0 },
    uJetLength: { value: 0.22 },
    uJetDiscOuter: { value: 18 }, // accretion disc outer radius (Rs), for jet occlusion
    uViewHeight: { value: 800 },
  };
  applyBandUniforms(u, 'visible');
  return u;
}

/** @param {string} name settings.band (unknown → visible) */
export function applyBandUniforms(u, name) {
  const b = bandFor(name);
  u.uBandDustPass.value = b.dustPass;
  u.uBandStarGain.value = b.starGain;
  u.uBandStarKeep.value = b.starKeep;
  u.uBandStarColor.value.set(...b.starColor);
  u.uBandHiiGain.value = b.hiiGain;
  u.uBandHiiColor.value.setRGB(...b.hiiColor);
  u.uBandHiiCore.value.setRGB(...b.hiiCore);
  u.uBandSnGain.value = b.snGain;
  u.uBandDiscGain.value = b.discGain;
  u.uBandDiscFalloff.value = b.discFalloff;
  u.uBandBulgeGain.value = b.bulgeGain;
  u.uBandLightColor.value.set(...b.lightColor);
  u.uBandGasColor.value.setRGB(...b.gasColor);
  u.uBandGasHole.value = b.gasHole;
  u.uBandJetGain.value = b.jetGain;
}

export function applyShapeUniforms(u, shape) {
  const s = clampShape(shape);
  u.uBar.value = s.barLength;
  u.uDiscScale.value = s.discScale;
  u.uDiscThickness.value = s.discThickness;
  u.uBulgeSize.value = s.bulgeSize;
  u.uBulgeFlatten.value = s.bulgeFlatten;
  u.uBulgeFraction.value = s.bulgeFraction;
}

/** @param {number} dustScale global dust multiplier from settings */
export function applyStructureUniforms(u, structure, dustScale = 1) {
  const s = clampStructure(structure);
  u.uArms.value = s.arms;
  u.uWinding.value = s.armWinding;
  u.uEccentricity.value = s.eccentricity;
  u.uArmContrast.value = s.armContrast;
  u.uFlocculence.value = s.flocculence;
  u.uDustStrength.value = s.dustStrength * dustScale;
  u.uGlow.value = s.glow;
  u.uBulgeSersic.value = s.bulgeSersic;
}

export function applyLookUniforms(u, look) {
  const l = clampLook(look);
  u.uScale.value = l.radius;
  u.uSize.value = l.starSize;
  u.uBrightness.value = l.brightness;
  u.uPhysical.value = l.physicalColor;
  u.uColorInner.value.set(l.colorInner);
  u.uColorOuter.value.set(l.colorOuter);
  return l;
}

export function applyMotionUniforms(u, motion) {
  const m = clampMotion(motion);
  u.uDifferential.value = m.differential;
  u.uPatternSpeed.value = m.patternSpeed;
  return m;
}
