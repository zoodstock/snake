/*
 * Headless tests for the pure simulation modules (no WebGL, no DOM).
 * Run with:  node tests/logic.test.js
 */
import assert from 'node:assert';
import * as M3 from '../src/sim/math.js';
import { Snake } from '../src/sim/snake.js';
import { World } from '../src/sim/world.js';
// The chase camera is pure maths over sim/math.js, so the stick tests can drive
// the real one rather than a stand-in that cannot reproduce the bug below.
import { ChaseCamera } from '../src/camera.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (err) {
    failures.push({ name, err });
    console.log('  FAIL ' + name + '\n       ' + err.message);
  }
}

/** Run the sim for `seconds` with a fixed step. */
function run(target, seconds, input, step) {
  const dt = step || 1 / 60;
  for (let t = 0; t < seconds; t += dt) target.update(dt, input.steer, input.boost);
}

console.log('math3d');

test('angleDelta takes the short way round', () => {
  assert.ok(Math.abs(M3.angleDelta(0.1, -0.1) - -0.2) < 1e-9);
  assert.ok(M3.angleDelta(3.0, -3.0) > 0, 'wraps across PI instead of turning back');
});

test('rotateY maps local +Z onto the heading', () => {
  const yaw = 0.7;
  const [x, z] = M3.rotateY(0, 1, yaw);
  assert.ok(Math.abs(x - Math.sin(yaw)) < 1e-9);
  assert.ok(Math.abs(z - Math.cos(yaw)) < 1e-9);
});

// A snake turning toward the RIGHT of the screen ends up at camYaw - 90 degrees.
// Screen right is world -X, because a three.js camera looks down its local -Z and
// that flips the sideways axis. Measured by projecting world axes through the real
// camera, not derived — assuming it the other way round steered everything
// backwards, twice. Which also means a NEGATIVE steer turns toward screen right.
const screenRight = (camYaw) => camYaw - Math.PI / 2;

test('stickTurn ignores the dead zone', () => {
  assert.ok(Math.abs(M3.stickTurn(0, 0)) < 1e-12);
  assert.ok(Math.abs(M3.stickTurn(0.1, -0.1)) < 1e-12, 'a resting thumb is not input');
  assert.ok(M3.stickTurn(1, 0) !== 0, 'a full push registers');
});

test('stickTurn sends the snake the way the stick points', () => {
  assert.ok(M3.stickTurn(1, 0) < 0, 'push right turns toward screen right');
  assert.ok(M3.stickTurn(-1, 0) > 0, 'push left turns toward screen left');
  assert.ok(Math.abs(M3.stickTurn(0, 1)) < 1e-12, 'push straight up holds the line');
  assert.ok(Math.abs(M3.stickTurn(1, 0) + M3.stickTurn(-1, 0)) < 1e-12, 'left mirrors right');
  assert.ok(Math.abs(M3.stickTurn(1, 0) + 1) < 1e-9, 'a full sideways push is full lock');
});

test('stickTurn is proportional to angle and to how far it is pushed', () => {
  // Half way between straight up and hard right is half the turn rate.
  const diagonal = M3.stickTurn(Math.SQRT1_2, Math.SQRT1_2);
  assert.ok(Math.abs(diagonal + 0.5) < 1e-6, 'diagonal is half lock, got ' + diagonal);
  assert.ok(Math.abs(diagonal) < Math.abs(M3.stickTurn(1, 0)), 'diagonal turns less than hard right');

  // Same angle, pushed less far: same direction, gentler.
  const light = M3.stickTurn(0.5, 0);
  const full = M3.stickTurn(1, 0);
  assert.ok(light < 0 && light > full, 'a small push is gentler: ' + light + ' vs ' + full);
});

test('a stick held sideways keeps turning, it does not settle', () => {
  // This is the point of a rate control, and it is what the on-screen stick is
  // expected to feel like: hold right and the snake keeps coming round.
  const w = new World({ seed: 77 });
  w.obstacles.length = 0;
  w.foods.length = 0;
  w.rivals.length = 0;
  const p = w.player;
  p.x = 0; p.z = 0; p.yaw = 0;

  const cam = new ChaseCamera();
  cam.snapTo(p);
  const turned = [];
  let last = p.yaw;
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < 30; i++) {
      w.update(1 / 60, { steer: M3.stickTurn(1, 0) });
      cam.update(1 / 60, p, true);
    }
    turned.push(M3.angleDelta(last, p.yaw));
    last = p.yaw;
  }
  for (const [i, d] of turned.entries()) {
    assert.ok(d < -0.5, 'half-second ' + i + ' should keep turning right, turned ' + d.toFixed(3));
  }
});

