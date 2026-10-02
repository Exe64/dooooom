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
 * Objects: props (server pallets, UPS batteries, water coolers, extinguishers)
 * are real meshes built from the same boxes and faces as their sprites.
 * Monsters show 8 rotations and, like items, are lit as volumes: a relief map
 * (height from the distance to the sprite's edge) gives them normals and a
 * depth offset, so they catch the lamps and dynamic lights from the side.
 * Everything standing on the floor casts a soft contact shadow. Sparks,
 * embers, smoke, debris and ejected casings are simulated particles.
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
  let texDetail = null, texHgt = null;
  let texWalls = null, texNrm = null, texSprites = null, texSprNrm = null, texLightA = null, texLightB = null, texCells = null, texBlack = null;
  let reflFBO = null, reflTex = null, reflDepth = null, rw = 0, rh = 0;
  let aniso = null, floatOK = false;
  let cssW = 1, cssH = 1, dpr = 1, scale = 1, bw = 1, bh = 1;

  const NEAR = 0.02, FAR = 120;
  const TAN_H = 0.8;                     // PLANE in game.js: 77 degree horizontal field of view
  const VSTRIDE = 15;                    // pos3 uv2 nrm3 tan3 tex4 (layer base, frames, phase, kind)
  const KIND_WALL = 0, KIND_FLOOR = 1, KIND_CEIL = 2, KIND_DOOR = 3;
  const LG2 = 8;                         // lightmap texels per map cell
  const MAX_DL = 16;                     // dynamic lights per frame
  const POM_DEPTH = 0.045;               // deepest parallax relief (tile units), see normalMap()

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
  uniform sampler2DArray uTex, uNrm, uHgt;
  uniform sampler2D uRefl, uDetail;
  uniform float uPom;

  // Parallax occlusion mapping: walks the view ray down into the height field
  // (racks' slots, door ribs, floor tiles) and returns where it hits.
  vec2 pom(vec2 uv, float layer, vec3 Vts, float fade) {
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    const int N = 14;
    float stepH = 1.0 / float(N);
    vec2 dUv = -Vts.xy / max(Vts.z, 0.2) * ${POM_DEPTH} * fade * stepH;
    float cur = 1.0, h = textureGrad(uHgt, vec3(uv, layer), dx, dy).r, prevH = h;
    vec2 p = uv;
    for (int i = 0; i < N; i++) {
      if (cur <= h) break;
      prevH = h;
      p += dUv; cur -= stepH;
      h = textureGrad(uHgt, vec3(p, layer), dx, dy).r;
    }
    // linear refinement between the last two samples
    float a = h - cur, b = prevH - (cur + stepH);
    float w = a / max(a - b, 1e-4);
    return mix(p, p - dUv, clamp(w, 0.0, 1.0));
  }
  uniform float uReflOn;
  uniform vec2 uViewport;
  ${LIGHTING}
  out vec4 oColor;
  void main() {
    vec3 Ng = normalize(vNrm), T = normalize(vTan);
    vec3 B = vKind == 1.0 || vKind == 2.0 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, -1.0);
    vec2 uv = vUv;
    float dist = length(uEye - vPos);
    float pf = uPom * (1.0 - smoothstep(5.0, 8.0, dist));
    if (pf > 0.0) {
      vec3 V0 = normalize(uEye - vPos);
      uv = pom(vUv, vLayer, vec3(dot(V0, T), dot(V0, B), dot(V0, Ng)), pf);
    }
    vec3 uvl = vec3(uv, vLayer);
    vec4 t = texture(uTex, uvl);
    vec4 nm = texture(uNrm, uvl);
    vec2 nxy = nm.rg * 2.0 - 1.0;
    // up close, the detail map adds grain and micro relief (not on emissive texels)
    float near = (1.0 - smoothstep(1.2, 3.5, length(uEye - vPos))) * (1.0 - t.a);
    if (near > 0.0) {
      vec4 dt = texture(uDetail, uv * 5.0);
      t.rgb *= 1.0 + (dt.r - 0.5) * 0.22 * near;
      nxy += (dt.gb - 0.5) * 0.35 * near;
    }
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
  flat out float vLayer; flat out float vFlags; flat out vec2 vFeet; flat out float vSize;
  void main() {
    vec3 p = vec3(iPos.xy + uRight * (aQuad.x - 0.5) * iPos.w, iPos.z + (1.0 - aQuad.y) * iPos.w);
    vUv = aQuad * iTex.yz;
    vPos = p; vLayer = iTex.x; vFlags = iTex.w; vFeet = iPos.xy; vSize = iPos.w;
    gl_Position = uVP * vec4(p.xy, p.z * uMirror, 1.0);
    gl_Position.xy += uJitter * gl_Position.w;
  }`;

  const SPRITE_FS = `#version 300 es
  precision highp float;
  precision highp sampler2DArray;
  in vec2 vUv; in vec3 vPos;
  flat in float vLayer; flat in float vFlags; flat in vec2 vFeet; flat in float vSize;
  uniform sampler2DArray uTex, uNrmS;
  uniform vec3 uFwd;
  uniform vec2 uRight;
  uniform mat4 uVP;
  ${LIGHTING}
  out vec4 oColor;
  void main() {
    if (uMirror < 0.0 && vPos.z < 0.0) discard;
    vec4 t = texture(uTex, vec3(vUv, vLayer));
    if (t.a < 0.03) discard;
    int fl = int(vFlags + 0.5);
    vec3 c, F = normalize(vec3(-uFwd.xy, 0.0)), P = vPos;
    if ((fl & 2) != 0) c = t.rgb * uEmissive;
    else {
      // relief: normal from the height map, surface pushed toward the viewer
      vec4 nm = texture(uNrmS, vec3(vUv, vLayer));
      vec3 nt = nm.rgb * 2.0 - 1.0;
      vec3 N = normalize(vec3(uRight, 0.0) * nt.x - vec3(0.0, 0.0, 1.0) * nt.y + F * max(nt.z, 0.05));
      P += F * (nm.a - 0.5) * vSize * 0.3;
      c = shade(t.rgb, N, P, vFeet, 0.35, 0.3, 0.3);
      if ((fl & 1) != 0) c = mix(c, vec3(1.6), 0.5);
      c = fogged(c, P);
    }
    vec4 cp = uVP * vec4(P.xy, P.z * uMirror, 1.0);
    gl_FragDepth = clamp(cp.z / cp.w * 0.5 + 0.5, 0.0, 1.0);
    oColor = vec4(uRaw > 0.5 ? c : tonemap(c), t.a);
  }`;

  // The weapon in hand: a mesh in camera space (weapons.js build3D), projected with
  // its own framing (focal f and vanishing point, in the 480x230 logical view) so that it
  // matches the 2D renders, moved by bobbing and recoil in screen space, and lit in
  // world space by the same lights as the scene. Its depth is written as if it were
  // in the world (K world units per meter) so that the post-processing sees it.
  const VM_VS = `#version 300 es
  layout(location=0) in vec3 aPos;
  layout(location=1) in vec3 aNrm;
  layout(location=2) in vec3 aCol;
  layout(location=3) in vec2 aUv;
  layout(location=4) in vec3 aMat;
  layout(location=5) in vec2 aEdge;
  uniform vec4 uProj;     // focal, vanishing point x, y (logical px)
  uniform vec4 uMove;     // offset x, y (logical px), rotation, unused
  uniform vec2 uPivot;    // rotation pivot (logical px)
  uniform vec2 uAB;       // world projection depth terms
  uniform vec2 uJitter;
  uniform vec3 uEye, uRw, uDw, uFw;
  uniform float uK;
  out vec3 vPos; out vec3 vNrm; out vec3 vCol; out vec2 vUv; out vec2 vEdge; out vec3 vLoc; flat out vec3 vMat;
  void main() {
    vEdge = aEdge; vLoc = aPos;
    vec2 s = uProj.yz + uProj.x * aPos.xy / aPos.z;
    vec2 q = s - uPivot;
    float c = cos(uMove.z), sn = sin(uMove.z);
    s = vec2(c * q.x - sn * q.y, sn * q.x + c * q.y) + uPivot + uMove.xy;
    float z = aPos.z * uK;
    gl_Position = vec4(vec2(s.x / 240.0 - 1.0, 1.0 - s.y / 115.0) * z, uAB.x * z + uAB.y, z);
    gl_Position.xy += uJitter * z;
    vPos = uEye + (uRw * aPos.x + uDw * aPos.y + uFw * aPos.z) * uK;
    vNrm = uRw * aNrm.x + uDw * aNrm.y + uFw * aNrm.z;
    vCol = aCol; vUv = aUv; vMat = aMat;
  }`;

  const VM_FS = `#version 300 es
  precision highp float;
  in vec3 vPos; in vec3 vNrm; in vec3 vCol; in vec2 vUv; in vec2 vEdge; in vec3 vLoc; flat in vec3 vMat;
  uniform sampler2D uAtlas;
  uniform vec3 uRw, uDw, uFw;
  ${LIGHTING}
  out vec4 oColor;
  float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  void main() {
    int fl = int(vMat.z + 0.5);
    vec3 alb = pow(vCol, vec3(2.2));
    if ((fl & 2) != 0) alb *= texture(uAtlas, vUv).rgb;
    // fine grain on the surfaces (cast metal, plastic)
    alb *= 0.94 + 0.06 * h3(floor(vLoc * 900.0));
    vec3 N = normalize(vNrm), c;
    vec3 V = normalize(uEye - vPos);
    // bevelled box edges: a dark seam, then a thin highlight catching the light
    float edge = 1e3;
    if ((fl & 4) != 0) {
      vec2 e = min(vEdge, 1.0 - vEdge) / max(fwidth(vEdge), vec2(1e-5));
      edge = min(e.x, e.y);
    }
    if ((fl & 1) != 0) c = alb * uEmissive * 1.5;
    else {
      float gloss = vMat.x, spec = vMat.y, shin = mix(8.0, 110.0, gloss);
      c = shade(alb, N, vPos, uEye.xy, gloss, spec, 0.2) * 0.55;
      // key light from above and to the left of the view, in the color of the room's light:
      // gives every part of the model its own shade, like a studio light
      vec3 lc = texture(uLightA, uEye.xy / uMapSize).rgb * 0.6 + uAmbient * 0.7 + 0.02;
      vec3 K = normalize(-uRw * 0.35 - uDw * 0.9 + uFw * 0.25);
      float nk = max(dot(N, K), 0.0);
      c += lc * (alb * (0.12 + 0.55 * nk) + spec * lobe(N, K, V, shin) * nk * 0.6);
      // shiny parts reflect the room: bright ceiling panels above, dark floor below
      vec3 R = reflect(-V, N);
      float fr = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
      vec3 env = lc * (0.25 + 2.2 * smoothstep(0.1, 0.9, R.z) + 0.6 * smoothstep(0.6, 0.95, abs(dot(R, uRw))));
      c += env * spec * mix(0.25, 1.0, fr) * gloss * (spec > 0.7 ? 0.6 : 0.15);
      // rim light along the silhouette
      c += lc * alb * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.6;
      c *= 0.72;   // held below the lamps: keeps its colors through the tone curve
      if (edge < 3.0) c *= mix(0.45, 1.0 + 0.6 * nk, smoothstep(0.6, 1.6, edge)) * (edge < 1.6 ? 1.0 : mix(1.25, 1.0, smoothstep(1.6, 3.0, edge)));
    }
    oColor = vec4(uRaw > 0.5 ? c : tonemap(c), 1.0);
  }`;

  // Monsters (monsters3d.js): rigid parts placed by a model matrix each, lit like the props.
  const MON_VS = `#version 300 es
  layout(location=0) in vec3 aPos;
  layout(location=1) in vec3 aNrm;
  layout(location=2) in vec3 aCol;
  layout(location=3) in vec2 aUv;
  layout(location=4) in vec3 aMat;
  uniform mat4 uVP, uModel;
  uniform float uMirror;
  uniform vec2 uJitter;
  out vec3 vPos; out vec3 vNrm; out vec3 vCol; out vec2 vUv; flat out vec3 vMat;
  void main() {
    vec4 wp = uModel * vec4(aPos, 1.0);
    vPos = wp.xyz; vNrm = mat3(uModel) * aNrm; vCol = aCol; vUv = aUv; vMat = aMat;
    gl_Position = uVP * vec4(wp.xy, wp.z * uMirror, 1.0);
    gl_Position.xy += uJitter * gl_Position.w;
  }`;
  const MON_FS = `#version 300 es
  precision highp float;
  in vec3 vPos; in vec3 vNrm; in vec3 vCol; in vec2 vUv; flat in vec3 vMat;
  uniform sampler2D uAtlas;
  uniform float uFlash;
  ${LIGHTING}
  out vec4 oColor;
  void main() {
    if (uMirror < 0.0 && vPos.z < 0.0) discard;
    int fl = int(vMat.z + 0.5);
    vec3 alb = pow(vCol, vec3(2.2));
    if ((fl & 2) != 0) alb *= texture(uAtlas, vUv).rgb;
    vec3 N = normalize(vNrm), c;
    if ((fl & 1) != 0) c = alb * uEmissive * 1.4;
    else {
      c = shade(alb, N, vPos, vPos.xy + N.xy * 0.05, vMat.x, vMat.y, 0.15);
      // a touch of rim light keeps the silhouettes readable in the dark
      vec3 V = normalize(uEye - vPos);
      c += alb * (uAmbient * 0.5 + 0.01) * pow(1.0 - max(dot(N, V), 0.0), 2.0);
      c = fogged(c, vPos);
    }
    c = mix(c, vec3(1.6), uFlash * 0.5);
    oColor = vec4(uRaw > 0.5 ? c : tonemap(c), 1.0);
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

  function newArray(layers, fmt, size = TS) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.log2(size) + 1, fmt, size, size, layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return t;
  }

  // Surface response per wall tile: [bump strength, gloss, specular].
  const MATERIALS = {
    // bump strength, gloss, specular, parallax depth (tile units: 1 = the wall's height)
    concrete: [1.1, 0.16, 0.12, 0.012], rack: [2.6, 0.62, 0.55, 0.045], door: [2.2, 0.5, 0.5, 0.03], crac: [2.2, 0.5, 0.45, 0.035],
    warn: [1.4, 0.3, 0.2, 0.012], exit: [1.8, 0.4, 0.3, 0.02], floor: [1.2, 0.78, 0.6, 0.008], perf: [2.2, 0.66, 0.55, 0.014], ceil: [1.2, 0.22, 0.12, 0.012],
  };
  const TILE_MAT = { '#': 'concrete', '?': 'concrete', W: 'warn', R: 'rack', S: 'rack', N: 'rack', C: 'crac', D: 'door', 1: 'door', 2: 'door', X: 'exit' };

  // Detail map, tiled several times per texture and faded in up close: fine grain and
  // micro relief so that surfaces don't turn into smooth blur when the player
  // walks up to them. r: albedo variation, g/b: normal perturbation (wrapping value noise).
  function detailTexture() {
    const N = 256, n = N * N, h = new Float32Array(n);
    const R = rng(4242);
    for (const [cell, amp] of [[64, 0.5], [32, 0.25], [16, 0.15], [8, 0.07], [4, 0.03]]) {
      const g = N / cell, v = new Float32Array(g * g).map(() => R());
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const fx = x / cell, fy = y / cell, x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const at = (i, j) => v[((j + g) % g) * g + ((i + g) % g)];
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx, b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        h[y * N + x] += (a + (b - a) * sy) * amp;
      }
    }
    const out = new Uint8Array(n * 4), at = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      out[i] = Math.round(Math.min(1, h[y * N + x]) * 255);
      out[i + 1] = Math.round(Math.max(0, Math.min(1, 0.5 + (at(x - 1, y) - at(x + 1, y)) * 6)) * 255);
      out[i + 2] = Math.round(Math.max(0, Math.min(1, 0.5 + (at(x, y - 1) - at(x, y + 1)) * 6)) * 255);
      out[i + 3] = 255;
    }
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.generateMipmap(gl.TEXTURE_2D);
    tex2D(t, gl.LINEAR_MIPMAP_LINEAR, gl.REPEAT);
    return t;
  }

  // Walls and flats are drawn again at GT for the GPU: twice the resolution of the
  // software renderer, so that they stay sharp up close.
  const GT = 512;
  // Normal (rg), gloss (b) and specular (a) maps, from the texture's luminance as a height field.
  // hgt (optional): the height field for parallax mapping, 255 = surface, 0 = POM_DEPTH deep,
  // scaled by the material's depth (racks and doors are deep, concrete and floors shallow).
  function normalMap(t, mat, size, hgt) {
    const m = MATERIALS[mat];
    return heightNormals(t.px, t.em, size, size, m[0] * size / TS, m[1], m[2], hgt, m[3] / POM_DEPTH);
  }
  function heightNormals(px, em, W, H, S, gl0, sp0, hgt, depth) {
    const n = W * H, lum = new Float32Array(n), h = new Float32Array(n);
    for (let i = 0; i < n; i++) { const c = px[i]; lum[i] = ((c & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + ((c >> 16) & 255) * 0.11) / 255; }
    // wrapped neighbor columns and rows (the textures tile)
    const xl = new Int32Array(W), xr = new Int32Array(W), yu = new Int32Array(H), yd = new Int32Array(H);
    for (let x = 0; x < W; x++) { xl[x] = (x + W - 1) % W; xr[x] = (x + 1) % W; }
    for (let y = 0; y < H; y++) { yu[y] = ((y + H - 1) % H) * W; yd[y] = ((y + 1) % H) * W; }
    const blur = (src, dst) => {
      for (let y = 0; y < H; y++) {
        const r = y * W, u = yu[y], d = yd[y];
        for (let x = 0; x < W; x++) dst[r + x] = (src[r + x] * 4 + src[r + xl[x]] + src[r + xr[x]] + src[u + x] + src[d + x]) * 0.125;
      }
    };
    const tmp = new Float32Array(n);
    blur(lum, tmp); blur(tmp, h);
    if (hgt) {
      let lo = 1, hi = 0;
      for (let i = 0; i < n; i++) { if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i]; }
      const k = hi - lo > 1e-3 ? 1 / (hi - lo) : 0;
      // emissive texels (screens, LEDs) stay flat: their text must not slide
      for (let i = 0; i < n; i++) hgt[i] = em && em[i] ? 255 : (1 - (1 - (h[i] - lo) * k) * depth) * 255 + 0.5;
    }
    const out = new Uint8Array(n * 4);
    for (let y = 0; y < H; y++) {
      const r = y * W, u = yu[y], d = yd[y];
      for (let x = 0; x < W; x++) {
        const i = r + x, o = i * 4;
        if (em && em[i]) { out[o] = 128; out[o + 1] = 128; out[o + 2] = 230; out[o + 3] = 150; continue; }
        const a = xl[x], b = xr[x];
        const gx = (h[u + b] + 2 * h[r + b] + h[d + b]) - (h[u + a] + 2 * h[r + a] + h[d + a]);
        const gy = (h[d + a] + 2 * h[d + x] + h[d + b]) - (h[u + a] + 2 * h[u + x] + h[u + b]);
        let nx = -gx * S, ny = -gy * S;
        const l = Math.sqrt(nx * nx + ny * ny + 1);
        nx /= l; ny /= l;
        const v = lum[i];
        out[o] = (nx * 0.5 + 0.5) * 255 + 0.5;
        out[o + 1] = (ny * 0.5 + 0.5) * 255 + 0.5;
        out[o + 2] = Math.min(1, gl0 * (0.7 + 0.6 * v)) * 255 + 0.5;
        out[o + 3] = Math.min(1, sp0 * (0.5 + v)) * 255 + 0.5;
      }
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
    texWalls = newArray(list.length, gl.SRGB8_ALPHA8, GT);
    texNrm = newArray(list.length, gl.RGBA8, GT);
    texHgt = newArray(list.length, gl.R8, GT);
    list.forEach(([t0, mat], i) => {
      const t = t0.hires ? t0.hires(GT) : t0, size = t0.hires ? GT : TS;
      const rgba = new Uint8Array(t.px.buffer.slice(0));
      for (let k = 0; k < t.em.length; k++) rgba[k * 4 + 3] = t.em[k] ? 255 : 0;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, texWalls);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      const hgt = new Uint8Array(size * size);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, texNrm);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, normalMap(t, mat, size, hgt));
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, texHgt);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RED, gl.UNSIGNED_BYTE, hgt);
    });
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texHgt);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texWalls);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texNrm);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    texDetail = detailTexture();
  }

  // Sprites: layers are given out on first use (CPU mips, edge dilation).
  // Each sprite also gets a relief map at half resolution (rgb: normal, a: height).
  const SPR_CAP = 240, NTS = TS / 2;
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
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    const rel = mipChain(reliefMap(mips[1] || mips[0], hw, hh), hw, hh);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texSprNrm);
    for (let m = 0; m < Math.min(LEVELS - 1, rel.length); m++) {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, m, 0, 0, l, Math.max(1, hw >> m), Math.max(1, hh >> m), 1, gl.RGBA, gl.UNSIGNED_BYTE, rel[m]);
    }
    return l;
  }

  // Rounded relief of a sprite: height from the distance to its edge (chamfer
  // distance transform), plus a little of its shading as detail.
  function reliefMap(rgba, w, h) {
    const n = w * h, D = Math.max(3, w / 11), d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = rgba[i * 4 + 3] >= 110 ? 1e6 : 0;
    const get = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i]) d[i] = Math.min(d[i], get(x - 1, y) + 1, get(x, y - 1) + 1, get(x - 1, y - 1) + 1.414, get(x + 1, y - 1) + 1.414);
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i]) d[i] = Math.min(d[i], get(x + 1, y) + 1, get(x, y + 1) + 1, get(x + 1, y + 1) + 1.414, get(x - 1, y + 1) + 1.414);
    }
    const hgt = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (!d[i]) continue;
      const t = Math.min(1, d[i] / D), lum = (rgba[i * 4] * 0.3 + rgba[i * 4 + 1] * 0.59 + rgba[i * 4 + 2] * 0.11) / 255;
      hgt[i] = Math.sqrt(1 - (1 - t) * (1 - t)) * 0.9 + lum * 0.1;
    }
    const H = (x, y) => hgt[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
    const out = new Uint8Array(n * 4), k = D * 0.45;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      let nx = -(H(x + 1, y) - H(x - 1, y)) * k, ny = -(H(x, y + 1) - H(x, y - 1)) * k;
      const l = Math.hypot(nx, ny, 1);
      out[o] = Math.round((nx / l * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      out[o + 3] = Math.round(hgt[i] * 255);
    }
    return out;
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

  // An axis-aligned box (no bottom face), textured with the rectangle r = [u0, v0, u1, v1] of a layer.
  function pushBox(V, I, x0, y0, z0, x1, y1, z1, r, tex) {
    const [u0, v0, u1, v1] = r, uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    pushQuad(V, I, [[x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0]], uv, [1, 0, 0], [0, -1, 0], tex);
    pushQuad(V, I, [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]], uv, [-1, 0, 0], [0, 1, 0], tex);
    pushQuad(V, I, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], uv, [0, 1, 0], [1, 0, 0], tex);
    pushQuad(V, I, [[x1, y0, z1], [x0, y0, z1], [x0, y0, z0], [x1, y0, z0]], uv, [0, -1, 0], [-1, 0, 0], tex);
    pushQuad(V, I, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], uv, [0, 0, 1], [1, 0, 0], tex);
  }

  // Trims: a baseboard along the concrete walls, and jambs framing the doors.
  const BASE_H = 0.045, BASE_D = 0.014, JAMB_W = 0.05, JAMB_D = 0.035;
  function pushTrims(V, I, L) {
    const w = L.w, h = L.h, solid = (x, y) => solidAt(L, x, y);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, t = L.map[i];
      if (!t || L.doors[i] || String.fromCharCode(t) !== '#') continue;
      const tex = [wallFrames(L, i)[0].glLayer, 1, 0, KIND_WALL], r = [0, 0.94, 1, 1];
      if (!solid(x + 1, y)) pushBox(V, I, x + 1, y, 0, x + 1 + BASE_D, y + 1, BASE_H, r, tex);
      if (!solid(x - 1, y)) pushBox(V, I, x - BASE_D, y, 0, x, y + 1, BASE_H, r, tex);
      if (!solid(x, y + 1)) pushBox(V, I, x, y + 1, 0, x + 1, y + 1 + BASE_D, BASE_H, r, tex);
      if (!solid(x, y - 1)) pushBox(V, I, x, y - BASE_D, 0, x + 1, y, BASE_H, r, tex);
    }
    for (const d of L.doorList) {
      if (d.secret) continue;
      const i = d.y * w + d.x, tex = [wallFrames(L, i)[0].glLayer, 1, 0, KIND_WALL], r = [0, 0, 0.08, 1];
      const x = d.x, y = d.y;
      // a frame on both faces of the wall: two jambs standing out of each face
      if (solid(x - 1, y) && solid(x + 1, y)) {        // passage north-south
        for (const [y0, y1] of [[y - JAMB_D, y], [y + 1, y + 1 + JAMB_D]]) {
          pushBox(V, I, x - JAMB_W, y0, 0, x + JAMB_W, y1, 1, r, tex);
          pushBox(V, I, x + 1 - JAMB_W, y0, 0, x + 1 + JAMB_W, y1, 1, r, tex);
        }
      } else {                                          // passage east-west
        for (const [x0, x1] of [[x - JAMB_D, x], [x + 1, x + 1 + JAMB_D]]) {
          pushBox(V, I, x0, y - JAMB_W, 0, x1, y + JAMB_W, 1, r, tex);
          pushBox(V, I, x0, y + 1 - JAMB_W, 0, x1, y + 1 + JAMB_W, 1, r, tex);
        }
      }
    }
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
    pushTrims(V, I, L);
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
    parts.length = 0;
    // a fresh sprite pool for the level, filled in the background (see warmUp)
    sprLayer = new Map(); sprNext = 0;
    warm.length = 0; warmTypes.clear();
    for (const e of L.enemies) queueType(e.type);
    const all = (v) => (Array.isArray(v) ? v : [v]);
    for (const k of Object.keys(Assets.proj)) warm.push(() => { all(Assets.proj[k]).forEach(spriteLayer); return true; });
    for (const k of Object.keys(Assets.items)) warm.push(() => { spriteLayer(Assets.items[k]); return true; });
  }

  // Background work, a few milliseconds per frame: monsters' rotations and sprite
  // uploads, so that nothing stalls a frame when it first shows up.
  const warm = [], warmTypes = new Set();
  function queueType(type) {
    if (warmTypes.has(type)) return;
    warmTypes.add(type);
    const S = Assets.enemies[type];
    warm.push(() => { S.walk.forEach(spriteLayer); spriteLayer(S.atk); return true; });
    warm.push(() => warmRotations(S, spriteLayer));
    warm.push(() => { S.die.forEach(spriteLayer); spriteLayer(S.dead); return true; });
  }
  function warmUp(L, budget) {
    for (const e of L.enemies) if (!warmTypes.has(e.type)) queueType(e.type);
    const t0 = performance.now();
    while (warm.length && performance.now() - t0 < budget) if (warm[0]()) warm.shift();
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

  /* ------------------------------------------------------------- objects */
  // Props: real meshes from the boxes and cylinders that their sprites were drawn
  // from (textures.js), textured from one atlas of their face canvases.
  const PROP_VS = `#version 300 es
  layout(location=0) in vec3 aPos;
  layout(location=1) in vec2 aUv;
  layout(location=2) in vec3 aNrm;
  layout(location=3) in vec3 aTan;
  layout(location=4) in vec3 aBit;
  layout(location=5) in vec2 aMat;
  layout(location=6) in vec4 iProp;   // x, y, angle, flags (1: armed UPS)
  uniform mat4 uVP;
  uniform float uMirror;
  uniform vec2 uJitter;
  out vec3 vPos; out vec2 vUv; out vec3 vNrm; out vec3 vTan; out vec3 vBit; out vec2 vMat;
  flat out float vFlags;
  void main() {
    float c = cos(iProp.z), s = sin(iProp.z);
    mat2 R = mat2(c, s, -s, c);
    vPos = vec3(R * aPos.xy + iProp.xy, aPos.z);
    vNrm = vec3(R * aNrm.xy, aNrm.z); vTan = vec3(R * aTan.xy, aTan.z); vBit = vec3(R * aBit.xy, aBit.z);
    vUv = aUv; vMat = aMat; vFlags = iProp.w;
    gl_Position = uVP * vec4(vPos.xy, vPos.z * uMirror, 1.0);
    gl_Position.xy += uJitter * gl_Position.w;
  }`;
  const PROP_FS = `#version 300 es
  precision highp float;
  in vec3 vPos; in vec2 vUv; in vec3 vNrm; in vec3 vTan; in vec3 vBit; in vec2 vMat;
  flat in float vFlags;
  uniform sampler2D uAtlas, uAtlasN, uDetail;
  uniform float uTime;
  ${LIGHTING}
  out vec4 oColor;
  void main() {
    vec4 t = texture(uAtlas, vUv);
    vec2 nxy = texture(uAtlasN, vUv).rg * 2.0 - 1.0;
    vec3 Ng = normalize(vNrm);
    // detail map up close, projected on the face's plane
    float near = 1.0 - smoothstep(1.2, 3.5, length(uEye - vPos));
    if (near > 0.0) {
      vec3 an = abs(Ng);
      vec2 dp = an.z > 0.7 ? vPos.xy : (an.x > an.y ? vPos.yz : vPos.xz);
      vec4 dt = texture(uDetail, dp * 4.0);
      t.rgb *= 1.0 + (dt.r - 0.5) * 0.25 * near;
      nxy += (dt.gb - 0.5) * 0.35 * near;
    }
    vec3 N = normalize(normalize(vTan) * nxy.x + normalize(vBit) * nxy.y + Ng * sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
    vec3 c = shade(t.rgb, N, vPos, vPos.xy + Ng.xy * 0.04, vMat.x, vMat.y, 0.0);
    if (vFlags > 0.5) c += t.rgb * vec3(4.0, 0.3, 0.2) * (0.55 + 0.45 * sin(uTime * 20.0));
    c = fogged(c, vPos);
    oColor = vec4(uRaw > 0.5 ? c : tonemap(c), 1.0);
  }`;

  const PSTRIDE = 16;   // pos3 uv2 nrm3 tan3 bit3 mat2
  const PROP_MAT = { x: [0.12, 0.08], B: [0.5, 0.5], f: [0.45, 0.4], e: [0.55, 0.5] };
  let progProp, propVAO, propInst, propMeshes = {}, texAtlas, texAtlasN;
  const PROP_MAX = 512, propData = new Float32Array(PROP_MAX * 4);

  function buildProps() {
    // faces drawn 4 times finer than the sprites' (sharp up close); rects keep the original as key
    const D = Assets.decor, canv = [], hi = new Map();
    const addC = (c) => { if (c && !canv.includes(c)) { canv.push(c); hi.set(c, c.hires ? c.hires(4) : c); } };
    for (const k of Object.keys(D)) {
      for (const b of D[k].boxes || []) Object.values(b.faces).forEach(addC);
      for (const c of D[k].cyls || []) { addC(c.tex); addC(c.top); }
    }
    // shelf packing, with 2 texel gutters made of stretched edges
    const AW = 2048, PAD = 2, rects = new Map();
    canv.sort((a, b) => hi.get(b).height - hi.get(a).height);
    let x = 0, y = 0, rowH = 0;
    for (const c of canv) {
      const hc = hi.get(c), w = hc.width + PAD * 2, h = hc.height + PAD * 2;
      if (x + w > AW) { x = 0; y += rowH; rowH = 0; }
      rects.set(c, [x + PAD, y + PAD, hc.width, hc.height]);
      x += w; rowH = Math.max(rowH, h);
    }
    const AH = 1 << Math.ceil(Math.log2(Math.max(4, y + rowH)));
    const at = newCanvas(AW, AH), g = at.getContext('2d');
    g.imageSmoothingEnabled = false;
    for (const [c0, [rx, ry, cw, ch]] of rects) { const c = hi.get(c0); g.drawImage(c, rx - PAD, ry - PAD, cw + PAD * 2, ch + PAD * 2); g.drawImage(c, rx, ry); }
    const img = g.getImageData(0, 0, AW, AH);
    const upload = (fmt, data) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt, AW, AH, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.generateMipmap(gl.TEXTURE_2D);
      tex2D(t, gl.LINEAR_MIPMAP_LINEAR, gl.CLAMP_TO_EDGE);
      return t;
    };
    texAtlas = upload(gl.SRGB8_ALPHA8, new Uint8Array(img.data.buffer));
    texAtlasN = upload(gl.RGBA8, heightNormals(new Uint32Array(img.data.buffer), null, AW, AH, 2.8, 0.3, 0.3));
    const uvr = (c) => { const [rx, ry, cw, ch] = rects.get(c); return [(rx + 0.5) / AW, (ry + 0.5) / AH, (rx + cw - 0.5) / AW, (ry + ch - 0.5) / AH]; };

    const V = [];
    const vert = (p, uv, n, t, b, m) => V.push(p[0], p[1], p[2], uv[0], uv[1], n[0], n[1], n[2], t[0], t[1], t[2], b[0], b[1], b[2], m[0], m[1]);
    const nrm = (v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); };
    // quad from origin o, along u to ue and along v to ve
    const face = (tex, o, ue, ve, n, m) => {
      if (!tex) return;
      const [u0, v0, u1, v1] = uvr(tex), p2 = [ue[0] + ve[0] - o[0], ue[1] + ve[1] - o[1], ue[2] + ve[2] - o[2]];
      const T = nrm([ue[0] - o[0], ue[1] - o[1], ue[2] - o[2]]), B = nrm([ve[0] - o[0], ve[1] - o[1], ve[2] - o[2]]);
      const q = [[o, [u0, v0]], [ue, [u1, v0]], [p2, [u1, v1]], [ve, [u0, v1]]];
      for (const k of [0, 1, 2, 0, 2, 3]) vert(q[k][0], q[k][1], n, T, B, m);
    };
    for (const k of Object.keys(D)) {
      const first = V.length / PSTRIDE, m = PROP_MAT[k] || [0.3, 0.3];
      for (const b of D[k].boxes || []) {
        const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y - b.d / 2, y1 = b.y + b.d / 2, z0 = b.z, z1 = b.z + b.h, F = b.faces;
        face(F.front || F.side, [x1, y0, z1], [x0, y0, z1], [x1, y0, z0], [0, -1, 0], m);
        face(F.back || F.side, [x0, y1, z1], [x1, y1, z1], [x0, y1, z0], [0, 1, 0], m);
        face(F.left || F.side, [x0, y0, z1], [x0, y1, z1], [x0, y0, z0], [-1, 0, 0], m);
        face(F.right || F.side, [x1, y1, z1], [x1, y0, z1], [x1, y1, z0], [1, 0, 0], m);
        face(F.top, [x0, y1, z1], [x1, y1, z1], [x0, y0, z1], [0, 0, 1], m);
      }
      for (const c of D[k].cyls || []) {
        const n = 18, [u0, v0, u1, v1] = uvr(c.tex), cm = [c.gloss, 0.6];
        const ring = (i, z) => [c.x + Math.cos(i / n * Math.PI * 2) * c.r, c.y + Math.sin(i / n * Math.PI * 2) * c.r, z];
        for (let i = 0; i < n; i++) {
          const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
          const ua = u1 - (u1 - u0) * i / n, ub = u1 - (u1 - u0) * (i + 1) / n;
          const n0 = [Math.cos(a0), Math.sin(a0), 0], n1 = [Math.cos(a1), Math.sin(a1), 0];
          const t0 = [Math.sin(a0), -Math.cos(a0), 0], t1 = [Math.sin(a1), -Math.cos(a1), 0], B = [0, 0, -1];
          const q = [[ring(i, c.z + c.h), [ua, v0], n0, t0], [ring(i + 1, c.z + c.h), [ub, v0], n1, t1], [ring(i + 1, c.z), [ub, v1], n1, t1], [ring(i, c.z), [ua, v1], n0, t0]];
          for (const k2 of [0, 1, 2, 0, 2, 3]) vert(q[k2][0], q[k2][1], q[k2][2], q[k2][3], B, cm);
          const tc = uvr(c.top), mid = [(tc[0] + tc[2]) / 2, (tc[1] + tc[3]) / 2];
          vert([c.x, c.y, c.z + c.h], mid, [0, 0, 1], [1, 0, 0], [0, 1, 0], cm);
          vert(ring(i, c.z + c.h), mid, [0, 0, 1], [1, 0, 0], [0, 1, 0], cm);
          vert(ring(i + 1, c.z + c.h), mid, [0, 0, 1], [1, 0, 0], [0, 1, 0], cm);
        }
      }
      propMeshes[k] = { first, count: V.length / PSTRIDE - first };
    }
    propVAO = gl.createVertexArray();
    gl.bindVertexArray(propVAO);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(V), gl.STATIC_DRAW);
    [[0, 3, 0], [1, 2, 3], [2, 3, 5], [3, 3, 8], [4, 3, 11], [5, 2, 14]].forEach(([loc, n, off]) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, PSTRIDE * 4, off * 4);
    });
    propInst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, propInst);
    gl.bufferData(gl.ARRAY_BUFFER, propData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribDivisor(6, 1);
    gl.bindVertexArray(null);
    progProp = compile(PROP_VS, PROP_FS);
  }

  // The frame's props, grouped by type: [type, first instance, count].
  const propGroups = [];
  function gatherProps(L) {
    propGroups.length = 0;
    let n = 0;
    for (const k of Object.keys(propMeshes)) {
      const first = n;
      const put = (o, armed) => { if (n < PROP_MAX) { propData.set([o.x, o.y, o.face || 0, armed ? 1 : 0], n * 4); n++; } };
      if (k === 'B') { for (const b of L.barrels) if (!b.dead) put(b, b.fuse >= 0); }
      else for (const d of L.decor) if (d.type === k) put(d, false);
      if (n > first) propGroups.push([k, first, n - first]);
    }
    if (n) { gl.bindBuffer(gl.ARRAY_BUFFER, propInst); gl.bufferSubData(gl.ARRAY_BUFFER, 0, propData.subarray(0, n * 4)); }
  }

  function drawProps(L, mirror) {
    if (!propGroups.length) return;
    gl.useProgram(progProp.p);
    setCommon(progProp, L, mirror);
    gl.uniform1f(progProp.u.uTime, performance.now() / 1000 % 1000);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texAtlas); gl.uniform1i(progProp.u.uAtlas, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texAtlasN); gl.uniform1i(progProp.u.uAtlasN, 1);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, texDetail); gl.uniform1i(progProp.u.uDetail, 6);
    gl.bindVertexArray(propVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, propInst);
    for (const [k, first, count] of propGroups) {
      gl.vertexAttribPointer(6, 4, gl.FLOAT, false, 16, first * 16);
      gl.drawArraysInstanced(gl.TRIANGLES, propMeshes[k].first, propMeshes[k].count, count);
    }
  }

  // Contact shadows: soft dark ellipses multiplied onto the floor under everything that stands on it.
  const SHADOW_VS = `#version 300 es
  layout(location=0) in vec2 aQuad;
  layout(location=1) in vec4 iSh;     // x, y, radius, strength
  uniform mat4 uVP;
  uniform vec2 uJitter;
  out vec2 vQ; flat out float vK;
  void main() {
    vQ = aQuad; vK = iSh.w;
    gl_Position = uVP * vec4(iSh.xy + aQuad * iSh.z, 0.003, 1.0);
    gl_Position.xy += uJitter * gl_Position.w;
  }`;
  const SHADOW_FS = `#version 300 es
  precision highp float;
  in vec2 vQ; flat in float vK;
  out vec4 oColor;
  void main() {
    float a = vK * (1.0 - smoothstep(0.1, 1.0, dot(vQ, vQ)));
    oColor = vec4(vec3(1.0 - a), 1.0);
  }`;
  const SH_MAX = 512, shData = new Float32Array(SH_MAX * 4);
  const PROP_SHADOW = { x: [0.62, 0.55], B: [0.42, 0.5], f: [0.26, 0.45], e: [0.1, 0.4] };
  let progShadow, shadowVAO, shadowInst, shN = 0;
  function gatherShadows(L) {
    shN = 0;
    const push = (x, y, r, k) => { if (shN < SH_MAX) { shData.set([x, y, r, k], shN * 4); shN++; } };
    for (const e of L.enemies) {
      if (!alive(e)) continue;
      const T = ETYPES[e.type], sc = T.scale * (e.shrunk > 0 ? 0.3 : 1);
      push(e.x, e.y, Math.max(0.12, sc * 0.33), T.z > 0.2 ? 0.3 : 0.55);
    }
    for (const it of L.items) if (!it.taken) push(it.x, it.y, 0.17, 0.4);
    for (const d of L.decor) { const s = PROP_SHADOW[d.type]; if (s) push(d.x, d.y, s[0], s[1]); }
    for (const b of L.barrels) if (!b.dead) push(b.x, b.y, PROP_SHADOW.B[0], PROP_SHADOW.B[1]);
    if (shN) { gl.bindBuffer(gl.ARRAY_BUFFER, shadowInst); gl.bufferSubData(gl.ARRAY_BUFFER, 0, shData.subarray(0, shN * 4)); }
  }
  function drawShadows() {
    if (!shN) return;
    gl.useProgram(progShadow.p);
    gl.uniformMatrix4fv(progShadow.u.uVP, false, VP);
    gl.uniform2f(progShadow.u.uJitter, frameJitter[0], frameJitter[1]);
    gl.depthMask(false);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
    gl.bindVertexArray(shadowVAO);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, shN);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  // Particles: simulated on the CPU (gravity, drag, bounces on the floor and walls),
  // drawn as instanced quads. Kinds: 0 glow, 1 streak (both additive), 2 smoke, 3 chunk.
  const PART_VS = `#version 300 es
  layout(location=0) in vec2 aQuad;
  layout(location=1) in vec4 iA;      // position, size
  layout(location=2) in vec4 iC;      // color, alpha
  layout(location=3) in vec4 iV;      // velocity, kind
  uniform mat4 uVP;
  uniform vec2 uJitter;
  uniform float uMirror;
  uniform vec3 uEye, uR3, uU3;
  out vec2 vQ; out vec4 vC; flat out float vKind;
  void main() {
    vec3 p = iA.xyz, w;
    float s = iA.w;
    if (abs(iV.w - 1.0) < 0.5) {
      // streak stretched along its velocity
      float sp = length(iV.xyz);
      vec3 dir = sp > 1e-3 ? iV.xyz / sp : uU3;
      vec3 side = cross(dir, normalize(uEye - p));
      float sl = length(side);
      side = sl > 1e-3 ? side / sl : uR3;
      w = p + dir * aQuad.y * (s + sp * 0.03) + side * aQuad.x * s * 0.3;
    } else w = p + uR3 * aQuad.x * s + uU3 * aQuad.y * s;
    vQ = aQuad; vC = iC; vKind = iV.w;
    gl_Position = uVP * vec4(w.xy, w.z * uMirror, 1.0);
    gl_Position.xy += uJitter * gl_Position.w;
  }`;
  const PART_FS = `#version 300 es
  precision highp float;
  in vec2 vQ; in vec4 vC; flat in float vKind;
  uniform float uRaw, uExposure;
  out vec4 oColor;
  void main() {
    float r2 = dot(vQ, vQ);
    vec4 c;
    if (vKind < 1.5) {
      if (r2 > 1.0) discard;
      c = vec4(vC.rgb * vC.a * exp(-r2 * 3.5) * (1.0 - r2), 1.0);
    } else if (vKind < 2.5) {
      if (r2 > 1.0) discard;
      float a = 1.0 - r2;
      c = vec4(vC.rgb, vC.a * a * a);
    } else c = vC;
    if (uRaw < 0.5) c.rgb = pow(1.0 - exp(-c.rgb * uExposure), vec3(1.0 / 2.2));
    oColor = c;
  }`;
  const P_MAX = 2400, P_F = 12;
  const parts = [], partAdd = new Float32Array(P_MAX * P_F), partAlpha = new Float32Array(P_MAX * P_F);
  let progPart, partVAO, partInst, nAdd = 0, nAlpha = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const hexLin = (h) => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255) ** 2.2);

  // n particles from (x, y, z): o = {kind, col, alpha, speed: [a, b], up, life: [a, b], size, grow, grav, drag, bounce, lit}
  function burst(x, y, z, n, o) {
    for (let i = 0; i < n && parts.length < P_MAX; i++) {
      const th = Math.random() * Math.PI * 2, cz = rnd(-0.6, 1), sz = Math.sqrt(1 - cz * cz), sp = rnd(o.speed[0], o.speed[1]);
      const life = rnd(o.life[0], o.life[1]);
      parts.push({
        x, y, z, vx: Math.cos(th) * sz * sp, vy: Math.sin(th) * sz * sp, vz: cz * sp + (o.up || 0),
        life, max: life, size: o.size * rnd(0.7, 1.3), grow: o.grow || 0, col: o.col, a: o.alpha || 1,
        kind: o.kind, grav: o.grav || 0, drag: o.drag || 0, bounce: o.bounce || 0.3, lit: !!o.lit,
      });
    }
  }
  const FX_PARTS = {
    spark: (x, y, z, s) => {
      burst(x, y, z, 10, { kind: 1, col: [4, 2.4, 0.9], speed: [2, 5], life: [0.2, 0.45], size: 0.02, grav: 8, bounce: 0.3 });
      burst(x, y, z, 1, { kind: 0, col: [2.5, 1.4, 0.6], speed: [0, 0], life: [0.1, 0.1], size: 0.15 * s });
    },
    plasmaHit: (x, y, z, s) => {
      burst(x, y, z, 14, { kind: 1, col: [1.2, 2.6, 4.5], speed: [2, 5], life: [0.2, 0.5], size: 0.02, grav: 4, bounce: 0.3 });
      burst(x, y, z, 1, { kind: 0, col: [0.8, 1.8, 3.6], speed: [0, 0], life: [0.14, 0.14], size: 0.3 * s });
    },
    boom: (x, y, z, s) => {
      burst(x, y, z, Math.round(28 * s), { kind: 1, col: [4.5, 2.2, 0.6], speed: [2, 6], life: [0.25, 0.6], size: 0.025, grav: 7, bounce: 0.3 });
      burst(x, y, z, Math.round(10 * s), { kind: 0, col: [3, 1.2, 0.3], speed: [0.5, 2], up: 0.6, life: [0.6, 1.2], size: 0.03, grav: 1.5, drag: 1.5 });
      burst(x, y, z, Math.round(7 * s), { kind: 2, col: [0.05, 0.045, 0.04], alpha: 0.55, speed: [0.2, 0.8], up: 0.35, life: [1, 1.7], size: 0.18 * s, grow: 0.35, drag: 2, lit: true });
      burst(x, y, z, 1, { kind: 0, col: [2.5, 1.2, 0.4], speed: [0, 0], life: [0.2, 0.2], size: Math.min(0.45, 0.4 * s) });
    },
    bigBoom: (x, y, z, s) => {
      burst(x, y, z, 70, { kind: 1, col: [5, 2.4, 0.6], speed: [3, 8], life: [0.3, 0.8], size: 0.03, grav: 7, bounce: 0.35 });
      burst(x, y, z, 30, { kind: 0, col: [3.5, 1.3, 0.3], speed: [0.5, 3], up: 0.8, life: [0.8, 1.6], size: 0.035, grav: 1.5, drag: 1.2 });
      burst(x, y, z, 16, { kind: 2, col: [0.04, 0.035, 0.03], alpha: 0.6, speed: [0.3, 1.4], up: 0.4, life: [1.4, 2.4], size: 0.3, grow: 0.45, drag: 1.8, lit: true });
      burst(x, y, z, 12, { kind: 3, col: [0.06, 0.06, 0.07], speed: [2, 4.5], up: 2, life: [2, 3], size: 0.04, grav: 9.8, bounce: 0.35, lit: true });
      burst(x, y, z, 1, { kind: 0, col: [3, 1.4, 0.45], speed: [0, 0], life: [0.28, 0.28], size: 0.5 });
    },
    nutanix: (x, y, z, s) => {
      burst(x, y, z, 40, { kind: 0, col: [1.5, 0.9, 4.5], speed: [0.3, 1.6], up: 0.9, life: [0.6, 1.2], size: 0.03, drag: 2 });
      burst(x, y, z, 1, { kind: 0, col: [1, 0.6, 2.5], speed: [0, 0], life: [0.3, 0.3], size: 0.45 });
    },
    smoke: (x, y, z) => burst(x, y, z, 1, { kind: 2, col: [0.06, 0.06, 0.06], alpha: 0.4, speed: [0, 0.2], up: 0.2, life: [0.6, 1], size: 0.08, grow: 0.25, drag: 2, lit: true }),
  };
  const FX_SCALE = { boom: 0.8, nutanix: 0.9 };
  function fx(kind, x, y, z, scale) {
    const f = FX_PARTS[kind];
    if (f) f(x, y, z, (scale || FX_SCALE[kind] || 0.35) / (FX_SCALE[kind] || 0.35));
  }
  // Debris of a killed monster, in its colors.
  function kill(e) {
    const S = Assets.enemies[e.type], T = ETYPES[e.type], cols = (S && S.debris) || ['#555555'];
    for (let i = 0; i < 14; i++) {
      burst(e.x, e.y, 0.2 + T.z + T.scale * 0.3, 1, { kind: 3, col: hexLin(cols[i % cols.length]), speed: [1.2, 3.2], up: 1.6, life: [2, 3], size: 0.03 * T.scale + 0.015, grav: 9.8, bounce: 0.35, lit: true });
    }
  }
  // Casings and muzzle smoke when the player fires.
  function shot(cur, P) {
    const ca = Math.cos(P.a), sa = Math.sin(P.a), rx = -sa, ry = ca;
    const mx = P.x + ca * 0.4 + rx * 0.08, my = P.y + sa * 0.4 + ry * 0.08;
    const casing = (col, size) => parts.length < P_MAX && parts.push({
      x: P.x + ca * 0.5 + rx * 0.2, y: P.y + sa * 0.5 + ry * 0.2, z: 0.3,
      vx: rx * rnd(1.2, 2.2) + ca * rnd(-0.2, 0.4), vy: ry * rnd(1.2, 2.2) + sa * rnd(-0.2, 0.4), vz: rnd(1, 2),
      life: 3, max: 3, size, grow: 0, col, a: 1, kind: 3, grav: 9.8, drag: 0.3, bounce: 0.45, lit: true,
    });
    if (cur === 2) {
      casing([0.55, 0.04, 0.03], 0.014);
      burst(mx, my, 0.4, 4, { kind: 2, col: [0.08, 0.08, 0.08], alpha: 0.35, speed: [0.1, 0.4], up: 0.15, life: [0.5, 0.9], size: 0.06, grow: 0.3, drag: 3, lit: true });
    } else if (cur === 3) {
      if (Math.random() < 0.6) casing([0.75, 0.5, 0.12], 0.009);
    } else if (cur === 4) {
      burst(mx, my, 0.35, 6, { kind: 2, col: [0.08, 0.08, 0.08], alpha: 0.4, speed: [0.1, 0.5], up: 0.1, life: [0.6, 1.1], size: 0.08, grow: 0.35, drag: 3, lit: true });
    }
  }

  const solidCell = (L, x, y) => {
    const cx = x | 0, cy = y | 0;
    if (x < 0 || y < 0 || cx >= L.w || cy >= L.h) return true;
    const i = cy * L.w + cx, d = L.doors[i];
    return L.map[i] !== 0 && !(d && d.open > 0.9);
  };
  function stepParticles(L, dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      if (!dt) continue;
      p.vz -= p.grav * dt;
      const dr = Math.max(0, 1 - p.drag * dt);
      p.vx *= dr; p.vy *= dr; p.vz *= dr;
      const nx = p.x + p.vx * dt;
      if (solidCell(L, nx, p.y)) p.vx *= -0.4; else p.x = nx;
      const ny = p.y + p.vy * dt;
      if (solidCell(L, p.x, ny)) p.vy *= -0.4; else p.y = ny;
      p.z += p.vz * dt;
      const rad = p.kind === 3 ? p.size * 0.5 : 0.005;
      if (p.z < rad) {
        p.z = rad;
        if (p.vz < 0) p.vz = -p.vz * p.bounce;
        p.vx *= 0.7; p.vy *= 0.7;
        if (p.vz < 0.25) p.vz = 0;
      }
      if (p.z > 0.98) { p.z = 0.98; p.vz = -Math.abs(p.vz) * 0.3; }
      p.size += p.grow * dt;
    }
  }
  function gatherParticles() {
    nAdd = 0; nAlpha = 0;
    for (const p of parts) {
      const f = p.life / p.max;
      let r = p.col[0], g = p.col[1], b = p.col[2], a = p.a;
      if (p.lit) {
        const v = Light.sample(p.x, p.y), k = 0.7 / 128;
        r *= (v & 255) * k + 0.05; g *= ((v >> 8) & 255) * k + 0.05; b *= ((v >> 16) & 255) * k + 0.05;
      }
      let arr, o;
      if (p.kind < 2) { arr = partAdd; o = nAdd++ * P_F; a *= p.kind === 1 ? Math.min(1, f * 2) : f; }
      else {
        arr = partAlpha; o = nAlpha++ * P_F;
        a *= p.kind === 2 ? Math.min(1, (1 - f) * 6) * f : Math.min(1, p.life * 2);
      }
      arr[o] = p.x; arr[o + 1] = p.y; arr[o + 2] = p.z; arr[o + 3] = p.size;
      arr[o + 4] = r; arr[o + 5] = g; arr[o + 6] = b; arr[o + 7] = a;
      arr[o + 8] = p.vx; arr[o + 9] = p.vy; arr[o + 10] = p.vz; arr[o + 11] = p.kind;
    }
  }
  function drawParticles(additiveOnly, mirror) {
    const groups = additiveOnly ? [[partAdd, nAdd, true]] : [[partAlpha, nAlpha, false], [partAdd, nAdd, true]];
    if (!nAdd && (additiveOnly || !nAlpha)) return;
    gl.useProgram(progPart.p);
    const u = progPart.u;
    gl.uniformMatrix4fv(u.uVP, false, VP);
    gl.uniform2f(u.uJitter, mirror ? 0 : frameJitter[0], mirror ? 0 : frameJitter[1]);
    gl.uniform1f(u.uMirror, mirror ? -1 : 1);
    gl.uniform3fv(u.uEye, cam.e); gl.uniform3fv(u.uR3, cam.r); gl.uniform3fv(u.uU3, cam.u);
    gl.uniform1f(u.uRaw, mirror || hdr ? 1 : 0);
    gl.uniform1f(u.uExposure, exposure);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.bindVertexArray(partVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, partInst);
    for (const [arr, n, add] of groups) {
      if (!n) continue;
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr.subarray(0, n * P_F));
      if (add) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, n);
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  function initObjects() {
    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    const vao = (inst, attrs, stride) => {
      const v = gl.createVertexArray();
      gl.bindVertexArray(v);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      for (const [loc, off] of attrs) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, stride * 4, off * 4);
        gl.vertexAttribDivisor(loc, 1);
      }
      gl.bindVertexArray(null);
      return v;
    };
    shadowInst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, shadowInst);
    gl.bufferData(gl.ARRAY_BUFFER, shData.byteLength, gl.DYNAMIC_DRAW);
    shadowVAO = vao(shadowInst, [[1, 0]], 4);
    partInst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, partInst);
    gl.bufferData(gl.ARRAY_BUFFER, partAdd.byteLength, gl.DYNAMIC_DRAW);
    partVAO = vao(partInst, [[1, 0], [2, 4], [3, 8]], P_F);
    progShadow = compile(SHADOW_VS, SHADOW_FS);
    progPart = compile(PART_VS, PART_FS);
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
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, texDetail); gl.uniform1i(u.uDetail, 6);
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texHgt); gl.uniform1i(u.uHgt, 7);
    gl.uniform1f(u.uPom, !mirror && Light.high ? 1 : 0);
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
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texSprNrm); gl.uniform1i(progSprite.u.uNrmS, 1);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(spriteVAO);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, sprN);
    gl.disable(gl.BLEND);
  }

  // Weapon meshes: one buffer for every pose; vmMap: 2D art of a pose -> its vertex range.
  const VM_K = 0.4;
  let progVM = null, vmVAO = null, vmAtlas = null, vmMap = new Map();
  function setWeapons(art2D, meshes) {
    if (!ok || !meshes) return;
    const ranges = [], parts = [];
    let n = 0;
    const walk = (a, m) => {
      if (Array.isArray(a)) { a.forEach((x, i) => walk(x, m[i])); return; }
      const count = m.data.length / meshes.stride;
      ranges.push([a, { first: n, count, view: m.view }]);
      parts.push(m.data); n += count;
    };
    for (const k of Object.keys(art2D)) if (meshes[k]) walk(art2D[k], meshes[k]);
    const all = new Float32Array(n * meshes.stride);
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    vmVAO = gl.createVertexArray();
    gl.bindVertexArray(vmVAO);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, all, gl.STATIC_DRAW);
    const st = meshes.stride * 4;
    [[0, 3, 0], [1, 3, 3], [2, 3, 6], [3, 2, 9], [5, 2, 11], [4, 3, 13]].forEach(([loc, size, off]) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, off * 4);
    });
    gl.bindVertexArray(null);
    vmAtlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, vmAtlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, meshes.atlas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    vmMap = new Map(ranges);
  }

  /* -------------------------------------------------------- monsters */
  let progMon = null, monVAO = null, monAtlas = null, monModels = null;
  function setMonsters(meshes) {
    monVAO = gl.createVertexArray();
    gl.bindVertexArray(monVAO);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, meshes.data, gl.STATIC_DRAW);
    const st = meshes.stride * 4;
    [[0, 3, 0], [1, 3, 3], [2, 3, 6], [3, 2, 9], [4, 3, 11]].forEach(([loc, size, off]) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, off * 4);
    });
    gl.bindVertexArray(null);
    monAtlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, monAtlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, meshes.atlas);
    gl.generateMipmap(gl.TEXTURE_2D);
    tex2D(monAtlas, gl.LINEAR_MIPMAP_LINEAR, gl.CLAMP_TO_EDGE);
    monModels = meshes.models;
  }

  // 4x4 column-major helpers
  const M4 = {
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    trs(tx, ty, tz) { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1]); },
    scale(x, y, z) { return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]); },
    rot(axis, a) {
      const c = Math.cos(a), s = Math.sin(a);
      if (axis === 'z') return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      if (axis === 'y') return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
      return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
    },
  };

  // Local transform of a part this frame: walk cycle, attack, idle motion.
  function partMatrix(p, e, T, t) {
    const moving = e.state === 'chase' && !(e.painT > 0) ? 1 : 0;
    const ph = e.animT * (e.type === 'bug' ? 14 : e.type === 'troll' ? 6 : 8) * (e.shrunk > 0 ? 1.6 : 1);
    let atk = 0;
    if (e.state === 'attack') atk = T.melee ? Math.sin(Math.max(0, Math.min(1, 1 - e.timer / 0.45)) * Math.PI) : 1;
    let axis = 'y', a = 0, dz = 0, sz = 1, sxy = 1;
    switch (p.anim) {
      case 'legA': case 'legB': {
        const s = Math.sin(ph + (p.anim === 'legB' ? Math.PI : 0)) * moving;
        if (e.type === 'bug') { axis = 'z'; a = s * 0.35; } else a = s * 0.5;
        break;
      }
      case 'armL': a = -Math.sin(ph) * 0.35 * moving - atk * (T.melee ? 1.6 : 0.6); break;
      case 'gun': a = Math.sin(ph) * 0.35 * moving * (1 - atk) - atk * (T.melee ? 1.6 : 1.35); break;
      case 'club': a = Math.sin(ph) * 0.3 * moving - atk * 2.0; break;
      case 'head': a = Math.sin(t * 1.7 + e.x) * 0.06 - atk * 0.12; break;
      case 'jaw': axis = 'z'; a = atk * 0.5 * (Math.sin(t * 30) * 0.5 + 0.5); break;
      case 'body': dz = Math.abs(Math.sin(ph)) * 1.2 * moving; a = atk * (T.melee ? 0.18 : -0.08); break;
      case 'spin': axis = 'z'; a = t * 0.9 + e.x; break;
      case 'orbit': axis = 'z'; a = t * 2.4 + e.x; break;
      case 'scarf': axis = 'z'; a = Math.sin(t * 7 + e.x) * 0.35; break;
      case 'mouth': sz = 1 + atk * 1.8; break;
      case 'flame': sz = 1 + 0.08 * Math.sin(t * 9 + p.k * 1.7) + atk * 0.15; sxy = 1 + 0.05 * Math.sin(t * 7 + p.k); break;
      case 'bolt': sz = Math.sin(t * 23 + e.x) > -0.4 || atk ? 1 : 0.001; break;
      default: break;
    }
    if (!a && !dz && sz === 1 && sxy === 1) return null;
    const [px, py, pz] = p.pivot;
    let m = M4.trs(px, py, pz + dz);
    if (a) m = M4.mul(m, M4.rot(axis, a));
    if (sz !== 1 || sxy !== 1) m = M4.mul(m, M4.scale(sxy, sxy, sz));
    return M4.mul(m, M4.trs(-px, -py, -pz));
  }

  function drawMonsters(L, mirror) {
    if (!monModels) return;
    gl.useProgram(progMon.p);
    setCommon(progMon, L, mirror);
    const u = progMon.u, t = performance.now() / 1000;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, monAtlas); gl.uniform1i(u.uAtlas, 0);
    gl.bindVertexArray(monVAO);
    for (const e of L.enemies) {
      if (!alive(e)) continue;
      const mdl = monModels[e.type], T = ETYPES[e.type];
      if (!mdl) continue;
      const dx = e.x - cam.e[0], dy = e.y - cam.e[1];
      if (dx * cam.f[0] + dy * cam.f[1] < -1.5) continue;       // behind the camera
      // bosses are taller than the ceiling as sprites: as models they stand under it, wider instead
      const hmax = 0.96 - T.z;
      let k = Math.min(T.scale, hmax) / 64, kxy = k * Math.sqrt(Math.max(1, T.scale / hmax)), z = T.z;
      if (e.type === 'drone') z += Math.sin(e.animT * 3 + e.x) * 0.05;
      if (e.shrunk > 0) { const f = e.shrunk < 1 ? 0.3 + 0.7 * (1 - e.shrunk) : 0.3; k *= f; kxy *= f; z = 0; }
      let base = M4.mul(M4.trs(e.x, e.y, z), M4.rot('z', e.face || 0));
      if (e.painT > 0) base = M4.mul(base, M4.rot('y', 0.22));   // flinches back
      base = M4.mul(base, M4.scale(kxy, kxy, k));
      gl.uniform1f(u.uFlash, e.flash > 0 ? 1 : 0);
      for (const p of mdl.parts) {
        const lm = partMatrix(p, e, T, t);
        gl.uniformMatrix4fv(u.uModel, false, lm ? M4.mul(base, lm) : base);
        gl.drawArrays(gl.TRIANGLES, p.first, p.count);
      }
    }
  }

  // w: {art (the 2D art of the pose), x, y (offset), rot, px, py (pivot)}, in logical px.
  function drawWeapon(L, w) {
    const m = w && vmMap.get(w.art);
    if (!m) return;
    gl.useProgram(progVM.p);
    setCommon(progVM, L, false);
    const u = progVM.u;
    gl.uniform4f(u.uProj, m.view.f, 240 + m.view.ox, 115 + m.view.oy, 0);
    gl.uniform4f(u.uMove, w.x, w.y, w.rot, 0);
    gl.uniform2f(u.uPivot, w.px, w.py);
    gl.uniform2f(u.uAB, (FAR + NEAR) / (FAR - NEAR), -2 * FAR * NEAR / (FAR - NEAR));
    gl.uniform3f(u.uRw, cam.r[0], cam.r[1], cam.r[2]);
    gl.uniform3f(u.uDw, -cam.u[0], -cam.u[1], -cam.u[2]);
    gl.uniform3f(u.uFw, cam.f[0], cam.f[1], cam.f[2]);
    gl.uniform1f(u.uK, VM_K);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, vmAtlas); gl.uniform1i(u.uAtlas, 0);
    // always in front of the world; its triangles come sorted back to front
    gl.depthFunc(gl.ALWAYS);
    gl.bindVertexArray(vmVAO);
    gl.drawArrays(gl.TRIANGLES, m.first, m.count);
    gl.depthFunc(gl.LEQUAL);
  }

  let reflOn = false;
  // f: {L, P, inv, anim, collect(add), shakeX, shakeY (fractions of the view), weapon (see drawWeapon)}
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
    warmUp(L, f.warmBudget || 4);
    gatherLights(L, P, f.inv);
    gatherProps(L);
    gatherShadows(L);
    stepParticles(L, f.dt || 0);
    gatherParticles();
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
      drawProps(L, true);
      drawMonsters(L, true);
      drawSprites(L, true);
      drawParticles(true, true);
      gl.bindTexture(gl.TEXTURE_2D, reflTex);
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, hdr ? msFBO : null);
    gl.viewport(0, 0, bw, bh);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawWorld(L, f.anim, false);
    drawProps(L, false);
    drawMonsters(L, false);
    drawShadows();
    drawSprites(L, false);
    drawParticles(false, false);
    drawWeapon(L, f.weapon);
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
    if (P.z > 40.0 || P.z < 0.42) { oColor = vec4(1.0); return; }   // sky, or the weapon in hand
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
      progVM = compile(VM_VS, VM_FS);
      progMon = compile(MON_VS, MON_FS);
      initPost();
      buildWallArray();
      texSprites = newArray(SPR_CAP, gl.SRGB8_ALPHA8);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      texSprNrm = newArray(SPR_CAP, gl.RGBA8, NTS);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      buildProps();
      initObjects();
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
    // particle events from the game (only while the GPU renderer is in use)
    fx(kind, x, y, z, scale) { if (ok) fx(kind, x, y, z, scale); },
    kill(e) { if (ok) kill(e); },
    shot(cur, P) { if (ok) shot(cur, P); },
    // a wall tile changed (rack migrated to Nutanix): the static geometry is rebuilt
    retile(L) { if (ok && L === curL) buildWorld(L); },
    // finishes the background work at once (automated tests)
    flushWarm() { if (curL) warmUp(curL, 1e9); },
    // the weapon meshes (weapons.js build3D), keyed by the 2D art of each pose
    setWeapons(art2D, meshes) { if (ok && !vmMap.size) setWeapons(art2D, meshes); },
    get hasWeapons() { return ok && vmMap.size > 0; },
    // the monster models (monsters3d.js build)
    setMonsters(meshes) { if (ok && !monModels && meshes) setMonsters(meshes); },
    get hasMonsters() { return ok && !!monModels; },
    get ok() { return ok; },
    get hdr() { return hdr; },
    get canvas() { return cv; },
    onLost: null,
  };
})();
