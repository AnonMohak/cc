uniform vec3 uBoxHalf;

// Box surface point in galaxy unit space (the mesh is a ±1 cube scaled by uBoxHalf).
varying vec3 vUnitPos;

void main() {
  vUnitPos = position * uBoxHalf;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
