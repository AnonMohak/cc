import * as THREE from 'three';
import { LAYERS } from '../core/layers.js';
import { SHADOW_B, MARCH_INNER } from './blackHole.js';

/**
 * Invisible stand-ins for depth of field (core/DepthOfFieldPass.js). Stars
 * and volumes write no depth, so each object draws a low-poly ellipsoid that
 * writes the object's CENTRE view distance (not the surface): the whole
 * object then has one focus distance, and the selected one stays sharp even
 * when the camera is inside it. Galaxies share one geometry and material
 * (never disposed, like the shared noise texture); a black hole has its own
 * material (disposeDofProxy).
 */

/** Impact parameter (Rs) inside which a black hole pixel is always the hole: the photon ring and the inner arches. */
export const HOLE_CORE_B = 2.5 * SHADOW_B;

let geometry = null;
let material = null;

const centreDepthVertex = /* glsl */ `
  varying float vCenterDepth;
  varying vec3 vWorld;
  varying vec3 vCenter;
  varying vec3 vAxis;
  varying float vScale;
  void main() {
    vCenterDepth = -(modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vAxis = normalize((modelMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    vScale = length(modelMatrix[0].xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

function sharedGeometry() {
  geometry ??= new THREE.SphereGeometry(1, 16, 8);
  return geometry;
}

function shared() {
  if (material) return { geometry: sharedGeometry(), material };
  material = new THREE.ShaderMaterial({
    vertexShader: centreDepthVertex,
    fragmentShader: /* glsl */ `
      varying float vCenterDepth;
      void main() {
        gl_FragColor = vec4(vCenterDepth, 0.0, 0.0, 1.0);
      }`,
    // Both sides: the camera may be inside the proxy (inside a galaxy).
    side: THREE.DoubleSide,
  });
  return { geometry: sharedGeometry(), material };
}

/**
 * A black hole's proxy writes the hole's depth only where the lens shows the
 * hole: the near disc, the far disc bent over and under the shadow (one bend
 * of 2 Rs / b at closest approach, the weak-field deflection), and the core
 * around the shadow (HOLE_CORE_B: photon ring, inner arches). Elsewhere it
 * discards, so the background seen through the lens keeps the far depth and
 * blurs (a whole sphere left a sharp ring of background around a focused
 * hole, and a sharp piece of the lens streak).
 */
function createHoleMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: centreDepthVertex,
    fragmentShader: /* glsl */ `
      uniform float uRs; // Rs in proxy-local units
      uniform float uDiscOuter; // disc outer radius (Rs)
      varying float vCenterDepth;
      varying vec3 vWorld;
      varying vec3 vCenter;
      varying vec3 vAxis;
      varying float vScale;
      const float SHADOW_B = ${SHADOW_B.toFixed(4)};
      const float CORE_B = ${HOLE_CORE_B.toFixed(4)};
      const float DISC_INNER = ${MARCH_INNER.toFixed(4)};

      // Whether the ray o + t·d (t in (0, tMax)) crosses the disc annulus.
      bool hitsDisc(vec3 o, vec3 d, float tMax, float rs) {
        float dn = dot(d, vAxis);
        if (abs(dn) < 1e-5) return false;
        float t = dot(vCenter - o, vAxis) / dn;
        if (t <= 0.0 || t >= tMax) return false;
        float r = length(o + d * t - vCenter) / rs;
        return r > DISC_INNER * 0.8 && r < uDiscOuter * 1.05;
      }

      void main() {
        float rs = uRs * vScale;
        vec3 rd = normalize(vWorld - cameraPosition);
        vec3 oc = vCenter - cameraPosition;
        float tc = dot(oc, rd);
        vec3 p0 = cameraPosition + rd * tc; // closest approach
        float b = length(p0 - vCenter) / rs;
        bool hole = b < CORE_B;
        // The near disc, before the closest approach.
        hole = hole || hitsDisc(cameraPosition, rd, max(tc, 0.0), rs);
        // The far disc, after one bend toward the hole.
        if (!hole && tc > 0.0) {
          float bend = min(2.0 / max(b, SHADOW_B), 1.2);
          vec3 toward = normalize(vCenter - p0);
          vec3 d2 = normalize(rd * cos(bend) + toward * sin(bend));
          hole = hitsDisc(p0, d2, 1e9, rs);
        }
        if (!hole) discard;
        gl_FragColor = vec4(vCenterDepth, 0.0, 0.0, 1.0);
      }`,
    uniforms: { uRs: { value: 0.05 }, uDiscOuter: { value: 18 } },
    // Both sides: the camera may be inside the proxy (close to the hole).
    side: THREE.DoubleSide,
  });
}

/**
 * A proxy mesh in the object's local (unit) space, on layer DOF.
 * @param {boolean} blackHole a standalone black hole (round star cloud) or a galaxy disc
 */
export function createDofProxy(blackHole) {
  const mesh = blackHole ? new THREE.Mesh(sharedGeometry(), createHoleMaterial()) : new THREE.Mesh(shared().geometry, shared().material);
  // Galaxies: a flattened disc ellipsoid. Black holes: a sphere that
  // setDofProxyHole sizes to just past the accretion disc.
  if (blackHole) mesh.scale.setScalar(1);
  else mesh.scale.set(1.1, 0.3, 1.1);
  mesh.layers.set(LAYERS.DOF);
  return mesh;
}

/**
 * Size a black hole's proxy and set its lens test: rsUnit = Rs in the
 * object's unit space, discSize = disc outer radius in Rs.
 * @param {THREE.Mesh} mesh
 */
export function setDofProxyHole(mesh, rsUnit, discSize) {
  // Just past the disc (the far disc's lensed image reaches a little wider).
  const scale = Math.min(1, rsUnit * discSize * 1.4);
  mesh.scale.setScalar(scale);
  mesh.material.uniforms.uRs.value = rsUnit / Math.max(scale, 1e-6);
  mesh.material.uniforms.uDiscOuter.value = discSize;
}

/** Dispose what a proxy owns (a black hole's material; the shared ones stay). */
export function disposeDofProxy(mesh) {
  if (mesh.material !== material) mesh.material.dispose();
}
