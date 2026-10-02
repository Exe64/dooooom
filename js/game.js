'use strict';
/*
 * DUKE NUTANIX: raycasting engine, Duke Nukem spirit, set in datacenters.
 * Software rendering of the 3D view at a quality-dependent resolution (480x230 to 960x460),
 * smoothly upscaled, with the HUD and the weapons drawn at full screen resolution.
 */

const W = 480, H = 270, HUD_H = 40, VH = H - HUD_H, HORIZ = VH / 2;
const PLANE = 0.8, PROJ = (W / 2) / PLANE;
const FONT = '"Press Start 2P", monospace';
const WALL_CHARS = '#RSNCWXD12?34567';
const SPECIAL_NAMES = { '3': 'Broadcom ESXi', '4': 'Proxmox', '5': 'Vates XCP-ng', '6': 'Hyper-V' };

/* ------------------------------------------------------------ definitions */

const WEAPONS = [
  { name: 'MECH KEYBOARD', ammo: null, rate: 0.5, anim: 0.45, dmg: [20, 34], melee: true, range: 1.5 },
  { name: 'CAGE NUT PISTOL', ammo: 'nuts', rate: 0.3, anim: 0.25, dmg: [12, 18], proj: 'nut', speed: 19, spread: 0.01, sfx: 'nutgun' },
  { name: 'PACKET SHOTGUN', ammo: 'shells', rate: 0.9, anim: 0.8, dmg: [7, 12], pellets: 8, spread: 0.085, sfx: 'shotgun' },
  { name: 'GATLING RIVETER', ammo: 'nuts', rate: 0.085, anim: 0.08, dmg: [9, 14], proj: 'nut', speed: 21, spread: 0.04, sfx: 'rivet' },
  { name: 'SFP BAZOOKA', ammo: 'sfp', rate: 0.85, anim: 0.5, dmg: [110, 110], proj: 'sfp', speed: 13, spread: 0, sfx: 'rocket' },
  { name: 'HARD DRIVES', ammo: 'hdd', rate: 0.75, anim: 0.5, dmg: [130, 130], proj: 'hdd', speed: 9, spread: 0, sfx: 'throw' },
  { name: 'ZIP COMPRESSOR', ammo: 'cells', use: 4, rate: 0.6, anim: 0.3, dmg: [0, 0], proj: 'zip', speed: 16, spread: 0, sfx: 'shrink' },
  { name: 'OVERCLOCK CANNON', ammo: 'cells', rate: 0.11, anim: 0.1, dmg: [18, 26], proj: 'plasma', speed: 15, spread: 0, sfx: 'plasma' },
];
const AMMO_MAX = { nuts: 250, shells: 50, sfp: 30, hdd: 20, cells: 300 };
const AMMO_LABELS = [['NUT', 'nuts'], ['FRM', 'shells'], ['SFP', 'sfp'], ['HDD', 'hdd'], ['NRG', 'cells']];
const WEAPON_SLOT = { F: 2, M: 3, K: 4, G: 5, Y: 6, L: 7 };

const BOSS_BASE = { speed: 1.0, radius: 0.7, scale: 1.9, z: 0, atkRange: 18, cd: 1.5, sight: 30, pain: 0.04, shotZ: 0.9, boss: true };
const ETYPES = {
  bug: { name: 'Bug', hp: 35, speed: 2.2, radius: 0.3, scale: 0.7, z: 0, melee: true, dmg: [5, 11], atkRange: 1.0, cd: 0.9, sight: 16, pain: 0.7 },
  drone: { name: 'Viral drone', hp: 50, speed: 1.6, radius: 0.3, scale: 0.6, z: 0.35, dmg: [8, 14], atkRange: 11, cd: 1.9, sight: 18, pain: 0.5, shotZ: 0.62, shot: 'orb' },
  bot: { name: 'BSOD bot', hp: 85, speed: 1.2, radius: 0.32, scale: 1.0, z: 0, dmg: [5, 9], atkRange: 13, cd: 2.4, sight: 18, pain: 0.35, burst: 3, shotZ: 0.55, shot: 'bolt' },
  troll: { name: 'Forum troll', hp: 170, speed: 1.6, radius: 0.4, scale: 1.15, z: 0, melee: true, dmg: [14, 24], atkRange: 1.2, cd: 1.2, sight: 16, pain: 0.2 },
  spam: { name: 'Spammer', hp: 60, speed: 1.3, radius: 0.32, scale: 0.8, z: 0, dmg: [4, 7], atkRange: 10, cd: 2.2, sight: 16, pain: 0.5, shotZ: 0.45, shot: 'bolt', fan: 3 },
  botnet: { ...BOSS_BASE, name: 'BOTNET', tag: 'ZOMBIFICATION IN PROGRESS', hp: 900, dmg: [7, 12], shot: 'botnet', minion: 'bug' },
  miner: { ...BOSS_BASE, name: 'CRYPTOMINER', tag: 'MINING IN PROGRESS', hp: 1100, dmg: [8, 13], shot: 'miner', minion: 'drone' },
  rootkit: { ...BOSS_BASE, name: 'ROOTKIT', tag: 'PRIVILEGE ESCALATION', hp: 1300, dmg: [9, 14], shot: 'boss', minion: 'spam' },
  zeroday: { ...BOSS_BASE, name: 'ZERO-DAY', tag: 'EXPLOIT IN PROGRESS', hp: 1500, speed: 1.2, dmg: [9, 15], shot: 'zeroday', minion: 'bot' },
  ransomware: { ...BOSS_BASE, name: 'RANSOMWARE', tag: 'ENCRYPTION IN PROGRESS', hp: 2200, dmg: [10, 16], shot: 'boss', minion: 'bug' },
};
// Mini-bosses guard the exit of every x5 level (E1M5, E2M5...).
const MINI_BASE = { speed: 1.3, radius: 0.5, scale: 1.35, z: 0, atkRange: 14, cd: 1.6, sight: 22, pain: 0.1, shotZ: 0.7, boss: true, mini: true };
Object.assign(ETYPES, {
  spaghetti: { ...MINI_BASE, name: 'CABLE SPAGHETTI MONSTER', tag: 'UNDOCUMENTED PATCHING', hp: 450, dmg: [6, 10], shot: 'plug', fan: 3, shotSpeed: 9, shotScale: 0.3 },
  hotspot: { ...MINI_BASE, name: 'HOT SPOT', tag: 'THERMAL RUNAWAY', hp: 600, dmg: [8, 12], shot: 'fire', fan: 5, shotSpeed: 6, shotScale: 0.45 },
  storm: { ...MINI_BASE, name: 'PACKET STORM', tag: 'DDOS IN PROGRESS', hp: 700, z: 0.25, dmg: [4, 7], shot: 'packet', fan: 1, burst: 6, shotSpeed: 13, shotScale: 0.28, cd: 2.0 },
  bitrot: { ...MINI_BASE, name: 'BIT ROT', tag: 'SILENT DATA CORRUPTION', hp: 950, speed: 0.8, dmg: [10, 16], shot: 'rot', fan: 3, shotSpeed: 6.5, shotScale: 0.4, minion: 'bug' },
  shadowit: { ...MINI_BASE, name: 'SHADOW IT', tag: 'UNSANCTIONED SAAS', hp: 850, speed: 2.2, dmg: [7, 11], shot: 'card', fan: 3, shotSpeed: 12, shotScale: 0.3, teleport: true },
});
const ENEMY_CHARS = { b: 'bug', d: 'drone', o: 'bot', t: 'troll', m: 'spam' };
const ITEM_CHARS = '+HAascrukgjFMKGYL';
const DECOR_CHARS = 'xef';

/* ----------------------------------------------------------- one-liners */

const QUIPS = {
  start: ["The admin has entered the building. And he hasn't had his coffee.", 'Who touched prod again?',
    "I came here to reboot servers and kick ass. And I'm almost done rebooting.",
    'Nobody closes my ticket but me.', "Alright. Maintenance window's open... on your heads."],
  kill: ['Ctrl Alt Delete, baby!', 'Back to slash dev slash null.', 'Kernel panic? Not on my watch.', 'Bug fixed. In prod. As usual.',
    'Ticket closed.', 'Garbage collected!', 'Error 404: enemy not found.', "Now that's a hotfix.", "You weren't in the SLA.", 'Segfault, pal.'],
  weapon: ['Come to daddy.', 'Ooh, production-grade hardware.', 'Finally, a tool worthy of me.', "Somebody's getting encrypted... and it ain't me."],
  secret: ['A secret area! Nobody hides anything from the admin.', "Huh, a closet that wasn't on the cabling plan."],
  stomp: ['Squashed like an old Jira ticket.', 'Compressed, crushed, archived.', 'File size: zero bytes.'],
  nutanix: ['Another cluster migrated to Nutanix.', 'One keystroke, one migration.', 'Hyperconverged, baby!', 'And boom, one more in Prism.'],
  nutanixAll: ["One hundred percent Nutanix datacenter. Now that's infrastructure!"],
  hurt: ["I've had smoother migrations.", 'Ouch. Gonna need a ticket for that.', "I'm bleeding in RAID zero."],
  boss: ["I'm gonna uninstall you.", 'No ransom for you, big guy.', 'Finally, someone my size.'],
  bossKill: ['Keep your encryption.', 'There. Restore complete.', 'Uninstalled. No reboot required.'],
  fountain: ['Ahhh. Nothing beats AC water.', 'Keeps the ego hydrated.'],
  drink: ['Turbo engaged!', 'Twenty-four hours without sleep, no problem.'],
  barrel: ['Boom! UPS discharged.', 'Power outage... for you.'],
  exit: ['Reboot started. Next!', "The datacenter says thanks. You're welcome."],
};
let voiceOn = true;
let lastQuip = -99;
let adminVoice = null;
function pickVoice() {
  if (!window.speechSynthesis) return;
  const v = speechSynthesis.getVoices().filter((x) => x.lang && x.lang.toLowerCase().startsWith('en'));
  adminVoice = v.find((x) => /david|daniel|alex|fred|guy|male/i.test(x.name) && !/female/i.test(x.name)) || v[0] || null;
}
if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

function quip(kind, chance = 1, force = false) {
  if (!L || Math.random() > chance) return;
  if (!force && L.time - lastQuip < 4) return;
  const list = QUIPS[kind];
  const text = list[Math.floor(Math.random() * list.length)];
  lastQuip = L.time;
  L.subtitle = { text, t: 3.2 };
  if (voiceOn && window.speechSynthesis && window.SpeechSynthesisUtterance) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.pitch = 0.35; u.rate = 1.05; u.volume = 0.9;
      if (adminVoice) u.voice = adminVoice;
      speechSynthesis.speak(u);
    } catch (e) { /* speech synthesis unavailable */ }
  }
}

/* ---------------------------------------------------------------- canvas */

const view = document.getElementById('view');
const vctx = view.getContext('2d');
const vignette = document.getElementById('vignette');
// Two looks. MODERN: this file's renderer, at RW x RVH (render scale RS of the 480x230
// logical view, 1.5x by default), 256px textures, colored lighting, smooth upscaling;
// layout, HUD and weapons stay in logical units. RETRO: js/retro.js, Doom's 320x200
// indexed-color renderer, shown at 4:3 and stepped at 35 Hz.
// MODERN runs on the GPU (js/gl.js) when WebGL2 is available, with this file's
// software renderer as the fallback; the 2D canvas then only carries the weapon and HUD.
let style = 'modern';
let useGL = false, glDead = false;
const WTEX = WTEX_HI, WSH = 8;
const MODERN_SCALE = 1.5;
let RS = 1, RW = W, RVH = VH, RHZ = HORIZ, RPROJ = PROJ;
let scr, sctx, img, buf, zbuf, glow; // glow: 1 where the pixel emits light (feeds the bloom)
function setRenderScale(scale) {
  RS = scale;
  RW = Math.round(W * scale / 8) * 8;          // floor casting works in spans of 8 pixels
  RVH = Math.round(VH * scale / 2) * 2;
  RHZ = RVH / 2;
  RPROJ = (RW / 2) / PLANE;
  scr = newCanvas(RW, RVH);
  sctx = scr.getContext('2d');
  img = sctx.createImageData(RW, RVH);
  buf = new Uint32Array(img.data.buffer);
  zbuf = new Float32Array(RW);
  glow = new Uint8Array(RW * RVH);
  Post.init(RW, RVH);
}
let K = 1;

function resize() {
  const ww = window.innerWidth, wh = window.innerHeight, ar = style === 'retro' ? Retro.ASPECT : W / H;
  let cw = ww, ch = ww / ar;
  if (ch > wh) { ch = wh; cw = wh * ar; }
  view.style.width = cw + 'px';
  view.style.height = ch + 'px';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  view.width = Math.round(cw * dpr);
  view.height = Math.round(ch * dpr);
  K = view.width / W;
  // the GPU renderer draws its own vignette
  vignette.style.display = style === 'retro' || (useGL && GLR.hdr) ? 'none' : '';
  // the vignette is a CSS layer over the 3D view: composited by the browser for free
  const vg = view.getBoundingClientRect();
  Object.assign(vignette.style, { left: vg.left + 'px', top: vg.top + 'px', width: cw + 'px', height: (ch * VH / H) + 'px' });
  GLR.layout(vg.left, vg.top, cw, ch * VH / H, dpr);
}
window.addEventListener('resize', resize);

/* ----------------------------------------------------------------- state */

let state = 'loading';
let L = null;            // current level
let INV = null;          // inventory carried between levels
let INV_START = null;    // inventory at level start (for restarts)
let god = false;
let animFrame = 0, animClock = 0;
const P = { x: 0, y: 0, a: 0 };

