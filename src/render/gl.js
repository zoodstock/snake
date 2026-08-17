/*
 * Tiny WebGL helper layer: context setup, shader programs, static meshes and
 * instanced batches. GLSL ES 1.00 shaders so WebGL1 (+ ANGLE_instanced_arrays)
 * and WebGL2 both work.
 */
// Fixed attribute slots shared by every program in the game.
export const ATTR = {
  a_pos: 0,
  a_norm: 1,
  i_offset: 2,
  i_scale: 3,
  i_rot_emi: 4,
  i_color: 5,
};
export const INSTANCE_FLOATS = 11; // offset(3) + scale(3) + rot/emissive(2) + color(3)

export function createContext(canvas) {
  const attrs = { antialias: true, alpha: false, depth: true, powerPreference: 'high-performance' };
  let gl = canvas.getContext('webgl2', attrs);
  let instanced;
  if (gl) {
    instanced = {
      divisor: (loc, n) => gl.vertexAttribDivisor(loc, n),
      drawElements: (mode, count, type, offset, prims) =>
        gl.drawElementsInstanced(mode, count, type, offset, prims),
    };
  } else {
    gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
    if (!gl) return null;
    const ext = gl.getExtension('ANGLE_instanced_arrays');
    if (!ext) return null;
    instanced = {
      divisor: (loc, n) => ext.vertexAttribDivisorANGLE(loc, n),
      drawElements: (mode, count, type, offset, prims) =>
        ext.drawElementsInstancedANGLE(mode, count, type, offset, prims),
    };
  }
  return { gl, instanced };
}

function compile(gl, type, source, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(label + ' shader: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

export class Program {
  constructor(gl, vertexSrc, fragmentSrc, label) {
    this.gl = gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vertexSrc, label + ' vertex'));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fragmentSrc, label + ' fragment'));
    for (const name in ATTR) gl.bindAttribLocation(prog, ATTR[name], name);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(label + ' link: ' + gl.getProgramInfoLog(prog));
    }
    this.handle = prog;
    this.uniforms = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(prog, i);
      const name = info.name.replace(/\[0\]$/, '');
      this.uniforms[name] = gl.getUniformLocation(prog, name);
    }
  }

  use() { this.gl.useProgram(this.handle); return this; }

  setMat4(name, value) {
    const loc = this.uniforms[name];
    if (loc) this.gl.uniformMatrix4fv(loc, false, value);
    return this;
  }

  set(name, ...values) {
    const loc = this.uniforms[name];
    if (!loc) return this;
    const gl = this.gl;
    if (values.length === 1) gl.uniform1f(loc, values[0]);
    else if (values.length === 2) gl.uniform2f(loc, values[0], values[1]);
    else if (values.length === 3) gl.uniform3f(loc, values[0], values[1], values[2]);
    else gl.uniform4f(loc, values[0], values[1], values[2], values[3]);
    return this;
  }
}

/** Static indexed mesh with interleaved position + normal. */
export class Mesh {
  constructor(gl, vertices, indices) {
    this.gl = gl;
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    this.count = indices.length;
  }

  bind() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(ATTR.a_pos);
    gl.vertexAttribPointer(ATTR.a_pos, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(ATTR.a_norm);
    gl.vertexAttribPointer(ATTR.a_norm, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
  }
}

/**
 * A growable CPU-side list of instances, uploaded once per draw.
 * Each instance: world offset, per-axis scale, Y rotation, emissive/alpha, color.
 */
export class InstanceBatch {
  constructor(gl, instanced, capacity) {
    this.gl = gl;
    this.instanced = instanced;
    this.capacity = capacity;
    this.data = new Float32Array(capacity * INSTANCE_FLOATS);
    this.count = 0;
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
  }

  clear() { this.count = 0; return this; }

  /** scale may be a number (uniform) or [sx, sy, sz]. */
  add(x, y, z, scale, rot, emissive, color) {
    if (this.count >= this.capacity) return this;
    const i = this.count * INSTANCE_FLOATS;
    const d = this.data;
    d[i] = x; d[i + 1] = y; d[i + 2] = z;
    if (typeof scale === 'number') { d[i + 3] = scale; d[i + 4] = scale; d[i + 5] = scale; }
    else { d[i + 3] = scale[0]; d[i + 4] = scale[1]; d[i + 5] = scale[2]; }
    d[i + 6] = rot; d[i + 7] = emissive;
    d[i + 8] = color[0]; d[i + 9] = color[1]; d[i + 10] = color[2];
    this.count++;
    return this;
  }

  draw(mesh) {
    if (this.count === 0) return;
    const gl = this.gl;
    mesh.bind();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.count * INSTANCE_FLOATS));
    const stride = INSTANCE_FLOATS * 4;
    const layout = [
      [ATTR.i_offset, 3, 0],
      [ATTR.i_scale, 3, 12],
      [ATTR.i_rot_emi, 2, 24],
      [ATTR.i_color, 3, 32],
    ];
    for (const [loc, size, offset] of layout) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
      this.instanced.divisor(loc, 1);
    }
    this.instanced.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0, this.count);
    for (const [loc] of layout) this.instanced.divisor(loc, 0);
  }
}

/** Unit cube centred on the origin, one normal per face. */
export function cubeGeometry() {
  const faces = [
    { n: [0, 0, 1], v: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
    { n: [0, 0, -1], v: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
    { n: [1, 0, 0], v: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
    { n: [-1, 0, 0], v: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
    { n: [0, 1, 0], v: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
    { n: [0, -1, 0], v: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
  ];
  const vertices = [], indices = [];
  faces.forEach((face, f) => {
    for (const v of face.v) vertices.push(v[0], v[1], v[2], face.n[0], face.n[1], face.n[2]);
    const b = f * 4;
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { vertices, indices };
}

/** Unit quad on the XZ plane, facing up. */
export function quadGeometry() {
  const vertices = [
    -0.5, 0, -0.5, 0, 1, 0,
    0.5, 0, -0.5, 0, 1, 0,
    0.5, 0, 0.5, 0, 1, 0,
    -0.5, 0, 0.5, 0, 1, 0,
  ];
  return { vertices, indices: [0, 2, 1, 0, 3, 2] };
}