test('a quarter turn to the right lands on the screen-right heading', () => {
  // Sanity-check the sign against the measured screen mapping: turn right for as
  // long as it takes to sweep 90 degrees and that is where you end up.
  const s = new Snake({ x: 0, z: 0, yaw: 0 });
  const start = s.yaw;
  const want = screenRight(start);
  for (let i = 0; i < 600 && Math.abs(M3.angleDelta(want, s.yaw)) > 0.02; i++) {
    s.update(1 / 120, M3.stickTurn(1, 0));
  }
  assert.ok(Math.abs(M3.angleDelta(want, s.yaw)) < 0.02,
    'ended at ' + s.yaw.toFixed(3) + ', wanted ' + want.toFixed(3));
});

console.log('snake');

test('a fresh snake has a straight tail behind the head', () => {
  const s = new Snake({ x: 0, z: 0, yaw: 0, segments: 9 });
  assert.strictEqual(s.body.length, 9);
  s.body.forEach((seg, i) => {
    assert.ok(Math.abs(seg.x) < 1e-6, 'segment ' + i + ' should sit on the axis');
    const want = -(i + 1) * s.spacing;
    assert.ok(Math.abs(seg.z - want) < 0.05, 'segment ' + i + ' at ' + seg.z + ', want ' + want);
  });
});

test('head advances along its heading and segments stay evenly spaced', () => {
  const s = new Snake({ x: 0, z: 0, yaw: 0, segments: 12 });
  run(s, 2, { steer: 0 });
  assert.ok(Math.abs(s.z - s.speed * 2) < 0.4, 'travelled ' + s.z);
  let prev = { x: s.x, z: s.z };
  for (const seg of s.body) {
    const gap = Math.hypot(seg.x - prev.x, seg.z - prev.z);
    assert.ok(Math.abs(gap - s.spacing) < 0.05, 'gap ' + gap);
    prev = seg;
  }
});

/** Distance from a point to the polyline the head travelled. */
function distanceToTrail(trail, px, pz) {
  let best = Infinity;
  for (let i = 0; i + 1 < trail.length; i++) {
    const a = trail[i], b = trail[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t)));
  }
  return best;
}

test('the body follows the path through a turn, it does not cut the corner', () => {
  const s = new Snake({ x: 0, z: 0, yaw: 0, segments: 20 });
  run(s, 1.2, { steer: 0 });
  run(s, 0.7, { steer: 1 });
  // Every segment must sit on the path the head actually travelled.
  for (const seg of s.body) {
    const off = distanceToTrail(s.trail, seg.x, seg.z);
    assert.ok(off < 0.01, 'segment off the trail by ' + off);
  }
  const spread = s.body.some((seg) => Math.abs(seg.x) > 0.5);
  assert.ok(spread, 'the tail should be swung out sideways after a turn');
});

test('growing lengthens the body and the trail keeps up', () => {
  const s = new Snake({ segments: 9 });
  run(s, 3, { steer: 0 });
  s.grow(20);
  assert.strictEqual(s.segments, 29);
  assert.strictEqual(s.body.length, 29);
  run(s, 3, { steer: 0 });
  const tail = s.body[s.body.length - 1];
  const span = Math.hypot(tail.x - s.x, tail.z - s.z);
  assert.ok(Math.abs(span - 29 * s.spacing) < 0.4, 'tail distance ' + span);
});

test('boosting is faster but turns wider', () => {
  const cruise = new Snake({ segments: 9 });
  const boost = new Snake({ segments: 9 });
  run(cruise, 1, { steer: 1, boost: false });
  run(boost, 1, { steer: 1, boost: true });
  assert.ok(boost.dist > cruise.dist, 'boost covers more ground');
  assert.ok(Math.abs(boost.yaw) < Math.abs(cruise.yaw), 'boost turns less sharply');
});