function newInventory() {
  return { hp: 100, armor: 0, ammo: { nuts: 60, shells: 0, sfp: 0, hdd: 0, cells: 0 }, weapons: [true, true, false, false, false, false, false, false], cur: 1 };
}
// Starting loadout when jumping straight into a later level.
function defaultLoadout(idx) {
  const inv = newInventory();
  for (const [ch, first] of Object.entries(WEAPON_FIRST_LEVEL)) if (first < idx) inv.weapons[WEAPON_SLOT[ch]] = true;
  const w = inv.weapons;
  inv.ammo = { nuts: 100, shells: w[2] ? 20 : 0, sfp: w[4] ? 5 : 0, hdd: w[5] ? 4 : 0, cells: w[6] || w[7] ? 80 : 0 };
  inv.armor = idx >= 10 ? 50 : 0;
  inv.cur = w[3] ? 3 : w[2] ? 2 : 1;
  return inv;
}
const cloneInv = (i) => JSON.parse(JSON.stringify(i));
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const alive = (e) => e.state !== 'dead' && e.state !== 'dying';
// sound family of an enemy
const sndKind = (e) => (ETYPES[e.type].boss ? 'boss' : e.type === 'troll' ? 'bug' : e.type === 'spam' ? 'bot' : e.type);

function loadLevel(idx) {
  const def = getLevel(idx);
  const rows = def.map, w = rows[0].length, h = rows.length;
  L = {
    idx, def, w, h,
    map: new Uint8Array(w * h), block: new Uint8Array(w * h),
    floor: new Uint8Array(w * h), ceil: new Uint8Array(w * h), variant: new Uint8Array(w * h),
    doors: new Array(w * h).fill(null), doorList: [],
    enemies: [], items: [], decor: [], barrels: [], proj: [], fx: [],
    flow: new Int16Array(w * h), flowT: 0,
    time: 0, kills: 0, totalKills: 0, itemsGot: 0, totalItems: 0,
    secrets: 0, totalSecrets: 0, migrated: 0, totalSpecials: 0,
    msgs: [], titleT: 5, subtitle: null, keys: { red: false, blue: false }, bossAlive: false, bossSeen: false,
  };
  let start = null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = rows[y][x], i = y * w + x;
    L.variant[i] = ((x * 7919 + y * 104729) >>> 3) % 251;
    // ceiling: light panels on a 3x3 grid, cable trays running north-south every 4 columns
    L.ceil[i] = (x % 3 === 1 && y % 3 === 1) ? 1 : x % 4 === 2 ? 2 : 0;
    if (WALL_CHARS.includes(c)) {
      L.map[i] = c.charCodeAt(0);
      if ('3456'.includes(c)) L.totalSpecials++;
      if (c === 'D' || c === '1' || c === '2' || c === '?') {
        const d = { x, y, lock: c === '1' ? 'red' : c === '2' ? 'blue' : null, secret: c === '?', open: 0, st: 'closed', timer: 0 };
        if (d.secret) L.totalSecrets++;
        L.doors[i] = d; L.doorList.push(d);
      }
      continue;
    }
    if (c === 'P') start = { x: x + 0.5, y: y + 0.5 };
    else if (c === 'Z') spawnEnemy(def.bossType || 'ransomware', x + 0.5, y + 0.5);
    else if (c === 'V') spawnEnemy(def.miniType || 'spaghetti', x + 0.5, y + 0.5);
    else if (ENEMY_CHARS[c]) spawnEnemy(ENEMY_CHARS[c], x + 0.5, y + 0.5);
    else if (ITEM_CHARS.includes(c)) { L.items.push({ x: x + 0.5, y: y + 0.5, type: c, taken: false }); L.totalItems++; }
    else if (c === 'B') { L.barrels.push({ x: x + 0.5, y: y + 0.5, hp: 25, fuse: -1, dead: false, face: ((x * 7 + y * 13) % 4) * Math.PI / 2 }); L.block[i] = 1; }
    else if (DECOR_CHARS.includes(c)) { L.decor.push({ x: x + 0.5, y: y + 0.5, type: c, uses: 0, face: ((x * 7 + y * 13) % 4) * Math.PI / 2 }); if (c === 'x') L.block[i] = 1; }
  }
  // perforated tiles in front of racks (cold aisles)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (L.map[y * w + x]) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const t = L.map[(y + dy) * w + x + dx];
      if (t && 'RSN34567'.includes(String.fromCharCode(t))) L.floor[y * w + x] = 1;
    }
  }
  P.x = start.x; P.y = start.y;
  let best = 0;
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    castRay(P.x, P.y, Math.cos(a), Math.sin(a));
    if (RH.d > best) { best = RH.d; P.a = a; }
  }
  Object.assign(P, { bobPhase: 0, bobAmt: 0, wAnim: 0, fireCd: 0, raise: 1, flashT: 0, hurtT: 0, pickT: 0, dead: false, deadT: 0, spin: 0,
    faceMood: '', faceT: 0, look: 0, lookT: 0, hurtDir: 0, shake: 0, boostT: 0, nutT: 0, pitch: 0 });
  computeFlow();
  Light.bake(L);
}

function spawnEnemy(type, x, y) {
  const T = ETYPES[type];
  const e = { type, x, y, hp: T.hp, state: 'idle', timer: 0, cd: 0, animT: Math.random(), painT: 0, flash: 0, sees: false, losT: Math.random() * 0.2,
    alerted: false, strafe: Math.random() < 0.5 ? 1 : -1, shots: 0, shotT: 0, attacks: 0, shrunk: 0, tpT: 4,
    face: randi(0, 7) * Math.PI / 4 };   // facing angle, for the RETRO rotation frames
  L.enemies.push(e);
  L.totalKills++;
  if (T.boss) L.bossAlive = true;
  return e;
}

/* ------------------------------------------------------------- raycasting */

const RH = { d: 0, side: 0, mx: 0, my: 0, wx: 0, tile: 0 };

// DDA with sliding doors in the middle of the cell. If (rdx, rdy) is
// normalized, RH.d is the Euclidean distance; otherwise the perpendicular distance.
function castRay(px, py, rdx, rdy) {
  const w = L.w, h = L.h, map = L.map;
  let mx = px | 0, my = py | 0;
  const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
  const ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
  let sx, sy, sdx, sdy;
  if (rdx < 0) { sx = -1; sdx = (px - mx) * ddx; } else { sx = 1; sdx = (mx + 1 - px) * ddx; }
  if (rdy < 0) { sy = -1; sdy = (py - my) * ddy; } else { sy = 1; sdy = (my + 1 - py) * ddy; }
  let side = 0;
  for (let i = 0; i < 256; i++) {
    if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; }
    if (mx < 0 || my < 0 || mx >= w || my >= h) break;
    const idx = my * w + mx, t = map[idx];
    if (!t) continue;
    const door = L.doors[idx];
    if (door && !door.secret) {
      let d, f;
      if (side === 0) { d = sdx - ddx * 0.5; f = py + d * rdy; if (Math.floor(f) !== my) continue; f -= my; }
      else { d = sdy - ddy * 0.5; f = px + d * rdx; if (Math.floor(f) !== mx) continue; f -= mx; }
      if (f < door.open) continue;
      RH.d = d; RH.side = side; RH.mx = mx; RH.my = my; RH.wx = f - door.open; RH.tile = t;
      return RH;
    }
    // a secret passage slides back into the wall, Wolfenstein-style
    let d = side === 0 ? sdx - ddx : sdy - ddy;
    if (door && door.secret) {
      if (door.open >= 1) continue;
      const pd = side === 0 ? d + ddx * door.open : d + ddy * door.open;
      const f = side === 0 ? py + pd * rdy : px + pd * rdx;
      if (Math.floor(f) !== (side === 0 ? my : mx)) continue;
      d = pd;
    }
    let wx = side === 0 ? py + d * rdy : px + d * rdx;
    wx -= Math.floor(wx);
    RH.d = d; RH.side = side; RH.mx = mx; RH.my = my; RH.wx = wx; RH.tile = t;
    return RH;
  }
  RH.d = 100; RH.tile = 0;
  return RH;
}

function hasLOS(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
  if (d < 0.01) return true;
  castRay(x0, y0, dx / d, dy / d);
  return RH.d >= d - 0.05;
}

function cellSolid(cx, cy) {
  if (cx < 0 || cy < 0 || cx >= L.w || cy >= L.h) return true;
  const i = cy * L.w + cx;
  if (L.block[i]) return true;
  if (!L.map[i]) return false;
  const d = L.doors[i];
  return !d || d.open < 0.9;
}

function blocked(x, y, r) {
  return cellSolid((x - r) | 0, (y - r) | 0) || cellSolid((x + r) | 0, (y - r) | 0) ||
         cellSolid((x - r) | 0, (y + r) | 0) || cellSolid((x + r) | 0, (y + r) | 0);
}

function moveEntity(o, dx, dy, r, isPlayer) {
  let moved = false;
  const nx = o.x + dx;
  if (!blocked(nx, o.y, r) && !(isPlayer && hitsEnemy(nx, o.y, r))) { o.x = nx; moved = true; }
  const ny = o.y + dy;
  if (!blocked(o.x, ny, r) && !(isPlayer && hitsEnemy(o.x, ny, r))) { o.y = ny; moved = true; }
  return moved;
}

function hitsEnemy(x, y, r) {
  for (const e of L.enemies) {
    if (!alive(e) || e.shrunk > 0) continue;
    const rr = r + ETYPES[e.type].radius;
    const dx = e.x - x, dy = e.y - y;
    if (dx * dx + dy * dy < rr * rr) {
      const cur = (e.x - P.x) ** 2 + (e.y - P.y) ** 2;
      if (dx * dx + dy * dy < cur) return true;
    }
  }
  return false;
}

/* ----------------------------------------------------------------- doors */

function openDoor(d) {
  if (d.st === 'closed' || d.st === 'closing') {
    d.st = 'opening';
    Sfx.door(Math.hypot(d.x + 0.5 - P.x, d.y + 0.5 - P.y));
  }
  d.timer = 4;
}

function doorOccupied(d) {
  const inCell = (x, y, r) => x + r > d.x && x - r < d.x + 1 && y + r > d.y && y - r < d.y + 1;
  if (inCell(P.x, P.y, 0.28)) return true;
  for (const e of L.enemies) if (e.state !== 'dead' && inCell(e.x, e.y, ETYPES[e.type].radius)) return true;
  return false;
}

function updateDoors(dt) {
  for (const d of L.doorList) {
    if (d.st === 'opening') { d.open += dt * (d.secret ? 0.8 : 1.8); if (d.open >= 1) { d.open = 1; d.st = 'open'; d.timer = 4; } }
    else if (d.st === 'open') {
      if (d.secret) continue;
      d.timer -= dt;
      if (d.timer <= 0) { if (doorOccupied(d)) d.timer = 1; else { d.st = 'closing'; Sfx.door(Math.hypot(d.x + 0.5 - P.x, d.y + 0.5 - P.y)); } }
    } else if (d.st === 'closing') {
      if (doorOccupied(d)) { d.st = 'opening'; continue; }
      d.open -= dt * 1.8;
      if (d.open <= 0) { d.open = 0; d.st = 'closed'; }
    }
  }
}

/* ------------------------------------------------------------- messages */

function msg(text) {
  L.msgs.push({ text, t: 3.5 });
  if (L.msgs.length > 4) L.msgs.shift();
}

/* ---------------------------------------------------------------- player */

const keys = {};
let mouseDX = 0, mouseDY = 0, firing = false, showMap = false;
let sensitivity = 1;

function useAction() {
  const dx = Math.cos(P.a), dy = Math.sin(P.a);
  // water cooler in front of the player
  for (const f of L.decor) {
    if (f.type !== 'f') continue;
    const fx = f.x - P.x, fy = f.y - P.y, d = Math.hypot(fx, fy);
    if (d < 1.4 && (fx * dx + fy * dy) / d > 0.7) {
      if (INV.hp >= 100) { msg("You're not thirsty. Neither is your ego."); return; }
      if (f.uses >= 6) { msg('The water cooler is empty.'); return; }
      f.uses++; INV.hp = Math.min(100, INV.hp + 5);
      Sfx.slurp(); msg('Glug glug... +5 ego'); quip('fountain', 0.4);
      return;
    }
  }
  for (let s = 0.2; s <= 1.8; s += 0.1) {
    const cx = (P.x + dx * s) | 0, cy = (P.y + dy * s) | 0;
    const i = cy * L.w + cx, t = L.map[i];
    if (!t) continue;
    const d = L.doors[i];
    if (d) {
      if (d.st === 'open' || d.st === 'opening') { if (d.st === 'open') d.timer = 4; return; }
      if (d.lock && !L.keys[d.lock]) {
        Sfx.deny();
        msg(d.lock === 'red' ? 'Access denied: RED BADGE required' : 'Access denied: BLUE BADGE required');
        return;
      }
      if (d.secret) {
        L.secrets++;
        Sfx.secret();
        msg('Secret area found!');
        quip('secret', 1, true);
      }
      openDoor(d);
      return;
    }
    if (String.fromCharCode(t) === 'X') {
      if (L.bossAlive) { Sfx.deny(); msg('The system is locked! Destroy the boss.'); return; }
      completeLevel();
      return;
    }
    return;
  }
}

function switchWeapon(i) {
  if (i === INV.cur || !INV.weapons[i]) return;
  INV.cur = i; P.raise = 1; P.wAnim = 0;
}

function hasAmmo(i) {
  const w = WEAPONS[i];
  return !w.ammo || INV.ammo[w.ammo] >= (w.use || 1);
}

function bestWeapon() {
  for (const i of [7, 3, 2, 1, 4, 0]) if (INV.weapons[i] && hasAmmo(i)) return i;
  return 0;
}

