/*
 * Minimal 3D math helpers (column-major 4x4 matrices, WebGL convention).
 * Dependency free so it works in the browser and under plain node (for tests).
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.M3 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TAU = Math.PI * 2;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /** Frame-rate independent exponential smoothing: 0 = no move, 1 = snap. */
  function smoothing(rate, dt) { return 1 - Math.exp(-rate * dt); }

  /** Shortest signed angular distance from a to b, in (-PI, PI]. */
  function angleDelta(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  function mat4() { return new Float32Array(16); }

  function identity(o) {
    o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  }

  /** o = a * b */
  function multiply(o, a, b) {
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      o[c * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return o;
  }

  function perspective(o, fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    identity(o);
    o[0] = f / aspect;
    o[5] = f;
    o[10] = (far + near) * nf;
    o[11] = -1;
    o[14] = 2 * far * near * nf;
    o[15] = 0;
    return o;
  }

  function lookAt(o, eye, target, up) {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len; zy /= len; zz /= len;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz);
    if (len < 1e-6) { xx = 1; xy = 0; xz = 0; } else { xx /= len; xy /= len; xz /= len; }

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
    o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
    o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
    o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    o[15] = 1;
    return o;
  }

  /** Rotate a local offset around the Y axis by `yaw` (yaw 0 faces +Z). */
  function rotateY(x, z, yaw) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    return [x * c + z * s, -x * s + z * c];
  }

  /**
   * Turn a stick reading into a world heading, relative to where the camera is
   * looking: pushing up means "away from the camera", left means "camera left".
   * `sy` is positive up. Returns null inside the dead zone.
   */
  function stickToHeading(sx, sy, camYaw, deadZone) {
    const dead = deadZone === undefined ? 0.24 : deadZone;
    const magnitude = Math.hypot(sx, sy);
    if (magnitude < dead) return null;
    // Rescale so the usable range starts at the dead zone edge, not at zero.
    const strength = clamp((magnitude - dead) / (1 - dead), 0, 1);
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = fz, rz = -fx;                       // camera right, on the ground plane
    let x = fx * (sy / magnitude) + rx * (sx / magnitude);
    let z = fz * (sy / magnitude) + rz * (sx / magnitude);
    const len = Math.hypot(x, z) || 1;
    return { x: x / len, z: z / len, strength };
  }

  /** Hex string or 0xRRGGBB to a [r,g,b] triple in 0..1. */
  function color(hex) {
    const n = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /** Blend two [r,g,b] triples. */
  function mixColor(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }

  return {
    TAU, clamp, lerp, smoothing, angleDelta, rotateY, stickToHeading, color, mixColor,
    mat4, identity, multiply, perspective, lookAt,
  };
});