test('trail memory is bounded by body length, not by run time', () => {
  const s = new Snake({ segments: 15 });
  run(s, 30, { steer: 0.4 });
  const needed = (s.bodyLength() + s.spacing * 2) / (s.speed / 60);
  assert.ok(s.trail.length < needed + 8, 'trail grew to ' + s.trail.length);
  assert.ok(s.trail.length > 10, 'trail should still hold the recent path');
});

test('steerToward turns the short way', () => {
  const s = new Snake({ x: 0, z: 0, yaw: 0 });
  assert.ok(s.steerToward(10, 5) > 0, 'target on the right steers right');
  assert.ok(s.steerToward(-10, 5) < 0, 'target on the left steers left');
  assert.ok(Math.abs(s.steerToward(0, 10)) < 1e-6, 'straight ahead needs no steer');
});

test('hitsBody skips the neck but still finds the tail', () => {
  const s = new Snake({ x: 0, z: 0, yaw: 0, segments: 20 });
  s.rebuildBody();
  const neck = s.body[1];
  assert.strictEqual(s.hitsBody(neck.x, neck.z, s.headRadius, 8), -1, 'neck is exempt');
  const tail = s.body[18];
  assert.ok(s.hitsBody(tail.x, tail.z, s.headRadius, 8) >= 0, 'tail is not exempt');
});

console.log('world');

test('the world starts alive with food, obstacles and rivals', () => {
  const w = new World({ seed: 42 });
  assert.strictEqual(w.state, 'playing');
  assert.strictEqual(w.foods.length, w.cfg.foodCount);
  assert.strictEqual(w.rivals.length, w.cfg.rivalCount);
  assert.ok(w.obstacles.length > 10, 'obstacles were generated');
  for (const o of w.obstacles) {
    assert.ok(Math.hypot(o.x, o.z) >= 15, 'spawn area stays clear');
    assert.ok(Math.abs(o.x) < w.cfg.arena && Math.abs(o.z) < w.cfg.arena, 'inside the arena');
  }
});

test('the same seed builds the same arena', () => {
  const a = new World({ seed: 7 });
  const b = new World({ seed: 7 });
  assert.deepStrictEqual(a.obstacles, b.obstacles);
  assert.deepStrictEqual(a.foods.map((f) => [f.x, f.z, f.golden]), b.foods.map((f) => [f.x, f.z, f.golden]));
});

test('driving into the wall ends the run', () => {
  const w = new World({ seed: 3 });
  w.obstacles.length = 0;
  w.foods.length = 0;
  w.rivals.length = 0;
  w.player.x = 0;
  w.player.z = w.cfg.arena - 3;
  w.player.yaw = 0;
  for (let i = 0; i < 400 && w.state === 'playing'; i++) w.update(1 / 60, { steer: 0 });
  assert.strictEqual(w.state, 'dead');
  assert.strictEqual(w.deathCause, 'wall');
});

test('driving into a block ends the run', () => {
  const w = new World({ seed: 5 });
  w.foods.length = 0;
  w.rivals.length = 0;
  w.obstacles = [{ x: 0, z: 12, size: 4, height: 3, tint: 0 }];
  w.player.x = 0; w.player.z = 0; w.player.yaw = 0;
  for (let i = 0; i < 200 && w.state === 'playing'; i++) w.update(1 / 60, { steer: 0 });
  assert.strictEqual(w.deathCause, 'block');
});

test('a short snake can turn as hard as it likes without biting itself', () => {
  const w = new World({ seed: 11 });
  w.obstacles.length = 0;
  w.foods.length = 0;
  w.rivals.length = 0;
  for (let i = 0; i < 60 * 8; i++) w.update(1 / 60, { steer: 1 });
  assert.strictEqual(w.state, 'playing', 'died from: ' + w.deathCause);
});

test('a long snake curled into a full loop bites itself', () => {
  const w = new World({ seed: 12 });
  w.obstacles.length = 0;
  w.foods.length = 0;
  w.rivals.length = 0;
  w.player.grow(70);
  for (let i = 0; i < 60 * 12 && w.state === 'playing'; i++) w.update(1 / 60, { steer: 1 });
  assert.strictEqual(w.state, 'dead');
  assert.strictEqual(w.deathCause, 'self');
});