function updatePlayer(dt) {
  if (P.dead) { P.deadT += dt; return; }
  const turn = ((keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0));
  P.a += turn * 2.8 * dt + mouseDX * 0.0022 * sensitivity;
  mouseDX = 0;
  // looking up and down (GPU renderer only; aiming stays automatic in height)
  if (useGL) P.pitch = Math.max(-0.6, Math.min(0.6, P.pitch - mouseDY * 0.0022 * sensitivity));
  mouseDY = 0;
  const fwd = ((keys.KeyW || keys.ArrowUp) ? 1 : 0) - ((keys.KeyS || keys.ArrowDown) ? 1 : 0);
  const str = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const dx = Math.cos(P.a), dy = Math.sin(P.a);
  const mx = dx * fwd - dy * str, my = dy * fwd + dx * str;
  const len = Math.hypot(mx, my);
  const run = keys.ShiftLeft || keys.ShiftRight;
  if (P.boostT > 0) P.boostT -= dt;
  if (len > 0) {
    const sp = (run ? 5.6 : 3.8) * (P.boostT > 0 ? 1.45 : 1) * dt / len;
    moveEntity(P, mx * sp, my * sp, 0.28, true);
    P.bobPhase += dt * (run ? 11 : 8);
    P.bobAmt = Math.min(1, P.bobAmt + dt * 4);
  } else P.bobAmt = Math.max(0, P.bobAmt - dt * 4);

  // stomping compressed enemies
  for (const e of L.enemies) {
    if (!alive(e) || e.shrunk <= 0) continue;
    if ((e.x - P.x) ** 2 + (e.y - P.y) ** 2 < 0.45 * 0.45) {
      e.hp = 0; killEnemy(e, 'stomp');
      Sfx.squish(); msg('SPLAT!'); quip('stomp', 0.8, true);
    }
  }

  for (const it of L.items) {
    if (it.taken) continue;
    if ((it.x - P.x) ** 2 + (it.y - P.y) ** 2 < 0.36 && pickup(it)) { it.taken = true; if (!it.drop) L.itemsGot++; }
  }

  P.fireCd -= dt;
  P.raise = Math.max(0, P.raise - dt * 4);
  if (P.wAnim > 0) P.wAnim = Math.max(0, P.wAnim - dt / WEAPONS[INV.cur].anim);
  if (P.flashT > 0) P.flashT -= dt;
  if (firing && INV.cur === 3) P.spin += dt * 40;
  if (firing && P.fireCd <= 0 && P.raise < 0.3) fire();

  P.faceT -= dt; if (P.faceT <= 0) P.faceMood = '';
  P.lookT -= dt; if (P.lookT <= 0) { P.look = randi(-1, 1); P.lookT = rand(0.6, 1.8); }
  if (P.hurtT > 0) P.hurtT -= dt;
  if (P.pickT > 0) P.pickT -= dt;
  if (P.shake > 0) P.shake = Math.max(0, P.shake - dt * 1.6);
}

function pickup(it) {
  const add = (k, n) => {
    if (INV.ammo[k] >= AMMO_MAX[k]) return false;
    INV.ammo[k] = Math.min(AMMO_MAX[k], INV.ammo[k] + n); return true;
  };
  const giveWeapon = (ch, k, n, text) => {
    const i = WEAPON_SLOT[ch];
    const isNew = !INV.weapons[i];
    if (!isNew && !add(k, n)) return false;
    INV.weapons[i] = true;
    if (isNew) { add(k, n); switchWeapon(i); quip('weapon', 1, true); }
    msg(text);
    Sfx.weaponPickup();
    P.faceMood = 'grin'; P.faceT = 1.5; P.pickT = 0.3;
    return true;
  };
  let ok = true, text = '';
  switch (it.type) {
    case '+': if (INV.hp >= 100) return false; INV.hp = Math.min(100, INV.hp + 10); text = 'Espresso: +10 ego'; break;
    case 'H': if (INV.hp >= 100) return false; INV.hp = Math.min(100, INV.hp + 25); text = 'Medkit: +25 ego'; break;
    case 'A': if (INV.armor >= 100) return false; INV.armor = 100; text = 'Firewall enabled: 100% armor'; break;
    case 'j': P.boostT = 15; text = 'Energy drink: TURBO for 15 s!'; quip('drink', 0.7); break;
    case 'a': ok = add('nuts', it.drop ? 10 : 30); text = 'M6 cage nuts'; break;
    case 's': ok = add('shells', 8); text = 'Jumbo frames (+8)'; break;
    case 'k': ok = add('sfp', 4); text = 'SFP+ modules (+4 rockets)'; break;
    case 'g':
      if (!INV.weapons[5]) return giveWeapon('G', 'hdd', 2, 'HARD DRIVES picked up! [6]');
      ok = add('hdd', 2); text = 'Hard drives (+2)'; break;
    case 'c': ok = add('cells', 40); text = 'Energy cells (+40)'; break;
    case 'r': L.keys.red = true; msg('RED access badge picked up'); Sfx.key(); P.pickT = 0.3; return true;
    case 'u': L.keys.blue = true; msg('BLUE access badge picked up'); Sfx.key(); P.pickT = 0.3; return true;
    case 'F': return giveWeapon('F', 'shells', 8, 'PACKET SHOTGUN picked up! [3]');
    case 'M': return giveWeapon('M', 'nuts', 60, 'GATLING RIVETER picked up! [4]');
    case 'K': return giveWeapon('K', 'sfp', 5, 'SFP BAZOOKA picked up! [5]');
    case 'G': return giveWeapon('G', 'hdd', 5, 'HARD DRIVES picked up! [6]');
    case 'Y': return giveWeapon('Y', 'cells', 40, 'ZIP COMPRESSOR picked up! [7]');
    case 'L': return giveWeapon('L', 'cells', 60, 'OVERCLOCK CANNON picked up! [8]');
  }
  if (!ok) return false;
  msg(text);
  Sfx.pickup();
  P.pickT = 0.25;
  return true;
}

function fire() {
  const w = WEAPONS[INV.cur];
  if (!hasAmmo(INV.cur)) {
    Sfx.click();
    P.fireCd = 0.35;
    const b = bestWeapon();
    if (b !== INV.cur) switchWeapon(b);
    return;
  }
  if (w.ammo) INV.ammo[w.ammo] -= (w.use || 1);
  P.fireCd = w.rate;
  P.wAnim = 1;
  if (w.melee) { Sfx.fist(); meleeAttack(w); return; }
  if (w.proj !== 'hdd' && w.proj !== 'zip') P.flashT = 0.07;
  if (w.proj === 'sfp') P.shake = Math.max(P.shake, 0.25);
  if (useGL) GLR.shot(INV.cur, P);
  Sfx[w.sfx]();
  // the noise wakes enemies up
  for (const e of L.enemies) {
    if (e.state !== 'idle') continue;
    const d = Math.hypot(e.x - P.x, e.y - P.y);
    if (d < 7 || (d < 16 && hasLOS(e.x, e.y, P.x, P.y))) e.alerted = true;
  }
  if (w.proj) {
    const a = P.a + (Math.random() - 0.5) * 2 * w.spread;
    const dx = Math.cos(a), dy = Math.sin(a);
    const p = { x: P.x + dx * 0.3, y: P.y + dy * 0.3, vx: dx * w.speed, vy: dy * w.speed, kind: w.proj, dmg: randi(w.dmg[0], w.dmg[1]), owner: 'player', z: 0.3, life: 4, t: 0 };
    if (w.proj === 'nut') { p.scale = 0.2; p.z = 0.3; }
    if (w.proj === 'sfp') { p.scale = 0.3; p.z = 0.25; }
    if (w.proj === 'zip') { p.scale = 0.3; }
    if (w.proj === 'hdd') { p.scale = 0.22; p.z = 0.45; p.vz = 1.6; p.fuse = 1.7; p.life = 10; }
    L.proj.push(p);
    return;
  }
  for (let i = 0; i < w.pellets; i++) hitscan(P.a + (Math.random() - 0.5) * 2 * w.spread, randi(w.dmg[0], w.dmg[1]));
}

function hitscan(a, dmg) {
  const dx = Math.cos(a), dy = Math.sin(a);
  castRay(P.x, P.y, dx, dy);
  const wallD = RH.d;
  let best = null, bestD = wallD, barrel = null;
  const test = (ox, oy, r) => {
    const ex = ox - P.x, ey = oy - P.y, along = ex * dx + ey * dy;
    return along > 0 && along < bestD && Math.abs(ex * dy - ey * dx) < r ? along : -1;
  };
  for (const e of L.enemies) {
    if (!alive(e)) continue;
    const r = ETYPES[e.type].radius * (e.shrunk > 0 ? 0.4 : 1) + 0.05;
    const al = test(e.x, e.y, r);
    if (al > 0) { best = e; barrel = null; bestD = al; }
  }
  for (const b of L.barrels) {
    if (b.dead) continue;
    const al = test(b.x, b.y, 0.35);
    if (al > 0) { barrel = b; best = null; bestD = al; }
  }
  if (best) {
    addFx(P.x + dx * (bestD - 0.2), P.y + dy * (bestD - 0.2), 'spark', 0.35 + ETYPES[best.type].z, 0.25);
    damageEnemy(best, dmg);
  } else if (barrel) {
    damageBarrel(barrel, dmg);
  } else if (wallD < 60) {
    addFx(P.x + dx * (wallD - 0.05), P.y + dy * (wallD - 0.05), 'spark', 0.3 + Math.random() * 0.3, 0.2);
  }
}

function meleeAttack(w) {
  const dx = Math.cos(P.a), dy = Math.sin(P.a);
  let best = null, bestD = w.range;
  for (const e of L.enemies) {
    if (!alive(e)) continue;
    const ex = e.x - P.x, ey = e.y - P.y;
    const along = ex * dx + ey * dy;
    if (along <= 0 || along > bestD + ETYPES[e.type].radius) continue;
    if (Math.abs(ex * dy - ey * dx) < ETYPES[e.type].radius + 0.3) { best = e; bestD = along; }
  }
  if (best) { damageEnemy(best, randi(w.dmg[0], w.dmg[1])); Sfx.melee(0); return; }
  // keyboard hit on a rack: Nutanix migration of special racks
  castRay(P.x, P.y, dx, dy);
  if (RH.d > 1.5 || !RH.tile) return;
  const ch = String.fromCharCode(RH.tile);
  const i = RH.my * L.w + RH.mx;
  if ('3456'.includes(ch)) {
    L.map[i] = '7'.charCodeAt(0);
    if (useGL) GLR.retile(L);
    L.migrated++;
    Sfx.nutanix();
    const hx = P.x + dx * (RH.d - 0.1), hy = P.y + dy * (RH.d - 0.1);
    addFx(hx, hy, 'nutanix', 0.55, 0.7, 0.5);
    P.pickT = 0.2;
    msg(`${SPECIAL_NAMES[ch]} rack migrated to NUTANIX! (${L.migrated}/${L.totalSpecials})`);
    if (L.migrated === L.totalSpecials) {
      msg('100% NUTANIX DATACENTER! Bonus: +50 armor');
      INV.armor = Math.min(200, INV.armor + 50);
      quip('nutanixAll', 1, true);
    } else quip('nutanix', 0.8, true);
  } else if ('RSNC7'.includes(ch)) {
    Sfx.melee(0);
    addFx(P.x + dx * (RH.d - 0.1), P.y + dy * (RH.d - 0.1), 'spark', 0.45, 0.2);
  }
}

function damagePlayer(dmg, fromX, fromY) {
  if (P.dead || god) return;
  if (INV.armor > 0) {
    const ab = Math.min(INV.armor, Math.floor(dmg / 3));
    INV.armor -= ab; dmg -= ab;
  }
  INV.hp -= Math.round(dmg);
  P.hurtT = 0.35;
  P.faceMood = 'ouch'; P.faceT = 0.6;
  if (fromX !== undefined) {
    let rel = Math.atan2(fromY - P.y, fromX - P.x) - P.a;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    P.hurtDir = rel;
  }
  if (INV.hp <= 0) {
    INV.hp = 0; P.dead = true; P.deadT = 0; firing = false;
    Sfx.playerDeath();
  } else {
    Sfx.hurt();
    if (INV.hp < 35) quip('hurt', 0.25);
  }
}

/* ----------------------------------------------------- explosions & barrels */

function damageBarrel(b, dmg) {
  b.hp -= dmg;
  if (b.hp <= 0 && b.fuse < 0) b.fuse = 0.01;
}

function explode(x, y, radius, dmg) {
  const dp = Math.hypot(P.x - x, P.y - y);
  Sfx.bigBoom(dp);
  addFx(x, y, 'bigBoom', 0.1, 0.6, 1.5);
  P.shake = Math.max(P.shake, Math.max(0, 0.9 - dp / 12));
  let kills = 0;
  for (const e of L.enemies) {
    if (!alive(e)) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < radius + ETYPES[e.type].radius && hasLOS(x, y, e.x, e.y)) {
      damageEnemy(e, dmg * (1 - 0.6 * d / radius));
      if (!alive(e)) kills++;
    }
  }
  if (dp < radius && hasLOS(x, y, P.x, P.y)) damagePlayer(dmg * 0.5 * (1 - dp / radius), x, y);
  for (const b of L.barrels) {
    if (b.dead || b.fuse >= 0) continue;
    if (Math.hypot(b.x - x, b.y - y) < radius) b.fuse = rand(0.1, 0.25);
  }
  if (kills >= 2) quip('barrel', 0.6);
}

function updateBarrels(dt) {
  for (const b of L.barrels) {
    if (b.dead || b.fuse < 0) continue;
    b.fuse -= dt;
    if (b.fuse <= 0) {
      b.dead = true;
      L.block[(b.y | 0) * L.w + (b.x | 0)] = 0;
      explode(b.x, b.y, 2.6, 120);
    }
  }
}

/* --------------------------------------------------------------- enemies */

