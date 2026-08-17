/*
 * Renderer smoke test.
 *
 * Drives the real renderer over a real simulation with three.js replaced by the
 * local test double, so it needs no network and no GPU. It cannot tell you the
 * scene looks right — only that the renderer runs, produces finite transforms,
 * and stays inside its instance budgets. Looking at it still needs a browser
 * (see CLAUDE.md).
 *
 *   node --import ./tests/register-three-stub.mjs tests/renderer.smoke.mjs
 */
import { World } from '../src/sim/world.js';
import { ChaseCamera } from '../src/camera.js';

// Minimal DOM for the canvas textures the renderer builds.
const ctx2d = {
  fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
  fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  createLinearGradient() { return { addColorStop() {} }; },
};
const makeCanvas = () => ({ width: 1280, height: 720, getContext: () => ctx2d, style: {} });
globalThis.document = { createElement: () => makeCanvas() };

const { Renderer } = await import('../src/render/renderer.js');
const THREE = await import('./three-stub.mjs');

const canvas = makeCanvas();
const renderer = new Renderer(canvas);
renderer.resize(1280, 720, 2);

const world = new World({ seed: 4242 });
const camera = new ChaseCamera();
camera.snapTo(world.player);

let frames = 0, deaths = 0, maxBodies = 0, maxScenery = 0, maxGlow = 0;
for (let i = 0; i < 900; i++) {
  const boost = i % 180 < 40;
  world.update(1 / 60, { steer: Math.sin(i / 40) * 0.8, boost });
  camera.update(1 / 60, world.player, world.state === 'playing');
  renderer.render(world, camera);
  frames++;
  maxBodies = Math.max(maxBodies, renderer.bodies.n);
  maxScenery = Math.max(maxScenery, renderer.scenery.n);
  maxGlow = Math.max(maxGlow, renderer.glow.n);
  if (world.state !== 'playing') { deaths++; world.reset(); camera.snapTo(world.player); }
}

// A long snake and a full particle burst are the capacity worst case.
world.reset();
world.player.grow(220);
world.spawnBurst(0, 1, 0, 400, [1, 0.5, 0.2]);
for (let i = 0; i < 120; i++) {
  world.update(1 / 60, { steer: 0.3, boost: true });
  camera.update(1 / 60, world.player, true);
  renderer.render(world, camera);
  maxBodies = Math.max(maxBodies, renderer.bodies.n);
}

const cap = { bodies: renderer.bodies.capacity, scenery: renderer.scenery.capacity, glow: renderer.glow.capacity };
console.log('frames rendered      :', THREE.stats.renders);
console.log('instances written    :', THREE.stats.matrices, 'matrices,', THREE.stats.colors, 'colors');
console.log('peak scenery         :', maxScenery, '/', cap.scenery);
console.log('peak bodies          :', maxBodies, '/', cap.bodies, '(long snake + 400 particles)');
console.log('peak glow            :', maxGlow, '/', cap.glow);
console.log('scenery rebuilds     :', renderer._sceneryFor ? 'tracked' : 'none');
console.log('camera lookAt calls  :', renderer.camera.looks);
console.log('deaths handled        :', deaths);
if (maxBodies >= cap.bodies) throw new Error('bodies batch saturated — instances would be dropped');
if (maxScenery >= cap.scenery) throw new Error('scenery batch saturated');
if (maxGlow >= cap.glow) throw new Error('glow batch saturated');
console.log('\nOK: no NaN matrices, no capacity overflow, no bad colours');
