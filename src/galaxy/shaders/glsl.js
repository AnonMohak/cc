import model from './chunks/model.glsl?raw';
import noise from './chunks/noise.glsl?raw';
import spikes from './chunks/spikes.glsl?raw';

/** Shared GLSL chunks, prepended to shaders that need them. */
export const CHUNKS = { model, noise, spikes };

/** Join GLSL parts (chunks first, then the shader body). */
export function glsl(...parts) {
  return parts.join('\n');
}