function killEnemy(e, how) {
  const T = ETYPES[e.type];
  const dist = Math.hypot(e.x - P.x, e.y - P.y);
  e.state = 'dying'; e.timer = 0.5; e.shrunk = 0;
  L.kills++;
  Sfx.enemyDeath(sndKind(e), dist);
  if (how !== 'stomp') addFx(e.x, e.y, 'boom', 0.2 + T.z, T.boss ? 1.5 : 0.5);
  if (useGL) GLR.kill(e);
  if ((e.type === 'bot' || e.type === 'spam') && Math.random() < 0.7) L.items.push({ x: e.x, y: e.y, type: 'a', taken: false, drop: true });
  if (T.mini) {
    L.bossAlive = L.enemies.some((o) => o !== e && alive(o) && ETYPES[o.type].boss);
    P.shake = 0.7;
    msg(`MINI-BOSS ${T.name} DOWN!${L.bossAlive ? '' : ' The REBOOT terminal is unlocked.'}`);
    quip('bossKill', 1, true);
  } else if (T.boss) {
    L.bossAlive = false;
    P.shake = 1;
    msg(`${T.name} ELIMINATED! The REBOOT terminal is unlocked.`);
    quip('bossKill', 1, true);
    for (const o of L.enemies) if (o !== e && alive(o)) { o.hp = 0; killEnemy(o); }
  } else if (how !== 'stomp') quip('kill', 0.18);
}

function damageEnemy(e, dmg) {
  const T = ETYPES[e.type];
  const dist = Math.hypot(e.x - P.x, e.y - P.y);
  e.hp -= dmg;
  e.flash = 0.08;
  e.alerted = true;
  if (e.hp <= 0) { killEnemy(e); return; }
  if (e.state === 'idle') { e.state = 'chase'; Sfx.alert(sndKind(e), dist); }
  if (Math.random() < T.pain) { e.painT = 0.22; Sfx.enemyPain(sndKind(e), dist); if (e.state === 'attack' && !T.boss) e.state = 'chase'; }
}

function shrinkEnemy(e) {
  const T = ETYPES[e.type];
  if (T.boss) { msg(`${T.name} is too big to compress!`); damageEnemy(e, 40); return; }
  e.shrunk = 8; e.state = 'chase'; e.painT = 0.3; e.alerted = true;
  msg(`${T.name} compressed to .zip! Stomp it!`);
}

function passableForEnemy(i) {
  if (L.block[i]) return false;
  if (!L.map[i]) return true;
  const d = L.doors[i];
  return !!d && ((!d.lock && !d.secret) || d.open > 0.9);
}

let flowQueue = new Int32Array(1);
function computeFlow() {
  const f = L.flow; f.fill(-1);
  const w = L.w;
  if (flowQueue.length < L.w * L.h) flowQueue = new Int32Array(L.w * L.h);
  const q = flowQueue;
  const s = (P.y | 0) * w + (P.x | 0);
  let qh = 0, qt = 0;
  f[s] = 0; q[qt++] = s;
  while (qh < qt) {
    const c = q[qh++], cx = c % w, cy = (c / w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= L.h) continue;
      const n = ny * w + nx;
      if (f[n] >= 0 || !passableForEnemy(n)) continue;
      f[n] = f[c] + 1; q[qt++] = n;
    }
  }
}

function flowTarget(e) {
  const w = L.w, cx = e.x | 0, cy = e.y | 0, cur = L.flow[cy * w + cx];
  let best = cur < 0 ? 9999 : cur, bx = -1, by = -1;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const nx = cx + dx, ny = cy + dy, n = ny * w + nx;
    const v = L.flow[n];
    if (v < 0 || v >= best) continue;
    if (dx && dy && (!passableForEnemy(cy * w + nx) || !passableForEnemy(ny * w + cx) || L.map[cy * w + nx] || L.map[ny * w + cx])) continue;
    best = v; bx = nx; by = ny;
  }
  if (bx < 0) return null;
  const d = L.doors[by * w + bx];
  if (d && d.open < 0.9) openDoor(d);
  return { x: bx + 0.5, y: by + 0.5 };
}

function enemyFire(e) {
  const T = ETYPES[e.type];
  const dist = Math.hypot(P.x - e.x, P.y - e.y);
  const ang = Math.atan2(P.y - e.y, P.x - e.x);
  const shoot = (a, kind, speed, scale) => {
    L.proj.push({ x: e.x + Math.cos(a) * T.radius, y: e.y + Math.sin(a) * T.radius, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, kind,
      dmg: randi(T.dmg[0], T.dmg[1]), owner: 'enemy', z: T.shotZ - scale / 2, scale, life: 5, t: 0 });
  };
  Sfx.enemyShoot(sndKind(e), dist);
  if (T.boss) {
    const n = T.fan || (e.type === 'zeroday' ? 7 : 5);
    for (let k = 0; k < n; k++) shoot(ang + (k - (n - 1) / 2) * 0.13, T.shot, T.shotSpeed || 7.5, T.shotScale || 0.5);
    e.attacks++;
    if (T.minion && e.attacks % 4 === 0) spawnMinions(e);
  } else if (T.fan) {
    for (let k = 0; k < T.fan; k++) shoot(ang + (k - (T.fan - 1) / 2) * 0.18, T.shot, 9, 0.22);
  } else if (e.type === 'drone') shoot(ang + rand(-0.05, 0.05), 'orb', 7, 0.35);
  else shoot(ang + rand(-0.07, 0.07), 'bolt', 12, 0.25);
}

function spawnMinions(boss) {
  const type = ETYPES[boss.type].minion;
  const n = L.enemies.filter((o) => o.type === type && alive(o)).length;
  if (n >= 6) return;
  for (let k = 0; k < 2; k++) {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2, r = rand(1.2, 2.5);
      const x = boss.x + Math.cos(a) * r, y = boss.y + Math.sin(a) * r;
      if (!blocked(x, y, 0.35) && hasLOS(boss.x, boss.y, x, y)) {
        const b = spawnEnemy(type, x, y);
        b.state = 'chase'; b.alerted = true;
        addFx(x, y, 'plasmaHit', 0.2, 0.4);
        break;
      }
    }
  }
  msg(`${ETYPES[boss.type].name} calls for reinforcements!`);
}

function updateEnemy(e, dt) {
  const T = ETYPES[e.type];
  if (e.flash > 0) e.flash -= dt;
  if (e.state === 'dead') return;
  if (e.state === 'dying') { e.timer -= dt; if (e.timer <= 0) e.state = 'dead'; return; }
  const dx = P.x - e.x, dy = P.y - e.y, dist = Math.hypot(dx, dy) || 0.001;
  e.losT -= dt;
  if (e.losT <= 0) {
    e.sees = !P.dead && dist < T.sight && hasLOS(e.x, e.y, P.x, P.y);
    e.losT = rand(0.12, 0.25);
  }
  if (e.state === 'idle') {
    if (e.sees || e.alerted) {
      e.state = 'chase'; e.cd = rand(0.3, T.cd); Sfx.alert(sndKind(e), dist);
      if (T.boss && !L.bossSeen) { L.bossSeen = true; quip('boss', 1, true); }
    }
    return;
  }
  e.animT += dt;
  if (e.painT > 0) { e.painT -= dt; return; }
  const shrunk = e.shrunk > 0;
  if (shrunk) { e.shrunk -= dt; if (e.shrunk <= 0) msg(`${T.name} decompressed itself!`); }
  e.cd -= dt;
  if (e.state === 'attack') {
    e.timer -= dt;
    if (e.shots > 0) { e.shotT -= dt; if (e.shotT <= 0) { if (!P.dead) enemyFire(e); e.shots--; e.shotT = 0.17; } }
    if (e.timer <= 0) e.state = 'chase';
    return;
  }
  if (P.dead) return;

  if (T.teleport && e.sees && (e.tpT -= dt) <= 0) {
    // Shadow IT vanishes and reappears somewhere around the player
    for (let tries = 0; tries < 16; tries++) {
      const a = Math.random() * Math.PI * 2, r = rand(3, 6);
      const x = P.x + Math.cos(a) * r, y = P.y + Math.sin(a) * r;
      if (!blocked(x, y, T.radius) && hasLOS(x, y, P.x, P.y)) {
        addFx(e.x, e.y, 'plasmaHit', 0.5, 0.4, 1.2);
        e.x = x; e.y = y;
        addFx(x, y, 'plasmaHit', 0.5, 0.4, 1.2);
        Sfx.shrink();
        break;
      }
    }
    e.tpT = rand(4, 6.5);
  }

  if (!shrunk && e.cd <= 0 && e.sees) {
    if (T.melee) {
      if (dist < T.atkRange + 0.25) {
        e.state = 'attack'; e.timer = 0.45; e.cd = T.cd; e.face = Math.atan2(dy, dx);
        damagePlayer(randi(T.dmg[0], T.dmg[1]), e.x, e.y);
        Sfx.melee(dist);
        return;
      }
    } else if (dist < T.atkRange) {
      e.state = 'attack'; e.face = Math.atan2(dy, dx);
      e.shots = T.burst || 1;
      e.shotT = 0.2;
      e.timer = 0.25 + e.shots * 0.17;
      e.cd = T.cd * rand(0.7, 1.4);
      return;
    }
  }

  let tx, ty;
  if (shrunk) {
    // a compressed enemy runs away
    tx = e.x - dx; ty = e.y - dy;
  } else {
    const keep = T.melee ? 0 : (T.boss ? 3.5 : 3);
    if (e.sees) {
      if (dist > keep) { tx = P.x; ty = P.y; }
      else { tx = e.x - (dy / dist) * e.strafe; ty = e.y + (dx / dist) * e.strafe; }
    } else {
      const t = flowTarget(e);
      if (!t) return;
      tx = t.x; ty = t.y;
    }
  }
  const mdx = tx - e.x, mdy = ty - e.y, md = Math.hypot(mdx, mdy);
  if (md < 0.01) return;
  const sp = T.speed * (shrunk ? 0.7 : 1) * dt;
  const r = shrunk ? 0.12 : T.radius;
  const ox = e.x, oy = e.y;
  e.face = Math.atan2(mdy, mdx);
  moveEntity(e, mdx / md * sp, mdy / md * sp, r, false);
  const pr = r + 0.28;
  if (!shrunk && (e.x - P.x) ** 2 + (e.y - P.y) ** 2 < pr * pr) { e.x = ox; e.y = oy; }
  if (Math.abs(e.x - ox) + Math.abs(e.y - oy) < sp * 0.3) e.strafe = -e.strafe;
  if (Math.random() < dt * 0.3) e.strafe = -e.strafe;
}

function separateEnemies() {
  const list = L.enemies;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!alive(a)) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (!alive(b)) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) continue;
      const d = Math.hypot(dx, dy);
      const min = ETYPES[a.type].radius + ETYPES[b.type].radius;
      if (d > 0.001 && d < min) {
        const push = (min - d) * 0.25, px = dx / d * push, py = dy / d * push;
        if (!blocked(a.x - px, a.y - py, ETYPES[a.type].radius)) { a.x -= px; a.y -= py; }
        if (!blocked(b.x + px, b.y + py, ETYPES[b.type].radius)) { b.x += px; b.y += py; }
      }
    }
  }
}

/* ------------------------------------------------------ projectiles & fx */

function addFx(x, y, kind, z, dur, scale) {
  L.fx.push({ x, y, kind, z, t: 0, dur, scale: scale || (kind === 'boom' ? 0.8 : kind === 'nutanix' ? 0.9 : 0.35) });
  if (useGL) GLR.fx(kind, x, y, z, scale);
}

function projHitsWall(x, y) {
  const cx = x | 0, cy = y | 0;
  if (cx < 0 || cy < 0 || cx >= L.w || cy >= L.h) return true;
  const i = cy * L.w + cx;
  if (!L.map[i]) return false;
  const d = L.doors[i];
  return !d || d.open < 0.9;
}

function projImpact(p) {
  p.dead = true;
  if (p.kind === 'sfp') explode(p.x - p.vx * 0.01, p.y - p.vy * 0.01, 2.5, p.dmg);
  else if (p.kind === 'hdd') explode(p.x, p.y, 2.8, p.dmg);
  else addFx(p.x - p.vx * 0.01, p.y - p.vy * 0.01, p.kind === 'plasma' || p.kind === 'zip' ? 'plasmaHit' : p.owner === 'player' ? 'spark' : 'boom', p.z, 0.25);
}

function updateProjectiles(dt) {
  for (const p of L.proj) {
    if (p.dead) continue;
    p.t += dt;
    p.life -= dt;
    if (p.life <= 0) { if (p.kind === 'hdd') projImpact(p); else p.dead = true; continue; }
    if (p.kind === 'hdd') { updateHdd(p, dt); continue; }
    if (p.kind === 'sfp' && Math.random() < dt * 30) addFx(p.x - p.vx * 0.03, p.y - p.vy * 0.03, 'smoke', p.z + 0.1, 0.4, 0.25);
    const steps = Math.ceil(Math.hypot(p.vx, p.vy) * dt / 0.1);
    for (let s = 0; s < steps && !p.dead; s++) {
      p.x += p.vx * dt / steps; p.y += p.vy * dt / steps;
      if (projHitsWall(p.x, p.y)) { projImpact(p); break; }
      if (p.owner === 'enemy') {
        if (!P.dead && (p.x - P.x) ** 2 + (p.y - P.y) ** 2 < 0.35 * 0.35) {
          p.dead = true;
          damagePlayer(p.dmg, p.x - p.vx, p.y - p.vy);
          addFx(p.x, p.y, 'boom', p.z, 0.2);
        }
        continue;
      }
      projHitsTargets(p);
    }
  }
  L.proj = L.proj.filter((p) => !p.dead);
  for (const f of L.fx) f.t += dt;
  L.fx = L.fx.filter((f) => f.t < f.dur);
}

