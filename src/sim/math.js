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
 * Turn a stick push into a turn rate: -1 turns as hard as the snake can toward the
 * RIGHT of the screen, +1 toward the left, 0 holds the line.
 *
 * This is a rate, not a heading to settle on: a sideways push keeps turning for as
 * long as it is held, which is what the stick is expected to feel like. There is
 * therefore no camera yaw involved — the stick is read in screen space, and pushing
 * right turns right whichever way the snake happens to face.
 *
 * Sign: the simulation's positive rotation goes toward world +X, which is the LEFT
 * of the screen, because a three.js camera looks down its local -Z (measured, not
 * derived — see CLAUDE.md). So a push to the right yields a NEGATIVE steer.
 *
 * How far off straight-ahead the push is sets how hard it turns, and how far out the
 * stick is pushed scales that, so a nudge curves and a full push carves. Returns 0
 * inside the dead zone.
 */
export function stickTurn(sx, sy, opts) {
  const cfg = opts || {};
  const dead = cfg.deadZone === undefined ? 0.24 : cfg.deadZone;
  const magnitude = Math.hypot(sx, sy);
  if (magnitude < dead) return 0;
  // Rescale so the usable range starts at the dead zone edge, not at zero.
  const strength = clamp((magnitude - dead) / (1 - dead), 0, 1);
  const angle = Math.atan2(sx, sy);        // 0 = straight up the screen, + = right
  return clamp(-angle / (Math.PI / 2), -1, 1) * strength;
}
