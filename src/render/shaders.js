/*
 * GLSL ES 1.00 shader sources, so WebGL1 and WebGL2 both compile them.
 *
 *   solid  - lit, fogged instanced cubes (everything solid in the scene)
 *   blend  - translucent instanced quads/cubes: contact shadows and glow columns
 *   ground - the checkered arena floor
 *   sky    - a full-screen gradient behind the world
 */

export const SOLID_VERT = `
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

export const SOLID_FRAG = `
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

export const BLEND_VERT = `
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

export const BLEND_FRAG = `
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

export const GROUND_VERT = `
  attribute vec3 a_pos;
  attribute vec3 a_norm;
  uniform mat4 u_viewProj;
  uniform float u_size;
  varying vec3 v_world;
  void main() {
    v_world = vec3(a_pos.x * u_size, 0.0, a_pos.z * u_size);
    gl_Position = u_viewProj * vec4(v_world, 1.0);
  }`;

export const GROUND_FRAG = `
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

export const SKY_VERT = `
  attribute vec3 a_pos;
  attribute vec3 a_norm;
  varying float v_t;
  void main() {
    v_t = a_pos.z * 2.0;
    gl_Position = vec4(a_pos.x * 2.0, a_pos.z * 2.0, 0.999, 1.0);
  }`;

export const SKY_FRAG = `
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