function projHitsTargets(p) {
  for (const e of L.enemies) {
    if (!alive(e)) continue;
    const r = ETYPES[e.type].radius * (e.shrunk > 0 ? 0.4 : 1) + 0.12;
    if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 < r * r) {
      if (p.kind === 'zip') { p.dead = true; shrinkEnemy(e); addFx(p.x, p.y, 'plasmaHit', p.z, 0.3); }
      else if (p.kind === 'sfp' || p.kind === 'hdd') projImpact(p);
      else { p.dead = true; damageEnemy(e, p.dmg); addFx(p.x, p.y, p.kind === 'plasma' ? 'plasmaHit' : 'spark', p.z, 0.25); }
      return true;
    }
  }
  for (const b of L.barrels) {
    if (b.dead) continue;
    if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 < 0.4 * 0.4) {
      if (p.kind === 'sfp' || p.kind === 'hdd') projImpact(p);
      else { p.dead = true; damageBarrel(b, p.kind === 'zip' ? 0 : p.dmg); addFx(p.x, p.y, 'spark', p.z, 0.2); }
      return true;
    }
  }
  return false;
}

// Thrown hard drive: arcing trajectory, bounces off walls and floor, 1.7 s fuse.
function updateHdd(p, dt) {
  p.fuse -= dt;
  if (p.fuse <= 0) { projImpact(p); return; }
  const fr = Math.max(0, 1 - (p.z <= 0.06 ? 3 : 0.4) * dt);
  p.vx *= fr; p.vy *= fr;
  const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
  if (blockedProj(nx, p.y)) { p.vx = -p.vx * 0.55; Sfx.bounce(Math.hypot(p.x - P.x, p.y - P.y)); } else p.x = nx;
  if (blockedProj(p.x, ny)) { p.vy = -p.vy * 0.55; Sfx.bounce(Math.hypot(p.x - P.x, p.y - P.y)); } else p.y = ny;
  p.vz -= 6 * dt;
  p.z += p.vz * dt;
  if (p.z < 0.05) { p.z = 0.05; if (Math.abs(p.vz) > 0.8) Sfx.bounce(Math.hypot(p.x - P.x, p.y - P.y)); p.vz = -p.vz * 0.45; }
  if (p.t > 0.15) projHitsTargets(p);
}
function blockedProj(x, y) {
  if (projHitsWall(x, y)) return true;
  const i = (y | 0) * L.w + (x | 0);
  return L.block[i] && !L.barrels.some((b) => !b.dead && (b.x | 0) === (x | 0) && (b.y | 0) === (y | 0));
}

/* ------------------------------------------------------------- rendering */

// Pixel c lit per channel by m (texel x m >> 15, so 128 x 256 = 1.0) plus fog.
function litPx(c, mr, mg, mb, fr, fg, fb) {
  let r = ((c & 255) * mr >> 15) + fr, g = (((c >> 8) & 255) * mg >> 15) + fg, b = (((c >> 16) & 255) * mb >> 15) + fb;
  if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
  return 0xff000000 | (b << 16) | (g << 8) | r;
}

function shade(c, s) {
  return 0xff000000 | ((((c >> 16) & 255) * s >> 8) << 16) | ((((c >> 8) & 255) * s >> 8) << 8) | ((c & 255) * s >> 8);
}

function lightAt(d) {
  const amb = 0.62 + L.def.ambient * 0.38 + (P.flashT > 0 ? 0.12 : 0);
  const s = 256 * amb / (1 + d * 0.07 + d * d * 0.009);
  return s > 256 ? 256 : s | 0;
}

// Distance fog: 0..256 share of the episode fog color added to a pixel.
function fogAt(d) {
  const f = 256 * (1 - Math.exp(-d * 0.075));
  return f > 200 ? 200 : f | 0;
}

// Vertical contact shading of walls, by texel row: darker at the foot, a bit at the top.
const WALL_AO = new Uint16Array(WTEX_HI);
for (let i = 0; i < WTEX_HI; i++) {
  const v = (i + 0.5) / WTEX_HI;
  WALL_AO[i] = Math.round(256 * Math.min(1, 0.82 + v * 1.8) * (v > 0.82 ? 1 - (v - 0.82) * 2.2 : 1));
}

let fogR = 0, fogG = 0, fogB = 0;
const SPAN = 8; // RW is a multiple of it

function render() {
  const dirX = Math.cos(P.a), dirY = Math.sin(P.a);
  const plX = -dirY * PLANE, plY = dirX * PLANE;
  const w = L.w, h = L.h;
  const floorT = Assets.floor, ceilT = Assets.ceil;
  const concreteT = Assets.concrete[L.def.episode % 5];
  Light.update(L, P);
  [fogR, fogG, fogB] = Light.fog;
  glow.fill(0);

  // floor and ceiling: texel x lightmap x distance, plus fog
  const rdx0 = dirX - plX, rdy0 = dirY - plY, rdx1 = dirX + plX, rdy1 = dirY + plY;
  for (let y = RHZ; y < RVH; y++) {
    const p = y - RHZ + 0.5;
    const rowD = 0.5 * RPROJ / p;
    const s = lightAt(rowD), fg = fogAt(rowD);
    const fr = fogR * fg >> 8, fgg = fogG * fg >> 8, fb = fogB * fg >> 8;
    const stx = rowD * (rdx1 - rdx0) / RW, sty = rowD * (rdy1 - rdy0) / RW;
    let fx = P.x + rowD * rdx0, fy = P.y + rowD * rdy0;
    const fo = y * RW, co = (RVH - 1 - y) * RW;
    // the lightmap is sampled every SPAN pixels and interpolated in between
    let lv = Light.sample(fx, fy);
    let mr = (lv & 255) * s, mg = ((lv >> 8) & 255) * s, mb = ((lv >> 16) & 255) * s;
    for (let x0 = 0; x0 < RW; x0 += SPAN) {
      lv = Light.sample(fx + stx * SPAN, fy + sty * SPAN);
      const er = (lv & 255) * s, eg = ((lv >> 8) & 255) * s, eb = ((lv >> 16) & 255) * s;
      const dr = (er - mr) / SPAN, dg = (eg - mg) / SPAN, db = (eb - mb) / SPAN;
      for (let x = x0; x < x0 + SPAN; x++, fx += stx, fy += sty, mr += dr, mg += dg, mb += db) {
        if (fx < 0 || fy < 0 || fx >= w || fy >= h) { buf[fo + x] = 0xff000000; buf[co + x] = 0xff000000; continue; }
        const cx = fx | 0, cy = fy | 0, ci = cy * w + cx;
        const ti = ((((fy - cy) * WTEX) | 0) << WSH) | (((fx - cx) * WTEX) | 0);
        buf[fo + x] = litPx(floorT[L.floor[ci]].px[ti], mr, mg, mb, fr, fgg, fb);
        const ct = ceilT[L.ceil[ci]];
        if (ct.em[ti]) { buf[co + x] = ct.px[ti]; glow[co + x] = 1; } else buf[co + x] = litPx(ct.px[ti], mr, mg, mb, fr, fgg, fb);
      }
      mr = er; mg = eg; mb = eb;
    }
  }

  // walls
  for (let x = 0; x < RW; x++) {
    const cam = 2 * x / RW - 1;
    const rdx = dirX + plX * cam, rdy = dirY + plY * cam;
    castRay(P.x, P.y, rdx, rdy);
    const d = Math.max(RH.d, 0.02);
    zbuf[x] = d;
    if (!RH.tile) continue;
    const lh = RPROJ / d;
    const top = RHZ - lh / 2;
    const y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(RVH - 1, Math.floor(RHZ + lh / 2));
    const vi = RH.my * w + RH.mx;
    const ch = String.fromCharCode(RH.tile);
    const vars = ch === '#' || ch === '?' ? concreteT : Assets.walls[ch];
    const frames = vars[L.variant[vi] % vars.length];
    const tex = frames[(animFrame + L.variant[vi]) % frames.length];
    let tx = (RH.wx * WTEX) | 0;
    if ((RH.side === 0 && rdx < 0) || (RH.side === 1 && rdy > 0)) tx = WTEX - 1 - tx;
    let s = lightAt(d);
    if (RH.side === 1) s = (s * 0.8) | 0;
    // light the face from the lightmap texel row just in front of it
    const IN = 0.5 / LG;
    let lv;
    if (RH.side === 0) lv = Light.sample(rdx < 0 ? RH.mx + 1 + IN : RH.mx - IN, P.y + rdy * d);
    else lv = Light.sample(P.x + rdx * d, rdy < 0 ? RH.my + 1 + IN : RH.my - IN);
    const mr = ((lv & 255) * s) >> 8, mg = (((lv >> 8) & 255) * s) >> 8, mb = (((lv >> 16) & 255) * s) >> 8;
    const fg = fogAt(d), fr = fogR * fg >> 8, fgg = fogG * fg >> 8, fb = fogB * fg >> 8;
    const step = WTEX / lh;
    let tp = (y0 - top) * step;
    const px = tex.px, em = tex.em;
    for (let y = y0; y <= y1; y++, tp += step) {
      const row = (tp | 0) & (WTEX - 1), ti = row << WSH | tx;
      if (em[ti]) { buf[y * RW + x] = px[ti]; glow[y * RW + x] = 1; continue; }
      const k = WALL_AO[row];
      buf[y * RW + x] = litPx(px[ti], mr * k, mg * k, mb * k, fr, fgg, fb);
    }
  }

  // sprites
  const invDet = 1 / (plX * dirY - dirX * plY);
  const list = [];
  const add = (x, y, spr, scale, z, flash, bright) => {
    const sx = x - P.x, sy = y - P.y;
    const ty = invDet * (-plY * sx + plX * sy);
    if (ty < 0.15) return;
    const tx = invDet * (dirY * sx - dirX * sy);
    list.push({ spr, scale, z, flash, bright: bright ? 1 : 0, tx, ty, x, y });
  };
  collectSprites(add, false);
  list.sort((a, b) => b.ty - a.ty);
  for (const s of list) drawSprite(s);

  if (P.hurtT > 0.15) {
    for (let k = 0; k < 6; k++) {
      const y = randi(0, RVH - 4), hgt = randi(1, 4), off = randi(-12, 12) * RS | 0;
      for (let yy = y; yy < y + hgt; yy++) {
        const row = buf.subarray(yy * RW, yy * RW + RW);
        row.copyWithin(off > 0 ? off : 0, off > 0 ? 0 : -off);
      }
    }
  }
  if (Light.high) Post.bloom(buf, glow, RW, RVH);
  sctx.putImageData(img, 0, 0);
}

// Every billboard of the frame, through add(x, y, spr, scale, z, flash, bright).
// RETRO (retro = true) picks the monsters' rotation frames (8 views, Doom-style)
// and 8 of the props' 16 rotations. The GPU renderer (gpu = true) gets high
// resolution rotations, and draws props and effects itself (meshes, particles).
function collectSprites(add, retro, gpu) {
  const frameOf = (a, t, fps) => (Array.isArray(a) ? a[((t * fps) | 0) % a.length] : a);
  if (!gpu) {
    for (const d of L.decor) { const A = Assets.decor[d.type]; add(d.x, d.y, propFrame(A, d, retro), A.scale, A.z); }
    const UPS = Assets.decor.B;
    for (const b of L.barrels) if (!b.dead) add(b.x, b.y, propFrame(UPS, b, retro), UPS.scale, UPS.z, b.fuse >= 0);
  }
  const bobT = performance.now() / 400;
  for (const it of L.items) {
    if (it.taken) continue;
    const floaty = 'ruFMKGYL'.includes(it.type);
    add(it.x, it.y, Assets.items[it.type], 0.5, floaty ? 0.05 + Math.sin(bobT + it.x) * 0.03 : 0, 0, it.type === 'r' || it.type === 'u');
  }
  for (const e of L.enemies) {
    const T = ETYPES[e.type], S = Assets.enemies[e.type];
    const R = !alive(e) ? S : gpu ? hiRotation(S, enemyRot(e)) : retro ? buildRotations(S)[enemyRot(e)] : S;
    let spr;
    if (e.state === 'dead') spr = S.dead;
    else if (e.state === 'dying') spr = S.die[e.timer > 0.25 ? 0 : 1];
    else if (e.state === 'attack') spr = R.atk;
    else if (e.state === 'idle') spr = R.walk[0];
    else spr = R.walk[((e.animT * (e.type === 'drone' ? 6 : e.shrunk > 0 ? 10 : 4)) | 0) % 2];
    let z = T.z;
    let scale = T.scale;
    if (e.type === 'drone' && e.state !== 'dead') z += Math.sin(e.animT * 3 + e.x) * 0.05;
    if (e.state === 'dead') { z = 0; scale = Math.max(0.8, T.scale * 0.7); }
    if (e.shrunk > 0 && alive(e)) { scale *= e.shrunk < 1 ? 0.3 + 0.7 * (1 - e.shrunk) : 0.3; z = 0; }
    add(e.x, e.y, spr, scale, z, e.flash > 0);
  }
  for (const p of L.proj) add(p.x, p.y, frameOf(Assets.proj[p.kind], p.t, 16), p.scale || 0.35, p.z, false, true);
  if (gpu) return;
  for (const f of L.fx) {
    const fr = Assets.fx[f.kind];
    const i = Math.min(fr.length - 1, (f.t / f.dur * fr.length) | 0);
    add(f.x, f.y, fr[i], f.scale, f.z - f.scale / 2 + (f.kind === 'smoke' ? f.t * 0.4 : 0), false, true);
  }
}

// Rotation (0-7) under which the player sees a monster: 0 when it faces the player,
// 2 when it faces the player's right, 4 from behind (see rotSprite in textures.js).
function enemyRot(e) {
  const rel = Math.atan2(P.y - e.y, P.x - e.x) - e.face;
  return ((Math.round(rel / (Math.PI / 4)) % 8) + 8) % 8;
}

