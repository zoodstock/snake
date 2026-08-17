/*
 * Test double for three.js.
 *
 * It models only the surface src/render/renderer.js touches, and asserts the
 * things a real GPU accepts silently: non-finite matrices, zero scales, colours
 * that are not 0xRRGGBB, and writes past an InstancedMesh's capacity.
 *
 * This tests OUR renderer, not three.js. If the renderer starts using a three.js
 * API that is missing here, this stub throws — add the API rather than assuming
 * the renderer is broken.
 */
export const PCFSoftShadowMap = 'PCFSoftShadowMap';
export const SRGBColorSpace = 'srgb';
export const RepeatWrapping = 'repeat';
export const AdditiveBlending = 'additive';
export const DynamicDrawUsage = 'dynamic';

export const stats = { renders: 0, matrices: 0, colors: 0, maxIndex: {} };

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
export class Vector3 extends V3 {}
export class Euler extends V3 { }
export class Quaternion {
  constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; }
  setFromEuler(e) {
    const h = e.y / 2;
    this.x = 0; this.y = Math.sin(h); this.z = 0; this.w = Math.cos(h);
    return this;
  }
}
export class Matrix4 {
  constructor() { this.elements = new Array(16).fill(0); this.elements[0] = this.elements[5] = this.elements[10] = this.elements[15] = 1; }
  compose(pos, quat, scale) {
    if (![pos.x, pos.y, pos.z, scale.x, scale.y, scale.z, quat.y, quat.w].every(Number.isFinite)) {
      throw new Error('compose got a non-finite value: pos=' + JSON.stringify(pos) + ' scale=' + JSON.stringify(scale));
    }
    if (scale.x === 0 || scale.y === 0 || scale.z === 0) throw new Error('zero scale instance');
    this.elements[12] = pos.x; this.elements[13] = pos.y; this.elements[14] = pos.z;
    this.elements[0] = scale.x; this.elements[5] = scale.y; this.elements[10] = scale.z;
    return this;
  }
}
export class Color {
  constructor(hex) { if (hex !== undefined) this.set(hex); }
  set(hex) {
    if (typeof hex !== 'number' || !Number.isInteger(hex) || hex < 0 || hex > 0xffffff) {
      throw new Error('Color.set expects 0xRRGGBB, got ' + JSON.stringify(hex));
    }
    this.hex = hex;
    return this;
  }
}
export class Fog { constructor(color, near, far) { Object.assign(this, { color, near, far }); } }
export class Scene {
  constructor() { this.children = []; }
  add(o) { if (!o) throw new Error('Scene.add(undefined)'); this.children.push(o); }
}
export class PerspectiveCamera {
  constructor(fov, aspect, near, far) {
    Object.assign(this, { fov, aspect, near, far });
    this.position = new Vector3();
    this.looks = 0;
  }
  lookAt(x, y, z) {
    if (![x, y, z].every(Number.isFinite)) throw new Error('camera.lookAt got NaN');
    this.looks++;
  }
  updateProjectionMatrix() { this.projectionUpdates = (this.projectionUpdates || 0) + 1; }
}
class Light { constructor() { this.position = new Vector3(); } }
export class HemisphereLight extends Light {}
export class DirectionalLight extends Light {
  constructor() {
    super();
    this.shadow = {
      mapSize: { set() {} },
      camera: { updateProjectionMatrix() {} },
    };
    this.target = { position: new Vector3(), updateMatrixWorld() {} };
  }
}
class Geometry { dispose() { this.disposed = true; } }
export class BoxGeometry extends Geometry {}
export class PlaneGeometry extends Geometry { constructor(w, h) { super(); this.w = w; this.h = h; } }
class Material { constructor(opts = {}) { Object.assign(this, opts); } }
export class MeshLambertMaterial extends Material {}
export class MeshBasicMaterial extends Material {}
export class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry; this.material = material;
    this.rotation = new Vector3(); this.position = new Vector3();
  }
}
export class InstancedMesh extends Mesh {
  constructor(geometry, material, capacity) {
    super(geometry, material);
    if (!Number.isInteger(capacity) || capacity <= 0) throw new Error('bad InstancedMesh capacity');
    this.capacity = capacity;
    this.count = 0;
    this.instanceColor = null;
    this.instanceMatrix = { setUsage() {}, needsUpdate: false };
    this._label = material instanceof MeshBasicMaterial ? 'basic' : 'lambert';
  }
  setMatrixAt(i, m) {
    if (i >= this.capacity) throw new Error('setMatrixAt past capacity: ' + i + ' >= ' + this.capacity);
    if (!m.elements.every(Number.isFinite)) throw new Error('matrix has non-finite elements');
    stats.matrices++;
  }
  setColorAt(i, c) {
    if (i >= this.capacity) throw new Error('setColorAt past capacity');
    if (!(c instanceof Color)) throw new Error('setColorAt needs a Color');
    this.instanceColor = this.instanceColor || { needsUpdate: false };
    stats.colors++;
  }
}
export class CanvasTexture {
  constructor(canvas) {
    if (!canvas || !canvas.getContext) throw new Error('CanvasTexture needs a canvas');
    this.repeat = { set() {} };
  }
}
export class WebGLRenderer {
  constructor(opts) {
    if (!opts || !opts.canvas) throw new Error('WebGLRenderer needs a canvas');
    this.shadowMap = {};
  }
  setPixelRatio(r) { if (!Number.isFinite(r) || r <= 0) throw new Error('bad pixel ratio'); this.dpr = r; }
  setSize(w, h) {
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error('bad size');
    this.size = [w, h];
  }
  render(scene, camera) {
    if (!scene || !camera) throw new Error('render needs a scene and camera');
    stats.renders++;
  }
}