test('eating food scores, grows and respawns the pickup', () => {
  const w = new World({ seed: 21 });
  w.obstacles.length = 0;
  w.rivals.length = 0;
  const startSegments = w.player.segments;
  w.foods = [{ x: 0, z: w.player.z + 4, golden: false, value: 10, growth: 3, radius: 0.5, phase: 0 }];
  let events = [];
  for (let i = 0; i < 120 && events.length === 0; i++) {
    events = w.update(1 / 60, { steer: 0 }).filter((e) => e.type === 'eat');
  }
  assert.strictEqual(events.length, 1);
  assert.strictEqual(w.score, 10);
  assert.strictEqual(w.eaten, 1);
  assert.strictEqual(w.player.segments, startSegments + 3);
  assert.strictEqual(w.foods.length, 1, 'the eaten pickup is replaced');
  assert.ok(w.particles.length > 0, 'eating throws confetti');
});

test('quick second bite multiplies the score, a slow one resets it', () => {
  const w = new World({ seed: 22 });
  w.obstacles.length = 0;
  w.rivals.length = 0;
  const feed = () => {
    w.foods = [{ x: w.player.x, z: w.player.z, golden: false, value: 10, growth: 0, radius: 0.9, phase: 0 }];
    w.update(1 / 60, { steer: 0 });
  };
  feed();
  assert.strictEqual(w.combo, 1);
  feed();
  assert.strictEqual(w.combo, 2, 'combo climbs inside the window');
  assert.strictEqual(w.score, 10 + 20);
  for (let i = 0; i < 60 * 4; i++) w.update(1 / 60, { steer: 0 });   // let the window lapse
  assert.strictEqual(w.combo, 1, 'combo decays');
});

test('boosting drains stamina and cruising refills it', () => {
  const w = new World({ seed: 23 });
  w.obstacles.length = 0;
  w.foods.length = 0;
  w.rivals.length = 0;
  for (let i = 0; i < 60; i++) w.update(1 / 60, { steer: 0.2, boost: true });
  assert.ok(w.stamina < 0.75, 'stamina fell to ' + w.stamina);
  assert.ok(w.player.boosting, 'still boosting while stamina remains');
  for (let i = 0; i < 60 * 3; i++) w.update(1 / 60, { steer: 0.2, boost: false });
  assert.ok(w.stamina > 0.95, 'stamina recovered to ' + w.stamina);
});

test('an empty stamina bar cancels the boost', () => {
  const w = new World({ seed: 24 });
  w.obstacles.length = 0;
  w.foods.length = 0;
  w.rivals.length = 0;
  w.stamina = 0.02;
  w.update(1 / 60, { steer: 0, boost: true });
  assert.strictEqual(w.player.boosting, false);
  assert.ok(w.stamina > 0.02, 'stamina regenerates instead');
});

test('a rival that hits the player body dies and pays out', () => {
  const w = new World({ seed: 25 });
  w.obstacles.length = 0;
  w.foods.length = 0;
  const rival = w.rivals[0];
  w.rivals.length = 1;
  // Park the rival's head right on top of a mid-body segment of the player.
  const seg = w.player.body[4];
  rival.snake.x = seg.x;
  rival.snake.z = seg.z;
  rival.snake.rebuildBody();
  const events = w.update(1 / 60, { steer: 0 });
  assert.ok(events.some((e) => e.type === 'kill'), 'kill event fired');
  assert.strictEqual(rival.snake.alive, false);
  assert.strictEqual(w.kills, 1);
  assert.strictEqual(w.score, 60);
  assert.ok(w.foods.length > 0, 'the dead rival drops food');
});

test('a dead rival respawns after its timer', () => {
  const w = new World({ seed: 26 });
  w.obstacles.length = 0;
  const rival = w.rivals[0];
  w._killRival(rival, 'test');
  assert.strictEqual(rival.snake.alive, false);
  const wait = rival.respawnIn + 0.5;
  for (let t = 0; t < wait; t += 1 / 60) w._updateRival(1 / 60, rival);
  assert.strictEqual(rival.snake.alive, true, 'rival came back');
});

test('touching a rival body kills the player', () => {
  const w = new World({ seed: 27 });
  w.obstacles.length = 0;
  w.foods.length = 0;
  const rival = w.rivals[0];
  w.rivals.length = 1;
  const seg = rival.snake.body[5];
  w.player.x = seg.x;
  w.player.z = seg.z;
  w.update(1 / 60, { steer: 0 });
  assert.strictEqual(w.state, 'dead');
  assert.strictEqual(w.deathCause, 'rival');
});

