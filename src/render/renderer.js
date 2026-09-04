/*
 * Renderer, built on three.js.
 *
 * The blocky look comes from drawing nearly everything as instanced boxes, in
 * four meshes:
 *
 *   scenery  - walls and pillars. Static: rebuilt only when the arena changes.
 *   bodies   - snakes and particles. Rewritten every frame.
 *   glow     - unlit boxes: food, eyes, tongue. Reads as emissive.
 *   beacons  - additive columns over the food, visible across the arena.
 *
 * The renderer only reads the world. It never changes it.
 */

import * as THREE from 'three';
import { rotateY } from '../sim/math.js';
import { PALETTE, brighten } from './palette.js';

const CAPACITY = { scenery: 1600, bodies: 2400, glow: 160, beacons: 48 };

const FOG_NEAR = 55;
const FOG_FAR = 200;
const TILE = 4;                  // ground checker cell, in world units

/** Reusable scratch objects so the frame loop allocates nothing. */
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _matrix = new THREE.Matrix4();
const _color = new THREE.Color();

/**
 * A growable-until-full instanced box batch. `add()` during the frame, then
 * `commit()` once — that is when the GPU buffers are flagged.
 */
class BoxBatch {
  constructor(material, capacity, opts) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    // Instances move every frame, so let three skip the (now meaningless) cull.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = !!(opts && opts.castShadow);
    this.mesh.receiveShadow = !!(opts && opts.receiveShadow);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.capacity = capacity;
    this.n = 0;
  }

  clear() { this.n = 0; return this; }

  /** `scale` is a number or [x, y, z]; `rotY` radians; `hex` a colour. */
  add(x, y, z, scale, rotY, hex) {
    if (this.n >= this.capacity) return this;
    _pos.set(x, y, z);
    if (typeof scale === 'number') _scale.set(scale, scale, scale);
    else _scale.set(scale[0], scale[1], scale[2]);
    _euler.set(0, rotY, 0);
    _quat.setFromEuler(_euler);
    _matrix.compose(_pos, _quat, _scale);
    this.mesh.setMatrixAt(this.n, _matrix);
    this.mesh.setColorAt(this.n, _color.set(hex));
    this.n++;
    return this;
  }

  commit() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** A 2x2 checker tile with faint seams, drawn once into a canvas. */
