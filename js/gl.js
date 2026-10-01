'use strict';
/*
 * MODERN style on the GPU (WebGL2).
 *
 * Geometry: the grid map becomes real geometry (wall faces, floor and ceiling
 * quads, sliding doors and secret walls) drawn with depth testing at the
 * screen's native resolution. Textures (the same procedural canvases as the
 * software renderer) live in texture arrays with mipmaps and anisotropic
 * filtering. Billboards are instanced quads tested against the depth buffer.
 * The camera can look up and down.
 *
 * Lighting, per pixel:
 * - a directional lightmap baked per level at 8 texels per cell: the light of
 *   the ceiling panels (soft shadows from 4 points on each panel) and of the
 *   glowing walls, plus where that light comes from (mean light position), so
 *   that normal maps and highlights react to the real lamps;
 * - normal, gloss and specular maps derived from the textures (grooves between
 *   rack units, rivets, floor tiles);
 * - up to 16 dynamic point lights (muzzle flashes, projectiles, explosions,
 *   armed UPS) with wall shadows traced through the map grid in the shader;
 * - planar reflections on the raised floor: the scene is drawn mirrored under
 *   the floor at half resolution, then blurred by mipmaps according to gloss.
 *
 * Post-processing: the frame is rendered in HDR (half floats) with 4x MSAA,
 * then: screen-space ambient occlusion, volumetric haze (lit by the lightmap,
 * light shafts under the ceiling panels, glow around dynamic lights), a
 * multi-level bloom, ACES tone mapping, a color grade per episode, vignette,
 * slight chromatic aberration, film grain and dithering. Without float render
 * targets, the frame is tone mapped directly instead.
 *
 * The game logic stays in game.js; this module only draws a frame from the
 * level state. If WebGL2 is missing, game.js keeps the software renderer.
 */