// Picks the rotation frame of a volumetric prop according to where the player stands
// (RETRO: 8 rotations like Doom, out of the 16 rendered).
function propFrame(A, o, eight) {
  const n = A.frames.length;
  if (n === 1) return A.frames[0];
  const phi = Math.atan2(P.y - o.y, P.x - o.x);
  const yaw = Math.atan2(-Math.cos(phi), -Math.sin(phi)) + (o.face || 0);
  const m = eight && n % 8 === 0 ? 8 : n;
  const k = ((Math.round(yaw / (Math.PI * 2) * m) % m) + m) % m;
  return A.frames[k * (n / m)];
}

function drawSprite(s) {
  const spr = s.spr, sw = spr.w, sh = spr.h, px = spr.px;
  const size = s.scale * RPROJ / s.ty;
  const cx = (RW / 2) * (1 + s.tx / s.ty);
  const bottom = RHZ + (0.5 - s.z) * RPROJ / s.ty;
  const top = bottom - size, left = cx - size / 2;
  const x0 = Math.max(0, Math.ceil(left)), x1 = Math.min(RW - 1, Math.floor(left + size));
  const y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(RVH - 1, Math.floor(bottom));
  if (x0 > x1 || y0 > y1) return;
  // lit by the lightmap at its feet; bright sprites (projectiles, fx) are self-lit
  let mr = 32768, mg = 32768, mb = 32768, fr = 0, fg = 0, fb = 0;
  if (!s.bright) {
    const lt = lightAt(s.ty), lv = Light.sample(s.x, s.y), f = fogAt(s.ty);
    mr = (lv & 255) * lt; mg = ((lv >> 8) & 255) * lt; mb = ((lv >> 16) & 255) * lt;
    fr = fogR * f >> 8; fg = fogG * f >> 8; fb = fogB * f >> 8;
  }
  const inv = sw / size;
  for (let x = x0; x <= x1; x++) {
    if (s.ty >= zbuf[x]) continue;
    const tx = ((x - left) * inv) | 0;
    if (tx < 0 || tx >= sw) continue;
    for (let y = y0; y <= y1; y++) {
      const ty = ((y - top) * inv) | 0;
      if (ty >= sh) break;
      const c = px[ty * sw + tx];
      if (!c) continue;
      const o = y * RW + x;
      const lc = s.flash ? (c | 0xff808080) : litPx(c, mr, mg, mb, fr, fg, fb);
      const a = c >>> 24;
      if (a === 255) { buf[o] = lc; glow[o] = s.bright; continue; }
      // soft edge: blend with what is behind
      const d = buf[o], ia = 255 - a;
      buf[o] = 0xff000000 | ((((lc >> 16) & 255) * a + ((d >> 16) & 255) * ia) >> 8) << 16 |
        ((((lc >> 8) & 255) * a + ((d >> 8) & 255) * ia) >> 8) << 8 | (((lc & 255) * a + (d & 255) * ia) >> 8);
    }
  }
}

/* --------------------------------------------------------------- weapons */

function drawFlash(g, x, y, r, inner, outer) {
  g.fillStyle = outer;
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2, rr = i % 2 ? r * 0.45 : r * rand(0.8, 1.1);
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8);
  }
  g.fill();
  ell(g, x, y, r * 0.4, r * 0.35, inner);
}

const CAN_FILTER = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;

// Draws the weapon held in hand on the high-resolution canvas (logical coordinates).
// The models are pre-rendered by js/weapons.js; here we only pick the pose and
// add bobbing, recoil, lighting and the muzzle flash.
// part: 'all', 'art' (the model, unlit: RETRO) or 'fx' (flash and glow, full bright: RETRO,
// and MODERN on the GPU, where the model itself is a lit mesh drawn by gl.js).
// pose: the frame's weaponPose(), so that the GPU mesh and the 2D effects agree.
// Returns whether something was drawn.
function drawWeapon(g, shx, shy, part = 'all', pose = weaponPose()) {
  if (!pose) return false;
  const { art, flash, rot } = pose, t = P.wAnim;
  const lum = Math.min(1.2, L.def.ambient * 0.85 + 0.2 + (P.flashT > 0 ? 0.35 : 0));
  const m = art.muzzle, fx = m && (INV.cur === 7 || INV.cur === 6 || (flash && P.flashT > 0));
  if (part === 'fx' && !fx) return false;
  g.save();
  g.translate(pose.x + shx, pose.y + shy);
  if (rot) { g.translate(pose.px, pose.py); g.rotate(rot); g.translate(-pose.px, -pose.py); }
  if (part === 'all' && CAN_FILTER && Math.abs(lum - 1) > 0.02) g.filter = `brightness(${lum.toFixed(2)})`;
  if (part !== 'fx') g.drawImage(art.c, art.x, art.y, art.w, art.h);
  g.filter = 'none';
  if (m && part !== 'art') {
    if (INV.cur === 7 || INV.cur === 6) {
      // energy weapons: pulsing glow at the nozzle
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 90);
      g.globalAlpha = 0.35 + pulse * 0.35 + (t > 0.3 ? 0.3 : 0);
      ell(g, m[0], m[1], 5 + pulse * 2, 4 + pulse * 2, INV.cur === 7 ? '#8ef' : '#c6b6ff');
      g.globalAlpha = 1;
      if (INV.cur === 6 && t > 0.5) drawFlash(g, m[0], m[1], 18, '#ffffff', '#8a6aff');
    }
    if (flash && P.flashT > 0) drawFlash(g, m[0] + rand(-1, 1), m[1] - 2, flash[2], flash[0], flash[1]);
  }
  g.restore();
  return true;
}

// Pose of the weapon in hand this frame: which art (pose of the model), its offset
// (bobbing, raise, recoil) and rotation around a pivot, in logical px; null when dead.
function weaponPose() {
  if (P.dead) return null;
  const A = Assets.weapons, t = P.wAnim;
  const bx = Math.cos(P.bobPhase) * 8 * P.bobAmt;
  const by = Math.abs(Math.sin(P.bobPhase)) * 6 * P.bobAmt + P.raise * 120;
  let art, dx = 0, dy = 0, rot = 0, flash = null;
  switch (INV.cur) {
    case 0: {
      const s = t > 0 ? Math.sin(t * Math.PI) : 0;
      art = A.keyboard; dx = -s * 120; dy = -s * 40; rot = -s * 0.7;
      break;
    }
    case 1: art = A.pistol[t > 0.4 ? 1 : 0]; dy = t * 14; rot = t * 0.05; flash = ['#fff6b0', '#ffb040', 16]; break;
    case 2: art = A.shotgun[t > 0.15 && t < 0.75 ? 1 : 0]; dy = t * 20; flash = ['#fff6b0', '#ff7a1a', 30]; break;
    case 3: art = A.gatling[Math.floor(P.spin / (Math.PI / 12)) % 4]; dy = t * 6 + (firing ? rand(-1, 1) : 0); dx = firing ? rand(-1, 1) : 0; flash = ['#fff6b0', '#ffb040', 20]; break;
    case 4: art = A.bazooka[t > 0.3 ? 1 : 0]; dy = t * 24; flash = ['#fff6b0', '#ff7a1a', 30]; break;
    case 5: art = A.hdd[t > 0.25 ? 1 : 0]; dy = t > 0 && t <= 0.25 ? (0.25 - t) * 4 * 70 : 0; break;
    case 6: art = A.zip; dy = t * 10; break;
    default: art = A.plasma; dy = t * 8; flash = ['#ffffff', '#3cf', 24]; break;
  }
  return { art, flash, rot, x: bx + dx, y: by + dy, px: art.x + art.w * 0.85, py: art.y + art.h };
}

/* ------------------------------------------------------------------- HUD */

// The admin's Duke-style face: blond flat-top, shades, smirk.
function drawFace(g, cx, cy) {
  const hp = INV.hp;
  const mood = P.dead ? 'dead' : P.faceMood;
  g.fillStyle = hp > 60 ? '#e0a877' : hp > 30 ? '#d0966a' : '#c0845e';
  g.fillRect(cx - 12, cy - 8, 24, 22);                        // square jaw
  g.fillRect(cx - 10, cy + 14, 20, 3);
  g.fillStyle = '#e8c23a'; g.fillRect(cx - 13, cy - 16, 26, 9); // blond flat-top
  g.fillStyle = '#c9a020'; for (let x = cx - 12; x < cx + 13; x += 3) g.fillRect(x, cy - 16, 1, 8);
  g.fillStyle = '#e8c23a'; g.fillRect(cx - 13, cy - 8, 3, 6); g.fillRect(cx + 10, cy - 8, 3, 6);
  // shades
  if (mood === 'dead') {
    g.fillStyle = '#000'; g.font = '6px monospace'; g.fillText('x', cx - 8, cy + 1); g.fillText('x', cx + 3, cy + 1);
  } else {
    g.fillStyle = '#0a0a0a'; g.fillRect(cx - 12, cy - 5, 11, 6); g.fillRect(cx + 1, cy - 5, 11, 6); g.fillRect(cx - 1, cy - 4, 2, 2);
    g.fillStyle = god ? '#ffd700' : 'rgba(120,180,255,0.6)'; g.fillRect(cx - 10 + P.look, cy - 4, 3, 1); g.fillRect(cx + 3 + P.look, cy - 4, 3, 1);
  }
  // mouth
  g.fillStyle = '#5a1a1a';
  if (mood === 'ouch' || mood === 'dead') ell(g, cx, cy + 9, 3, 3, '#5a1a1a');
  else if (mood === 'grin' || god) { g.fillRect(cx - 6, cy + 7, 12, 3); g.fillStyle = '#fff'; g.fillRect(cx - 5, cy + 7, 10, 1); }
  else { g.fillRect(cx - 2, cy + 9, 8, 2); g.fillRect(cx + 5, cy + 7, 2, 2); }  // smirk
  if (hp < 60) { g.fillStyle = '#b01515'; g.fillRect(cx + 7, cy + 2, 2, 6); }
  if (hp < 30) { g.fillRect(cx - 9, cy + 4, 2, 8); g.fillRect(cx + 3, cy + 12, 5, 2); }
}

function drawHud(g) {
  const y = VH;
  g.fillStyle = '#1c1f24'; g.fillRect(0, y, W, HUD_H);
  g.fillStyle = '#4a4f57'; g.fillRect(0, y, W, 2);
  g.fillStyle = '#0e1013';
  for (const x of [72, 142, 214, 266, 336, 372]) g.fillRect(x, y + 2, 2, HUD_H - 2);
  const big = (txt, x, col) => {
    g.font = `14px ${FONT}`; g.textAlign = 'center';
    g.fillStyle = '#000'; g.fillText(txt, x + 1, y + 23);
    g.fillStyle = col; g.fillText(txt, x, y + 22);
  };
  const label = (txt, x) => { g.font = `5px ${FONT}`; g.textAlign = 'center'; g.fillStyle = '#9aa3ad'; g.fillText(txt, x, y + 35); };
  const w = WEAPONS[INV.cur];
  big(w.ammo ? String(INV.ammo[w.ammo]) : '--', 36, '#ff4d2e'); label('AMMO', 36);
  big(INV.hp + '%', 107, INV.hp > 30 ? '#ff4d2e' : '#ff1a1a'); label('EGO', 107);
  g.font = `7px ${FONT}`; g.textAlign = 'center';
  for (let i = 0; i < 8; i++) {
    const x = 153 + (i % 4) * 17, yy = y + 12 + ((i / 4) | 0) * 11;
    g.fillStyle = i === INV.cur ? '#ffe14a' : INV.weapons[i] ? '#d8dde3' : '#3a3f46';
    g.fillText(String(i + 1), x, yy + 4);
  }
  label('WEAPONS', 178);
  g.fillStyle = '#0e1013'; g.fillRect(216, y + 3, 50, HUD_H - 4);
  if (P.hurtT > 0) { g.fillStyle = 'rgba(255,0,0,0.25)'; g.fillRect(216, y + 3, 50, HUD_H - 4); }
  drawFace(g, 241, y + 20);
  big(INV.armor + '%', 301, '#4fb4ff'); label('ARMOR', 301);
  const badge = (on, col, yy) => { g.fillStyle = on ? col : '#2a2e34'; g.fillRect(347, y + yy, 14, 9); g.fillStyle = on ? '#eee' : '#1c1f24'; g.fillRect(349, y + yy + 5, 10, 2); };
  badge(L.keys.red, '#d42020', 7); badge(L.keys.blue, '#1f58d6', 20);
  g.font = `5px ${FONT}`; g.textAlign = 'left';
  AMMO_LABELS.forEach(([n, k], i) => {
    const yy = y + 9 + i * 7;
    g.fillStyle = '#9aa3ad'; g.fillText(n, 380, yy);
    g.fillStyle = w.ammo === k ? '#ffe14a' : '#b8a040';
    g.textAlign = 'right'; g.fillText(`${INV.ammo[k]}/${AMMO_MAX[k]}`, 472, yy); g.textAlign = 'left';
  });
}

