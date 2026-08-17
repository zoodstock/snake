/*
 * Renderer: blocky, Roblox-flavoured look built from one instanced cube.
 * Draw order per frame: sky gradient -> ground -> soft shadows -> solids -> glows.
 */
(function (root) {
  'use strict';

  const M3 = root.M3;
  const GL = root.GLCore;

  const PALETTE = {
    skyTop: M3.color(0x2f7fd0),
    skyHorizon: M3.color(0xa8dcf2),
    fog: M3.color(0x9fd0e8),
    grassA: M3.color(0x5aa84f),
    grassB: M3.color(0x4f9b47),
    grassLine: M3.color(0x3f7f3a),
    edgeWarn: M3.color(0xd8b24a),
    wallA: M3.color(0xdcd6c8),
    wallB: M3.color(0xb8b1a1),
    wallAccent: M3.color(0xe0575f),
    obstacle: [M3.color(0x9096a4), M3.color(0xb5793f), M3.color(0x6f8fb5)],
    obstacleTop: M3.color(0xffffff),
    playerBody: [M3.color(0x63d94e), M3.color(0x3faf3a)],
    playerHead: M3.color(0x7cec62),
    eye: M3.color(0xffffff),
    pupil: M3.color(0x141a20),
    tongue: M3.color(0xf25c7f),
    food: M3.color(0xe8434f),
    foodGold: M3.color(0xffc63c),
    rivals: [
      [M3.color(0xa661e8), M3.color(0x7d3fbf), M3.color(0xbb85f0)],
      [M3.color(0xf0973c), M3.color(0xc86a1e), M3.color(0xf7b163)],
      [M3.color(0x3fd0d8), M3.color(0x2596a3), M3.color(0x74e6ea)],
      [M3.color(0xf05a9b), M3.color(0xbf3c74), M3.color(0xf788b8)],
    ],
  };

  const SOLID_VERT = `
    attribute vec3 a_pos;
    attribute vec3 a_norm;
    attribute vec3 i_offset;
    attribute vec3 i_scale;
    attribute vec2 i_rot_emi;
    attribute vec3 i_color;
    uniform mat4 u_viewProj;
    varying vec3 v_norm;
    varying vec3 v_color;
    varying vec3 v_world;
    varying float v_emi;
    void main() {
      float s = sin(i_rot_emi.x), c = cos(i_rot_emi.x);
      vec3 p = a_pos * i_scale;
      vec3 world = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) + i_offset;
      v_norm = vec3(a_norm.x * c + a_norm.z * s, a_norm.y, -a_norm.x * s + a_norm.z * c);
      v_color = i_color;
      v_emi = i_rot_emi.y;
      v_world = world;
      gl_Position = u_viewProj * vec4(world, 1.0);
    }`;

  const SOLID_FRAG = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying vec3 v_norm;
    varying vec3 v_color;
    varying vec3 v_world;
    varying float v_emi;
    uniform vec3 u_lightDir;
    uniform vec3 u_camPos;
    uniform vec3 u_fogColor;
    uniform float u_fogDensity;
    void main() {
      vec3 n = normalize(v_norm);
      float diff = max(dot(n, u_lightDir), 0.0);
      vec3 ambient = mix(vec3(0.26, 0.28, 0.34), vec3(0.46, 0.52, 0.60), 0.5 + 0.5 * n.y);
      vec3 lit = v_color * (ambient + vec3(1.0, 0.97, 0.88) * diff * 0.85);
      lit += v_color * v_emi;
      float dist = length(v_world - u_camPos) * u_fogDensity;
      float fog = clamp(1.0 - exp(-dist * dist), 0.0, 1.0);
      gl_FragColor = vec4(mix(lit, u_fogColor, fog), 1.0);
    }`;

  const BLEND_VERT = `
    attribute vec3 a_pos;
    attribute vec3 a_norm;
    attribute vec3 i_offset;
    attribute vec3 i_scale;
    attribute vec2 i_rot_emi;
    attribute vec3 i_color;
    uniform mat4 u_viewProj;
    varying vec3 v_local;
    varying vec3 v_color;
    varying float v_alpha;
    void main() {
      float s = sin(i_rot_emi.x), c = cos(i_rot_emi.x);
      vec3 p = a_pos * i_scale;
      vec3 world = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) + i_offset;
      v_local = a_pos;
      v_color = i_color;
      v_alpha = i_rot_emi.y;
      gl_Position = u_viewProj * vec4(world, 1.0);
    }`;

  const BLEND_FRAG = `
    precision mediump float;
    varying vec3 v_local;
    varying vec3 v_color;
    varying float v_alpha;
    uniform float u_mode;
    void main() {
      float a = v_alpha;
      if (u_mode < 0.5) {
        a *= smoothstep(0.5, 0.16, length(v_local.xz));       // round shadow blob
      } else {
        a *= 1.0 - smoothstep(-0.5, 0.5, v_local.y);          // glow column, fades upward
        a *= 1.0 - smoothstep(0.25, 0.5, abs(v_local.x) + abs(v_local.z));
      }
      gl_FragColor = vec4(v_color * a, a);
    }`;

  const GROUND_VERT = `
    attribute vec3 a_pos;
    attribute vec3 a_norm;
    uniform mat4 u_viewProj;
    uniform float u_size;
    varying vec3 v_world;
    void main() {
      v_world = vec3(a_pos.x * u_size, 0.0, a_pos.z * u_size);
      gl_Position = u_viewProj * vec4(v_world, 1.0);
    }`;

  const GROUND_FRAG = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying vec3 v_world;
    uniform vec3 u_camPos;
    uniform vec3 u_colA;
    uniform vec3 u_colB;
    uniform vec3 u_colLine;
    uniform vec3 u_colEdge;
    uniform vec3 u_fogColor;
    uniform float u_fogDensity;
    uniform float u_arena;
    void main() {
      float tile = 4.0;
      vec2 cell = floor(v_world.xz / tile);
      float checker = mod(cell.x + cell.y, 2.0);
      vec3 base = mix(u_colA, u_colB, checker);
      vec2 f = abs(fract(v_world.xz / tile) - 0.5);
      float line = smoothstep(0.44, 0.5, max(f.x, f.y));
      base = mix(base, u_colLine, line * 0.5);
      float edge = smoothstep(u_arena - 7.0, u_arena, max(abs(v_world.x), abs(v_world.z)));
      base = mix(base, u_colEdge, edge * 0.45);
      base *= 0.72;
      float dist = length(v_world - u_camPos) * u_fogDensity;
      float fog = clamp(1.0 - exp(-dist * dist), 0.0, 1.0);
      gl_FragColor = vec4(mix(base, u_fogColor, fog), 1.0);
    }`;

  const SKY_VERT = `
    attribute vec3 a_pos;
    attribute vec3 a_norm;
    varying float v_t;
    void main() {
      v_t = a_pos.z * 2.0;
      gl_Position = vec4(a_pos.x * 2.0, a_pos.z * 2.0, 0.999, 1.0);
    }`;

  const SKY_FRAG = `
    precision mediump float;
    varying float v_t;
    uniform vec3 u_top;
    uniform vec3 u_horizon;
    void main() {
      float t = clamp(v_t * 0.5 + 0.5, 0.0, 1.0);
      vec3 col = mix(u_horizon, u_top, smoothstep(0.32, 1.0, t));
      col += vec3(0.10, 0.08, 0.02) * smoothstep(0.55, 1.0, 1.0 - abs(t - 0.72) * 3.0);
      gl_FragColor = vec4(col, 1.0);
    }`;

  class Renderer {
    constructor(canvas) {
      const ctx = GL.createContext(canvas);
      if (!ctx) throw new Error('WebGL is not available in this browser.');
      this.canvas = canvas;
      this.gl = ctx.gl;
      this.instanced = ctx.instanced;
      const gl = this.gl;

      this.solidProg = new GL.Program(gl, SOLID_VERT, SOLID_FRAG, 'solid');
      this.blendProg = new GL.Program(gl, BLEND_VERT, BLEND_FRAG, 'blend');
      this.groundProg = new GL.Program(gl, GROUND_VERT, GROUND_FRAG, 'ground');
      this.skyProg = new GL.Program(gl, SKY_VERT, SKY_FRAG, 'sky');

      const cube = GL.cubeGeometry();
      const quad = GL.quadGeometry();
      this.cube = new GL.Mesh(gl, cube.vertices, cube.indices);
      this.quad = new GL.Mesh(gl, quad.vertices, quad.indices);

      this.solids = new GL.InstanceBatch(gl, ctx.instanced, 4096);
      this.shadows = new GL.InstanceBatch(gl, ctx.instanced, 1024);
      this.glows = new GL.InstanceBatch(gl, ctx.instanced, 256);

      this.proj = M3.mat4();
      this.view = M3.mat4();
      this.viewProj = M3.mat4();
      this.lightDir = (() => {
        const v = [0.42, 0.82, 0.38];
        const l = Math.hypot(v[0], v[1], v[2]);
        return [v[0] / l, v[1] / l, v[2] / l];
      })();
      this.fogDensity = 0.0115;
      this.walls = null;
      this.width = 1;
      this.height = 1;

      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
    }

    resize(cssWidth, cssHeight, dpr) {
      const w = Math.max(1, Math.round(cssWidth * dpr));
      const h = Math.max(1, Math.round(cssHeight * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this.width = w;
      this.height = h;
    }

    /** Perimeter wall blocks, built once per world. */
    _buildWalls(arena) {
      if (this.walls) return this.walls;
      const blocks = [];
      const step = 2, edge = arena + 1;
      for (let t = -arena; t <= arena; t += step) {
        for (const [x, z] of [[t, -edge], [t, edge], [-edge, t], [edge, t]]) {
          const wave = Math.abs(Math.round(t / step)) % 5;
          const height = wave === 0 ? 4 : 3;
          const color = wave === 0 ? PALETTE.wallAccent : (wave % 2 ? PALETTE.wallA : PALETTE.wallB);
          blocks.push({ x, z, height, color });
        }
      }
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          blocks.push({ x: sx * edge, z: sz * edge, height: 6, color: PALETTE.wallAccent });
        }
      }
      this.walls = { arena, blocks };
      return this.walls;
    }

    setCamera(cam, aspect) {
      M3.perspective(this.proj, cam.fov * Math.PI / 180, aspect, 0.5, 260);
      M3.lookAt(this.view, cam.position, cam.target, [0, 1, 0]);
      M3.multiply(this.viewProj, this.proj, this.view);
      this.camPos = cam.position;
    }

    // --------------------------------------------------------------- scene fill

    _addSnake(snake, colors, opts) {
      const solids = this.solids, shadows = this.shadows;
      const glow = opts && opts.glow ? opts.glow : 0;
      const body = snake.body;
      const total = Math.max(1, body.length);

      for (let i = body.length - 1; i >= 0; i--) {
        const seg = body[i];
        const taper = 1 - 0.4 * (i / total);
        const size = Math.max(0.45, 0.95 * taper);
        const wave = Math.sin(snake.phase - i * 0.55);
        const y = size * 0.5 + wave * 0.12 + 0.04;
        const stripe = (i % 4) < 2 ? colors[0] : colors[1];
        const emissive = glow * (0.35 + 0.3 * wave);
        const length = Math.max(size, snake.spacing * 1.62);   // overlap the neighbours
        solids.add(seg.x, y, seg.z, [size, size * 0.92, length], seg.yaw, emissive, stripe);
        if (i % 2 === 0) {
          shadows.add(seg.x, 0.02, seg.z, size * 2.1, 0, 0.42, [0, 0, 0]);
        }
      }

      // Head, crest, eyes and tongue in the head's local frame. The chase camera
      // mostly sees the head from behind, so the silhouette has to do the work.
      const headSize = 1.44;
      const headY = headSize * 0.5 + Math.sin(snake.phase) * 0.06 + 0.05;
      const headColor = colors[2] || colors[0];
      solids.add(snake.x, headY, snake.z, [headSize, headSize * 0.84, headSize * 1.3], snake.yaw, glow * 0.5, headColor);
      shadows.add(snake.x, 0.02, snake.z, headSize * 2.3, 0, 0.46, [0, 0, 0]);

      const place = (lx, ly, lz, scale, emissive, color) => {
        const [wx, wz] = M3.rotateY(lx, lz, snake.yaw);
        solids.add(snake.x + wx, headY + ly, snake.z + wz, scale, snake.yaw, emissive, color);
      };
      // Crest ridge along the top, so you can pick your head out of your own body.
      place(0, headSize * 0.44, -0.1, [headSize * 0.42, 0.26, headSize * 1.0], glow * 0.6, colors[1]);
      for (const side of [-1, 1]) {
        place(side * 0.4, 0.28, 0.46, 0.34, 0.25, PALETTE.eye);
        place(side * 0.4, 0.28, 0.63, [0.19, 0.19, 0.07], 0, PALETTE.pupil);
      }
      const flick = 0.28 + Math.max(0, Math.sin(snake.phase * 0.7)) * 0.35;
      place(0, -0.16, 0.62 + flick * 0.5, [0.09, 0.07, flick], 0.2, PALETTE.tongue);
    }

    _addWorld(world, time) {
      const solids = this.solids, shadows = this.shadows, glows = this.glows;
      solids.clear(); shadows.clear(); glows.clear();

      const walls = this._buildWalls(world.cfg.arena);
      for (const b of walls.blocks) {
        for (let level = 0; level < b.height; level++) {
          const shade = 1 - level * 0.05;
          solids.add(b.x, level + 0.5, b.z, [2, 1, 2], 0, 0,
            [b.color[0] * shade, b.color[1] * shade, b.color[2] * shade]);
        }
      }

      for (const o of world.obstacles) {
        const base = PALETTE.obstacle[o.tint % PALETTE.obstacle.length];
        for (let level = 0; level < o.height; level++) {
          const shade = 0.82 + 0.18 * (level / Math.max(1, o.height - 1));
          const jitter = ((level % 2) ? 0.06 : -0.04);
          solids.add(o.x + jitter, level + 0.5, o.z - jitter, [o.size, 1, o.size], 0, 0,
            [base[0] * shade, base[1] * shade, base[2] * shade]);
        }
        shadows.add(o.x, 0.02, o.z, o.size * 1.75, 0, 0.5, [0, 0, 0]);
      }

      for (const f of world.foods) {
        const color = f.golden ? PALETTE.foodGold : PALETTE.food;
        const bob = Math.sin(f.phase) * 0.22;
        const size = f.golden ? 1.05 : 0.85;
        const pulse = 0.45 + 0.3 * (0.5 + 0.5 * Math.sin(f.phase * 2));
        solids.add(f.x, 1.05 + bob, f.z, size, f.phase * 0.9, pulse, color);
        solids.add(f.x, 1.05 + bob + size * 0.62, f.z, [0.16, 0.3, 0.16], f.phase * 0.9, 0.2, PALETTE.grassLine);
        shadows.add(f.x, 0.02, f.z, size * 2.0, 0, 0.34, [0, 0, 0]);
        glows.add(f.x, 3.0, f.z, [size * 1.7, 6.4, size * 1.7], 0, f.golden ? 0.5 : 0.34, color);
      }

      for (const rival of world.rivals) {
        if (!rival.snake.alive) continue;
        const colors = PALETTE.rivals[rival.tint % PALETTE.rivals.length];
        this._addSnake(rival.snake, colors, { glow: rival.snake.boosting ? 0.4 : 0 });
      }

      if (world.player.alive) {
        const colors = [PALETTE.playerBody[0], PALETTE.playerBody[1], PALETTE.playerHead];
        this._addSnake(world.player, colors, { glow: world.player.boosting ? 0.55 : 0 });
      }

      for (const p of world.particles) {
        const fade = Math.max(0, Math.min(1, p.life / p.maxLife));
        const size = p.size * (0.4 + 0.6 * fade);
        solids.add(p.x, p.y, p.z, size, p.rot, 0.25, p.color);
      }

      this._time = time;
    }

    // -------------------------------------------------------------------- draw

    render(world, cam) {
      const gl = this.gl;
      this._addWorld(world, world.time);
      this.setCamera(cam, this.width / this.height);

      gl.viewport(0, 0, this.width, this.height);
      gl.depthMask(true);
      gl.clearColor(PALETTE.fog[0], PALETTE.fog[1], PALETTE.fog[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // Sky gradient behind everything.
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      this.skyProg.use()
        .set('u_top', PALETTE.skyTop[0], PALETTE.skyTop[1], PALETTE.skyTop[2])
        .set('u_horizon', PALETTE.skyHorizon[0], PALETTE.skyHorizon[1], PALETTE.skyHorizon[2]);
      this.quad.bind();
      gl.drawElements(gl.TRIANGLES, this.quad.count, gl.UNSIGNED_SHORT, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);

      // Ground.
      const g = this.groundProg.use();
      g.setMat4('u_viewProj', this.viewProj);
      g.set('u_size', (world.cfg.arena + 30) * 2);
      g.set('u_arena', world.cfg.arena);
      g.set('u_camPos', this.camPos[0], this.camPos[1], this.camPos[2]);
      g.set('u_colA', PALETTE.grassA[0], PALETTE.grassA[1], PALETTE.grassA[2]);
      g.set('u_colB', PALETTE.grassB[0], PALETTE.grassB[1], PALETTE.grassB[2]);
      g.set('u_colLine', PALETTE.grassLine[0], PALETTE.grassLine[1], PALETTE.grassLine[2]);
      g.set('u_colEdge', PALETTE.edgeWarn[0], PALETTE.edgeWarn[1], PALETTE.edgeWarn[2]);
      g.set('u_fogColor', PALETTE.fog[0], PALETTE.fog[1], PALETTE.fog[2]);
      g.set('u_fogDensity', this.fogDensity);
      this.quad.bind();
      gl.drawElements(gl.TRIANGLES, this.quad.count, gl.UNSIGNED_SHORT, 0);

      // Contact shadows (alpha blended, no depth write).
      const b = this.blendProg.use();
      b.setMat4('u_viewProj', this.viewProj);
      b.set('u_mode', 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      this.shadows.draw(this.quad);

      // Solid geometry.
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      const s = this.solidProg.use();
      s.setMat4('u_viewProj', this.viewProj);
      s.set('u_lightDir', this.lightDir[0], this.lightDir[1], this.lightDir[2]);
      s.set('u_camPos', this.camPos[0], this.camPos[1], this.camPos[2]);
      s.set('u_fogColor', PALETTE.fog[0], PALETTE.fog[1], PALETTE.fog[2]);
      s.set('u_fogDensity', this.fogDensity);
      this.solids.draw(this.cube);

      // Additive glow columns over the food.
      const b2 = this.blendProg.use();
      b2.setMat4('u_viewProj', this.viewProj);
      b2.set('u_mode', 1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);
      this.glows.draw(this.cube);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  root.SnakeRenderer = { Renderer, PALETTE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
