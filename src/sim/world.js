/*
 * World simulation: arena, food, blocky obstacles, rival snakes, collisions,
 * scoring and particle bookkeeping. Pure logic — the renderer only reads it.
 */
import { clamp } from './math.js';
import { Snake } from './snake.js';
export const CFG = {
  arena: 46,             // half-size of the playable square
  foodCount: 16,
  obstacleCount: 26,
  rivalCount: 3,
  startSegments: 9,
  selfHitSkip: 8,        // body segments next to the head that cannot be bitten
  comboWindow: 2.6,
  comboMax: 5,
  boostDrain: 0.34,      // stamina per second while boosting
  boostRegen: 0.2,
  boostFloor: 0.06,      // stamina needed to kick off a boost
  maxParticles: 320,
  rivalRespawn: [4, 8],
};

export const RIVAL_TINTS = 4;   // renderer maps 0..3 to distinct palettes
const RIVAL_STEERS = [-1, -0.55, 0, 0.55, 1];   // candidate turns the AI evaluates

/** Small deterministic PRNG so tests (and replays) are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class World {
  constructor(opts) {
    this.cfg = Object.assign({}, CFG, opts || {});
    this.seed = (opts && opts.seed) || 1337;
    this.reset();
  }

  reset() {
    const cfg = this.cfg;
    this.rng = mulberry32(this.seed);
    this.state = 'playing';
    this.time = 0;
    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.stamina = 1;
    this.kills = 0;
    this.eaten = 0;
    this.deathCause = '';
    this.particles = [];
    this.events = [];

    this.player = new Snake({ x: 0, z: -6, yaw: 0, segments: cfg.startSegments });
    this.obstacles = this._makeObstacles();
    this.rivals = [];              // cleared first so spawn checks ignore the last run
    this.foods = [];
    for (let i = 0; i < cfg.foodCount; i++) this.foods.push(this._makeFood());
    for (let i = 0; i < cfg.rivalCount; i++) this.rivals.push(this._makeRival(i));
    return this;
  }

  // ---------------------------------------------------------------- spawning

  _makeObstacles() {
    const cfg = this.cfg, out = [], rng = this.rng;
    let guard = 0;
    while (out.length < cfg.obstacleCount && guard++ < 800) {
      const size = 2 + Math.floor(rng() * 3);          // 2..4 wide footprint
      const height = 2 + Math.floor(rng() * 6);
      const span = cfg.arena - size - 3;
      const x = (rng() * 2 - 1) * span;
      const z = (rng() * 2 - 1) * span;
      if (Math.hypot(x, z) < 15) continue;              // keep the spawn area open
      let clear = true;
      for (const o of out) {
        if (Math.abs(o.x - x) < o.size + size + 5 && Math.abs(o.z - z) < o.size + size + 5) {
          clear = false; break;
        }
      }
      if (clear) out.push({ x, z, size, height, tint: Math.floor(rng() * 3) });
    }
    return out;
  }

  /** Distance from a point to the nearest living snake part. */
  _clearanceAt(x, z) {
    let best = Infinity;
    const consider = (snake) => {
      if (!snake || !snake.alive) return;
      best = Math.min(best, Math.hypot(snake.x - x, snake.z - z));
      for (const seg of snake.body) {
        const d = Math.hypot(seg.x - x, seg.z - z);
        if (d < best) best = d;
      }
    };
    consider(this.player);
    if (this.rivals) for (const r of this.rivals) consider(r.snake);
    return best;
  }

  /**
   * Pick a spot clear of obstacles, every living snake and the arena edge.
   * Spawning on top of another snake is instant death, so this matters.
   */
  _freeSpot(margin, spanOverride, obstacleClear) {
    const cfg = this.cfg, rng = this.rng;
    const span = spanOverride === undefined ? cfg.arena - 4 : spanOverride;
    const blockClear = obstacleClear === undefined ? 2.5 : obstacleClear;
    let best = null, bestClear = -1;
    for (let attempt = 0; attempt < 48; attempt++) {
      const x = (rng() * 2 - 1) * span;
      const z = (rng() * 2 - 1) * span;
      if (this._insideObstacle(x, z, blockClear)) continue;
      const clear = this._clearanceAt(x, z);
      if (clear > bestClear) { bestClear = clear; best = { x, z }; }
      if (clear >= margin) break;
    }
    return best || { x: 0, z: cfg.arena * 0.5 };
  }

  /**
   * Choose a spawn heading with open road ahead, breaking ties toward
   * `preferred`. Without this a rival can spawn nose-on to a block with less
   * room than its turning circle needs and die on the spot, forever.
   */
  _openHeading(spot, preferred) {
    const TAU = Math.PI * 2;
    let bestYaw = preferred, bestScore = -Infinity;
    for (let i = 0; i < 16; i++) {
      const yaw = preferred + (i / 16) * TAU;
      let room = 0;
      for (let d = 2; d <= 18; d += 2) {
        const x = spot.x + Math.sin(yaw) * d;
        const z = spot.z + Math.cos(yaw) * d;
        if (this._outsideArena(x, z, 2) || this._insideObstacle(x, z, 2)) break;
        room = d;
      }
      let off = (yaw - preferred) % TAU;
      if (off > Math.PI) off -= TAU;
      if (off < -Math.PI) off += TAU;
      const score = room - Math.abs(off) * 2;
      if (score > bestScore) { bestScore = score; bestYaw = yaw; }
    }
    return bestYaw;
  }

  /** Cheap roaming target for the AI — no clearance search needed. */
  _wanderSpot() {
    const span = this.cfg.arena - 6, rng = this.rng;
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = (rng() * 2 - 1) * span;
      const z = (rng() * 2 - 1) * span;
      if (!this._insideObstacle(x, z, 3)) return { x, z };
    }
    return { x: 0, z: 0 };
  }

  _makeFood() {
    const spot = this._freeSpot(9);
    const golden = this.rng() < 0.12;
    return {
      x: spot.x, z: spot.z,
      golden,
      value: golden ? 30 : 10,
      growth: golden ? 7 : 3,
      radius: golden ? 0.62 : 0.5,
      phase: this.rng() * 6.283,
    };
  }

  _makeRival(index) {
    // Spawn away from the wall and pointed inward: a rival dropped nose-first
    // at the edge has less room than its turning circle needs. The narrower
    // span keeps the spot obstacle-checked rather than clamped after the fact.
    const spot = this._freeSpot(24, this.cfg.arena - 12, 8);
    const inward = Math.atan2(-spot.x, -spot.z);
    const snake = new Snake({
      x: spot.x, z: spot.z,
      yaw: this._openHeading(spot, inward) + (this.rng() - 0.5) * 0.5,
      segments: 10 + Math.floor(this.rng() * 8),
      speed: 9.5 + this.rng() * 2.5,
      turnRate: 2.2 + this.rng() * 0.5,
    });
    return {
      snake,
      tint: index % RIVAL_TINTS,
      wander: { x: spot.x, z: spot.z },
      wanderTimer: 0,
      respawnIn: 0,
      steer: 0,
      planTimer: 0,
      // Personality: how often it re-plans, and how reliably it notices the
      // player's body. A careless rival can be baited into your tail.
      reaction: 0.1 + this.rng() * 0.22,
      caution: 0.55 + this.rng() * 0.45,
    };
  }

  // -------------------------------------------------------------- collisions

  _insideObstacle(x, z, radius) {
    for (const o of this.obstacles) {
      const half = o.size / 2;
      const dx = Math.abs(x - o.x) - half;
      const dz = Math.abs(z - o.z) - half;
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
      if (dx < 0 && dz < 0) return true;
      if (outside < radius) return true;
    }
    return false;
  }

  _outsideArena(x, z, radius) {
    const a = this.cfg.arena - radius;
    return x < -a || x > a || z < -a || z > a;
  }

  /** What would kill a snake head at this spot? Returns a cause or ''. */
  _hazardAt(snake, x, z, ignoreSelf) {
    const r = snake.headRadius;
    if (this._outsideArena(x, z, r)) return 'wall';
    if (this._insideObstacle(x, z, r)) return 'block';
    if (!ignoreSelf && snake.hitsBody(x, z, r, this.cfg.selfHitSkip) >= 0) return 'self';
    return '';
  }

  /**
   * Would a rival head at (x, z) be dead? Used by the AI lookahead, so it
   * keeps a little more clearance than the real collision test.
   * `step` is how far into the future this sample is (own body is only a
   * threat once the projection has moved past the neck).
   */
  _probeDeadly(snake, x, z, step, ahead, avoidPlayer) {
    const r = snake.headRadius + 0.7;
    if (this._outsideArena(x, z, r)) return true;
    if (this._insideObstacle(x, z, r)) return true;
    if (this.player.alive && avoidPlayer) {
      if (this.player.hitsBody(x, z, r, 0) >= 0) return true;
      if (this.player.hitsHead(x, z, r)) return true;
    }
    if (step >= 4 && snake.hitsBody(x, z, snake.headRadius, this.cfg.selfHitSkip) >= 0) return true;
    for (const other of this.rivals) {
      const os = other.snake;
      if (os === snake || !os.alive) continue;
      if (os.hitsBody(x, z, r, 0) >= 0) return true;
      // Rivals converge on the same food, so project the other head forward
      // too — otherwise nobody swerves until they are already touching.
      const ox = os.x + Math.sin(os.yaw) * os.currentSpeed * ahead;
      const oz = os.z + Math.cos(os.yaw) * os.currentSpeed * ahead;
      const clear = r + os.headRadius + 1.4;
      if ((ox - x) * (ox - x) + (oz - z) * (oz - z) < clear * clear) return true;
    }
    return false;
  }

  /**
   * Pick a steer for a rival by projecting a handful of candidate turns a
   * second or so into the future and keeping the one that both survives
   * longest and ends nearest the goal.
   */
  _planSteer(rival, goal) {
    const snake = rival.snake;
    const steps = 11, step = 0.11;
    const avoidPlayer = this.rng() < rival.caution;
    let best = 0, bestScore = -Infinity;
    for (const candidate of RIVAL_STEERS) {
      let x = snake.x, z = snake.z, yaw = snake.yaw, survived = 0;
      for (let k = 0; k < steps; k++) {
        yaw += candidate * snake.turnRate * step;
        x += Math.sin(yaw) * snake.speed * step;
        z += Math.cos(yaw) * snake.speed * step;
        if (this._probeDeadly(snake, x, z, k, (k + 1) * step, avoidPlayer)) break;
        survived++;
      }
      let score = survived * 18 - Math.hypot(goal.x - x, goal.z - z) - Math.abs(candidate) * 1.5;
      if (candidate === rival.steer) score += 2;   // hysteresis, stops the wiggle
      if (score > bestScore) { bestScore = score; best = candidate; }
    }
    return best;
  }

  // ------------------------------------------------------------------ update

  /** Advance the simulation. `input` is {steer: -1..1, boost: bool}. */
  update(dt, input) {
    this.events.length = 0;
    if (this.state !== 'playing') {
      this._updateParticles(dt);
      return this.events;
    }
    dt = Math.min(dt, 1 / 25);
    this.time += dt;

    this._updatePlayer(dt, input || {});
    for (const f of this.foods) f.claim = null;   // dibs are re-taken every frame
    for (const rival of this.rivals) this._updateRival(dt, rival);
    this._updateParticles(dt);
    for (const f of this.foods) f.phase += dt * 2.4;

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 1;
    }
    return this.events;
  }

  _updatePlayer(dt, input) {
    const player = this.player;
    let boost = !!input.boost;
    if (boost && this.stamina <= this.cfg.boostFloor) boost = false;
    if (boost) {
      this.stamina = Math.max(0, this.stamina - this.cfg.boostDrain * dt);
    } else {
      this.stamina = Math.min(1, this.stamina + this.cfg.boostRegen * dt);
    }

    player.update(dt, input.steer || 0, boost);

    const cause = this._hazardAt(player, player.x, player.z, false);
    if (cause) return this._killPlayer(cause);

    for (const rival of this.rivals) {
      if (!rival.snake.alive) continue;
      if (rival.snake.hitsHead(player.x, player.z, player.headRadius)) {
        this._killRival(rival, 'headbutt');
        return this._killPlayer('rival');
      }
      if (rival.snake.hitsBody(player.x, player.z, player.headRadius, 0) >= 0) {
        return this._killPlayer('rival');
      }
    }

    this._eatCheck(player, true);
  }

  _updateRival(dt, rival) {
    const snake = rival.snake;
    if (!snake.alive) {
      rival.respawnIn -= dt;
      if (rival.respawnIn <= 0) {
        const fresh = this._makeRival(rival.tint);
        rival.snake = fresh.snake;
        rival.wander = fresh.wander;
        rival.wanderTimer = 0;
        rival.steer = 0;
        rival.planTimer = 0;
        rival.reaction = fresh.reaction;
        rival.caution = fresh.caution;
        this.events.push({ type: 'spawn', rival });
      }
      return;
    }

    // Pick a goal: nearest food, or a wander point when the field is empty.
    // Food another rival already called dibs on costs extra, so they spread out.
    rival.wanderTimer -= dt;
    let goal = null, bestDist = Infinity, bestCost = Infinity;
    for (const f of this.foods) {
      const d = Math.hypot(f.x - snake.x, f.z - snake.z);
      const cost = d + (f.claim && f.claim !== rival ? 22 : 0);
      if (cost < bestCost) { bestCost = cost; bestDist = d; goal = f; }
    }
    if (goal) goal.claim = rival;
    if (!goal || bestDist > 55) {
      if (rival.wanderTimer <= 0) {
        rival.wander = this._wanderSpot();
        rival.wanderTimer = 3 + this.rng() * 3;
      }
      goal = rival.wander;
    }

    // Re-plan a few times a second; steer holds steady in between.
    rival.planTimer -= dt;
    if (rival.planTimer <= 0) {
      rival.steer = this._planSteer(rival, goal);
      rival.planTimer = rival.reaction + this.rng() * 0.05;
    }

    snake.update(dt, rival.steer, bestDist > 22 && this.rng() < 0.02);

    const cause = this._hazardAt(snake, snake.x, snake.z, false);
    if (cause) return this._killRival(rival, cause);
    if (this.player.hitsBody(snake.x, snake.z, snake.headRadius, 0) >= 0) {
      this.kills++;
      this.score += 60;
      this.events.push({ type: 'kill', x: snake.x, z: snake.z });
      return this._killRival(rival, 'player');
    }
    for (const other of this.rivals) {
      if (other === rival || !other.snake.alive) continue;
      if (other.snake.hitsBody(snake.x, snake.z, snake.headRadius, 0) >= 0) {
        return this._killRival(rival, 'rival');
      }
    }

    this._eatCheck(snake, false);
  }

  _eatCheck(snake, isPlayer) {
    for (let i = 0; i < this.foods.length; i++) {
      const f = this.foods[i];
      const dx = f.x - snake.x, dz = f.z - snake.z;
      const reach = f.radius + snake.headRadius;
      if (dx * dx + dz * dz > reach * reach) continue;

      snake.grow(f.growth);
      if (isPlayer) {
        this.combo = this.comboTimer > 0 ? Math.min(this.cfg.comboMax, this.combo + 1) : 1;
        this.comboTimer = this.cfg.comboWindow;
        this.score += f.value * this.combo;
        this.eaten++;
        this.stamina = Math.min(1, this.stamina + (f.golden ? 0.35 : 0.12));
        this.events.push({ type: 'eat', x: f.x, z: f.z, golden: f.golden, combo: this.combo });
      } else {
        this.events.push({ type: 'rivalEat', x: f.x, z: f.z });
      }
      this.spawnBurst(f.x, 0.9, f.z, f.golden ? 22 : 14, f.golden ? [1, 0.85, 0.25] : [0.95, 0.28, 0.3]);
      this.foods[i] = this._makeFood();
      return;
    }
  }

  _killPlayer(cause) {
    if (this.state !== 'playing') return;
    this.state = 'dead';
    this.deathCause = cause;
    this.player.alive = false;
    this.spawnBurst(this.player.x, 1, this.player.z, 46, [0.55, 0.95, 0.45]);
    this.events.push({ type: 'die', cause, score: this.score });
  }

  _killRival(rival, cause) {
    const snake = rival.snake;
    if (!snake.alive) return;
    snake.alive = false;
    const [lo, hi] = this.cfg.rivalRespawn;
    rival.respawnIn = lo + this.rng() * (hi - lo);
    this.spawnBurst(snake.x, 1, snake.z, 26, [0.8, 0.5, 1]);

    // A dead rival leaves food behind.
    let dropped = 0;
    for (let i = 2; i < snake.body.length && dropped < 6; i += 4) {
      const s = snake.body[i];
      if (this._outsideArena(s.x, s.z, 1) || this._insideObstacle(s.x, s.z, 1)) continue;
      const food = this._makeFood();
      food.x = s.x; food.z = s.z;
      this.foods.push(food);
      dropped++;
    }
    // Keep the field size stable by trimming the oldest extras.
    while (this.foods.length > this.cfg.foodCount + 8) this.foods.shift();
    this.events.push({ type: 'rivalDie', cause, x: snake.x, z: snake.z });
  }

  // --------------------------------------------------------------- particles

  spawnBurst(x, y, z, count, color) {
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.cfg.maxParticles) break;
      const a = rng() * 6.283, up = 3 + rng() * 8, out = 2 + rng() * 7;
      this.particles.push({
        x, y, z,
        vx: Math.sin(a) * out, vy: up, vz: Math.cos(a) * out,
        size: 0.18 + rng() * 0.28,
        life: 0.6 + rng() * 0.7,
        maxLife: 1.3,
        spin: (rng() * 2 - 1) * 6,
        rot: rng() * 6.283,
        color: [
          clamp(color[0] + (rng() - 0.5) * 0.15, 0, 1),
          clamp(color[1] + (rng() - 0.5) * 0.15, 0, 1),
          clamp(color[2] + (rng() - 0.5) * 0.15, 0, 1),
        ],
      });
    }
  }

  _updateParticles(dt) {
    const list = this.particles;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      p.vy -= 26 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.spin * dt;
      const floor = p.size * 0.5;
      if (p.y < floor) {
        p.y = floor;
        p.vy *= -0.42;
        p.vx *= 0.7; p.vz *= 0.7;
      }
    }
  }
}
