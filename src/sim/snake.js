/*
 * Snake simulation: a head that drives forward and a body sampled from the
 * trail the head has left behind. Pure logic, no rendering, no DOM.
 */
import { TAU, clamp } from './math.js';
export const DEFAULTS = {
  x: 0, z: 0, yaw: 0,
  speed: 11.5,          // units / second while cruising
  boostSpeed: 19.5,
  turnRate: 2.7,        // radians / second at full steer
  boostTurnScale: 0.72, // boosting makes you less nimble
  spacing: 0.66,        // distance between body segments
  segments: 9,
  headRadius: 0.58,
  bodyRadius: 0.5,
};

export class Snake {
  constructor(opts) {
    Object.assign(this, DEFAULTS, opts || {});
    this.alive = true;
    this.boosting = false;
    this.currentSpeed = this.speed;
    this.steer = 0;
    this.dist = 0;
    this.phase = 0;       // slither animation phase
    this.trail = [];
    this.body = [];       // {x, z, yaw} per segment, index 0 nearest the head
    this._seedTrail();
    this.rebuildBody();
  }

  /** Lay a straight tail behind the head so a fresh snake is not a pile of cubes. */
  _seedTrail() {
    const back = this.bodyLength() + this.spacing * 2;
    const steps = Math.max(2, Math.ceil(back / 0.25));
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.trail.length = 0;
    for (let i = steps; i >= 0; i--) {
      const d = (i / steps) * back;
      this.trail.push({ x: this.x - fx * d, z: this.z - fz * d, d: -d });
    }
  }

  bodyLength() { return this.segments * this.spacing; }

  get forward() { return [Math.sin(this.yaw), Math.cos(this.yaw)]; }

  /**
   * Advance the head. `steer` is -1..1 (negative = left), `boost` a boolean.
   * The trail records where the head has been; the body samples from it.
   */
  update(dt, steer, boost) {
    this.steer = clamp(steer || 0, -1, 1);
    this.boosting = !!boost;
    this.currentSpeed = this.boosting ? this.boostSpeed : this.speed;

    const turn = this.turnRate * (this.boosting ? this.boostTurnScale : 1);
    this.yaw = (this.yaw + this.steer * turn * dt) % TAU;

    const step = this.currentSpeed * dt;
    this.x += Math.sin(this.yaw) * step;
    this.z += Math.cos(this.yaw) * step;
    this.dist += step;
    this.phase += dt * (6 + this.currentSpeed * 0.35);

    this.trail.push({ x: this.x, z: this.z, d: this.dist });
    this._prune();
    this.rebuildBody();
  }

  /** Drop trail points the tail can no longer reach. */
  _prune() {
    const keepFrom = this.dist - this.bodyLength() - this.spacing * 2;
    let drop = 0;
    // Keep one point behind the cutoff so sampling can still interpolate.
    while (drop + 1 < this.trail.length && this.trail[drop + 1].d < keepFrom) drop++;
    if (drop > 0) this.trail.splice(0, drop);
  }

  /** Position on the trail at absolute travelled distance `d`. */
  sample(d) {
    const t = this.trail;
    if (t.length === 0) return { x: this.x, z: this.z };
    if (d >= t[t.length - 1].d) return t[t.length - 1];
    if (d <= t[0].d) return t[0];
    let lo = 0, hi = t.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid].d <= d) lo = mid; else hi = mid;
    }
    const a = t[lo], b = t[hi];
    const span = b.d - a.d;
    const f = span > 1e-6 ? (d - a.d) / span : 0;
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
  }

  /** Recompute body segment transforms from the trail. */
  rebuildBody() {
    const body = this.body;
    body.length = this.segments;
    let px = this.x, pz = this.z;
    for (let i = 0; i < this.segments; i++) {
      const p = this.sample(this.dist - (i + 1) * this.spacing);
      const dx = px - p.x, dz = pz - p.z;
      const yaw = (dx * dx + dz * dz) > 1e-8 ? Math.atan2(dx, dz) : this.yaw;
      const slot = body[i];
      if (slot) { slot.x = p.x; slot.z = p.z; slot.yaw = yaw; }
      else body[i] = { x: p.x, z: p.z, yaw };
      px = p.x; pz = p.z;
    }
    return body;
  }

  grow(n) {
    this.segments += n;
    this.rebuildBody();
  }

  /** Steer input that turns the snake toward a world point. */
  steerToward(tx, tz) {
    const want = Math.atan2(tx - this.x, tz - this.z);
    let d = (want - this.yaw) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return clamp(d * 2.2, -1, 1);
  }

  /**
   * Does a circle at (x, z) touch this snake's body?
   * `skip` ignores segments closest to the head (a snake never bites its own neck).
   */
  hitsBody(x, z, radius, skip) {
    const skipN = skip === undefined ? 0 : skip;
    const rr = radius + this.bodyRadius;
    const limit = rr * rr;
    for (let i = skipN; i < this.body.length; i++) {
      const s = this.body[i];
      const dx = s.x - x, dz = s.z - z;
      if (dx * dx + dz * dz < limit) return i;
    }
    return -1;
  }

  hitsHead(x, z, radius) {
    const rr = radius + this.headRadius;
    const dx = this.x - x, dz = this.z - z;
    return dx * dx + dz * dz < rr * rr;
  }
}