test('rivals steer around walls and blocks for minutes on end', () => {
  const causes = {};
  let deaths = 0;
  for (const seed of [28, 99, 7, 1337, 2, 404]) {
    const w = new World({ seed });
    for (let i = 0; i < 60 * 60; i++) {
      for (const e of w.update(1 / 60, { steer: 0.15 })) {
        if (e.type === 'rivalDie') { deaths++; causes[e.cause] = (causes[e.cause] || 0) + 1; }
      }
      if (w.state !== 'playing') w.reset();
      for (const r of w.rivals) {
        if (!r.snake.alive) continue;
        assert.ok(Math.abs(r.snake.x) <= w.cfg.arena, 'rival stayed in bounds');
        assert.ok(Math.abs(r.snake.z) <= w.cfg.arena, 'rival stayed in bounds');
      }
    }
  }
  // The player here just circles at spawn, so nothing should be killing rivals.
  assert.ok(deaths <= 3, 'rivals crashed ' + deaths + ' times: ' + JSON.stringify(causes));
});

test('a rival never spawns somewhere it cannot escape', () => {
  for (const seed of [28, 2, 99, 5150]) {
    const w = new World({ seed });
    for (let spawn = 0; spawn < 25; spawn++) {
      const rival = w._makeRival(spawn % 4);
      w.rivals.push(rival);
      // Give it a second of AI control from a standing start.
      for (let i = 0; i < 60; i++) w._updateRival(1 / 60, rival);
      assert.strictEqual(rival.snake.alive, true,
        'seed ' + seed + ' spawn ' + spawn + ' died immediately');
      w.rivals.pop();
    }
  }
});

test('particles fall, settle and expire', () => {
  const w = new World({ seed: 29 });
  w.particles.length = 0;
  w.spawnBurst(0, 2, 0, 20, [1, 0, 0]);
  assert.strictEqual(w.particles.length, 20);
  for (let i = 0; i < 30; i++) w._updateParticles(1 / 60);
  for (const p of w.particles) assert.ok(p.y >= 0, 'particle stayed above the ground');
  for (let i = 0; i < 60 * 3; i++) w._updateParticles(1 / 60);
  assert.strictEqual(w.particles.length, 0, 'all particles expired');
});

test('particle count is capped', () => {
  const w = new World({ seed: 30 });
  for (let i = 0; i < 40; i++) w.spawnBurst(0, 1, 0, 40, [1, 1, 1]);
  assert.ok(w.particles.length <= w.cfg.maxParticles, 'capped at ' + w.cfg.maxParticles);
});

test('reset clears the run', () => {
  const w = new World({ seed: 31 });
  w.score = 500;
  w._killPlayer('wall');
  w.reset();
  assert.strictEqual(w.state, 'playing');
  assert.strictEqual(w.score, 0);
  assert.strictEqual(w.player.segments, w.cfg.startSegments);
  assert.strictEqual(w.player.alive, true);
  assert.strictEqual(w.deathCause, '');
});

test('a dead world stops simulating the snake', () => {
  const w = new World({ seed: 32 });
  w._killPlayer('wall');
  const before = { x: w.player.x, z: w.player.z };
  for (let i = 0; i < 60; i++) w.update(1 / 60, { steer: 1, boost: true });
  assert.strictEqual(w.player.x, before.x);
  assert.strictEqual(w.player.z, before.z);
});

test('a long unattended run stays consistent', () => {
  const w = new World({ seed: 33 });
  for (let i = 0; i < 60 * 90; i++) {
    w.update(1 / 60, { steer: Math.sin(i / 90) * 0.8, boost: i % 300 < 40 });
    if (w.state !== 'playing') w.reset();
    assert.ok(isFinite(w.player.x) && isFinite(w.player.z), 'position stayed finite');
    assert.strictEqual(w.player.body.length, w.player.segments);
  }
  assert.ok(w.foods.length >= w.cfg.foodCount, 'food supply never runs dry');
  assert.ok(w.foods.length <= w.cfg.foodCount + 8, 'food list stays bounded');
});

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  for (const f of failures) console.error('\n' + f.name + '\n' + f.err.stack);
  process.exit(1);
}
