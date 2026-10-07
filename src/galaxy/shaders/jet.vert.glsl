// AGN jets: two strips along the accretion-disc axis (uJetAxis, galaxy-local)
// that turn about the axis to face the camera. Needs uCameraLocal (stars.glsl uniforms are not
// included: this shader declares what it uses).
uniform vec3 uCameraLocal;
uniform vec3 uJetAxis; // unit
uniform float uJetLength; // unit-disc units
uniform float uJetRs; // black-hole Rs, unit-disc units
uniform float uViewHeight; // viewport height, CSS px

attribute float aSide; // +1 north jet, -1 south jet

varying vec2 vJet; // x: across (−1..1), y: along (0 base .. 1 tip)
varying float vEnergy;

// Never thinner than this on screen, or a far jet flickers as a broken line.
const float MIN_WIDTH_PX = 1.5;

void main() {
  float s = position.y; // 0..1 along the jet
  vec3 axisP = uJetAxis * (aSide * (uJetRs * 3.0 + s * uJetLength));
  // Collimated near the hole, slowly widening (half-width in Rs).
  float width = uJetRs * mix(1.0, 3.0, s);
  vec4 mvAxis = modelViewMatrix * vec4(axisP, 1.0);
  float scale = length(modelMatrix[0].xyz); // galaxy radius
  float pxLocal = -mvAxis.z / (projectionMatrix[1][1] * uViewHeight * 0.5) / scale;
  float minWidth = MIN_WIDTH_PX * pxLocal;
  // A widened strip carries the same total light.
  vEnergy = width / max(width, minWidth);
  width = max(width, minWidth);

  vec3 toCam = uCameraLocal - axisP;
  vec3 side = cross(uJetAxis, toCam);
  float sideLen = length(side);
  // Looking straight down the axis the strip has no width: fade it out.
  vEnergy *= smoothstep(0.0, 0.15, sideLen / max(length(toCam), 1e-6));
  side = sideLen > 1e-6 ? side / sideLen : vec3(1.0, 0.0, 0.0);
  vec3 p = axisP + side * position.x * 2.0 * width;
  vJet = vec2(position.x * 2.0, s);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
