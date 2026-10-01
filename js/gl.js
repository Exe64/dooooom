'use strict';
/*
 * MODERN style on the GPU (WebGL2).
 *
 * The grid map becomes real geometry: wall faces, floor and ceiling quads,
 * sliding doors and secret walls, drawn with depth testing at the screen's
 * native resolution. Textures (the same procedural canvases as the software
 * renderer) live in texture arrays with mipmaps and anisotropic filtering, so
 * distant floors and racks no longer shimmer. Billboards (monsters, items,
 * projectiles) are instanced quads tested against the depth buffer.
 * The camera can look up and down.
 *
 * The game logic stays in game.js; this module only draws a frame from the
 * level state. If WebGL2 is missing, game.js keeps the software renderer.
 */
const GLR = (() => {
  let gl = null, cv = null, ok = false;
  let curL = null;
  let progWorld, progSprite;
  let worldVAO = null, worldCount = 0, worldBufs = [];
  let doorVAO = null, doorVBO = null, doorIBO = null, doorCount = 0;
  let spriteVAO = null, spriteInst = null;
  let texWalls = null, texSprites = null, texLight = null;
  let aniso = null;
  let cssW = 1, cssH = 1, dpr = 1, scale = 1, bw = 1, bh = 1;

  const NEAR = 0.02, FAR = 120;
  const TAN_H = 0.8;                     // PLANE in game.js: 77 degree horizontal field of view
  const VSTRIDE = 15;                    // pos3 uv2 nrm3 tan3 tex4 (layer base, frames, phase, kind)
  const KIND_WALL = 0, KIND_FLOOR = 1, KIND_CEIL = 2, KIND_DOOR = 3;

  /* ------------------------------------------------------------ shaders */
  const WORLD_VS = `#version 300 es
  layout(location=0) in vec3 aPos;
  layout(location=1) in vec2 aUv;
  layout(location=2) in vec3 aNrm;
  layout(location=3) in vec3 aTan;
  layout(location=4) in vec4 aTex;
  uniform mat4 uVP;
  uniform float uAnim;
  uniform vec2 uJitter;
  out vec3 vPos; out vec2 vUv; out vec3 vNrm;
  flat out float vLayer; flat out float vKind;
  void main() {
    vPos = aPos; vUv = aUv; vNrm = aNrm;
    vLayer = aTex.x + mod(uAnim + aTex.z, aTex.y);
    vKind = aTex.w;
    gl_Position = uVP * vec4(aPos, 1.0);
    gl_Position.xy += uJitter * gl_Position.w;
  }`;

  const COMMON_FS = `
  uniform sampler2D uLight;      // baked lightmap: 1.0 = 128/255
  uniform vec2 uMapSize;
  uniform vec3 uEye;
  uniform vec3 uFog;
  uniform float uAmb;
  vec3 lightmap(vec2 p) { return texture(uLight, p / uMapSize).rgb * (255.0 / 128.0); }
  // distance falloff of the software renderer (lightAt), in 0..1
  float falloff(float d) { return min(1.0, uAmb / (1.0 + d * 0.07 + d * d * 0.009)); }
  float fogAmt(float d) { return min(200.0 / 256.0, 1.0 - exp(-d * 0.075)); }
  vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
  vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }
  `;

  const WORLD_FS = `#version 300 es
  precision highp float;
  precision highp sampler2DArray;
  in vec3 vPos; in vec2 vUv; in vec3 vNrm;
  flat in float vLayer; flat in float vKind;
  uniform sampler2DArray uTex;
  uniform vec3 uFwd;
  ${COMMON_FS}
  out vec4 oColor;
  void main() {
    vec4 t = texture(uTex, vec3(vUv, vLayer));
    // emissive texels (LEDs, screens, light panels) are stored in alpha
    if (t.a > 0.5) { oColor = vec4(toSrgb(t.rgb), 1.0); return; }
    vec2 lp = vPos.xy + vNrm.xy * (0.5 / 4.0);
    float d = dot(vPos - uEye, uFwd);
    float s = falloff(d);
    if (vKind == 0.0 || vKind == 3.0) {
      if (abs(vNrm.y) > 0.5) s *= 0.8;
      float v = clamp(1.0 - vPos.z, 0.0, 1.0);
      s *= min(1.0, 0.82 + v * 1.8) * (v > 0.82 ? 1.0 - (v - 0.82) * 2.2 : 1.0);
    }
    vec3 c = toSrgb(t.rgb) * lightmap(lp) * s + uFog * fogAmt(d);
    oColor = vec4(min(c, 1.0), 1.0);
  }`;

  const SPRITE_VS = `#version 300 es
  layout(location=0) in vec2 aQuad;
  layout(location=1) in vec4 iPos;    // x, y, bottom z, size
  layout(location=2) in vec4 iTex;    // layer, u scale, v scale, flags (1 flash, 2 self-lit)
  uniform mat4 uVP;
  uniform vec2 uRight;
  uniform vec2 uJitter;
  out vec2 vUv; out vec3 vPos;
  flat out float vLayer; flat out float vFlags; flat out vec2 vFeet;
  void main() {
    vec3 p = vec3(iPos.xy + uRight * (aQuad.x - 0.5) * iPos.w, iPos.z + (1.0 - aQuad.y) * iPos.w);
    vUv = aQuad * iTex.yz;
    vPos = p; vLayer = iTex.x; vFlags = iTex.w; vFeet = iPos.xy;
    gl_Position = uVP * vec4(p, 1.0);
    gl_Position.xy += uJitter * gl_Position.w;
  }`;

  const SPRITE_FS = `#version 300 es
  precision highp float;
  precision highp sampler2DArray;
  in vec2 vUv; in vec3 vPos;
  flat in float vLayer; flat in float vFlags; flat in vec2 vFeet;
  uniform sampler2DArray uTex;
  uniform vec3 uFwd;
  ${COMMON_FS}
  out vec4 oColor;
  void main() {
    vec4 t = texture(uTex, vec3(vUv, vLayer));
    if (t.a < 0.03) discard;
    vec3 c = toSrgb(t.rgb);
    int fl = int(vFlags + 0.5);
    if ((fl & 1) != 0) c = mix(c, vec3(1.0), 0.5);
    else if ((fl & 2) == 0) {
      float d = dot(vPos - uEye, uFwd);
      c = c * lightmap(vFeet) * falloff(d) + uFog * fogAmt(d);
    }
    oColor = vec4(min(c, 1.0), t.a);
  }`;

  function compile(vs, fs) {
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i), nm = a.name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  }

  /* ----------------------------------------------------------- textures */
  const TS = WTEX_HI;          // 256: walls, flats and sprites
  const LEVELS = Math.log2(TS) + 1;

  // Box-filtered mip chain of an RGBA8 image (alpha-weighted so transparent texels don't darken edges).
  function mipChain(rgba, w, h) {
    const out = [rgba];
    let src = rgba, sw = w, sh = h;
    while (sw > 1 || sh > 1) {
      const dw = Math.max(1, sw >> 1), dh = Math.max(1, sh >> 1), dst = new Uint8Array(dw * dh * 4);
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
        let r = 0, g = 0, b = 0, a = 0, rr = 0, gg = 0, bb = 0;
        for (let k = 0; k < 4; k++) {
          const sx = Math.min(sw - 1, x * 2 + (k & 1)), sy = Math.min(sh - 1, y * 2 + (k >> 1)), i = (sy * sw + sx) * 4;
          const al = src[i + 3];
          r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al;
          rr += src[i]; gg += src[i + 1]; bb += src[i + 2];
        }
        const o = (y * dw + x) * 4;
        if (a > 0) { dst[o] = r / a; dst[o + 1] = g / a; dst[o + 2] = b / a; } else { dst[o] = rr / 4; dst[o + 1] = gg / 4; dst[o + 2] = bb / 4; }
        dst[o + 3] = a / 4;
      }
      out.push(dst);
      src = dst; sw = dw; sh = dh;
    }
    return out;
  }

  // Spreads the colors of opaque texels into the transparent ones around them, so that
  // bilinear filtering doesn't pull black into the edges.
  function dilate(rgba, w, h, passes) {
    for (let p = 0; p < passes; p++) {
      const src = rgba.slice();
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (src[i + 3]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = (yy * w + xx) * 4;
          if (!src[j + 3] && !(src[j] | src[j + 1] | src[j + 2])) continue;
          r += src[j]; g += src[j + 1]; b += src[j + 2]; n++;
        }
        if (n) { rgba[i] = r / n; rgba[i + 1] = g / n; rgba[i + 2] = b / n; }
      }
    }
  }

  function newArray(layers, fmt) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, LEVELS, fmt, TS, TS, layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return t;
  }

  // Walls, flats: every texture of Assets gets a layer; the frames of an animated
  // variant are consecutive. Alpha holds the emissive mask.
  let wallLayers = [];
  function buildWallArray() {
    const list = [];
    const reg = (t) => { if (t.glLayer === undefined) { t.glLayer = list.length; list.push(t); } };
    for (const ch of Object.keys(Assets.walls)) for (const v of Assets.walls[ch]) v.forEach(reg);
    for (const ep of Assets.concrete) for (const v of ep) v.forEach(reg);
    Assets.floor.forEach(reg); Assets.ceil.forEach(reg);
    wallLayers = list;
    texWalls = newArray(list.length, gl.SRGB8_ALPHA8);
    list.forEach((t, i) => {
      const rgba = new Uint8Array(t.px.buffer.slice(0));
      for (let k = 0; k < t.em.length; k++) rgba[k * 4 + 3] = t.em[k] ? 255 : 0;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, TS, TS, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    });
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  }

  // Sprites: layers are given out on first use (CPU mips, edge dilation).
  const SPR_CAP = 224;
  let sprLayer = new Map(), sprNext = 0;
  function spriteLayer(spr) {
    let l = sprLayer.get(spr);
    if (l !== undefined) return l;
    if (sprNext >= SPR_CAP) { sprLayer = new Map(); sprNext = 0; }
    l = sprNext++;
    sprLayer.set(spr, l);
    const w = spr.w, h = spr.h;
    const rgba = new Uint8Array(spr.px.buffer.slice(0));
    dilate(rgba, w, h, 3);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texSprites);
    const mips = mipChain(rgba, w, h);
    for (let m = 0; m < Math.min(LEVELS, mips.length); m++) {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, m, 0, 0, l, Math.max(1, w >> m), Math.max(1, h >> m), 1, gl.RGBA, gl.UNSIGNED_BYTE, mips[m]);
    }
    return l;
  }

  /* ----------------------------------------------------------- geometry */
  const solidAt = (L, x, y) => x < 0 || y < 0 || x >= L.w || y >= L.h || (L.map[y * L.w + x] !== 0 && !L.doors[y * L.w + x]);
  const isDoorCell = (L, x, y) => x >= 0 && y >= 0 && x < L.w && y < L.h && !!L.doors[y * L.w + x];

  function wallFrames(L, i) {
    const ch = String.fromCharCode(L.map[i]);
    const vars = ch === '#' || ch === '?' ? Assets.concrete[L.def.episode % 5] : Assets.walls[ch];
    return vars[L.variant[i] % vars.length];
  }

  // A quad: corners p0..p3 (counter-clockwise), uvs, normal, tangent, texture info.
  function pushQuad(V, I, p, uv, n, t, tex) {
    const base = V.length / VSTRIDE;
    for (let k = 0; k < 4; k++) V.push(p[k][0], p[k][1], p[k][2], uv[k][0], uv[k][1], n[0], n[1], n[2], t[0], t[1], t[2], tex[0], tex[1], tex[2], tex[3]);
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // A vertical face along a cell edge, from (ax, ay) to (bx, by), u running from a to b, v from top to bottom.
  function pushWall(V, I, ax, ay, bx, by, u0, u1, n, tex) {
    const t = [bx - ax, by - ay, 0], l = Math.hypot(t[0], t[1]) || 1;
    pushQuad(V, I, [[ax, ay, 1], [bx, by, 1], [bx, by, 0], [ax, ay, 0]], [[u0, 0], [u1, 0], [u1, 1], [u0, 1]], n, [t[0] / l, t[1] / l, 0], tex);
  }

  function makeVAO(V, I, dynamic) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer(), ib = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, V, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    const S = VSTRIDE * 4;
    [[0, 3, 0], [1, 2, 3], [2, 3, 5], [3, 3, 8], [4, 4, 11]].forEach(([loc, n, off]) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, S, off * 4);
    });
    gl.bindVertexArray(null);
    return { vao, vb, ib };
  }

  function buildWorld(L) {
    for (const b of worldBufs) gl.deleteBuffer(b);
    if (worldVAO) gl.deleteVertexArray(worldVAO);
    const V = [], I = [], w = L.w, h = L.h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!L.map[i] || L.doors[i]) {
        // floor and ceiling
        const fl = Assets.floor[L.floor[i]].glLayer, ce = Assets.ceil[L.ceil[i]].glLayer;
        const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
        pushQuad(V, I, [[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]], uv, [0, 0, 1], [1, 0, 0], [fl, 1, 0, KIND_FLOOR]);
        pushQuad(V, I, [[x, y, 1], [x + 1, y, 1], [x + 1, y + 1, 1], [x, y + 1, 1]], uv, [0, 0, -1], [1, 0, 0], [ce, 1, 0, KIND_CEIL]);
        continue;
      }
      const fr = wallFrames(L, i), tex = [fr[0].glLayer, fr.length, L.variant[i], KIND_WALL];
      const open = (xx, yy) => !solidAt(L, xx, yy) || isDoorCell(L, xx, yy);
      if (open(x + 1, y)) pushWall(V, I, x + 1, y + 1, x + 1, y, 0, 1, [1, 0, 0], tex);
      if (open(x - 1, y)) pushWall(V, I, x, y, x, y + 1, 0, 1, [-1, 0, 0], tex);
      if (open(x, y + 1)) pushWall(V, I, x, y + 1, x + 1, y + 1, 0, 1, [0, 1, 0], tex);
      if (open(x, y - 1)) pushWall(V, I, x + 1, y, x, y, 0, 1, [0, -1, 0], tex);
    }
    const m = makeVAO(new Float32Array(V), new Uint32Array(I), false);
    worldVAO = m.vao; worldBufs = [m.vb, m.ib]; worldCount = I.length;
  }

  // Doors slide sideways into the wall; secret walls slide back, away from the player.
  const doorV = [], doorI = [];
  function buildDoors(L, P) {
    doorV.length = 0; doorI.length = 0;
    const T = 0.03;
    for (const d of L.doorList) {
      const i = d.y * L.w + d.x, fr = wallFrames(L, i), tex = [fr[0].glLayer, fr.length, L.variant[i], KIND_DOOR];
      const o = d.open, x = d.x, y = d.y;
      if (d.secret) {
        if (o >= 1) continue;
        if (o > 0 && !d.glPush) {
          const dx = x + 0.5 - P.x, dy = y + 0.5 - P.y;
          d.glPush = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
        }
        if (o <= 0) d.glPush = null;
        const px = x + (d.glPush ? d.glPush[0] * o : 0), py = y + (d.glPush ? d.glPush[1] * o : 0);
        pushWall(doorV, doorI, px + 1, py + 1, px + 1, py, 0, 1, [1, 0, 0], tex);
        pushWall(doorV, doorI, px, py, px, py + 1, 0, 1, [-1, 0, 0], tex);
        pushWall(doorV, doorI, px, py + 1, px + 1, py + 1, 0, 1, [0, 1, 0], tex);
        pushWall(doorV, doorI, px + 1, py, px, py, 0, 1, [0, -1, 0], tex);
        continue;
      }
      if (o >= 1) continue;
      if (solidAt(L, x - 1, y) && solidAt(L, x + 1, y)) {
        // passage runs north-south: the panel spans x at y + 0.5 and slides east
        const yc = y + 0.5, a = x + o, b = x + 1 + o;
        pushWall(doorV, doorI, a, yc + T, b, yc + T, 0, 1, [0, 1, 0], tex);
        pushWall(doorV, doorI, b, yc - T, a, yc - T, 0, 1, [0, -1, 0], tex);
        pushWall(doorV, doorI, a, yc - T, a, yc + T, 0.02, 0.04, [-1, 0, 0], tex);
      } else {
        const xc = x + 0.5, a = y + o, b = y + 1 + o;
        pushWall(doorV, doorI, xc - T, a, xc - T, b, 0, 1, [-1, 0, 0], tex);
        pushWall(doorV, doorI, xc + T, b, xc + T, a, 0, 1, [1, 0, 0], tex);
        pushWall(doorV, doorI, xc + T, a, xc - T, a, 0.02, 0.04, [0, -1, 0], tex);
      }
    }
    doorCount = doorI.length;
    if (!doorCount) return;
    gl.bindVertexArray(doorVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, doorVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(doorV), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, doorIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(doorI), gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
  }

  function uploadLight() {
    if (!texLight) texLight = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texLight);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, Light.w, Light.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(Light.base.buffer.slice(0)));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function setLevel(L) {
    curL = L;
    buildWorld(L);
    uploadLight();
  }

  /* -------------------------------------------------------------- camera */
  // View-projection matrix (column-major) for an eye at e, yaw a, pitch p.
  // World: x east, y south, z up; the floor is z = 0 and the ceiling z = 1.
  const VP = new Float32Array(16);
  const cam = { e: [0, 0, 0], f: [1, 0, 0], r: [0, 1, 0] };
  function camera(ex, ey, ez, a, p) {
    const ca = Math.cos(a), sa = Math.sin(a), cp = Math.cos(p), sp = Math.sin(p);
    const f = [ca * cp, sa * cp, sp], r = [-sa, ca, 0], u = [-ca * sp, -sa * sp, cp];
    const e = [ex, ey, ez];
    const dot = (v) => v[0] * e[0] + v[1] * e[1] + v[2] * e[2];
    const sx = 1 / TAN_H, sy = 1 / (TAN_H * (bh / bw));
    const A = (FAR + NEAR) / (FAR - NEAR), B = -2 * FAR * NEAR / (FAR - NEAR);
    // rows of P * V
    const row = [
      [r[0] * sx, r[1] * sx, r[2] * sx, -dot(r) * sx],
      [u[0] * sy, u[1] * sy, u[2] * sy, -dot(u) * sy],
      [f[0] * A, f[1] * A, f[2] * A, -dot(f) * A + B],
      [f[0], f[1], f[2], -dot(f)],
    ];
    for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) VP[c * 4 + rr] = row[rr][c];
    cam.e = e; cam.f = f; cam.r = r;
  }

  /* ------------------------------------------------------------- sprites */
  const SPR_MAX = 2048, SPR_F = 8;
  const sprData = new Float32Array(SPR_MAX * SPR_F), sprSort = new Float32Array(SPR_MAX * SPR_F);
  const sprDepth = new Float32Array(SPR_MAX), sprOrder = [];
  let sprN = 0;
  // Same signature as the software renderer's add(): world position, sprite, size, bottom z, flash, self-lit.
  function addSprite(x, y, spr, size, z, flash, bright) {
    if (sprN >= SPR_MAX || !spr) return;
    const dx = x - cam.e[0], dy = y - cam.e[1];
    const depth = dx * cam.f[0] + dy * cam.f[1];
    if (depth < -size) return;
    const o = sprN * SPR_F;
    sprData[o] = x; sprData[o + 1] = y; sprData[o + 2] = z; sprData[o + 3] = size;
    sprData[o + 4] = spriteLayer(spr); sprData[o + 5] = spr.w / TS; sprData[o + 6] = spr.h / TS;
    sprData[o + 7] = (flash ? 1 : 0) | (bright ? 2 : 0);
    sprDepth[sprN] = dx * dx + dy * dy;
    sprN++;
  }

  /* --------------------------------------------------------------- frame */
  function setCommon(pr, L) {
    const u = pr.u;
    gl.uniformMatrix4fv(u.uVP, false, VP);
    gl.uniform2f(u.uJitter, frameJitter[0], frameJitter[1]);
    gl.uniform3f(u.uEye, cam.e[0], cam.e[1], cam.e[2]);
    gl.uniform3f(u.uFwd, cam.f[0], cam.f[1], cam.f[2]);
    gl.uniform2f(u.uMapSize, L.w, L.h);
    gl.uniform3f(u.uFog, Light.fog[0] / 255, Light.fog[1] / 255, Light.fog[2] / 255);
    gl.uniform1f(u.uAmb, frameAmb);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texLight); gl.uniform1i(u.uLight, 1);
  }
  let frameJitter = [0, 0], frameAmb = 1;

  // f: {L, P, anim, collect(add), shakeX, shakeY (in fractions of the view)}
  function render(f) {
    const L = f.L, P = f.P;
    if (L !== curL) setLevel(L);
    resizeBuffers();
    const bob = Math.sin(P.bobPhase * 2) * 0.012 * P.bobAmt;
    camera(P.x, P.y, 0.5 + bob, P.a, P.pitch || 0);
    frameJitter = [f.shakeX * 2, -f.shakeY * 2];
    frameAmb = 0.62 + L.def.ambient * 0.38 + (P.flashT > 0 ? 0.12 : 0);
    buildDoors(L, P);
    sprN = 0;
    f.collect(addSprite);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, bw, bh);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);

    gl.useProgram(progWorld.p);
    setCommon(progWorld, L);
    gl.uniform1f(progWorld.u.uAnim, f.anim);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texWalls); gl.uniform1i(progWorld.u.uTex, 0);
    gl.bindVertexArray(worldVAO);
    gl.drawElements(gl.TRIANGLES, worldCount, gl.UNSIGNED_INT, 0);
    if (doorCount) { gl.bindVertexArray(doorVAO); gl.drawElements(gl.TRIANGLES, doorCount, gl.UNSIGNED_INT, 0); }

    if (sprN) {
      // back to front, alpha blended over the world
      sprOrder.length = sprN;
      for (let i = 0; i < sprN; i++) sprOrder[i] = i;
      sprOrder.sort((a, b) => sprDepth[b] - sprDepth[a]);
      for (let k = 0; k < sprN; k++) sprSort.set(sprData.subarray(sprOrder[k] * SPR_F, sprOrder[k] * SPR_F + SPR_F), k * SPR_F);
      gl.useProgram(progSprite.p);
      setCommon(progSprite, L);
      gl.uniform2f(progSprite.u.uRight, cam.r[0], cam.r[1]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texSprites); gl.uniform1i(progSprite.u.uTex, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(spriteVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, spriteInst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sprSort.subarray(0, sprN * SPR_F));
      gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, sprN);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }

  /* -------------------------------------------------------------- set up */
  function resizeBuffers() {
    const w = Math.max(1, Math.round(cssW * dpr * scale)), h = Math.max(1, Math.round(cssH * dpr * scale));
    if (w === bw && h === bh && cv.width === w) return;
    bw = w; bh = h;
    cv.width = w; cv.height = h;
  }

  // Places the GL canvas over the 3D part of the view (CSS pixels).
  function layout(left, top, w, h, ratio) {
    if (!cv) return;
    lay = [left, top, w, h, ratio];
    Object.assign(cv.style, { left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px' });
    cssW = w; cssH = h; dpr = ratio;
    // keep the pixel count reasonable on very large screens
    const px = cssW * cssH * dpr * dpr;
    scale = Math.min(1, Math.sqrt(2.6e6 / px)) * userScale;
  }
  let userScale = 1, lay = null;
  // Lowers the resolution one step on a slow GPU; false once at the minimum.
  function degrade() {
    if (userScale <= 0.55) return false;
    userScale = Math.max(0.5, userScale - 0.2);
    if (lay) layout(...lay);
    return true;
  }

  function init(canvas) {
    if (ok) return true;
    try {
      cv = canvas;
      gl = cv.getContext('webgl2', { antialias: true, alpha: false, depth: true, premultipliedAlpha: false, powerPreference: 'high-performance' });
      if (!gl) return false;
      aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      progWorld = compile(WORLD_VS, WORLD_FS);
      progSprite = compile(SPRITE_VS, SPRITE_FS);
      buildWallArray();
      texSprites = newArray(SPR_CAP, gl.SRGB8_ALPHA8);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const d = makeVAO(new Float32Array(VSTRIDE), new Uint32Array(1), true);
      doorVAO = d.vao; doorVBO = d.vb; doorIBO = d.ib;
      // sprites: a unit quad + per-instance data
      spriteVAO = gl.createVertexArray();
      gl.bindVertexArray(spriteVAO);
      const q = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, q);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      spriteInst = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, spriteInst);
      gl.bufferData(gl.ARRAY_BUFFER, sprData.byteLength, gl.DYNAMIC_DRAW);
      for (const [loc, off] of [[1, 0], [2, 4]]) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, SPR_F * 4, off * 4);
        gl.vertexAttribDivisor(loc, 1);
      }
      gl.bindVertexArray(null);
      cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); ok = false; if (GLR.onLost) GLR.onLost(); });
      ok = true;
    } catch (e) {
      console.warn('WebGL2 renderer unavailable, using the software renderer.', e);
      ok = false;
    }
    return ok;
  }

  return {
    init, render, layout, degrade,
    get ok() { return ok; },
    get canvas() { return cv; },
    onLost: null,
  };
})();