function drawOverlayText(g) {
  g.font = `6px ${FONT}`; g.textAlign = 'left';
  L.msgs.forEach((m, i) => {
    g.globalAlpha = Math.min(1, m.t);
    g.fillStyle = '#000'; g.fillText(m.text, 7, 13 + i * 10);
    g.fillStyle = '#ffe14a'; g.fillText(m.text, 6, 12 + i * 10);
  });
  g.globalAlpha = 1;
  if (L.titleT > 0) {
    g.globalAlpha = Math.min(1, L.titleT);
    g.font = `9px ${FONT}`; g.textAlign = 'center';
    g.fillStyle = '#000'; g.fillText(L.def.name, W / 2 + 1, 61);
    g.fillStyle = '#3dff6a'; g.fillText(L.def.name, W / 2, 60);
    g.font = `5px ${FONT}`; g.fillStyle = '#9aa3ad';
    g.fillText(`EPISODE ${L.def.episode + 1}: ${EPISODES[L.def.episode].name}`, W / 2, 72);
    g.globalAlpha = 1;
  }
  if (L.subtitle && L.subtitle.t > 0) {
    g.globalAlpha = Math.min(1, L.subtitle.t);
    g.font = `6px ${FONT}`; g.textAlign = 'center';
    const tw = g.measureText(L.subtitle.text).width;
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(W / 2 - tw / 2 - 4, VH - 30, tw + 8, 11);
    g.fillStyle = '#fff'; g.fillText(L.subtitle.text, W / 2, VH - 22);
    g.globalAlpha = 1;
  }
  g.font = `5px ${FONT}`; g.textAlign = 'right';
  g.fillStyle = 'rgba(220,230,240,0.8)'; g.fillText(WEAPONS[INV.cur].name, W - 6, VH - 6);
  // Nutanix migration counter
  g.fillStyle = L.migrated === L.totalSpecials ? '#b6a4ff' : '#7855fa';
  g.fillText(`NUTANIX ${L.migrated}/${L.totalSpecials}`, W - 6, 12);
  if (god) { g.fillStyle = '#ffd700'; g.fillText('ROOT MODE', W - 6, 21); }
  if (P.boostT > 0) { g.fillStyle = '#3dff6a'; g.fillText(`TURBO ${Math.ceil(P.boostT)}`, W - 6, god ? 30 : 21); }
  const boss = L.enemies.find((e) => ETYPES[e.type].boss && alive(e) && e.state !== 'idle');
  if (boss) {
    const T = ETYPES[boss.type];
    const f = Math.max(0, boss.hp / T.hp);
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(W / 2 - 101, 21, 202, 10);
    g.fillStyle = T.mini ? '#6a3a08' : '#7a0f0f'; g.fillRect(W / 2 - 100, 22, 200, 8);
    g.fillStyle = T.mini ? '#ff9a1a' : '#ff2a2a'; g.fillRect(W / 2 - 100, 22, 200 * f, 8);
    g.font = `5px ${FONT}`; g.textAlign = 'center'; g.fillStyle = '#fff';
    g.fillText(`${T.mini ? 'MINI-BOSS ' : ''}${T.name}: ${T.tag}`, W / 2, 18);
  }
}

function drawMap(g) {
  const cs = Math.min((W - 40) / L.w, (VH - 30) / L.h);
  const ox = (W - cs * L.w) / 2, oy = (VH - cs * L.h) / 2;
  g.fillStyle = 'rgba(0,8,4,0.85)'; g.fillRect(0, 0, W, VH);
  const col = { '#': '#6b7178', '?': '#6b7178', R: '#2e8b3d', S: '#2e6da6', N: '#8a6d1f', C: '#b8bcc0', W: '#c2a020', X: '#3dff6a', D: '#9aa3ad', '1': '#d42020', '2': '#1f58d6',
    '3': '#cc092f', '4': '#e57000', '5': '#2f9bff', '6': '#00a4ef', '7': '#7855fa' };
  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
    const i = y * L.w + x, t = L.map[i];
    if (!t) { if (L.block[i]) { g.fillStyle = '#5a4a2a'; g.fillRect(ox + x * cs + cs * 0.2, oy + y * cs + cs * 0.2, cs * 0.6, cs * 0.6); } continue; }
    g.fillStyle = col[String.fromCharCode(t)] || '#666';
    g.fillRect(ox + x * cs, oy + y * cs, cs - 0.5, cs - 0.5);
  }
  for (const it of L.items) if (!it.taken) { g.fillStyle = '#ffe14a'; g.fillRect(ox + it.x * cs - 1, oy + it.y * cs - 1, 2, 2); }
  for (const e of L.enemies) if (alive(e)) { g.fillStyle = '#ff3b3b'; g.fillRect(ox + e.x * cs - 1.5, oy + e.y * cs - 1.5, 3, 3); }
  const px = ox + P.x * cs, py = oy + P.y * cs;
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(px + Math.cos(P.a) * 5, py + Math.sin(P.a) * 5);
  g.lineTo(px + Math.cos(P.a + 2.5) * 4, py + Math.sin(P.a + 2.5) * 4);
  g.lineTo(px + Math.cos(P.a - 2.5) * 4, py + Math.sin(P.a - 2.5) * 4);
  g.fill();
  g.font = `6px ${FONT}`; g.textAlign = 'center'; g.fillStyle = '#3dff6a';
  g.fillText('DATACENTER MAP: ' + L.def.name, W / 2, 12);
}

// The 3D view through the GPU renderer; the 2D canvas over it stays transparent there.
// dt advances its particles (0 while paused).
let glPose = null;   // the weapon pose drawn by the GPU this frame (present() adds its 2D effects)
function renderGL(dt = 0) {
  const sh = P.shake > 0 ? P.shake * 7 : 0;
  glPose = GLR.hasWeapons ? weaponPose() : null;
  GLR.render({
    weapon: glPose,
    L, P, inv: INV, anim: animFrame, dt,
    warmBudget: state === 'briefing' ? 30 : 4,   // the briefing screen hides the background work
    shakeX: sh ? rand(-sh, sh) / W : 0, shakeY: sh ? rand(-sh, sh) / VH : 0,
    collect: (add) => collectSprites(add, false, true),
  });
}

function present() {
  vctx.setTransform(1, 0, 0, 1, 0, 0);
  vctx.imageSmoothingEnabled = style === 'modern';
  vctx.imageSmoothingQuality = 'high';
  const sh = P.shake > 0 ? P.shake * 7 * K : 0;
  if (useGL) vctx.clearRect(0, 0, W * K, VH * K);
  else {
    if (sh) { vctx.fillStyle = '#000'; vctx.fillRect(0, 0, W * K, VH * K); }
    vctx.drawImage(scr, sh ? rand(-sh, sh) : 0, sh ? rand(-sh, sh) : 0, W * K, VH * K);
  }
  vctx.setTransform(K, 0, 0, K, 0, 0);
  const g = vctx;
  g.save(); g.beginPath(); g.rect(0, 0, W, VH); g.clip();
  if (useGL && GLR.hasWeapons) drawWeapon(g, 0, 0, 'fx', glPose);
  else drawWeapon(g, sh ? rand(-sh, sh) / K : 0, sh ? rand(-sh, sh) / K : 0);
  g.restore();
  g.fillStyle = 'rgba(120,255,140,0.85)';
  g.fillRect(W / 2 - 5, HORIZ - 0.5, 3.5, 1); g.fillRect(W / 2 + 1.5, HORIZ - 0.5, 3.5, 1);
  g.fillRect(W / 2 - 0.5, HORIZ - 5, 1, 3.5); g.fillRect(W / 2 - 0.5, HORIZ + 1.5, 1, 3.5);
  if (showMap) drawMap(g);
  if (P.hurtT > 0) { g.fillStyle = `rgba(255,0,0,${P.hurtT * 0.8})`; g.fillRect(0, 0, W, VH); }
  if (P.pickT > 0) { g.fillStyle = `rgba(255,230,80,${P.pickT * 0.5})`; g.fillRect(0, 0, W, VH); }
  if (P.dead) { g.fillStyle = `rgba(120,0,0,${Math.min(0.6, P.deadT * 0.4)})`; g.fillRect(0, 0, W, VH); }
  if (P.hurtT > 0 && P.hurtDir) {
    g.save(); g.translate(W / 2, HORIZ); g.rotate(P.hurtDir);
    g.fillStyle = `rgba(255,40,40,${P.hurtT * 2})`;
    g.beginPath(); g.moveTo(60, -10); g.lineTo(74, 0); g.lineTo(60, 10); g.fill();
    g.restore();
  }
  drawOverlayText(g);
  drawHud(g);
}

/* ------------------------------------------------------------- game loop */

function updateMsgs(dt) {
  for (const m of L.msgs) m.t -= dt;
  L.msgs = L.msgs.filter((m) => m.t > 0);
  if (L.titleT > 0) L.titleT -= dt;
  if (L.subtitle) L.subtitle.t -= dt;
}

function update(dt) {
  L.time += dt;
  animClock += dt;
  if (animClock > 0.45) { animClock = 0; animFrame = (animFrame + 1) & 1; }
  updatePlayer(dt);
  updateDoors(dt);
  L.flowT -= dt;
  if (L.flowT <= 0) { computeFlow(); L.flowT = 0.3; }
  for (const e of L.enemies) updateEnemy(e, dt);
  separateEnemies();
  updateProjectiles(dt);
  updateBarrels(dt);
  updateMsgs(dt);
  if (P.dead && P.deadT > 1.6 && state === 'playing') showDeath();
}

// Draws the current frame in the active style (also used by the pause menu).
function drawFrame() {
  if (style === 'retro') Retro.frame();
  else { if (useGL) renderGL(); else render(); present(); }
}

let last = 0, tics = 0;
// Average render cost while playing: on a machine too slow for the HIGH
// effects, quality drops to LOW once (the player can switch back with G).
let renderCost = 0, slowT = 0, autoLowered = false;
function frame(ts) {
  const raw = Math.min(0.2, (ts - last) / 1000 || 0);
  last = ts;
  const shown = L && state !== 'title' && state !== 'loading' && state !== 'select';
  if (style === 'retro') {
    // Doom's 35 Hz: the logic advances in fixed tics and a frame is drawn per tic
    tics += raw * 35;
    let n = 0;
    for (; tics >= 1; tics--, n++) if (state === 'playing') update(1 / 35);
    if (n && shown) Retro.frame();
    requestAnimationFrame(frame);
    return;
  }
  const dt = Math.min(0.05, raw);
  if (state === 'playing') update(dt);
  if (shown) {
    if (useGL) {
      renderGL(state === 'playing' ? dt : 0); present();
      // the GPU works asynchronously: judge it by the time between frames
      if (state === 'playing' && !autoLowered) {
        renderCost += (raw * 1000 - renderCost) * 0.05;
        slowT = renderCost > 28 ? slowT + dt : 0;
        if (slowT > 3) {
          slowT = 0; renderCost = 0;
          if (GLR.degrade()) msg('Slow machine: lower 3D resolution');
          else { autoLowered = true; if (Light.high) toggleGraphics('Slow machine: graphics set to low (G to change)'); }
        }
      }
      requestAnimationFrame(frame);
      return;
    }
    const t0 = performance.now();
    render(); present();
    if (state === 'playing' && !autoLowered && (Light.high || RS > 1)) {
      renderCost += (performance.now() - t0 - renderCost) * 0.05;
      slowT = renderCost > 14 ? slowT + dt : 0;
      if (slowT > 3) {
        slowT = 0; renderCost = 0;
        if (RS > 1) { setRenderScale(1); msg('Slow machine: MODERN style at lower resolution'); }
        else { autoLowered = true; toggleGraphics('Slow machine: graphics set to low (G to change)'); }
      }
    }
  }
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------ save game */

const SAVE_KEY = 'dukenutanix.save';
function readSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || null; } catch (e) { return null; }
}
function writeSave(idx, inv) {
  const s = readSave() || { maxLevel: 0 };
  s.maxLevel = Math.max(s.maxLevel || 0, idx);
  s.level = idx; s.inv = inv;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable */ }
}

/* --------------------------------------------------------------- screens */

const overlay = document.getElementById('overlay');
const panel = document.getElementById('panel');

