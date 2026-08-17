/*
 * Third-person chase camera: rides behind the snake's head, leans out when
 * boosting, stays inside the arena and shakes on impact.
 */
import { clamp, lerp, smoothing, angleDelta } from './sim/math.js';

export const CFG = {
  distance: 10.8,
  height: 5.6,
  lookAhead: 4.6,
  lookHeight: 1.5,
  fov: 62,
  followRate: 7.5,   // how fast the camera swings behind the head
  moveRate: 9.0,
  boostDistance: 2.6,
  boostFov: 6,
  minZoom: 8,
  maxZoom: 24,
};

export class ChaseCamera {
  constructor(opts) {
    this.cfg = Object.assign({}, CFG, opts || {});
    this.position = [0, this.cfg.height, -this.cfg.distance];
    this.target = [0, 1, 0];
    this.fov = this.cfg.fov;
    this.yaw = 0;
    this.zoom = 0;        // player wheel adjustment
    this.shake = 0;
    this.orbit = 0;       // extra spin used by the death cam
    this._rng = 0.123;
  }

  addZoom(delta) {
    const cfg = this.cfg;
    this.zoom = clamp(this.zoom + delta, cfg.minZoom - cfg.distance, cfg.maxZoom - cfg.distance);
  }

  kick(amount) { this.shake = Math.min(1.4, this.shake + amount); }

  /** Jump straight to the ideal pose (used on spawn/restart). */
  snapTo(snake) {
    this.yaw = snake.yaw;
    this.shake = 0;
    this.orbit = 0;
    this.fov = this.cfg.fov;
    this._apply(snake, 1, false);
  }

  update(dt, snake, alive) {
    const rate = smoothing(this.cfg.followRate, dt);
    if (alive) {
      this.yaw += angleDelta(this.yaw, snake.yaw) * rate;
    } else {
      this.orbit += dt * 0.35;
      this.yaw += dt * 0.35;
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this._apply(snake, smoothing(this.cfg.moveRate, dt), alive);
  }

  _apply(snake, blend, alive) {
    const cfg = this.cfg;
    const boosting = alive && snake.boosting;
    const dist = cfg.distance + this.zoom + (boosting ? cfg.boostDistance : 0) + (alive ? 0 : 4);
    const height = cfg.height + (alive ? 0 : 3.5);

    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let px = snake.x - fx * dist;
    let pz = snake.z - fz * dist;
    let py = height;

    // Keep the eye inside the arena so we never see through the walls.
    const bound = 44;
    px = clamp(px, -bound, bound);
    pz = clamp(pz, -bound, bound);

    const shake = this.shake * this.shake * 0.9;
    if (shake > 0) {
      px += this._noise() * shake;
      py += this._noise() * shake * 0.6;
      pz += this._noise() * shake;
    }

    this.position[0] = lerp(this.position[0], px, blend);
    this.position[1] = lerp(this.position[1], Math.max(2.2, py), blend);
    this.position[2] = lerp(this.position[2], pz, blend);

    const ahead = alive ? cfg.lookAhead : 1.5;
    const tx = snake.x + Math.sin(snake.yaw) * ahead;
    const tz = snake.z + Math.cos(snake.yaw) * ahead;
    this.target[0] = lerp(this.target[0], tx, blend);
    this.target[1] = lerp(this.target[1], cfg.lookHeight, blend);
    this.target[2] = lerp(this.target[2], tz, blend);

    const wantFov = cfg.fov + (boosting ? cfg.boostFov : 0);
    this.fov = lerp(this.fov, wantFov, blend * 0.5);
  }

  /** Cheap deterministic noise in -1..1 (no Math.random churn). */
  _noise() {
    this._rng = (this._rng * 16807) % 2147483647;
    return (this._rng / 2147483647) * 2 - 1;
  }
}
