/*
 * Scalar, angle and stick maths shared by the simulation, camera and input.
 * No DOM, no WebGL — safe to import from tests.
 */

export const TAU = Math.PI * 2;


export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }

/** Frame-rate independent exponential smoothing: 0 = no move, 1 = snap. */
export function smoothing(rate, dt) { return 1 - Math.exp(-rate * dt); }

/** Shortest signed angular distance from a to b, in (-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Rotate a local (x, z) offset around the Y axis by `yaw` (yaw 0 faces +Z). */
export function rotateY(x, z, yaw) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  return [x * c + z * s, -x * s + z * c];
}

/**
 * Turn a stick reading into a world heading, relative to where the camera is
 * looking: pushing up means "away from the camera", left means "camera left".
 * `sy` is positive up. Returns null inside the dead zone.
 */
export function stickToHeading(sx, sy, camYaw, deadZone) {
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