function showPanel(html, onGo) {
  panel.innerHTML = html;
  overlay.classList.remove('hidden');
  const btn = panel.querySelector('[data-go]');
  if (btn) btn.onclick = (e) => { e.stopPropagation(); onGo(); };
  panel.querySelectorAll('[data-act]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); actions[b.dataset.act](b.dataset.arg); }; });
}

function hidePanel() { overlay.classList.add('hidden'); }

const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const CONTROLS = `
  <table class="ctl">
    <tr><td>WASD / ZQSD / ↑↓</td><td>Move</td></tr>
    <tr><td>Mouse / ← →</td><td>Turn (mouse: also look up / down in MODERN)</td></tr>
    <tr><td>Click / Ctrl</td><td>Fire</td></tr>
    <tr><td>E / Space</td><td>Open, search walls, drink</td></tr>
    <tr><td>1-8 / wheel</td><td>Switch weapon</td></tr>
    <tr><td>Shift</td><td>Run</td></tr>
    <tr><td>Tab / M</td><td>Datacenter map</td></tr>
    <tr><td>Esc</td><td>Pause</td></tr>
    <tr><td>N / V</td><td>Mute sound / voice</td></tr>
    <tr><td>G</td><td>Graphics quality (high / low)</td></tr>
    <tr><td>T</td><td>Style: modern / retro (Doom-like 320x200)</td></tr>
  </table>`;

const actions = {
  newGame() { Sfx.init(); INV = newInventory(); startLevel(0); },
  continueGame() {
    Sfx.init();
    const s = readSave();
    INV = s && s.inv ? cloneInv(s.inv) : defaultLoadout(s ? s.level : 0);
    startLevel(s ? s.level : 0);
  },
  select() { showSelect(); },
  play(arg) {
    Sfx.init();
    const idx = +arg, s = readSave();
    INV = s && s.level === idx && s.inv ? cloneInv(s.inv) : defaultLoadout(idx);
    startLevel(idx);
  },
  resume() { resumeGame(); },
  restart() { INV = cloneInv(INV_START); startLevel(L.idx); },
  title() { showTitle(); },
  style() { toggleStyle(); const b = document.getElementById('tsty'); if (b) b.textContent = `STYLE: ${style.toUpperCase()}`; },
};

function showTitle() {
  state = 'title';
  document.exitPointerLock && document.exitPointerLock();
  if (window.speechSynthesis) speechSynthesis.cancel();
  vctx.setTransform(1, 0, 0, 1, 0, 0);
  vctx.fillStyle = '#000'; vctx.fillRect(0, 0, view.width, view.height);
  const s = readSave();
  const cont = s ? `<button data-act="continueGame" class="big">CONTINUE ${getLevel(s.level).code}</button>` : '';
  showPanel(`
    <h1 class="logo">DUKE <span class="ntnx">NUTANI<span class="x">X</span></span></h1>
    <h2>THE ADMIN IS BACK<br><span class="ok">AND HE HASN'T HAD HIS COFFEE</span></h2>
    <p class="story">A ransomware has seized the datacenter and its corrupted processes have taken
    physical form between the racks. Armed with a <b>cage nut</b> pistol, hard drives and an
    oversized ego, fight through <b>5 episodes and 50 levels</b>, find the secret areas and use
    your keyboard to migrate every ESXi, Proxmox, Vates and Hyper-V rack to <b>Nutanix</b>.</p>
    ${cont}
    <button data-act="newGame" class="${s ? '' : 'big'}">NEW GAME</button>
    <button data-act="select">SELECT LEVEL</button>
    <button data-act="style" id="tsty">STYLE: ${style.toUpperCase()}</button>
    ${CONTROLS}
    <p class="hint">Click inside the game to capture the mouse. Cheats: iddqd, idkfa.</p>
  `);
}

function showSelect() {
  state = 'select';
  const s = readSave();
  const max = s ? s.maxLevel : 0;
  let html = '<h2>SELECT LEVEL</h2>';
  EPISODES.forEach((ep, e) => {
    html += `<h3>EPISODE ${e + 1}: ${ep.name}</h3><div class="grid">`;
    for (let k = 0; k < 10; k++) {
      const i = e * 10 + k;
      const locked = i > max;
      html += `<button ${locked ? 'disabled' : `data-act="play" data-arg="${i}"`} title="${locked ? 'Locked' : LEVEL_NAMES[i]}" class="lvl${k === 9 ? ' boss' : k === 4 ? ' mini' : ''}">${e + 1}-${k + 1}</button>`;
    }
    html += '</div>';
  });
  html += '<p class="hint">Levels unlock as you progress.</p><button data-act="title">BACK</button>';
  showPanel(html);
}

function startLevel(idx) {
  loadLevel(idx);
  INV_START = cloneInv(INV);
  writeSave(idx, INV_START);
  if (!INV.weapons[INV.cur]) INV.cur = 1;
  state = 'briefing';
  drawFrame();
  showPanel(`
    <h2>${L.def.name}<br><span class="ep">EPISODE ${L.def.episode + 1}: ${EPISODES[L.def.episode].name}</span></h2>
    <p class="story">${L.def.intro}</p>
    <p class="story small">Racks to migrate to Nutanix: ${L.totalSpecials} | Secret areas: ${L.totalSecrets}</p>
    <button data-go class="big">ENTER</button>
  `, () => { hidePanel(); state = 'playing'; lockPointer(); quip('start', 0.9, true); });
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  firing = false;
  showPanel(`
    <h2>PAUSE</h2>
    <p class="story">${L.def.name}<br>Enemies ${L.kills}/${L.totalKills} | Items ${L.itemsGot}/${L.totalItems} | Secrets ${L.secrets}/${L.totalSecrets}<br>
    Nutanix migrations ${L.migrated}/${L.totalSpecials} | ${fmtTime(L.time)}</p>
    <button data-act="resume" class="big">RESUME</button>
    <button data-act="restart">RESTART LEVEL</button>
    <button data-act="title">MAIN MENU</button>
    <button id="gfx">GRAPHICS: ${Light.high ? 'HIGH' : 'LOW'}</button>
    <button id="sty">STYLE: ${style.toUpperCase()}</button>
    <label class="sens">Mouse sensitivity <input type="range" min="0.3" max="2.5" step="0.1" value="${sensitivity}" id="sens"></label>
    ${CONTROLS}
  `);
  const gb = document.getElementById('gfx');
  gb.onclick = () => { toggleGraphics(); gb.textContent = `GRAPHICS: ${Light.high ? 'HIGH' : 'LOW'}`; drawFrame(); };
  const sb = document.getElementById('sty');
  sb.onclick = () => { toggleStyle(); sb.textContent = `STYLE: ${style.toUpperCase()}`; drawFrame(); };
  const s = document.getElementById('sens');
  s.oninput = () => { sensitivity = +s.value; try { localStorage.setItem('dukenutanix.sens', s.value); } catch (e) { /* ignored */ } };
}

// RETRO (Doom's 320x200, 256 colors, 35 Hz) or MODERN (finer, smoothed) look.
function setStyle(st, quiet) {
  style = st === 'retro' ? 'retro' : 'modern';
  const hi = style === 'modern';
  if (hi) setRenderScale(MODERN_SCALE);
  else Retro.init();
  useGL = hi && !glDead && GLR.init(document.getElementById('gl'));
  if (useGL) GLR.setWeapons(Assets.weaponsHi, Assets.weapons3D);
  if (GLR.canvas) GLR.canvas.style.display = useGL ? 'block' : 'none';
  view.style.background = useGL ? 'transparent' : '';
  Assets.weapons = hi ? Assets.weaponsHi : Assets.weaponsRetro;
  view.style.imageRendering = hi ? 'auto' : 'pixelated';
  resize();
  try { localStorage.setItem('dukenutanix.style', style); } catch (e) { /* ignored */ }
  if (!quiet && L) msg(hi ? 'Style: MODERN (finer graphics)' : 'Style: RETRO (320x200, 256 colors, 35 fps)');
}
function toggleStyle() { setStyle(style === 'modern' ? 'retro' : 'modern'); }

// HIGH: dynamic lights, bloom and vignette. LOW keeps the baked lighting only.
function toggleGraphics(note) {
  Light.high = !Light.high;
  vignette.hidden = !Light.high;
  try { localStorage.setItem('dukenutanix.gfx', Light.high ? 'high' : 'low'); } catch (e) { /* ignored */ }
  msg(note || (Light.high ? 'Graphics: high' : 'Graphics: low (faster)'));
}

function resumeGame() {
  hidePanel();
  state = 'playing';
  lockPointer();
}

function showDeath() {
  state = 'dead';
  document.exitPointerLock && document.exitPointerLock();
  showPanel(`
    <h1 class="dead">SYSTEM COMPROMISED</h1>
    <p class="story">Kernel panic: the on-call admin is not responding.<br>Enemies ${L.kills}/${L.totalKills} | ${fmtTime(L.time)}</p>
    <button data-act="restart" class="big">RESTORE SNAPSHOT</button>
    <button data-act="title">MAIN MENU</button>
  `);
}

function completeLevel() {
  Sfx.exit();
  quip('exit', 0.7, true);
  state = 'intermission';
  firing = false;
  document.exitPointerLock && document.exitPointerLock();
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : 'N/A';
  const lastLevel = L.idx === LEVEL_COUNT - 1;
  if (!lastLevel) {
    const next = cloneInv(INV);
    next.hp = Math.max(next.hp, 1);
    writeSave(L.idx + 1, next);
  }
  const stats = `
    <table class="stats">
      <tr><td>ENEMIES</td><td>${pct(L.kills, L.totalKills)}</td></tr>
      <tr><td>ITEMS</td><td>${pct(L.itemsGot, L.totalItems)}</td></tr>
      <tr><td>SECRETS</td><td>${pct(L.secrets, L.totalSecrets)}</td></tr>
      <tr><td>NUTANIX MIGRATIONS</td><td>${L.migrated}/${L.totalSpecials}</td></tr>
      <tr><td>TIME</td><td>${fmtTime(L.time)}</td></tr>
    </table>`;
  if (lastLevel) {
    showPanel(`
      <h1 class="logo">REBOOT COMPLETE</h1>
      <h2>THE DATACENTER IS SAVED</h2>
      <p class="story">The ransomware is purged, the racks power back up one by one and the LEDs turn green again.
      It's 6:47 AM. The admin lights an e-cigarette, puts his shades back on and
      leaves the post-mortem to somebody else.</p>
      ${stats}
      <button data-act="title" class="big">MAIN MENU</button>
    `);
    return;
  }
  const epDone = L.idx % 10 === 9;
  showPanel(`
    <h2>${L.def.name}<br><span class="ok">REBOOTED</span></h2>
    ${epDone ? `<p class="story"><b>EPISODE ${L.def.episode + 1} COMPLETE!</b> Next stop: ${EPISODES[L.def.episode + 1].name}.</p>` : ''}
    ${stats}
    <button data-go class="big">NEXT ROOM</button>
  `, () => {
    INV.hp = Math.max(INV.hp, 1);
    startLevel(L.idx + 1);
  });
}

/* ----------------------------------------------------------------- input */

function lockPointer() {
  if (view.requestPointerLock && document.pointerLockElement !== view) {
    try { const p = view.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignored */ }
  }
}

let cheatBuf = '';
function onCheat(k) {
  cheatBuf = (cheatBuf + k.toLowerCase()).slice(-8);
  if (cheatBuf.endsWith('iddqd')) { god = !god; msg(god ? 'ROOT MODE enabled (sudo su)' : 'ROOT MODE disabled'); }
  if (cheatBuf.endsWith('idkfa')) {
    INV.weapons = INV.weapons.map(() => true);
    INV.ammo = { ...AMMO_MAX }; INV.armor = 200;
    L.keys.red = L.keys.blue = true;
    msg('Full arsenal + all badges');
  }
}

window.addEventListener('keydown', (e) => {
  if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (state === 'briefing' && (e.code === 'Enter' || e.code === 'Space')) { panel.querySelector('[data-go]')?.click(); return; }
  if (state === 'intermission' && e.code === 'Enter') { (panel.querySelector('[data-go]') || panel.querySelector('[data-act]'))?.click(); return; }
  if (state === 'paused' && e.code === 'Escape') { resumeGame(); return; }
  if (state !== 'playing') return;
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.key && e.key.length === 1) onCheat(e.key);
  if (P.dead) return;
  if (e.code === 'KeyE' || e.code === 'Space') useAction();
  if (e.code.startsWith('Digit')) { const n = +e.code.slice(5) - 1; if (n >= 0 && n < 8) switchWeapon(n); }
  if (e.code === 'Tab' || e.key === 'm' || e.key === 'M') showMap = !showMap;
  if (e.code === 'Escape' || e.code === 'KeyP') pauseGame();
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') firing = true;
  if (e.key === 'n' || e.key === 'N') msg(Sfx.toggleMute() ? 'Sound off' : 'Sound on');
  if (e.key === 'g' || e.key === 'G') toggleGraphics();
  if (e.key === 't' || e.key === 'T') toggleStyle();
  if (e.key === 'v' || e.key === 'V') {
    voiceOn = !voiceOn;
    if (!voiceOn && window.speechSynthesis) speechSynthesis.cancel();
    try { localStorage.setItem('dukenutanix.voice', voiceOn ? '1' : '0'); } catch (err) { /* ignored */ }
    msg(voiceOn ? "Admin's voice on" : "Admin's voice off (subtitles kept)");
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') firing = false;
});
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; firing = false; pauseGame(); });

view.addEventListener('mousedown', (e) => {
  if (state !== 'playing') return;
  Sfx.init();
  if (document.pointerLockElement !== view) lockPointer();
  if (e.button === 0) firing = true;
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; });
let skipMouse = 0;
window.addEventListener('mousemove', (e) => {
  if (state !== 'playing' || document.pointerLockElement !== view) return;
  // Chrome sometimes sends a huge movementX right after pointer lock
  if (skipMouse > 0) { skipMouse--; return; }
  if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
  mouseDX += e.movementX;
  mouseDY += e.movementY;
});
view.addEventListener('wheel', (e) => {
  if (state !== 'playing') return;
  e.preventDefault();
  const dir = e.deltaY > 0 ? 1 : -1;
  let i = INV.cur;
  for (let k = 0; k < 8; k++) { i = (i + dir + 8) % 8; if (INV.weapons[i]) { switchWeapon(i); break; } }
}, { passive: false });
view.addEventListener('contextmenu', (e) => e.preventDefault());

let hadLock = false;
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === view) { hadLock = true; skipMouse = 2; mouseDX = 0; mouseDY = 0; }
  else if (hadLock && state === 'playing') pauseGame();
});

/* --------------------------------------------------------------- startup */

// Carries over saves and settings stored under the game's former name (DOOOOOM).
function migrateStorage() {
  try {
    for (const k of ['save', 'sens', 'voice']) {
      const old = localStorage.getItem('dooooom.' + k);
      if (old !== null && localStorage.getItem('dukenutanix.' + k) === null) localStorage.setItem('dukenutanix.' + k, old);
      localStorage.removeItem('dooooom.' + k);
    }
  } catch (e) { /* storage unavailable */ }
}

function boot() {
  resize();
  migrateStorage();
  try {
    const s = localStorage.getItem('dukenutanix.sens'); if (s) sensitivity = +s;
    if (localStorage.getItem('dukenutanix.voice') === '0') voiceOn = false;
    if (localStorage.getItem('dukenutanix.gfx') === 'low') { Light.high = false; vignette.hidden = true; }
  } catch (e) { /* ignored */ }
  buildAssets();
  GLR.onLost = () => { glDead = true; setStyle(style, true); };
  Assets.weaponsRetro = WeaponArt.build({ pixel: true, s: 320 / W, sy: 320 / W / 1.2 });
  Assets.weaponsHi = WeaponArt.build({ pixel: false });
  Assets.weapons3D = WeaponArt.build3D();
  let st = 'modern';
  try { st = localStorage.getItem('dukenutanix.style') || 'modern'; } catch (e) { /* ignored */ }
  setStyle(st, true);
  showTitle();
  Update.check();
  requestAnimationFrame(frame);
  // debug hook for automated tests
  window.__duke = { get L() { return L; }, P, get INV() { return INV; }, get state() { return state; }, actions, keys, castRay };
}

if (document.fonts && document.fonts.load) {
  Promise.race([document.fonts.load(`10px ${FONT}`), new Promise((r) => setTimeout(r, 1500))]).then(boot, boot);
} else boot();
