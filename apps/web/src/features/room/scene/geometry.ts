import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import {
  NORMAL_STEPS_PER_UNIT,
  POSITION_STEPS_PER_MM,
  type SceneGeometry,
  type Vec3,
} from './asset';

function bytesOf(base64: string): ArrayBuffer {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}

/** One mesh of the scene asset, dequantised into a three.js geometry in millimetres. */
export function decodeGeometry(source: SceneGeometry): BufferGeometry {
  const stepsP = new Int16Array(bytesOf(source.p));
  const stepsN = new Int8Array(bytesOf(source.n));
  const positions = Float32Array.from(stepsP, (step) => step / POSITION_STEPS_PER_MM);
  const normals = Float32Array.from(stepsN, (step) => step / NORMAL_STEPS_PER_UNIT);
  const indices = source.i32
    ? new Uint32Array(bytesOf(source.i))
    : new Uint16Array(bytesOf(source.i));

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

export const vec = (value: Vec3) => new Vector3(...value);

/** Centre and size of an axis-aligned box given by its corners. */
export function boxOf(min: Vec3, max: Vec3): { centre: Vector3; size: Vector3 } {
  const low = vec(min);
  const high = vec(max);
  return { centre: low.clone().add(high).multiplyScalar(0.5), size: high.sub(low) };
}
