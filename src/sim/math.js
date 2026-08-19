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
 * Turn a stick push into a world heading for the snake to hold on to.
 *
 * Reading the stick against the live camera every frame cannot ever settle: the
 * chase camera swings in behind the snake as it turns, so the target swings with
 * it, and anything but a straight-up push circles forever. The camera yaw is
 * therefore sampled when the push starts and held while the thumb sits still, so
 * the snake reaches the direction you pointed at and stays on it. Moving the thumb
 * more than `repoint` re-aims against the view actually on screen, which is what
 * keeps steering continuous rather than one-shot.
 *
 * `prev` is what this returned last frame, or null when the stick was at rest.
 * Returns null inside the dead zone, which also re-arms the next push.
 */
export function stickHeading(prev, sx, sy, camYaw, opts) {
  const cfg = opts || {};
  const dead = cfg.deadZone === undefined ? 0.24 : cfg.deadZone;
  const repoint = cfg.repoint === undefined ? 0.21 : cfg.repoint;   // ~12 degrees
  const magnitude = Math.hypot(sx, sy);
  if (magnitude < dead) return null;
  // Rescale so the usable range starts at the dead zone edge, not at zero.
  const strength = clamp((magnitude - dead) / (1 - dead), 0, 1);
  // Screen right is world -X when the camera looks along +Z, not +X: a three.js
  // camera looks down its local -Z, so the handedness flips the sideways axis.
  // Measured by projecting world axes with the real camera — see CLAUDE.md. Hence
  // the heading is camYaw MINUS the stick angle; getting this backwards is what
  // made the snake veer the wrong way.
  const angle = Math.atan2(sx, sy);        // 0 = straight up the screen, + = right
  const yawFor = (ref, a) => ref - a;
  if (prev && Math.abs(angleDelta(prev.angle, angle)) <= repoint) {
    // Thumb held: keep the frozen angle too, so the heading does not creep.
    return { refYaw: prev.refYaw, angle: prev.angle, yaw: yawFor(prev.refYaw, prev.angle), strength };
  }
  return { refYaw: camYaw, angle, yaw: yawFor(camYaw, angle), strength };
}