function groundTexture() {
  const px = 256;                       // pixels per world tile
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px * 2;
  const ctx = canvas.getContext('2d');
  const cells = [
    [0, 0, PALETTE.grassA], [1, 0, PALETTE.grassB],
    [0, 1, PALETTE.grassB], [1, 1, PALETTE.grassA],
  ];
  for (const [cx, cy, hex] of cells) {
    ctx.fillStyle = '#' + hex.toString(16).padStart(6, '0');
    ctx.fillRect(cx * px, cy * px, px, px);
  }
  ctx.strokeStyle = '#' + PALETTE.grassLine.toString(16).padStart(6, '0');
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.5;
  for (const at of [0, px, px * 2]) {
    ctx.beginPath(); ctx.moveTo(at, 0); ctx.lineTo(at, px * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, at); ctx.lineTo(px * 2, at); ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Vertical sky gradient, horizon colour matched to the fog so they blend. */
function skyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  const hex = (h) => '#' + h.toString(16).padStart(6, '0');
  gradient.addColorStop(0, hex(PALETTE.sky));
  gradient.addColorStop(0.55, hex(PALETTE.skyHorizon));
  gradient.addColorStop(1, hex(PALETTE.fog));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Drawn full-screen, so it is always magnified: mips would only cost memory.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.three = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.three.shadowMap.enabled = true;
    this.three.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(PALETTE.fog, FOG_NEAR, FOG_FAR);

    // far has to clear the ground's far corner (see render()), otherwise the far
    // plane slices the fogged ground and puts the hard horizon back.
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 460);

    this.scene.add(new THREE.HemisphereLight(PALETTE.skyHorizon, PALETTE.grassA, 1.15));
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.1);
    this.sun.castShadow = true;
    // 2048 over the 92-unit frustum below is 22 texels per world unit, and the
    // shadow edges were visibly stepped at 1:1. 4096 doubles that; the scene is
    // only ~10k triangles in 6 draw calls, so the depth-only pass is cheap next to
    // how much of the frame shadows cover. A GPU whose whole texture limit is 4096
    // is not one to spend all of it on a shadow map, so those stay at 2048.
    const shadowPx = this.three.capabilities.maxTextureSize >= 8192 ? 4096 : 2048;
    this.sun.shadow.mapSize.set(shadowPx, shadowPx);
    this.sun.shadow.bias = -0.0006;
    const shadowCam = this.sun.shadow.camera;
    shadowCam.left = -46; shadowCam.right = 46;
    shadowCam.top = 46; shadowCam.bottom = -46;
    shadowCam.near = 1; shadowCam.far = 200;
    shadowCam.updateProjectionMatrix();
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Ground. Sized in render() once the arena is known.
    this.groundTexture = groundTexture();
    this.groundTexture.anisotropy = this.three.capabilities.getMaxAnisotropy();
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshLambertMaterial({ map: this.groundTexture }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this._groundSized = 0;

    this.scenery = new BoxBatch(
      new THREE.MeshLambertMaterial(), CAPACITY.scenery,
      { castShadow: true, receiveShadow: true },
    );
    this.bodies = new BoxBatch(
      new THREE.MeshLambertMaterial(), CAPACITY.bodies,
      { castShadow: true, receiveShadow: true },
    );
    this.glow = new BoxBatch(new THREE.MeshBasicMaterial(), CAPACITY.glow, {});
    this.beacons = new BoxBatch(new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }), CAPACITY.beacons, {});

    for (const batch of [this.scenery, this.bodies, this.glow, this.beacons]) {
      this.scene.add(batch.mesh);
    }

    this._sceneryFor = null;      // the obstacles array the scenery was built from
    this.width = 1;
    this.height = 1;
  }

  resize(cssWidth, cssHeight, dpr) {
    const w = Math.max(1, Math.floor(cssWidth));
    const h = Math.max(1, Math.floor(cssHeight));
    this.three.setPixelRatio(dpr);
    this.three.setSize(w, h, false);        // false: CSS already sizes the canvas
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // --------------------------------------------------------------- scene fill

  /** Walls and pillars only change when a new arena is generated. */
  _buildScenery(world) {
    if (this._sceneryFor === world.obstacles) return;
    this._sceneryFor = world.obstacles;

    const arena = world.cfg.arena;
    const batch = this.scenery.clear();
    const edge = arena + 1;
    for (let t = -arena; t <= arena; t += 2) {
      for (const [x, z] of [[t, -edge], [t, edge], [-edge, t], [edge, t]]) {
        const wave = Math.abs(Math.round(t / 2)) % 5;
        const height = wave === 0 ? 4 : 3;
        const hex = wave === 0 ? PALETTE.wallAccent : (wave % 2 ? PALETTE.wallA : PALETTE.wallB);
        for (let level = 0; level < height; level++) {
          batch.add(x, level + 0.5, z, [2, 1, 2], 0, hex);
        }
      }
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (let level = 0; level < 6; level++) {
          batch.add(sx * edge, level + 0.5, sz * edge, [2, 1, 2], 0, PALETTE.wallAccent);
        }
      }
    }

    for (const o of world.obstacles) {
      const base = PALETTE.obstacle[o.tint % PALETTE.obstacle.length];
      for (let level = 0; level < o.height; level++) {
        // Nudge alternate courses so stacks read as stacked blocks, not columns.
        const jitter = (level % 2) ? 0.06 : -0.04;
        batch.add(o.x + jitter, level + 0.5, o.z - jitter, [o.size, 1, o.size], 0, base);
      }
    }
    batch.commit();
  }

  /**
   * Place a box in the snake's local frame: +z is straight ahead, +x is its left.
   * `yawExtra` tilts the box itself without moving it, which is how the twin form
   * splays its two heads apart.
   */
  _place(batch, snake, baseY, lx, ly, lz, scale, hex, yawExtra) {
    const [wx, wz] = rotateY(lx, lz, snake.yaw);
    batch.add(snake.x + wx, baseY + ly, snake.z + wz, scale, snake.yaw + (yawExtra || 0), hex);
  }

  /** One head: skull, crest, eyes and a flicking tongue. Twin snakes get two. */
  _addHead(snake, colors, headHex, headSize, headY, side, tilt) {
    const batch = this.bodies;
    const put = (target, lx, ly, lz, scale, hex) =>
      this._place(target, snake, headY, lx + side, ly, lz, scale, hex, tilt);

    put(batch, 0, 0, 0, [headSize, headSize * 0.84, headSize * 1.3], headHex);
    put(batch, 0, headSize * 0.44, -0.1, [headSize * 0.42, 0.26, headSize], colors[1]);
    for (const eye of [-1, 1]) {
      put(this.glow, eye * 0.4, 0.28, 0.46, 0.34, PALETTE.eye);
      put(batch, eye * 0.4, 0.28, 0.63, [0.19, 0.19, 0.07], PALETTE.pupil);
    }
    const flick = 0.28 + Math.max(0, Math.sin(snake.phase * 0.7)) * 0.35;
    put(this.glow, 0, -0.16, 0.62 + flick * 0.5, [0.09, 0.07, flick], PALETTE.tongue);
  }

  _addSnake(snake, colors, boosting, form) {
    const batch = this.bodies;
    const body = snake.body;
    const total = Math.max(1, body.length);
    const glowT = boosting ? 0.32 : 0;

    for (let i = body.length - 1; i >= 0; i--) {
      const seg = body[i];
      const taper = 1 - 0.4 * (i / total);
      const size = Math.max(0.45, 0.95 * taper);
      const wave = Math.sin(snake.phase - i * 0.55);
      const y = size * 0.5 + wave * 0.12 + 0.04;
      const stripe = (i % 4) < 2 ? colors[0] : colors[1];
      const length = Math.max(size, snake.spacing * 1.62);   // overlap the neighbours
      const hex = glowT ? brighten(stripe, glowT * (0.6 + 0.4 * wave)) : stripe;
      batch.add(seg.x, y, seg.z, [size, size * 0.92, length], seg.yaw, hex);
    }

    // Head, crest, eyes and tongue in the head's local frame. The chase camera
    // mostly sees the head from behind, so the silhouette has to do the work.
    const headSize = form === 'kraken' ? 1.72 : 1.44;
    const headY = headSize * 0.5 + Math.sin(snake.phase) * 0.06 + 0.05;
    const headHex = glowT ? brighten(colors[2], glowT * 0.7) : colors[2];

    if (form === 'twin') {
      // The neck forks: two heads side by side, each canted outward.
      for (const side of [-1, 1]) {
        this._addHead(snake, colors, headHex, headSize * 0.82, headY, side * 0.62, side * 0.34);
      }
    } else {
      this._addHead(snake, colors, headHex, headSize, headY, 0, 0);
    }

    if (form && form !== 'snake') this._addFormTrim(snake, colors, form, headSize, headY);
  }

  /** The bits that make each shape recognisable on top of the shared snake. */
  _addFormTrim(snake, colors, form, headSize, headY) {
    const batch = this.bodies;
    const put = (target, lx, ly, lz, scale, hex, tilt) =>
      this._place(target, snake, headY, lx, ly, lz, scale, hex, tilt);

    if (form === 'kraken') {
      // A pale jaw hung under the skull, with a row of teeth along it.
      put(batch, 0, -headSize * 0.4, 0.26, [headSize * 1.02, 0.44, headSize * 1.16],
        PALETTE.krakenMaw);
      for (let t = 0; t < 6; t++) {
        const lx = (t - 2.5) * 0.3;
        put(batch, lx, -headSize * 0.16, 0.82, [0.18, 0.44, 0.18], PALETTE.krakenMaw);
      }
      // Six tentacles off the jaw, each a tapering chain that undulates. They have
      // to be long and thick enough to read as limbs — at a quarter of this size
      // they looked like crumbs scattered round the head.
      for (let t = 0; t < 6; t++) {
        const spread = -1.5 + t * 0.6;
        // Alternate limbs ride higher, and the undulation is gentle enough that a
        // chain still reads as one limb: at six overlapping arcs it was a pile.
        const lift = (t % 2) ? 0.3 : -0.02;
        for (let k = 0; k < 5; k++) {
          const wave = Math.sin(snake.phase * 1.5 - k * 0.85 + t * 1.1) * 0.2;
          const out = spread + wave * (0.25 + k * 0.12);
          const reach = 0.75 + k * 0.66;
          put(batch,
            Math.sin(out) * reach,
            -headSize * 0.14 + lift - k * 0.12,
            0.45 + Math.cos(out) * reach * 0.7,
            [0.46 - k * 0.06, 0.44 - k * 0.06, 0.82 - k * 0.1],
            PALETTE.krakenTentacle, out * 0.75);
        }
      }
      return;
    }

    if (form === 'abyss') {
      // Two long feelers with lit tips, the way the reference carries its lures.
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const sway = Math.sin(snake.phase * 1.1 + k * 0.7 + side) * 0.22;
          put(batch, side * (0.3 + k * 0.24) + sway * side, 0.62 + k * 0.42,
            0.5 + k * 0.5, [0.1, 0.1, 0.5], PALETTE.abyssVent);
        }
        const sway = Math.sin(snake.phase * 1.1 + 2.1 + side) * 0.22;
        put(this.glow, side * 1.02 + sway * side, 1.9, 2.0, 0.3, PALETTE.abyssLure);
      }
      // Flecks down the flanks and vents glowing between the plates. Strided so a
      // long snake cannot blow the glow batch's budget.
      const body = snake.body;
      const stride = Math.max(2, Math.ceil(body.length / 14));
      for (let i = 0; i < body.length; i += stride) {
        const seg = body[i];
        const wave = Math.sin(snake.phase - i * 0.55);
        const y = 0.5 + wave * 0.12 + 0.34;
        const [ox, oz] = rotateY(0.42, 0, seg.yaw);
        this.glow.add(seg.x + ox, y, seg.z + oz, 0.16, seg.yaw, PALETTE.abyssSpot);
        this.glow.add(seg.x - ox, y, seg.z - oz, 0.16, seg.yaw, PALETTE.abyssSpot);
        if (i % (stride * 2) === 0) {
          this.glow.add(seg.x, y - 0.34, seg.z, [0.5, 0.1, 0.24], seg.yaw, PALETTE.abyssVent);
        }
      }
      return;
    }

    if (form === 'twin') {
      // Banding down the back, so the second head reads as part of one animal.
      const body = snake.body;
      for (let i = 1; i < body.length; i += 3) {
        const seg = body[i];
        const wave = Math.sin(snake.phase - i * 0.55);
        this.bodies.add(seg.x, 0.5 + wave * 0.12 + 0.4, seg.z,
          [0.86, 0.16, 0.34], seg.yaw, PALETTE.twinBand);
      }
    }
  }

  _fill(world) {
    this._buildScenery(world);

    const bodies = this.bodies.clear();
    const glow = this.glow.clear();
    const beacons = this.beacons.clear();

    for (const f of world.foods) {
      const hex = f.blue ? PALETTE.foodBlue : f.golden ? PALETTE.foodGold : PALETTE.food;
      const bob = Math.sin(f.phase) * 0.22;
      const size = f.blue ? 1.15 : f.golden ? 1.05 : 0.85;
      glow.add(f.x, 1.05 + bob, f.z, size, f.phase * 0.9, hex);
      bodies.add(f.x, 1.05 + bob + size * 0.62, f.z, [0.16, 0.3, 0.16], f.phase * 0.9, PALETTE.grassLine);
      // A blue apple is rare and worth crossing the arena for, so its beacon is
      // taller than the rest.
      const column = f.blue ? 9.5 : 6.4;
      beacons.add(f.x, column * 0.5, f.z, [size * 1.7, column, size * 1.7], 0, hex);
    }

    for (const rival of world.rivals) {
      if (!rival.snake.alive) continue;
      this._addSnake(rival.snake, PALETTE.rivals[rival.tint % PALETTE.rivals.length],
        rival.snake.boosting);
    }
    if (world.player.alive) {
      const form = world.formId || 'snake';
      const colors = PALETTE.forms[form] ||
        [PALETTE.playerBody[0], PALETTE.playerBody[1], PALETTE.playerHead];
      this._addSnake(world.player, colors, world.player.boosting, form);
    }

    for (const p of world.particles) {
      const fade = Math.max(0, Math.min(1, p.life / p.maxLife));
      const size = p.size * (0.4 + 0.6 * fade);
      // Particles carry [r,g,b] in 0..1 from the simulation.
      const hex = (Math.round(p.color[0] * 255) << 16) |
        (Math.round(p.color[1] * 255) << 8) | Math.round(p.color[2] * 255);
      bodies.add(p.x, p.y, p.z, size, p.rot, hex);
    }

    bodies.commit();
    glow.commit();
    beacons.commit();
  }

  // -------------------------------------------------------------------- draw

  render(world, cam) {
    const arena = world.cfg.arena;
    if (this._groundSized !== arena) {
      // The ground has to reach a full fog distance past the arena on every
      // side: anywhere the player can stand, the nearest edge is then at least
      // FOG_FAR away and fades into the sky. At (arena + 30) the edge came out
      // less than half fogged and read as a hard horizon line. Rounded up to a
      // whole number of checker cells so the texture does not wrap mid-cell.
      const cell = TILE * 2;
      const size = Math.ceil((arena + FOG_FAR) * 2 / cell) * cell;
      this.ground.geometry.dispose();
      this.ground.geometry = new THREE.PlaneGeometry(size, size);
      this.groundTexture.repeat.set(size / cell, size / cell);
      this._groundSized = arena;
    }

    this._fill(world);

    // Keep the shadow frustum over the player rather than the whole arena.
    const px = world.player.x, pz = world.player.z;
    this.sun.position.set(px + 38, 66, pz + 26);
    this.sun.target.position.set(px, 0, pz);
    this.sun.target.updateMatrixWorld();

    if (this.camera.fov !== cam.fov) {
      this.camera.fov = cam.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(cam.position[0], cam.position[1], cam.position[2]);
    this.camera.lookAt(cam.target[0], cam.target[1], cam.target[2]);

    this.three.render(this.scene, this.camera);
  }
}