const GLR = (() => {
  let gl = null, cv = null, ok = false;
  let curL = null;
  let progWorld, progSprite;
  let worldVAO = null, worldCount = 0, floorCount = 0, worldBufs = [];
  let doorVAO = null, doorVBO = null, doorIBO = null, doorCount = 0;
  let spriteVAO = null, spriteInst = null;
  let texWalls = null, texNrm = null, texSprites = null, texLightA = null, texLightB = null, texCells = null, texBlack = null;
  let reflFBO = null, reflTex = null, reflDepth = null, rw = 0, rh = 0;
  let aniso = null, floatOK = false;
  let cssW = 1, cssH = 1, dpr = 1, scale = 1, bw = 1, bh = 1;

  const NEAR = 0.02, FAR = 120;
  const TAN_H = 0.8;                     // PLANE in game.js: 77 degree horizontal field of view
  const VSTRIDE = 15;                    // pos3 uv2 nrm3 tan3 tex4 (layer base, frames, phase, kind)
  const KIND_WALL = 0, KIND_FLOOR = 1, KIND_CEIL = 2, KIND_DOOR = 3;
  const LG2 = 8;                         // lightmap texels per map cell
  const MAX_DL = 16;                     // dynamic lights per frame

  /* ------------------------------------------------------------ shaders */
  const WORLD_VS = `#version 300 es
  layout(location=0) in vec3 aPos;
  layout(location=1) in vec2 aUv;
  layout(location=2) in vec3 aNrm;
  layout(location=3) in vec3 aTan;
  layout(location=4) in vec4 aTex;
  uniform mat4 uVP;
  uniform float uAnim;
  uniform float uMirror;
  uniform vec2 uJitter;
  out vec3 vPos; out vec2 vUv; out vec3 vNrm; out vec3 vTan;
  flat out float vLayer; flat out float vKind;
  void main() {
    vPos = aPos; vUv = aUv; vNrm = aNrm; vTan = aTan;
    vLayer = aTex.x + mod(uAnim + aTex.z, aTex.y);
    vKind = aTex.w;
    gl_Position = uVP * vec4(aPos.xy, aPos.z * uMirror, 1.0);
    gl_Position.xy += uJitter * gl_Position.w;
  }`;

  // Shared lighting: baked directional lightmap + dynamic lights + fog.
  const LIGHTING = `
  uniform sampler2D uLightA;     // rgb: direct light of lamps and glowing walls, a: ambient occlusion
  uniform sampler2D uLightB;     // xy: offset to the mean light position (cells), z: its height
  uniform sampler2D uCells;      // r: blocks light (walls, closed doors)
  uniform vec2 uMapSize;
  uniform vec3 uEye;
  uniform vec3 uAmbient;
  uniform vec3 uFog;
  uniform float uEmissive;
  uniform float uExposure;
  uniform float uMirror;
  uniform float uRaw;            // 1: linear HDR output (post-processing follows)
  uniform vec4 uDL[${MAX_DL}];   // dynamic lights: position, radius
  uniform vec4 uDC[${MAX_DL}];   // color x strength
  uniform int uDN;

  // 1 when the segment a-b (map plane) crosses no light-blocking cell.
  float gridShadow(vec2 a, vec2 b) {
    vec2 d = b - a;
    float len = length(d);
    if (len < 1e-3) return 1.0;
    vec2 dir = d / len;
    ivec2 c = ivec2(floor(a)), cb = ivec2(floor(b));
    ivec2 st = ivec2(dir.x < 0.0 ? -1 : 1, dir.y < 0.0 ? -1 : 1);
    vec2 inv = vec2(abs(dir.x) < 1e-5 ? 1e5 : 1.0 / abs(dir.x), abs(dir.y) < 1e-5 ? 1e5 : 1.0 / abs(dir.y));
    vec2 fr = a - vec2(c);
    vec2 tMax = vec2(dir.x < 0.0 ? fr.x : 1.0 - fr.x, dir.y < 0.0 ? fr.y : 1.0 - fr.y) * inv;
    ivec2 ms = ivec2(uMapSize) - 1;
    for (int i = 0; i < 24; i++) {
      if (c == cb) return 1.0;
      if (tMax.x < tMax.y) { if (tMax.x > len) return 1.0; tMax.x += inv.x; c.x += st.x; }
      else { if (tMax.y > len) return 1.0; tMax.y += inv.y; c.y += st.y; }
      if (c.x < 0 || c.y < 0 || c.x > ms.x || c.y > ms.y) return 0.0;
      if (texelFetch(uCells, c, 0).r > 0.5) return 0.0;
    }
    return 1.0;
  }

  // Blinn-Phong lobe, roughly energy-normalized.
  float lobe(vec3 N, vec3 L, vec3 V, float shin) {
    vec3 H = normalize(L + V);
    return pow(max(dot(N, H), 0.0), shin) * (shin + 8.0) / 50.0;
  }

  // alb: linear albedo, N: shading normal, P: world position, lp: where to read the lightmap,
  // gloss/spec: material, wrap: 0 for surfaces, 1 for flat billboards (half-Lambert).
  vec3 shade(vec3 alb, vec3 N, vec3 P, vec2 lp, float gloss, float spec, float wrap) {
    vec3 V = normalize(uEye - P);
    vec4 la = texture(uLightA, lp / uMapSize);
    vec4 lb = texture(uLightB, lp / uMapSize);
    float ao = la.a;
    vec3 amb = uAmbient * ao * (0.82 + 0.18 * N.z);
    vec3 Lv = vec3(lb.xy, lb.z - P.z);
    float ll = length(Lv);
    Lv = ll > 1e-3 ? Lv / ll : vec3(0.0, 0.0, 1.0);
    float ndl = dot(N, Lv);
    ndl = mix(max(ndl, 0.0), ndl * 0.5 + 0.5, wrap);
    vec3 dir = la.rgb * mix(1.0, ao, 0.5);
    float shin = mix(8.0, 110.0, gloss);
    vec3 c = alb * (amb + dir * (0.3 + 1.05 * ndl)) + dir * spec * lobe(N, Lv, V, shin) * max(ndl, 0.0);
    for (int i = 0; i < ${MAX_DL}; i++) {
      if (i >= uDN) break;
      vec3 d = uDL[i].xyz - P;
      float r = uDL[i].w, dd = dot(d, d);
      if (dd > r * r) continue;
      vec3 l = d * inversesqrt(max(dd, 1e-4));
      float nl = dot(N, l);
      nl = mix(max(nl, 0.0), nl * 0.5 + 0.5, wrap);
      if (nl <= 0.0) continue;
      float f = 1.0 - dd / (r * r);
      float sh = gridShadow(P.xy + N.xy * 0.03, uDL[i].xy);
      if (sh <= 0.0) continue;
      c += uDC[i].rgb * (f * f * sh * nl) * (alb + spec * lobe(N, l, V, shin));
    }
    return c;
  }

  vec3 fogged(vec3 c, vec3 P) {
    float d = length(P - uEye);
    float f = min(0.8, 1.0 - exp(-d * 0.07));
    return mix(c, uFog, f);
  }

  // ACES filmic curve (Narkowicz fit) and sRGB encoding.
  vec3 tonemap(vec3 c) {
    c *= uExposure;
    c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
    return pow(c, vec3(1.0 / 2.2));
  }
  `;

  const WORLD_FS = `#version 300 es
  precision highp float;
  precision highp sampler2DArray;
  in vec3 vPos; in vec2 vUv; in vec3 vNrm; in vec3 vTan;
  flat in float vLayer; flat in float vKind;
  uniform sampler2DArray uTex, uNrm;
  uniform sampler2D uRefl;
  uniform float uReflOn;
  uniform vec2 uViewport;
  ${LIGHTING}
  out vec4 oColor;
  void main() {
    vec3 uvl = vec3(vUv, vLayer);
    vec4 t = texture(uTex, uvl);
    vec4 nm = texture(uNrm, uvl);
    vec3 Ng = normalize(vNrm), T = normalize(vTan);
    vec3 B = vKind == 1.0 || vKind == 2.0 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, -1.0);
    vec2 nxy = nm.rg * 2.0 - 1.0;
    vec3 N = normalize(T * nxy.x + B * nxy.y + Ng * sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
    float gloss = nm.b, spec = nm.a;
    vec2 lp = vPos.xy + Ng.xy * (0.5 / ${LG2}.0);
    vec3 c = shade(t.rgb, N, vPos, lp, gloss, spec, 0.0);
    // floor: mirrored scene, blurred by roughness, Fresnel weighted
    if (vKind == 1.0 && uReflOn > 0.5) {
      vec3 V = normalize(uEye - vPos);
      vec2 suv = gl_FragCoord.xy / uViewport + nxy * 0.025;
      vec3 r = textureLod(uRefl, suv, (1.0 - gloss) * 4.0).rgb;
      float fr = 0.03 + 0.97 * pow(1.0 - max(V.z, 0.0), 5.0);
      float k = clamp((fr * 0.9 + 0.07) * gloss * 1.4, 0.0, 0.75);
      c = c * (1.0 - k * 0.5) + r * k;
    }
    // emissive texels (LEDs, screens, light panels) are stored in alpha
    c = mix(c, t.rgb * uEmissive, t.a);
    c = fogged(c, vPos);
    oColor = vec4(uRaw > 0.5 ? c : tonemap(c), 1.0);
  }`;

  const SPRITE_VS = `#version 300 es
  layout(location=0) in vec2 aQuad;
  layout(location=1) in vec4 iPos;    // x, y, bottom z, size
  layout(location=2) in vec4 iTex;    // layer, u scale, v scale, flags (1 flash, 2 self-lit)
  uniform mat4 uVP;
  uniform vec2 uRight;
  uniform vec2 uJitter;
  uniform float uMirror;
  out vec2 vUv; out vec3 vPos;
  flat out float vLayer; flat out float vFlags; flat out vec2 vFeet;
  void main() {
    vec3 p = vec3(iPos.xy + uRight * (aQuad.x - 0.5) * iPos.w, iPos.z + (1.0 - aQuad.y) * iPos.w);
    vUv = aQuad * iTex.yz;
    vPos = p; vLayer = iTex.x; vFlags = iTex.w; vFeet = iPos.xy;
    gl_Position = uVP * vec4(p.xy, p.z * uMirror, 1.0);
    gl_Position.xy += uJitter * gl_Position.w;
  }`;

  const SPRITE_FS = `#version 300 es
  precision highp float;
  precision highp sampler2DArray;
  in vec2 vUv; in vec3 vPos;
  flat in float vLayer; flat in float vFlags; flat in vec2 vFeet;
  uniform sampler2DArray uTex;
  uniform vec3 uFwd;
  ${LIGHTING}
  out vec4 oColor;
  void main() {
    if (uMirror < 0.0 && vPos.z < 0.0) discard;
    vec4 t = texture(uTex, vec3(vUv, vLayer));
    if (t.a < 0.03) discard;
    int fl = int(vFlags + 0.5);
    vec3 c;
    if ((fl & 2) != 0) c = t.rgb * uEmissive;
    else {
      vec3 N = normalize(vec3(-uFwd.xy, 0.0));
      c = shade(t.rgb, N, vPos, vFeet, 0.35, 0.25, 1.0);
      if ((fl & 1) != 0) c = mix(c, vec3(1.6), 0.5);
      c = fogged(c, vPos);
    }
    oColor = vec4(uRaw > 0.5 ? c : tonemap(c), t.a);
  }`;

  function compile(vs, fs) {
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
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

  // Spreads the colors of opaque texels into the transparent ones around them, so
  // that bilinear filtering doesn't pull black into the edges.
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

  // Surface response per wall tile: [bump strength, gloss, specular].
  const MATERIALS = {
    concrete: [1.1, 0.16, 0.12], rack: [2.6, 0.62, 0.55], door: [2.2, 0.5, 0.5], crac: [2.2, 0.5, 0.45],
    warn: [1.4, 0.3, 0.2], exit: [1.8, 0.4, 0.3], floor: [1.2, 0.78, 0.6], perf: [2.2, 0.66, 0.55], ceil: [1.2, 0.22, 0.12],
  };
  const TILE_MAT = { '#': 'concrete', '?': 'concrete', W: 'warn', R: 'rack', S: 'rack', N: 'rack', C: 'crac', D: 'door', 1: 'door', 2: 'door', X: 'exit' };

  // Normal (rg), gloss (b) and specular (a) maps, from the texture's luminance as a height field.
  function normalMap(t, mat) {
    const N = TS, px = t.px, em = t.em, [S, gl0, sp0] = MATERIALS[mat];
    const lum = new Float32Array(N * N), h = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) { const c = px[i]; lum[i] = ((c & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + ((c >> 16) & 255) * 0.11) / 255; }
    const at = (a, x, y) => a[((y + N) % N) * N + ((x + N) % N)];
    const blur = (src, dst) => {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        dst[y * N + x] = (at(src, x, y) * 4 + at(src, x - 1, y) + at(src, x + 1, y) + at(src, x, y - 1) + at(src, x, y + 1)) / 8;
      }
    };
    const tmp = new Float32Array(N * N);
    blur(lum, tmp); blur(tmp, h);
    const out = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, o = i * 4;
      if (em[i]) { out[o] = 128; out[o + 1] = 128; out[o + 2] = 230; out[o + 3] = 150; continue; }
      const gx = (at(h, x + 1, y - 1) + 2 * at(h, x + 1, y) + at(h, x + 1, y + 1)) - (at(h, x - 1, y - 1) + 2 * at(h, x - 1, y) + at(h, x - 1, y + 1));
      const gy = (at(h, x - 1, y + 1) + 2 * at(h, x, y + 1) + at(h, x + 1, y + 1)) - (at(h, x - 1, y - 1) + 2 * at(h, x, y - 1) + at(h, x + 1, y - 1));
      let nx = -gx * S, ny = -gy * S;
      const l = Math.hypot(nx, ny, 1);
      nx /= l; ny /= l;
      const v = lum[i];
      out[o] = Math.round((nx * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round(Math.min(1, gl0 * (0.7 + 0.6 * v)) * 255);
      out[o + 3] = Math.round(Math.min(1, sp0 * (0.5 + v)) * 255);
    }
    return out;
  }

  // Walls, flats: every texture of Assets gets a layer; the frames of an animated
  // variant are consecutive. Alpha holds the emissive mask.
  function buildWallArray() {
    const list = [];
    const reg = (t, mat) => { if (t.glLayer === undefined) { t.glLayer = list.length; list.push([t, mat]); } };
    for (const ch of Object.keys(Assets.walls)) for (const v of Assets.walls[ch]) v.forEach((t) => reg(t, TILE_MAT[ch] || 'rack'));
    for (const ep of Assets.concrete) for (const v of ep) v.forEach((t) => reg(t, 'concrete'));
    reg(Assets.floor[0], 'floor'); reg(Assets.floor[1], 'perf');
    Assets.ceil.forEach((t) => reg(t, 'ceil'));
    texWalls = newArray(list.length, gl.SRGB8_ALPHA8);
    list.forEach(([t], i) => {
      const rgba = new Uint8Array(t.px.buffer.slice(0));
      for (let k = 0; k < t.em.length; k++) rgba[k * 4 + 3] = t.em[k] ? 255 : 0;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, TS, TS, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    });
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    texNrm = newArray(list.length, gl.RGBA8);
    list.forEach(([t, mat], i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, TS, TS, 1, gl.RGBA, gl.UNSIGNED_BYTE, normalMap(t, mat)));
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

  function tex2D(t, filter, wrap) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  }

  /* ----------------------------------------------------------- lightmap */
  // Directional lightmap of a level (see the header): two RGBA float textures.
  function bake(L) {
    const lw = L.w * LG2, lh = L.h * LG2, n = lw * lh;
    const mood = LIGHT_MOODS[L.def.episode % LIGHT_MOODS.length];
    const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
    const DX = new Float32Array(n), DY = new Float32Array(n), DZ = new Float32Array(n), DW = new Float32Array(n);
    const solid = (cx, cy) => Light._solid(L, cx, cy);
    const SOFT = [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]];
    function point(x, y, z, rad, cr, cg, cb, k, soft) {
      const sx0 = Math.max(0, Math.floor((x - rad) * LG2)), sx1 = Math.min(lw - 1, Math.ceil((x + rad) * LG2));
      const sy0 = Math.max(0, Math.floor((y - rad) * LG2)), sy1 = Math.min(lh - 1, Math.ceil((y + rad) * LG2));
      const r2 = rad * rad, lum = cr + cg + cb;
      for (let sy = sy0; sy <= sy1; sy++) {
        const py = (sy + 0.5) / LG2;
        for (let sx = sx0; sx <= sx1; sx++) {
          const px = (sx + 0.5) / LG2;
          const d2 = (px - x) * (px - x) + (py - y) * (py - y);
          if (d2 >= r2 || solid(px | 0, py | 0)) continue;
          let vis = 0;
          if (soft) { for (const [ox, oy] of SOFT) if (Light._los(L, x + ox, y + oy, px, py)) vis += 0.25; }
          else vis = Light._los(L, x, y, px, py) ? 1 : 0;
          if (!vis) continue;
          const f = 1 - d2 / r2, a = f * f * k * vis, i = sy * lw + sx, wgt = a * lum;
          R[i] += cr * a; G[i] += cg * a; B[i] += cb * a;
          DX[i] += (x - px) * wgt; DY[i] += (y - py) * wgt; DZ[i] += z * wgt; DW[i] += wgt;
        }
      }
    }
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const i = y * L.w + x;
      if (L.map[i]) continue;
      if (L.ceil[i] === 1) point(x + 0.5, y + 0.5, 0.97, 3.6, mood.lamp[0], mood.lamp[1], mood.lamp[2], 1.0, true);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t = L.map[(y + dy) * L.w + x + dx];
        const gl0 = t && WALL_GLOW[String.fromCharCode(t)];
        if (gl0) point(x + 0.5 + dx * 0.3, y + 0.5 + dy * 0.3, 0.6, 2.1, gl0[0], gl0[1], gl0[2], gl0[3] * 1.2, false);
      }
    }
    const A = new Float32Array(n * 4), Bd = new Float32Array(n * 4);
    for (let sy = 0; sy < lh; sy++) for (let sx = 0; sx < lw; sx++) {
      const px = (sx + 0.5) / LG2, py = (sy + 0.5) / LG2, cx = px | 0, cy = py | 0, i = sy * lw + sx;
      // ambient occlusion: darker close to solid neighbors
      let ao = 1;
      if (solid(cx, cy)) ao = 0.5;
      else {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || !solid(cx + dx, cy + dy)) continue;
          const ex = dx < 0 ? px - cx : dx > 0 ? cx + 1 - px : 0;
          const ey = dy < 0 ? py - cy : dy > 0 ? cy + 1 - py : 0;
          const a = 0.55 + 0.45 * Math.min(1, Math.hypot(ex, ey) / 0.6);
          if (a < ao) ao = a;
        }
      }
      A[i * 4] = R[i]; A[i * 4 + 1] = G[i]; A[i * 4 + 2] = B[i]; A[i * 4 + 3] = ao;
      const w = DW[i];
      if (w > 1e-5) { Bd[i * 4] = DX[i] / w; Bd[i * 4 + 1] = DY[i] / w; Bd[i * 4 + 2] = DZ[i] / w; } else Bd[i * 4 + 2] = 1;
    }
    const up = (t, data) => {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, lw, lh, 0, gl.RGBA, gl.FLOAT, data);
      tex2D(t, gl.LINEAR, gl.CLAMP_TO_EDGE);
    };
    up(texLightA, A); up(texLightB, Bd);
    ambient = mood.amb.map((v) => v * L.def.ambient * 0.42);
  }
  let ambient = [0.3, 0.3, 0.3];

  // Map cells for the shader: r = blocks light. Doors change it as they move.
  let cellData = null, cellSig = '';
  function updateCells(L, force) {
    let sig = '';
    for (const d of L.doorList) sig += d.open < 0.5 ? '1' : '0';
    if (!force && sig === cellSig) return;
    cellSig = sig;
    if (force || !cellData || cellData.length !== L.w * L.h * 4) cellData = new Uint8Array(L.w * L.h * 4);
    for (let i = 0; i < L.w * L.h; i++) {
      const d = L.doors[i];
      cellData[i * 4] = L.map[i] && (!d || d.open < 0.5) ? 255 : 0;
      cellData[i * 4 + 1] = L.ceil[i];
      cellData[i * 4 + 2] = L.floor[i];
    }
    gl.bindTexture(gl.TEXTURE_2D, texCells);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, L.w, L.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, cellData);
    tex2D(texCells, gl.NEAREST, gl.CLAMP_TO_EDGE);
  }

  // The frame's dynamic lights (same sources as the software renderer).
  const DL = new Float32Array(MAX_DL * 4), DC = new Float32Array(MAX_DL * 4);
  let dlN = 0;
  function gatherLights(L, P, inv) {
    dlN = 0;
    if (!Light.high) return;
    const push = (x, y, z, rad, r, g, b, k) => {
      if (dlN >= MAX_DL || k <= 0) return;
      DL.set([x, y, z, rad], dlN * 4); DC.set([r * k, g * k, b * k, 0], dlN * 4); dlN++;
    };
    if (P.flashT > 0 && !P.dead) {
      const c = inv && inv.cur === 7 ? [0.4, 0.8, 1.0] : inv && inv.cur === 6 ? [0.7, 0.6, 1.0] : [1.0, 0.72, 0.4];
      push(P.x + Math.cos(P.a) * 0.5, P.y + Math.sin(P.a) * 0.5, 0.45, 5.5, c[0], c[1], c[2], 2.2);
    }
    for (const b of L.barrels) if (!b.dead && b.fuse >= 0) push(b.x, b.y, 0.5, 2.6, 1.0, 0.15, 0.1, 1.4 + Math.sin(performance.now() / 50));
    for (const f of L.fx) {
      const d = FX_LIGHT[f.kind];
      if (d) push(f.x, f.y, Math.max(0.15, f.z), d[4], d[0], d[1], d[2], d[3] * 2.2 * (1 - f.t / f.dur));
    }
    for (const p of L.proj) {
      const d = PROJ_LIGHT[p.kind];
      if (d) push(p.x, p.y, p.z + (p.scale || 0.35) / 2, d[4], d[0], d[1], d[2], d[3] * 1.8);
    }
  }

  /* ----------------------------------------------------------- geometry */
  const solidAt = (L, x, y) => x < 0 || y < 0 || x >= L.w || y >= L.h || (L.map[y * L.w + x] !== 0 && !L.doors[y * L.w + x]);

  function wallFrames(L, i) {
    const ch = String.fromCharCode(L.map[i]);
    const vars = ch === '#' || ch === '?' ? Assets.concrete[L.def.episode % 5] : Assets.walls[ch];
    return vars[L.variant[i] % vars.length];
  }

  // A quad: corners p0..p3, uvs, normal, tangent (direction of growing u), texture info.
  function pushQuad(V, I, p, uv, n, t, tex) {
    const base = V.length / VSTRIDE;
    for (let k = 0; k < 4; k++) V.push(p[k][0], p[k][1], p[k][2], uv[k][0], uv[k][1], n[0], n[1], n[2], t[0], t[1], t[2], tex[0], tex[1], tex[2], tex[3]);
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // A vertical face from (ax, ay) to (bx, by), u running from a to b, v from top to bottom.
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

  // Static world: floors first (left out of the mirrored pass), then ceilings and walls.
  function buildWorld(L) {
    for (const b of worldBufs) gl.deleteBuffer(b);
    if (worldVAO) gl.deleteVertexArray(worldVAO);
    const V = [], IF = [], I = [], w = L.w, h = L.h;
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!L.map[i] || L.doors[i]) {
        const fl = Assets.floor[L.floor[i]].glLayer, ce = Assets.ceil[L.ceil[i]].glLayer;
        pushQuad(V, IF, [[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]], uv, [0, 0, 1], [1, 0, 0], [fl, 1, 0, KIND_FLOOR]);
        pushQuad(V, I, [[x, y, 1], [x + 1, y, 1], [x + 1, y + 1, 1], [x, y + 1, 1]], uv, [0, 0, -1], [1, 0, 0], [ce, 1, 0, KIND_CEIL]);
        continue;
      }
      const fr = wallFrames(L, i), tex = [fr[0].glLayer, fr.length, L.variant[i], KIND_WALL];
      if (!solidAt(L, x + 1, y)) pushWall(V, I, x + 1, y + 1, x + 1, y, 0, 1, [1, 0, 0], tex);
      if (!solidAt(L, x - 1, y)) pushWall(V, I, x, y, x, y + 1, 0, 1, [-1, 0, 0], tex);
      if (!solidAt(L, x, y + 1)) pushWall(V, I, x, y + 1, x + 1, y + 1, 0, 1, [0, 1, 0], tex);
      if (!solidAt(L, x, y - 1)) pushWall(V, I, x + 1, y, x, y, 0, 1, [0, -1, 0], tex);
    }
    const m = makeVAO(new Float32Array(V), new Uint32Array(IF.concat(I)), false);
    worldVAO = m.vao; worldBufs = [m.vb, m.ib]; worldCount = IF.length + I.length; floorCount = IF.length;
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
        const tw = [tex[0], tex[1], tex[2], KIND_WALL];
        pushWall(doorV, doorI, px + 1, py + 1, px + 1, py, 0, 1, [1, 0, 0], tw);
        pushWall(doorV, doorI, px, py, px, py + 1, 0, 1, [-1, 0, 0], tw);
        pushWall(doorV, doorI, px, py + 1, px + 1, py + 1, 0, 1, [0, 1, 0], tw);
        pushWall(doorV, doorI, px + 1, py, px, py, 0, 1, [0, -1, 0], tw);
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

  function setLevel(L) {
    curL = L;
    buildWorld(L);
    bake(L);
    updateCells(L, true);
  }

  /* -------------------------------------------------------------- camera */
  // View-projection matrix (column-major) for an eye at e, yaw a, pitch p.
  // World: x east, y south, z up; the floor is z = 0 and the ceiling z = 1.
  const VP = new Float32Array(16);
  const cam = { e: [0, 0, 0], f: [1, 0, 0], r: [0, 1, 0], u: [0, 0, 1] };
  function camera(ex, ey, ez, a, p) {
    const ca = Math.cos(a), sa = Math.sin(a), cp = Math.cos(p), sp = Math.sin(p);
    const f = [ca * cp, sa * cp, sp], r = [-sa, ca, 0], u = [-ca * sp, -sa * sp, cp];
    const e = [ex, ey, ez];
    const dot = (v) => v[0] * e[0] + v[1] * e[1] + v[2] * e[2];
    const sx = 1 / TAN_H, sy = 1 / (TAN_H * (bh / bw));
    const A = (FAR + NEAR) / (FAR - NEAR), B = -2 * FAR * NEAR / (FAR - NEAR);
    const row = [
      [r[0] * sx, r[1] * sx, r[2] * sx, -dot(r) * sx],
      [u[0] * sy, u[1] * sy, u[2] * sy, -dot(u) * sy],
      [f[0] * A, f[1] * A, f[2] * A, -dot(f) * A + B],
      [f[0], f[1], f[2], -dot(f)],
    ];
    for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) VP[c * 4 + rr] = row[rr][c];
    cam.e = e; cam.f = f; cam.r = r; cam.u = u;
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
    const o = sprN * SPR_F;
    sprData[o] = x; sprData[o + 1] = y; sprData[o + 2] = z; sprData[o + 3] = size;
    sprData[o + 4] = spriteLayer(spr); sprData[o + 5] = spr.w / TS; sprData[o + 6] = spr.h / TS;
    sprData[o + 7] = (flash ? 1 : 0) | (bright ? 2 : 0);
    sprDepth[sprN] = dx * dx + dy * dy;
    sprN++;
  }

  /* --------------------------------------------------------------- frame */
  let frameJitter = [0, 0], exposure = 1;
  function setCommon(pr, L, mirror) {
    const u = pr.u;
    gl.uniformMatrix4fv(u.uVP, false, VP);
    gl.uniform2f(u.uJitter, mirror ? 0 : frameJitter[0], mirror ? 0 : frameJitter[1]);
    gl.uniform1f(u.uMirror, mirror ? -1 : 1);
    gl.uniform1f(u.uRaw, mirror || hdr ? 1 : 0);
    gl.uniform3f(u.uEye, cam.e[0], cam.e[1], mirror ? -cam.e[2] : cam.e[2]);
    gl.uniform3f(u.uFwd, cam.f[0], cam.f[1], cam.f[2]);
    gl.uniform2f(u.uMapSize, L.w, L.h);
    const f = Light.fog;
    gl.uniform3f(u.uFog, (f[0] / 255) ** 2.2 * 1.6, (f[1] / 255) ** 2.2 * 1.6, (f[2] / 255) ** 2.2 * 1.6);
    gl.uniform3f(u.uAmbient, ambient[0], ambient[1], ambient[2]);
    gl.uniform1f(u.uEmissive, 2.0);
    gl.uniform1f(u.uExposure, exposure);
    gl.uniform1i(u.uDN, dlN);
    if (dlN) { gl.uniform4fv(u.uDL, DL); gl.uniform4fv(u.uDC, DC); }
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texLightA); gl.uniform1i(u.uLightA, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, texLightB); gl.uniform1i(u.uLightB, 3);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, texCells); gl.uniform1i(u.uCells, 4);
  }

  function drawWorld(L, anim, mirror) {
    gl.useProgram(progWorld.p);
    setCommon(progWorld, L, mirror);
    const u = progWorld.u;
    gl.uniform1f(u.uAnim, anim);
    gl.uniform2f(u.uViewport, bw, bh);
    gl.uniform1f(u.uReflOn, !mirror && reflOn ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texWalls); gl.uniform1i(u.uTex, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texNrm); gl.uniform1i(u.uNrm, 1);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, !mirror && reflOn ? reflTex : texBlack); gl.uniform1i(u.uRefl, 5);
    gl.bindVertexArray(worldVAO);
    if (mirror) gl.drawElements(gl.TRIANGLES, worldCount - floorCount, gl.UNSIGNED_INT, floorCount * 4);
    else gl.drawElements(gl.TRIANGLES, worldCount, gl.UNSIGNED_INT, 0);
    if (doorCount) { gl.bindVertexArray(doorVAO); gl.drawElements(gl.TRIANGLES, doorCount, gl.UNSIGNED_INT, 0); }
  }

  function drawSprites(L, mirror) {
    if (!sprN) return;
    gl.useProgram(progSprite.p);
    setCommon(progSprite, L, mirror);
    gl.uniform2f(progSprite.u.uRight, cam.r[0], cam.r[1]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texSprites); gl.uniform1i(progSprite.u.uTex, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(spriteVAO);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, sprN);
    gl.disable(gl.BLEND);
  }

  let reflOn = false;
  // f: {L, P, inv, anim, collect(add), shakeX, shakeY (fractions of the view)}
  function render(f) {
    const L = f.L, P = f.P;
    if (L !== curL) setLevel(L);
    resizeBuffers();
    const bob = Math.sin(P.bobPhase * 2) * 0.012 * P.bobAmt;
    camera(P.x, P.y, 0.5 + bob, P.a, P.pitch || 0);
    frameJitter = [f.shakeX * 2, -f.shakeY * 2];
    exposure = 0.8 + (P.flashT > 0 ? 0.08 : 0);
    buildDoors(L, P);
    updateCells(L, false);
    gatherLights(L, P, f.inv);
    sprN = 0;
    f.collect(addSprite);
    if (sprN) {
      // back to front, alpha blended over the world
      sprOrder.length = sprN;
      for (let i = 0; i < sprN; i++) sprOrder[i] = i;
      sprOrder.sort((a, b) => sprDepth[b] - sprDepth[a]);
      for (let k = 0; k < sprN; k++) sprSort.set(sprData.subarray(sprOrder[k] * SPR_F, sprOrder[k] * SPR_F + SPR_F), k * SPR_F);
      gl.bindBuffer(gl.ARRAY_BUFFER, spriteInst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sprSort.subarray(0, sprN * SPR_F));
    }

    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);

    reflOn = Light.high;
    if (reflOn) {
      // the scene mirrored under the floor, sampled by the floor shader
      gl.bindFramebuffer(gl.FRAMEBUFFER, reflFBO);
      gl.viewport(0, 0, rw, rh);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      drawWorld(L, f.anim, true);
      drawSprites(L, true);
      gl.bindTexture(gl.TEXTURE_2D, reflTex);
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, hdr ? msFBO : null);
    gl.viewport(0, 0, bw, bh);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawWorld(L, f.anim, false);
    drawSprites(L, false);
    gl.bindVertexArray(null);
    if (hdr) post(L, P);
  }

  /* ----------------------------------------------------- post-processing */
  const QUAD_VS = `#version 300 es
  out vec2 vUv;
  void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    vUv = p;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }`;

  const POST_COMMON = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 oColor;
  uniform vec2 uNF;       // near, far
  uniform vec2 uTan;      // tangents of the half fields of view
  float linZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNF.x * uNF.y / (uNF.y + uNF.x - z * (uNF.y - uNF.x)); }
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  `;

  // Ambient occlusion from the depth buffer (half resolution, view space).
  const SSAO_FS = POST_COMMON + `
  uniform sampler2D uDepth;
  uniform vec2 uPx;       // depth texel size
  vec3 vpos(vec2 uv) { float z = linZ(textureLod(uDepth, uv, 0.0).r); return vec3((uv * 2.0 - 1.0) * uTan * z, z); }
  void main() {
    vec3 P = vpos(vUv);
    if (P.z > 40.0) { oColor = vec4(1.0); return; }
    vec3 px = vpos(vUv + vec2(uPx.x, 0.0)) - P, nx = P - vpos(vUv - vec2(uPx.x, 0.0));
    vec3 py = vpos(vUv + vec2(0.0, uPx.y)) - P, ny = P - vpos(vUv - vec2(0.0, uPx.y));
    vec3 dx = dot(px, px) < dot(nx, nx) ? px : nx, dy = dot(py, py) < dot(ny, ny) ? py : ny;
    vec3 N = normalize(cross(dx, dy));
    if (dot(N, P) > 0.0) N = -N;
    const float R = 0.32;
    vec2 rad = R / (P.z * uTan) * 0.5;
    float a0 = ign(gl_FragCoord.xy) * 6.2831, occ = 0.0;
    for (int i = 0; i < 12; i++) {
      float f = (float(i) + 0.5) / 12.0;
      float a = a0 + float(i) * 2.39996;
      vec2 o = vec2(cos(a), sin(a)) * rad * sqrt(f);
      vec3 v = vpos(vUv + o) - P;
      float vv = dot(v, v);
      occ += max(0.0, dot(v, N) * inversesqrt(vv + 1e-6) - 0.15) * smoothstep(R * R * 4.0, R * R, vv);
    }
    oColor = vec4(vec3(clamp(1.0 - occ / 12.0 * 1.7, 0.0, 1.0)), 1.0);
  }`;

  // Depth-aware 4x4 blur of the occlusion.
  const AOBLUR_FS = POST_COMMON + `
  uniform sampler2D uAO, uDepth;
  uniform vec2 uPx;
  void main() {
    float z0 = linZ(textureLod(uDepth, vUv, 0.0).r), s = 0.0, w = 0.0;
    for (int y = -2; y < 2; y++) for (int x = -2; x < 2; x++) {
      vec2 uv = vUv + (vec2(x, y) + 0.5) * uPx;
      float z = linZ(textureLod(uDepth, uv, 0.0).r);
      float k = 1.0 / (0.02 + abs(z - z0) * 8.0 / z0);
      s += textureLod(uAO, uv, 0.0).r * k; w += k;
    }
    oColor = vec4(vec3(s / w), 1.0);
  }`;

  // Volumetric haze along each view ray: lightmap in-scattering, shafts under the
  // light panels, glow of the dynamic lights.
  const VOL_FS = POST_COMMON + `
  uniform sampler2D uDepth, uLightA, uCells;
  uniform vec2 uMapSize;
  uniform vec3 uEye, uF, uR, uU, uLamp, uAmbient;
  uniform float uDensity;
  uniform vec4 uDL[${MAX_DL}];
  uniform vec4 uDC[${MAX_DL}];
  uniform int uDN;
  void main() {
    float z = linZ(textureLod(uDepth, vUv, 0.0).r);
    vec2 s = (vUv * 2.0 - 1.0) * uTan;
    vec3 d = uF + uR * s.x + uU * s.y;
    float tEnd = min(z * length(d), 26.0);
    d = normalize(d);
    const int STEPS = 14;
    float dt = tEnd / float(STEPS), t = dt * ign(gl_FragCoord.xy);
    vec3 acc = vec3(0.0);
    ivec2 ms = ivec2(uMapSize) - 1;
    for (int i = 0; i < STEPS; i++, t += dt) {
      vec3 p = uEye + d * t;
      vec3 l = texture(uLightA, p.xy / uMapSize).rgb * 0.22 + uAmbient * 0.05;
      ivec2 c = clamp(ivec2(floor(p.xy)), ivec2(0), ms);
      vec4 cell = texelFetch(uCells, c, 0);
      if (cell.r < 0.5 && abs(cell.g * 255.0 - 1.0) < 0.5) {
        float r = length(fract(p.xy) - 0.5), cone = 0.2 + (0.98 - p.z) * 0.42;
        l += uLamp * smoothstep(cone, cone * 0.45, r) * smoothstep(0.0, 0.5, p.z) * 1.6;
      }
      for (int k = 0; k < 8; k++) {
        if (k >= uDN) break;
        vec3 q = uDL[k].xyz - p;
        float rr = uDL[k].w, dd = dot(q, q);
        l += uDC[k].rgb * max(0.0, 1.0 - dd / (rr * rr)) * 0.5 / (1.0 + dd * 3.0);
      }
      acc += l * exp(-t * 0.05);
    }
    oColor = vec4(acc * dt * uDensity, 1.0);
  }`;

  // Bloom: soft-threshold bright pass, then dual-filter down and up sampling.
  const PREFILTER_FS = POST_COMMON + `
  uniform sampler2D uSrc;
  uniform vec2 uPx;
  uniform float uThreshold;
  void main() {
    vec3 c = (texture(uSrc, vUv + uPx * vec2(-0.5, -0.5)).rgb + texture(uSrc, vUv + uPx * vec2(0.5, -0.5)).rgb +
              texture(uSrc, vUv + uPx * vec2(-0.5, 0.5)).rgb + texture(uSrc, vUv + uPx * vec2(0.5, 0.5)).rgb) * 0.25;
    c = min(c, vec3(40.0));
    float b = max(c.r, max(c.g, c.b));
    float knee = uThreshold * 0.5, soft = clamp(b - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    oColor = vec4(c * max(soft, b - uThreshold) / max(b, 1e-4), 1.0);
  }`;
  const DOWN_FS = POST_COMMON + `
  uniform sampler2D uSrc;
  uniform vec2 uPx;
  void main() {
    vec3 c = texture(uSrc, vUv).rgb * 4.0;
    c += texture(uSrc, vUv - uPx).rgb + texture(uSrc, vUv + uPx).rgb;
    c += texture(uSrc, vUv + vec2(uPx.x, -uPx.y)).rgb + texture(uSrc, vUv - vec2(uPx.x, -uPx.y)).rgb;
    oColor = vec4(c / 8.0, 1.0);
  }`;
  const UP_FS = POST_COMMON + `
  uniform sampler2D uSrc;
  uniform vec2 uPx;
  void main() {
    vec3 c = texture(uSrc, vUv + vec2(-uPx.x * 2.0, 0.0)).rgb + texture(uSrc, vUv + vec2(uPx.x * 2.0, 0.0)).rgb;
    c += texture(uSrc, vUv + vec2(0.0, -uPx.y * 2.0)).rgb + texture(uSrc, vUv + vec2(0.0, uPx.y * 2.0)).rgb;
    c += (texture(uSrc, vUv + vec2(-uPx.x, uPx.y)).rgb + texture(uSrc, vUv + uPx).rgb +
          texture(uSrc, vUv - uPx).rgb + texture(uSrc, vUv + vec2(uPx.x, -uPx.y)).rgb) * 2.0;
    oColor = vec4(c / 12.0, 1.0);
  }`;

  // Final image: occlusion, haze, bloom, exposure, ACES, grade, lens effects.
  const COMPOSITE_FS = POST_COMMON + `
  uniform sampler2D uScene, uBloom, uAO, uVol;
  uniform float uExposure, uBloomK, uAOK, uVolK, uTime, uHurt, uVig, uSat, uCA;
  uniform vec3 uLift, uGain;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  vec3 aces(vec3 c) { return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0); }
  void main() {
    vec2 uv = vUv;
    if (uHurt > 0.15) {
      // damage glitch: a few rows slide sideways
      float band = floor(uv.y * 48.0), tt = floor(uTime * 24.0);
      if (hash(band * 7.13 + tt) > 0.82) uv.x += (hash(band + tt * 3.1) - 0.5) * 0.06 * uHurt;
    }
    vec2 dc = uv - 0.5;
    float r2 = dot(dc, dc);
    vec2 ca = dc * r2 * uCA;
    vec3 c = vec3(texture(uScene, uv - ca).r, texture(uScene, uv).g, texture(uScene, uv + ca).b);
    float ao = texture(uAO, uv).r;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c *= mix(1.0, ao, uAOK * (1.0 - smoothstep(1.0, 3.0, lum)));
    c += texture(uVol, uv).rgb * uVolK;
    c += texture(uBloom, uv).rgb * uBloomK;
    c = aces(c * uExposure);
    c = c * uGain + uLift * (1.0 - c);
    float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = max(mix(vec3(g), c, uSat), 0.0);
    c *= 1.0 - uVig * smoothstep(0.1, 0.55, r2 * 1.6);
    c = pow(c, vec3(1.0 / 2.2));
    c += (ign(gl_FragCoord.xy + fract(uTime * 7.0) * 113.0) - 0.5) * (2.0 / 255.0);
    c += (hash(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uTime) - 0.5) * 0.012;
    oColor = vec4(c, 1.0);
  }`;

  // Per episode: haze density, grade gain and lift, saturation.
  const GRADES = [
    { dens: 0.8, gain: [1.0, 1.0, 1.03], lift: [0.0, 0.004, 0.012], sat: 1.06 },   // clean rooms
    { dens: 1.25, gain: [0.95, 1.0, 1.08], lift: [0.0, 0.012, 0.028], sat: 1.0 },  // cooling zone
    { dens: 1.0, gain: [0.97, 1.04, 0.97], lift: [0.0, 0.014, 0.006], sat: 1.05 }, // network core
    { dens: 1.1, gain: [1.07, 0.98, 0.92], lift: [0.014, 0.0, 0.022], sat: 1.0 },  // cold archives
    { dens: 1.4, gain: [1.06, 1.0, 0.9], lift: [0.018, 0.01, 0.0], sat: 1.1 },     // hyperscale
  ];

  let hdr = false, samples = 0;
  let progSSAO, progAOBlur, progVol, progPre, progDown, progUp, progComp, quadVAO;
  let msFBO = null, msColor = null, msDepth = null, resFBO = null, sceneTex = null, depthTex = null;
  let aoTex = null, aoFBO = null, ao2Tex = null, ao2FBO = null, volTex = null, volFBO = null;
  let bloom = [];      // [{tex, fbo, w, h}]
  let texWhite = null;

  function target(w, h, fmt, filter) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    tex2D(tex, filter, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  let postGarbage = [];
  function resizePost() {
    for (const [kind, o] of postGarbage) gl['delete' + kind](o);
    postGarbage = [];
    const keep = (kind, o) => { postGarbage.push([kind, o]); return o; };
    // multisampled HDR scene + depth, resolved into textures
    msFBO = keep('Framebuffer', gl.createFramebuffer());
    gl.bindFramebuffer(gl.FRAMEBUFFER, msFBO);
    msColor = keep('Renderbuffer', gl.createRenderbuffer());
    gl.bindRenderbuffer(gl.RENDERBUFFER, msColor);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA16F, bw, bh);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msColor);
    msDepth = keep('Renderbuffer', gl.createRenderbuffer());
    gl.bindRenderbuffer(gl.RENDERBUFFER, msDepth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, bw, bh);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msDepth);
    const sc = target(bw, bh, gl.RGBA16F, gl.LINEAR);
    sceneTex = keep('Texture', sc.tex); resFBO = keep('Framebuffer', sc.fbo);
    depthTex = keep('Texture', gl.createTexture());
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, bw, bh);
    tex2D(depthTex, gl.NEAREST, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, resFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
    // half-resolution effects
    const hw = Math.max(1, bw >> 1), hh = Math.max(1, bh >> 1);
    let t = target(hw, hh, gl.RGBA8, gl.LINEAR); aoTex = keep('Texture', t.tex); aoFBO = keep('Framebuffer', t.fbo);
    t = target(hw, hh, gl.RGBA8, gl.LINEAR); ao2Tex = keep('Texture', t.tex); ao2FBO = keep('Framebuffer', t.fbo);
    t = target(hw, hh, gl.RGBA16F, gl.LINEAR); volTex = keep('Texture', t.tex); volFBO = keep('Framebuffer', t.fbo);
    bloom = [];
    let w = hw, h = hh;
    for (let i = 0; i < 6 && w >= 4 && h >= 4; i++) {
      t = target(w, h, gl.RGBA16F, gl.LINEAR);
      keep('Texture', t.tex); keep('Framebuffer', t.fbo);
      bloom.push(t);
      w >>= 1; h >>= 1;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function pass(pr, fbo, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(pr.p);
    gl.uniform2f(pr.u.uNF, NEAR, FAR);
    gl.uniform2f(pr.u.uTan, TAN_H, TAN_H * bh / bw);
    return pr.u;
  }
  function bindTex(u, name, unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u[name], unit);
  }
  const quad = () => { gl.bindVertexArray(quadVAO); gl.drawArrays(gl.TRIANGLES, 0, 3); };

  function post(L, P) {
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    // resolve MSAA
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msFBO);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resFBO);
    gl.blitFramebuffer(0, 0, bw, bh, 0, 0, bw, bh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.blitFramebuffer(0, 0, bw, bh, 0, 0, bw, bh, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    const hw = Math.max(1, bw >> 1), hh = Math.max(1, bh >> 1);
    const high = Light.high, gr = GRADES[L.def.episode % GRADES.length];
    let u;
    if (high) {
      u = pass(progSSAO, aoFBO, hw, hh);
      gl.uniform2f(u.uPx, 2 / bw, 2 / bh);
      bindTex(u, 'uDepth', 0, depthTex);
      quad();
      u = pass(progAOBlur, ao2FBO, hw, hh);
      gl.uniform2f(u.uPx, 1 / hw, 1 / hh);
      bindTex(u, 'uAO', 0, aoTex); bindTex(u, 'uDepth', 1, depthTex);
      quad();
      u = pass(progVol, volFBO, hw, hh);
      bindTex(u, 'uDepth', 0, depthTex); bindTex(u, 'uLightA', 1, texLightA); bindTex(u, 'uCells', 2, texCells);
      gl.uniform2f(u.uMapSize, L.w, L.h);
      gl.uniform3f(u.uEye, cam.e[0], cam.e[1], cam.e[2]);
      gl.uniform3fv(u.uF, cam.f); gl.uniform3fv(u.uR, cam.r); gl.uniform3fv(u.uU, cam.u);
      const mood = LIGHT_MOODS[L.def.episode % LIGHT_MOODS.length];
      gl.uniform3fv(u.uLamp, mood.lamp);
      gl.uniform3f(u.uAmbient, ambient[0], ambient[1], ambient[2]);
      gl.uniform1f(u.uDensity, 0.02 * gr.dens);
      gl.uniform1i(u.uDN, dlN);
      if (dlN) { gl.uniform4fv(u.uDL, DL); gl.uniform4fv(u.uDC, DC); }
      quad();
    }
    // bloom chain
    u = pass(progPre, bloom[0].fbo, bloom[0].w, bloom[0].h);
    gl.uniform2f(u.uPx, 1 / bw, 1 / bh);
    gl.uniform1f(u.uThreshold, 1.0);
    bindTex(u, 'uSrc', 0, sceneTex);
    quad();
    for (let i = 1; i < bloom.length; i++) {
      u = pass(progDown, bloom[i].fbo, bloom[i].w, bloom[i].h);
      gl.uniform2f(u.uPx, 1 / bloom[i - 1].w, 1 / bloom[i - 1].h);
      bindTex(u, 'uSrc', 0, bloom[i - 1].tex);
      quad();
    }
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = bloom.length - 1; i > 0; i--) {
      u = pass(progUp, bloom[i - 1].fbo, bloom[i - 1].w, bloom[i - 1].h);
      gl.uniform2f(u.uPx, 1 / bloom[i].w, 1 / bloom[i].h);
      bindTex(u, 'uSrc', 0, bloom[i].tex);
      quad();
    }
    gl.disable(gl.BLEND);
    // composite to the canvas
    u = pass(progComp, null, bw, bh);
    bindTex(u, 'uScene', 0, sceneTex); bindTex(u, 'uBloom', 1, bloom[0].tex);
    bindTex(u, 'uAO', 2, high ? ao2Tex : texWhite); bindTex(u, 'uVol', 3, high ? volTex : texBlack);
    gl.uniform1f(u.uExposure, exposure);
    gl.uniform1f(u.uBloomK, high ? 0.09 : 0.06);
    gl.uniform1f(u.uAOK, high ? 0.85 : 0);
    gl.uniform1f(u.uVolK, high ? 1 : 0);
    gl.uniform1f(u.uTime, performance.now() / 1000 % 1000);
    gl.uniform1f(u.uHurt, P.hurtT > 0 ? P.hurtT : 0);
    gl.uniform1f(u.uVig, high ? 0.42 : 0.3);
    gl.uniform1f(u.uCA, high ? 0.012 : 0);
    gl.uniform1f(u.uSat, gr.sat);
    gl.uniform3fv(u.uGain, gr.gain); gl.uniform3fv(u.uLift, gr.lift);
    quad();
    gl.bindVertexArray(null);
  }

  function initPost() {
    if (!floatOK) return;
    samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
    progSSAO = compile(QUAD_VS, SSAO_FS);
    progAOBlur = compile(QUAD_VS, AOBLUR_FS);
    progVol = compile(QUAD_VS, VOL_FS);
    progPre = compile(QUAD_VS, PREFILTER_FS);
    progDown = compile(QUAD_VS, DOWN_FS);
    progUp = compile(QUAD_VS, UP_FS);
    progComp = compile(QUAD_VS, COMPOSITE_FS);
    quadVAO = gl.createVertexArray();
    texWhite = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texWhite);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    tex2D(texWhite, gl.NEAREST, gl.CLAMP_TO_EDGE);
    hdr = true;
  }

  /* -------------------------------------------------------------- set up */
  function resizeBuffers() {
    const w = Math.max(1, Math.round(cssW * dpr * scale)), h = Math.max(1, Math.round(cssH * dpr * scale));
    if (w === bw && h === bh && cv.width === w) return;
    bw = w; bh = h;
    cv.width = w; cv.height = h;
    // reflection target at half resolution, with mipmaps for glossy blur
    rw = Math.max(1, w >> 1); rh = Math.max(1, h >> 1);
    if (reflTex) { gl.deleteTexture(reflTex); gl.deleteRenderbuffer(reflDepth); gl.deleteFramebuffer(reflFBO); }
    reflTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, reflTex);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(rw, rh))) + 1, floatOK ? gl.RGBA16F : gl.RGBA8, rw, rh);
    tex2D(reflTex, gl.LINEAR_MIPMAP_LINEAR, gl.CLAMP_TO_EDGE);
    reflDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, reflDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, rw, rh);
    reflFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, reflFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, reflTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, reflDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (hdr) resizePost();
  }

  let userScale = 1, lay = null;
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
      gl = cv.getContext('webgl2', { antialias: false, alpha: false, depth: true, premultipliedAlpha: false, powerPreference: 'high-performance' });
      if (!gl) return false;
      aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      floatOK = !!gl.getExtension('EXT_color_buffer_float');
      progWorld = compile(WORLD_VS, WORLD_FS);
      progSprite = compile(SPRITE_VS, SPRITE_FS);
      initPost();
      buildWallArray();
      texSprites = newArray(SPR_CAP, gl.SRGB8_ALPHA8);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      texLightA = gl.createTexture(); texLightB = gl.createTexture(); texCells = gl.createTexture();
      texBlack = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texBlack);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      tex2D(texBlack, gl.NEAREST, gl.CLAMP_TO_EDGE);
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
    get hdr() { return hdr; },
    get canvas() { return cv; },
    onLost: null,
  };
})();
