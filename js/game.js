'use strict';
/*
 * DOOOOOM — moteur de raycasting façon Wolfenstein/Doom.
 * Rendu logiciel dans un buffer 480x230 (vue 3D) + HUD en haute résolution.
 */

const W = 480, H = 270, HUD_H = 40, VH = H - HUD_H, HORIZ = VH / 2;
const PLANE = 0.8, PROJ = (W / 2) / PLANE;
const FONT = '"Press Start 2P", monospace';
const WALL_CHARS = '#RSNCWXD12';

/* ------------------------------------------------------------ définitions */

const WEAPONS = [
  { name: 'CLAVIER MÉCA', ammo: null, rate: 0.5, anim: 0.45, dmg: [20, 34], melee: true, range: 1.5 },
  { name: 'PISTOLET PING', ammo: 'bullets', rate: 0.36, anim: 0.3, dmg: [10, 16], pellets: 1, spread: 0.012 },
  { name: 'FUSIL À PAQUETS', ammo: 'shells', rate: 0.9, anim: 0.8, dmg: [7, 12], pellets: 8, spread: 0.085 },
  { name: 'MITRAILLEUSE GIGABIT', ammo: 'bullets', rate: 0.095, anim: 0.09, dmg: [9, 14], pellets: 1, spread: 0.035 },
  { name: 'CANON OVERCLOCK', ammo: 'cells', rate: 0.11, anim: 0.1, dmg: [18, 26], projectile: true },
];
const AMMO_MAX = { bullets: 200, shells: 50, cells: 300 };

const ETYPES = {
  bug: { name: 'Bug', hp: 35, speed: 2.2, radius: 0.3, scale: 0.7, z: 0, melee: true, dmg: [5, 11], atkRange: 1.0, cd: 0.9, sight: 16, pain: 0.7 },
  drone: { name: 'Drone viral', hp: 50, speed: 1.6, radius: 0.3, scale: 0.6, z: 0.35, dmg: [8, 14], atkRange: 11, cd: 1.9, sight: 18, pain: 0.5, shotZ: 0.62 },
  bot: { name: 'Bot BSOD', hp: 85, speed: 1.2, radius: 0.32, scale: 1.0, z: 0, dmg: [5, 9], atkRange: 13, cd: 2.4, sight: 18, pain: 0.35, burst: 3, shotZ: 0.55 },
  boss: { name: 'RANSOMWARE', hp: 1500, speed: 1.0, radius: 0.7, scale: 1.9, z: 0, dmg: [9, 15], atkRange: 18, cd: 1.5, sight: 30, pain: 0.04, shotZ: 0.9 },
};
const ENEMY_CHARS = { b: 'bug', d: 'drone', o: 'bot', Z: 'boss' };
const ITEM_CHARS = '+HAascruFML';
const DECOR_CHARS = 'xe';

/* ---------------------------------------------------------------- canvas */

const view = document.getElementById('view');
const vctx = view.getContext('2d');
const scr = newCanvas(W, VH);
const sctx = scr.getContext('2d');
const img = sctx.createImageData(W, VH);
const buf = new Uint32Array(img.data.buffer);
const zbuf = new Float32Array(W);
let K = 1;

function resize() {
  const ww = window.innerWidth, wh = window.innerHeight;
  let cw = ww, ch = ww * H / W;
  if (ch > wh) { ch = wh; cw = wh * W / H; }
  view.style.width = cw + 'px';
  view.style.height = ch + 'px';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  view.width = Math.round(cw * dpr);
  view.height = Math.round(ch * dpr);
  K = view.width / W;
}
window.addEventListener('resize', resize);

/* ------------------------------------------------------------------ état */

let state = 'loading';
let L = null;            // niveau courant
let INV = null;          // inventaire persistant entre niveaux
let INV_START = null;    // inventaire au début du niveau (pour recommencer)
let god = false;
let animFrame = 0, animClock = 0;
const P = { x: 0, y: 0, a: 0 };

function newInventory() {
  return { hp: 100, armor: 0, ammo: { bullets: 50, shells: 0, cells: 0 }, weapons: [true, true, false, false, false], cur: 1 };
}
const cloneInv = (i) => JSON.parse(JSON.stringify(i));
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));

function loadLevel(idx) {
  const def = LEVELS[idx];
  const rows = def.map, w = rows[0].length, h = rows.length;
  L = {
    idx, def, w, h,
    map: new Uint8Array(w * h), block: new Uint8Array(w * h),
    floor: new Uint8Array(w * h), ceil: new Uint8Array(w * h), variant: new Uint8Array(w * h),
    doors: new Array(w * h).fill(null), doorList: [],
    enemies: [], items: [], decor: [], proj: [], fx: [],
    flow: new Int16Array(w * h), flowT: 0,
    time: 0, kills: 0, totalKills: 0, itemsGot: 0, totalItems: 0,
    msgs: [], titleT: 5, keys: { red: false, blue: false }, bossAlive: false,
  };
  let start = null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = rows[y][x], i = y * w + x;
    L.variant[i] = ((x * 7919 + y * 104729) >>> 3) % 251;
    L.ceil[i] = (x % 3 === 1 && y % 3 === 1) ? 1 : 0;
    if (WALL_CHARS.includes(c)) {
      L.map[i] = c.charCodeAt(0);
      if (c === 'D' || c === '1' || c === '2') {
        const d = { x, y, lock: c === '1' ? 'red' : c === '2' ? 'blue' : null, open: 0, st: 'closed', timer: 0 };
        L.doors[i] = d; L.doorList.push(d);
      }
      continue;
    }
    if (c === 'P') start = { x: x + 0.5, y: y + 0.5 };
    else if (ENEMY_CHARS[c]) { spawnEnemy(ENEMY_CHARS[c], x + 0.5, y + 0.5); }
    else if (ITEM_CHARS.includes(c)) { L.items.push({ x: x + 0.5, y: y + 0.5, type: c, taken: false }); L.totalItems++; }
    else if (DECOR_CHARS.includes(c)) { L.decor.push({ x: x + 0.5, y: y + 0.5, type: c }); if (c === 'x') L.block[i] = 1; }
  }
  // dalles perforées devant les baies (allées froides)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (L.map[y * w + x]) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = String.fromCharCode(L.map[(y + dy) * w + x + dx]);
      if ('RSN'.includes(c) && L.map[(y + dy) * w + x + dx]) L.floor[y * w + x] = 1;
    }
  }
  P.x = start.x; P.y = start.y;
  // orientation vers le couloir le plus long
  let best = 0;
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    castRay(P.x, P.y, Math.cos(a), Math.sin(a));
    if (RH.d > best) { best = RH.d; P.a = a; }
  }
  Object.assign(P, { bobPhase: 0, bobAmt: 0, wAnim: 0, fireCd: 0, raise: 1, flashT: 0, hurtT: 0, pickT: 0, dead: false, deadT: 0, spin: 0, faceMood: '', faceT: 0, look: 0, lookT: 0, hurtDir: 0 });
  computeFlow();
}

function spawnEnemy(type, x, y) {
  const T = ETYPES[type];
  const e = { type, x, y, hp: T.hp, state: 'idle', timer: 0, cd: 0, animT: Math.random(), painT: 0, flash: 0, sees: false, losT: Math.random() * 0.2, alerted: false, strafe: Math.random() < 0.5 ? 1 : -1, shots: 0, shotT: 0, attacks: 0 };
  L.enemies.push(e);
  L.totalKills++;
  if (type === 'boss') L.bossAlive = true;
  return e;
}

/* ------------------------------------------------------------- raycasting */

const RH = { d: 0, side: 0, mx: 0, my: 0, wx: 0, tile: 0 };

// DDA avec portes coulissantes au milieu de la case. Si (rdx, rdy) est
// normalisé, RH.d est la distance euclidienne ; sinon la distance perpendiculaire.
function castRay(px, py, rdx, rdy) {
  const w = L.w, h = L.h, map = L.map;
  let mx = px | 0, my = py | 0;
  const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
  const ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
  let sx, sy, sdx, sdy;
  if (rdx < 0) { sx = -1; sdx = (px - mx) * ddx; } else { sx = 1; sdx = (mx + 1 - px) * ddx; }
  if (rdy < 0) { sy = -1; sdy = (py - my) * ddy; } else { sy = 1; sdy = (my + 1 - py) * ddy; }
  let side = 0;
  for (let i = 0; i < 200; i++) {
    if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; }
    if (mx < 0 || my < 0 || mx >= w || my >= h) break;
    const idx = my * w + mx, t = map[idx];
    if (!t) continue;
    const door = L.doors[idx];
    if (door) {
      let d, f;
      if (side === 0) { d = sdx - ddx * 0.5; f = py + d * rdy; if (Math.floor(f) !== my) continue; f -= my; }
      else { d = sdy - ddy * 0.5; f = px + d * rdx; if (Math.floor(f) !== mx) continue; f -= mx; }
      if (f < door.open) continue;
      RH.d = d; RH.side = side; RH.mx = mx; RH.my = my; RH.wx = f - door.open; RH.tile = t;
      return RH;
    }
    const d = side === 0 ? sdx - ddx : sdy - ddy;
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
    if (e.state === 'dead' || e.state === 'dying') continue;
    const rr = r + ETYPES[e.type].radius;
    const dx = e.x - x, dy = e.y - y;
    if (dx * dx + dy * dy < rr * rr) {
      // autorise à s'éloigner si déjà en contact
      const cur = (e.x - P.x) ** 2 + (e.y - P.y) ** 2;
      if (dx * dx + dy * dy < cur) return true;
    }
  }
  return false;
}

/* ----------------------------------------------------------------- portes */

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
    if (d.st === 'opening') { d.open += dt * 1.8; if (d.open >= 1) { d.open = 1; d.st = 'open'; d.timer = 4; } }
    else if (d.st === 'open') {
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

/* ------------------------------------------------------------------ joueur */

const keys = {};
let mouseDX = 0, firing = false, showMap = false;
let sensitivity = 1;

function useAction() {
  const dx = Math.cos(P.a), dy = Math.sin(P.a);
  for (let s = 0.2; s <= 1.8; s += 0.1) {
    const cx = (P.x + dx * s) | 0, cy = (P.y + dy * s) | 0;
    const i = cy * L.w + cx, t = L.map[i];
    if (!t) continue;
    const d = L.doors[i];
    if (d) {
      if (d.st === 'open' || d.st === 'opening') { if (d.st === 'open') d.timer = 4; return; }
      if (d.lock && !L.keys[d.lock]) {
        Sfx.deny();
        msg(d.lock === 'red' ? 'Accès refusé : BADGE ROUGE requis' : 'Accès refusé : BADGE BLEU requis');
        return;
      }
      openDoor(d);
      return;
    }
    if (String.fromCharCode(t) === 'X') {
      if (L.bossAlive) { Sfx.deny(); msg('Le RANSOMWARE verrouille le système ! Détruisez-le.'); return; }
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

function bestWeapon() {
  const order = [4, 3, 2, 1, 0];
  for (const i of order) {
    const w = WEAPONS[i];
    if (INV.weapons[i] && (!w.ammo || INV.ammo[w.ammo] > 0)) return i;
  }
  return 0;
}

function updatePlayer(dt) {
  if (P.dead) { P.deadT += dt; return; }
  const turn = ((keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0));
  P.a += turn * 2.8 * dt + mouseDX * 0.0022 * sensitivity;
  mouseDX = 0;
  const fwd = ((keys.KeyW || keys.ArrowUp) ? 1 : 0) - ((keys.KeyS || keys.ArrowDown) ? 1 : 0);
  const str = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const dx = Math.cos(P.a), dy = Math.sin(P.a);
  let mx = dx * fwd - dy * str, my = dy * fwd + dx * str;
  const len = Math.hypot(mx, my);
  const run = keys.ShiftLeft || keys.ShiftRight;
  if (len > 0) {
    const sp = (run ? 5.6 : 3.8) * dt / len;
    moveEntity(P, mx * sp, my * sp, 0.28, true);
    P.bobPhase += dt * (run ? 11 : 8);
    P.bobAmt = Math.min(1, P.bobAmt + dt * 4);
  } else P.bobAmt = Math.max(0, P.bobAmt - dt * 4);

  // ramassage
  for (const it of L.items) {
    if (it.taken) continue;
    if ((it.x - P.x) ** 2 + (it.y - P.y) ** 2 < 0.36 && pickup(it)) { it.taken = true; L.itemsGot++; }
  }

  // tir
  P.fireCd -= dt;
  P.raise = Math.max(0, P.raise - dt * 4);
  if (P.wAnim > 0) P.wAnim = Math.max(0, P.wAnim - dt / WEAPONS[INV.cur].anim);
  if (P.flashT > 0) P.flashT -= dt;
  if (firing && INV.cur === 3) P.spin += dt * 40;
  if (firing && P.fireCd <= 0 && P.raise < 0.3) fire();

  // visage
  P.faceT -= dt; if (P.faceT <= 0) P.faceMood = '';
  P.lookT -= dt; if (P.lookT <= 0) { P.look = randi(-1, 1); P.lookT = rand(0.6, 1.8); }
  if (P.hurtT > 0) P.hurtT -= dt;
  if (P.pickT > 0) P.pickT -= dt;
}

function pickup(it) {
  const add = (k, n) => {
    if (INV.ammo[k] >= AMMO_MAX[k]) return false;
    INV.ammo[k] = Math.min(AMMO_MAX[k], INV.ammo[k] + n); return true;
  };
  const giveWeapon = (i, k, n, text) => {
    const isNew = !INV.weapons[i];
    INV.weapons[i] = true;
    add(k, n);
    if (isNew) switchWeapon(i);
    msg(text);
    Sfx.weaponPickup();
    P.faceMood = 'grin'; P.faceT = 1.5;
    return true;
  };
  let ok = true, text = '';
  switch (it.type) {
    case '+': if (INV.hp >= 100) return false; INV.hp = Math.min(100, INV.hp + 10); text = 'Café serré : +10 santé'; break;
    case 'H': if (INV.hp >= 100) return false; INV.hp = Math.min(100, INV.hp + 25); text = 'Kit de secours : +25 santé'; break;
    case 'A': if (INV.armor >= 100) return false; INV.armor = 100; text = 'Firewall activé : armure 100%'; break;
    case 'a': ok = add('bullets', 20); text = 'Paquets de données (+20)'; break;
    case 's': ok = add('shells', 8); text = 'Trames jumbo (+8)'; break;
    case 'c': ok = add('cells', 40); text = "Cellules d'énergie (+40)"; break;
    case 'r': L.keys.red = true; msg("Badge d'accès ROUGE récupéré"); Sfx.key(); P.pickT = 0.3; return true;
    case 'u': L.keys.blue = true; msg("Badge d'accès BLEU récupéré"); Sfx.key(); P.pickT = 0.3; return true;
    case 'F': P.pickT = 0.3; return giveWeapon(2, 'shells', 8, 'FUSIL À PAQUETS récupéré ! [3]');
    case 'M': P.pickT = 0.3; return giveWeapon(3, 'bullets', 40, 'MITRAILLEUSE GIGABIT récupérée ! [4]');
    case 'L': P.pickT = 0.3; return giveWeapon(4, 'cells', 60, 'CANON OVERCLOCK récupéré ! [5]');
  }
  if (!ok) return false;
  msg(text);
  Sfx.pickup();
  P.pickT = 0.25;
  return true;
}

function fire() {
  const w = WEAPONS[INV.cur];
  if (w.ammo && INV.ammo[w.ammo] <= 0) {
    Sfx.click();
    P.fireCd = 0.35;
    const b = bestWeapon();
    if (b !== INV.cur) switchWeapon(b);
    return;
  }
  if (w.ammo) INV.ammo[w.ammo]--;
  P.fireCd = w.rate;
  P.wAnim = 1;
  if (!w.melee) P.flashT = 0.07;

  if (w.melee) {
    Sfx.fist();
    meleeAttack(w);
    return;
  }
  // réveille les ennemis qui entendent le tir
  for (const e of L.enemies) {
    if (e.state !== 'idle') continue;
    const d = Math.hypot(e.x - P.x, e.y - P.y);
    if (d < 7 || (d < 16 && hasLOS(e.x, e.y, P.x, P.y))) e.alerted = true;
  }
  if (w.projectile) {
    Sfx.plasma();
    const dx = Math.cos(P.a), dy = Math.sin(P.a);
    L.proj.push({ x: P.x + dx * 0.3, y: P.y + dy * 0.3, vx: dx * 15, vy: dy * 15, kind: 'plasma', dmg: randi(w.dmg[0], w.dmg[1]), owner: 'player', z: 0.28, life: 3 });
    return;
  }
  if (INV.cur === 1) Sfx.pistol(); else if (INV.cur === 2) Sfx.shotgun(); else Sfx.chaingun();
  for (let i = 0; i < w.pellets; i++) {
    const a = P.a + (Math.random() - 0.5) * 2 * w.spread;
    hitscan(a, randi(w.dmg[0], w.dmg[1]));
  }
}

function hitscan(a, dmg) {
  const dx = Math.cos(a), dy = Math.sin(a);
  castRay(P.x, P.y, dx, dy);
  const wallD = RH.d;
  let best = null, bestD = wallD;
  for (const e of L.enemies) {
    if (e.state === 'dead' || e.state === 'dying') continue;
    const ex = e.x - P.x, ey = e.y - P.y;
    const along = ex * dx + ey * dy;
    if (along <= 0 || along >= bestD) continue;
    const perp = Math.abs(ex * dy - ey * dx);
    if (perp < ETYPES[e.type].radius + 0.05) { best = e; bestD = along; }
  }
  if (best) {
    addFx(P.x + dx * (bestD - 0.2), P.y + dy * (bestD - 0.2), 'spark', 0.35 + ETYPES[best.type].z, 0.25);
    damageEnemy(best, dmg);
  } else if (wallD < 60) {
    addFx(P.x + dx * (wallD - 0.05), P.y + dy * (wallD - 0.05), 'spark', 0.3 + Math.random() * 0.3, 0.2);
  }
}

function meleeAttack(w) {
  const dx = Math.cos(P.a), dy = Math.sin(P.a);
  let best = null, bestD = w.range;
  for (const e of L.enemies) {
    if (e.state === 'dead' || e.state === 'dying') continue;
    const ex = e.x - P.x, ey = e.y - P.y;
    const along = ex * dx + ey * dy;
    if (along <= 0 || along > bestD + ETYPES[e.type].radius) continue;
    if (Math.abs(ex * dy - ey * dx) < ETYPES[e.type].radius + 0.3) { best = e; bestD = along; }
  }
  if (best) { damageEnemy(best, randi(w.dmg[0], w.dmg[1])); Sfx.melee(0); }
}

function damagePlayer(dmg, fromX, fromY) {
  if (P.dead || god) return;
  if (INV.armor > 0) {
    const ab = Math.min(INV.armor, Math.floor(dmg / 3));
    INV.armor -= ab; dmg -= ab;
  }
  INV.hp -= dmg;
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
  } else Sfx.hurt();
}

/* ----------------------------------------------------------------- ennemis */

function damageEnemy(e, dmg) {
  const T = ETYPES[e.type];
  const dist = Math.hypot(e.x - P.x, e.y - P.y);
  e.hp -= dmg;
  e.flash = 0.08;
  e.alerted = true;
  if (e.hp <= 0) {
    e.state = 'dying'; e.timer = 0.5;
    L.kills++;
    Sfx.enemyDeath(e.type, dist);
    addFx(e.x, e.y, 'boom', 0.2 + T.z, e.type === 'boss' ? 1.5 : 0.5);
    if (e.type === 'bot' && Math.random() < 0.7) L.items.push({ x: e.x, y: e.y, type: 'a', taken: false, drop: true });
    if (e.type === 'boss') {
      L.bossAlive = false;
      msg('RANSOMWARE ÉLIMINÉ ! Rebootez le datacenter.');
      for (const o of L.enemies) if (o !== e && o.state !== 'dead' && o.state !== 'dying') damageEnemy(o, 9999);
    }
    return;
  }
  if (e.state === 'idle') { e.state = 'chase'; Sfx.alert(e.type, dist); }
  if (Math.random() < T.pain) { e.painT = 0.22; Sfx.enemyPain(e.type, dist); if (e.state === 'attack' && e.type !== 'boss') e.state = 'chase'; }
}

function passableForEnemy(i) {
  if (L.block[i]) return false;
  if (!L.map[i]) return true;
  const d = L.doors[i];
  return !!d && (!d.lock || d.open > 0.9);
}

function computeFlow() {
  const f = L.flow; f.fill(-1);
  const w = L.w;
  const s = (P.y | 0) * w + (P.x | 0);
  const q = new Int32Array(L.w * L.h);
  let qh = 0, qt = 0;
  f[s] = 0; q[qt++] = s;
  while (qh < qt) {
    const c = q[qh++], cx = c % w, cy = (c / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
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
    L.proj.push({ x: e.x + Math.cos(a) * T.radius, y: e.y + Math.sin(a) * T.radius, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, kind, dmg: randi(T.dmg[0], T.dmg[1]), owner: 'enemy', z: T.shotZ - scale / 2, scale, life: 5 });
  };
  Sfx.enemyShoot(e.type, dist);
  if (e.type === 'boss') {
    for (let k = -2; k <= 2; k++) shoot(ang + k * 0.13, 'boss', 7.5, 0.5);
    e.attacks++;
    if (e.attacks % 4 === 0) spawnMinions(e);
  } else if (e.type === 'drone') shoot(ang + rand(-0.05, 0.05), 'orb', 7, 0.35);
  else shoot(ang + rand(-0.07, 0.07), 'bolt', 12, 0.25);
}

function spawnMinions(boss) {
  const alive = L.enemies.filter((o) => o.type === 'bug' && o.state !== 'dead' && o.state !== 'dying').length;
  if (alive >= 6) return;
  for (let k = 0; k < 2; k++) {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2, r = rand(1.2, 2.5);
      const x = boss.x + Math.cos(a) * r, y = boss.y + Math.sin(a) * r;
      if (!blocked(x, y, 0.3) && hasLOS(boss.x, boss.y, x, y)) {
        const b = spawnEnemy('bug', x, y);
        b.state = 'chase'; b.alerted = true;
        addFx(x, y, 'plasmaHit', 0.2, 0.4);
        break;
      }
    }
  }
  msg('Le RANSOMWARE génère des bugs !');
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
    if (e.sees || e.alerted) { e.state = 'chase'; e.cd = rand(0.3, T.cd); Sfx.alert(e.type, dist); }
    return;
  }
  e.animT += dt;
  if (e.painT > 0) { e.painT -= dt; return; }
  e.cd -= dt;
  if (e.state === 'attack') {
    e.timer -= dt;
    if (e.shots > 0) { e.shotT -= dt; if (e.shotT <= 0) { if (!P.dead) enemyFire(e); e.shots--; e.shotT = 0.17; } }
    if (e.timer <= 0) e.state = 'chase';
    return;
  }
  if (P.dead) return;

  if (e.cd <= 0 && e.sees) {
    if (T.melee) {
      if (dist < T.atkRange + 0.25) {
        e.state = 'attack'; e.timer = 0.45; e.cd = T.cd;
        damagePlayer(randi(T.dmg[0], T.dmg[1]), e.x, e.y);
        Sfx.melee(dist);
        return;
      }
    } else if (dist < T.atkRange) {
      e.state = 'attack';
      e.shots = T.burst || 1;
      e.shotT = 0.2;
      e.timer = 0.25 + e.shots * 0.17;
      e.cd = T.cd * rand(0.7, 1.4);
      return;
    }
  }

  // déplacement
  let tx, ty;
  const keep = T.melee ? 0 : (e.type === 'boss' ? 3.5 : 3);
  if (e.sees) {
    if (dist > keep) { tx = P.x; ty = P.y; }
    else { tx = e.x - (dy / dist) * e.strafe; ty = e.y + (dx / dist) * e.strafe; }
  } else {
    const t = flowTarget(e);
    if (!t) return;
    tx = t.x; ty = t.y;
  }
  const mdx = tx - e.x, mdy = ty - e.y, md = Math.hypot(mdx, mdy);
  if (md < 0.01) return;
  const sp = T.speed * dt;
  const ox = e.x, oy = e.y;
  moveEntity(e, mdx / md * sp, mdy / md * sp, T.radius, false);
  // pas de chevauchement avec le joueur
  const pr = T.radius + 0.28;
  if ((e.x - P.x) ** 2 + (e.y - P.y) ** 2 < pr * pr) { e.x = ox; e.y = oy; }
  if (Math.abs(e.x - ox) + Math.abs(e.y - oy) < sp * 0.3) e.strafe = -e.strafe;
  if (Math.random() < dt * 0.3) e.strafe = -e.strafe;
}

function separateEnemies() {
  const list = L.enemies;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.state === 'dead' || a.state === 'dying') continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.state === 'dead' || b.state === 'dying') continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
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

function addFx(x, y, kind, z, dur) {
  L.fx.push({ x, y, kind, z, t: 0, dur, scale: kind === 'boom' ? 0.8 : 0.35 });
}

function projHitsWall(x, y) {
  const cx = x | 0, cy = y | 0;
  if (cx < 0 || cy < 0 || cx >= L.w || cy >= L.h) return true;
  const i = cy * L.w + cx;
  if (!L.map[i]) return false;
  const d = L.doors[i];
  return !d || d.open < 0.9;
}

function updateProjectiles(dt) {
  for (const p of L.proj) {
    if (p.dead) continue;
    p.life -= dt;
    if (p.life <= 0) { p.dead = true; continue; }
    const steps = Math.ceil(Math.hypot(p.vx, p.vy) * dt / 0.1);
    for (let s = 0; s < steps && !p.dead; s++) {
      p.x += p.vx * dt / steps; p.y += p.vy * dt / steps;
      if (projHitsWall(p.x, p.y)) {
        p.dead = true;
        addFx(p.x - p.vx * 0.01, p.y - p.vy * 0.01, p.kind === 'plasma' ? 'plasmaHit' : 'boom', p.z, 0.25);
        break;
      }
      if (p.owner === 'enemy') {
        if (!P.dead && (p.x - P.x) ** 2 + (p.y - P.y) ** 2 < 0.35 * 0.35) {
          p.dead = true;
          damagePlayer(p.dmg, p.x - p.vx, p.y - p.vy);
          addFx(p.x, p.y, 'boom', p.z, 0.2);
        }
      } else {
        for (const e of L.enemies) {
          if (e.state === 'dead' || e.state === 'dying') continue;
          const r = ETYPES[e.type].radius + 0.12;
          if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 < r * r) {
            p.dead = true;
            damageEnemy(e, p.dmg);
            addFx(p.x, p.y, 'plasmaHit', p.z, 0.25);
            break;
          }
        }
      }
    }
  }
  L.proj = L.proj.filter((p) => !p.dead);
  for (const f of L.fx) f.t += dt;
  L.fx = L.fx.filter((f) => f.t < f.dur);
}

/* ------------------------------------------------------------------ rendu */

function shade(c, s) {
  return 0xff000000 | ((((c >> 16) & 255) * s >> 8) << 16) | ((((c >> 8) & 255) * s >> 8) << 8) | ((c & 255) * s >> 8);
}

function lightAt(d) {
  const amb = L.def.ambient + (P.flashT > 0 ? 0.35 : 0);
  let s = 256 * amb / (1 + d * 0.1 + d * d * 0.012);
  return s > 256 ? 256 : s | 0;
}

function render() {
  const dirX = Math.cos(P.a), dirY = Math.sin(P.a);
  const plX = -dirY * PLANE, plY = dirX * PLANE;
  const w = L.w, h = L.h;
  const floorT = Assets.floor, ceilT = Assets.ceil;

  // sol et plafond
  const rdx0 = dirX - plX, rdy0 = dirY - plY, rdx1 = dirX + plX, rdy1 = dirY + plY;
  for (let y = HORIZ; y < VH; y++) {
    const p = y - HORIZ + 0.5;
    const rowD = 0.5 * PROJ / p;
    const s = lightAt(rowD);
    const stx = rowD * (rdx1 - rdx0) / W, sty = rowD * (rdy1 - rdy0) / W;
    let fx = P.x + rowD * rdx0, fy = P.y + rowD * rdy0;
    const fo = y * W, co = (VH - 1 - y) * W;
    for (let x = 0; x < W; x++, fx += stx, fy += sty) {
      if (fx < 0 || fy < 0 || fx >= w || fy >= h) { buf[fo + x] = 0xff000000; buf[co + x] = 0xff000000; continue; }
      const cx = fx | 0, cy = fy | 0, ci = cy * w + cx;
      const ti = ((((fy - cy) * 64) | 0) << 6) | (((fx - cx) * 64) | 0);
      const ft = floorT[L.floor[ci]];
      buf[fo + x] = shade(ft.px[ti], s);
      const ct = ceilT[L.ceil[ci]];
      buf[co + x] = ct.em[ti] ? ct.px[ti] : shade(ct.px[ti], s);
    }
  }

  // murs
  for (let x = 0; x < W; x++) {
    const cam = 2 * x / W - 1;
    const rdx = dirX + plX * cam, rdy = dirY + plY * cam;
    castRay(P.x, P.y, rdx, rdy);
    const d = Math.max(RH.d, 0.02);
    zbuf[x] = d;
    if (!RH.tile) continue;
    const lh = PROJ / d;
    const top = HORIZ - lh / 2;
    const y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(VH - 1, Math.floor(HORIZ + lh / 2));
    const vi = RH.my * w + RH.mx;
    const vars = Assets.walls[String.fromCharCode(RH.tile)];
    const frames = vars[L.variant[vi] % vars.length];
    const tex = frames[(animFrame + L.variant[vi]) % frames.length];
    let tx = (RH.wx * 64) | 0;
    if ((RH.side === 0 && rdx > 0) || (RH.side === 1 && rdy < 0)) tx = 63 - tx;
    let s = lightAt(d);
    if (RH.side === 1) s = (s * 0.78) | 0;
    const step = 64 / lh;
    let tp = (y0 - top) * step;
    const px = tex.px, em = tex.em;
    for (let y = y0; y <= y1; y++, tp += step) {
      const ti = ((tp | 0) & 63) << 6 | tx;
      buf[y * W + x] = em[ti] ? px[ti] : shade(px[ti], s);
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
    list.push({ spr, scale, z, flash, bright, tx, ty });
  };
  for (const d of L.decor) add(d.x, d.y, Assets.items[d.type], d.type === 'x' ? 0.9 : 0.6, 0);
  const bobT = performance.now() / 400;
  for (const it of L.items) {
    if (it.taken) continue;
    const floaty = 'ruFML'.includes(it.type);
    add(it.x, it.y, Assets.items[it.type], 0.5, floaty ? 0.05 + Math.sin(bobT + it.x) * 0.03 : 0, 0, it.type === 'r' || it.type === 'u');
  }
  for (const e of L.enemies) {
    const T = ETYPES[e.type], S = Assets.enemies[e.type];
    let spr;
    if (e.state === 'dead') spr = S.dead;
    else if (e.state === 'dying') spr = S.die[e.timer > 0.25 ? 0 : 1];
    else if (e.state === 'attack') spr = S.atk;
    else if (e.state === 'idle') spr = S.walk[0];
    else spr = S.walk[((e.animT * (e.type === 'drone' ? 6 : 4)) | 0) % 2];
    let z = T.z;
    if (e.type === 'drone' && e.state !== 'dead') z += Math.sin(e.animT * 3 + e.x) * 0.05;
    if (e.state === 'dead') z = 0;
    add(e.x, e.y, spr, e.state === 'dead' ? Math.max(0.8, T.scale * 0.7) : T.scale, z, e.flash > 0);
  }
  for (const p of L.proj) add(p.x, p.y, Assets.proj[p.kind], p.scale || 0.35, p.z, false, true);
  for (const f of L.fx) {
    const fr = Assets.fx[f.kind];
    add(f.x, f.y, fr[f.t < f.dur / 2 ? 0 : 1], f.scale, f.z - f.scale / 2, false, true);
  }
  list.sort((a, b) => b.ty - a.ty);
  for (const s of list) drawSprite(s);

  // effet de glitch quand on est touché
  if (P.hurtT > 0.15) {
    for (let k = 0; k < 6; k++) {
      const y = randi(0, VH - 4), hgt = randi(1, 4), off = randi(-12, 12);
      for (let yy = y; yy < y + hgt; yy++) {
        const row = buf.subarray(yy * W, yy * W + W);
        row.copyWithin(off > 0 ? off : 0, off > 0 ? 0 : -off);
      }
    }
  }
  sctx.putImageData(img, 0, 0);
  drawWeapon(sctx);
  // viseur
  sctx.fillStyle = 'rgba(120,255,140,0.8)';
  sctx.fillRect(W / 2 - 4, HORIZ, 3, 1); sctx.fillRect(W / 2 + 2, HORIZ, 3, 1);
  sctx.fillRect(W / 2, HORIZ - 4, 1, 3); sctx.fillRect(W / 2, HORIZ + 2, 1, 3);
}

function drawSprite(s) {
  const spr = s.spr, sw = spr.w, sh = spr.h, px = spr.px;
  const size = s.scale * PROJ / s.ty;
  const cx = (W / 2) * (1 + s.tx / s.ty);
  const bottom = HORIZ + (0.5 - s.z) * PROJ / s.ty;
  const top = bottom - size, left = cx - size / 2;
  const x0 = Math.max(0, Math.ceil(left)), x1 = Math.min(W - 1, Math.floor(left + size));
  const y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(VH - 1, Math.floor(bottom));
  if (x0 > x1 || y0 > y1) return;
  const lt = s.bright ? 256 : lightAt(s.ty);
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
      buf[y * W + x] = s.flash ? (c | 0xff808080) : shade(c, lt);
    }
  }
}

/* ----------------------------------------------------------------- armes */

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

function drawHand(g, x, y, s = 1) {
  g.fillStyle = '#1f3a5f'; g.fillRect(x - 16 * s, y, 40 * s, 60);
  ell(g, x, y, 18 * s, 13 * s, '#d9a47a');
  g.fillStyle = '#c08a62'; g.fillRect(x - 12 * s, y - 2, 24 * s, 2);
}

function drawWeapon(g) {
  if (P.dead) return;
  const t = P.wAnim;
  const bx = Math.cos(P.bobPhase) * 8 * P.bobAmt;
  const by = Math.abs(Math.sin(P.bobPhase)) * 6 * P.bobAmt + P.raise * 90;
  const cx = W / 2 + bx, base = VH + by;
  const flash = P.flashT > 0;
  g.save();
  switch (INV.cur) {
    case 0: {
      const s = t > 0 ? Math.sin(t * Math.PI) : 0;
      g.translate(cx + 80 - s * 100, base - 30 - s * 45);
      g.rotate(-0.35 + s * 0.8);
      g.fillStyle = '#15171b'; g.fillRect(-72, -18, 144, 36);
      g.fillStyle = '#2c3038'; g.fillRect(-70, -16, 140, 32);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 15; k++) {
        g.fillStyle = (k + r * 3) % 11 === 0 ? '#e8741a' : '#d9dde2';
        g.fillRect(-66 + k * 8.8 + (r % 2) * 2, -14 + r * 7, 7, 5);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-66 + k * 8.8 + (r % 2) * 2, -10 + r * 7, 7, 1);
      }
      g.fillStyle = `hsl(${(performance.now() / 8) % 360},100%,60%)`; g.fillRect(-70, 14, 140, 2);
      g.fillStyle = '#1f3a5f'; g.fillRect(34, 16, 40, 60);
      ell(g, 44, 14, 20, 13, '#d9a47a');
      break;
    }
    case 1: {
      g.translate(cx, base + t * 16);
      drawHand(g, 0, -28);
      g.fillStyle = '#2b2f35'; g.fillRect(-10, -96, 20, 68);
      g.fillStyle = '#4a515a'; g.fillRect(-10, -96, 20, 34);
      g.fillStyle = '#5d656f'; g.fillRect(-10, -96, 3, 34);
      g.fillStyle = '#111'; g.fillRect(-4, -97, 8, 4); g.fillRect(-2, -101, 4, 4);
      g.fillStyle = '#3dff6a'; g.fillRect(-7, -70, 3, 3);
      if (flash) drawFlash(g, 0, -108, 24, '#fff6b0', '#ff9a1a');
      break;
    }
    case 2: {
      const k = t > 0.5 ? (1 - t) * 2 : t * 2;
      g.translate(cx, base + t * 20);
      drawHand(g, -30, -30 + k * 10, 0.9);
      drawHand(g, 30, -20);
      g.fillStyle = '#6b4a2a'; g.fillRect(-26, -64, 52, 64);
      g.fillStyle = '#7d5a35'; g.fillRect(-26, -64, 52, 5);
      g.fillStyle = '#3a3f46'; g.fillRect(-22, -122, 20, 64); g.fillRect(2, -122, 20, 64);
      g.fillStyle = '#5d656f'; g.fillRect(-22, -122, 5, 64); g.fillRect(2, -122, 5, 64);
      ell(g, -12, -122, 8, 5, '#0a0a0a'); ell(g, 12, -122, 8, 5, '#0a0a0a');
      g.fillStyle = '#6b4a2a'; g.fillRect(-24, -88 + k * 16, 48, 14);
      if (flash) drawFlash(g, 0, -134, 40, '#fff6b0', '#ff7a1a');
      break;
    }
    case 3: {
      g.translate(cx, base + t * 6);
      drawHand(g, -34, -24);
      g.fillStyle = '#3a3f46'; g.fillRect(-34, -72, 68, 72);
      g.fillStyle = '#50565e'; g.fillRect(-34, -72, 68, 6);
      g.fillStyle = '#e8c21a'; g.fillRect(20, -50, 12, 30);
      const bars = [];
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + P.spin; bars.push({ x: Math.cos(a) * 14, d: Math.sin(a) }); }
      bars.sort((a, b) => a.d - b.d);
      for (const b of bars) {
        const l = 70 + b.d * 30 | 0;
        g.fillStyle = `rgb(${l},${l + 6},${l + 14})`;
        g.fillRect(b.x - 4, -132, 8, 62);
      }
      g.fillStyle = '#2b2f35'; g.fillRect(-22, -110, 44, 6); g.fillRect(-22, -80, 44, 6);
      if (flash) drawFlash(g, randi(-8, 8), -140, 30, '#fff6b0', '#ff9a1a');
      break;
    }
    case 4: {
      g.translate(cx, base + t * 8);
      drawHand(g, -38, -22);
      drawHand(g, 38, -22);
      g.fillStyle = '#23272d'; g.fillRect(-40, -84, 80, 84);
      g.fillStyle = '#353b43'; g.fillRect(-40, -84, 80, 6);
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 90);
      for (let i = 0; i < 4; i++) {
        g.fillStyle = `rgba(60,200,255,${0.4 + pulse * 0.6})`;
        g.fillRect(-30, -74 + i * 16, 60, 6);
        g.fillStyle = '#bff'; g.fillRect(-30, -74 + i * 16, 60, 1);
      }
      g.fillStyle = '#15171b'; g.fillRect(-14, -110, 28, 28);
      ell(g, 0, -110, 12, 7, flash ? '#fff' : '#1a7de1');
      if (flash) drawFlash(g, 0, -118, 30, '#ffffff', '#3cf');
      break;
    }
  }
  g.restore();
}

/* ------------------------------------------------------------------- HUD */

function drawFace(g, cx, cy) {
  const hp = INV.hp;
  const mood = P.dead ? 'dead' : P.faceMood;
  ell(g, cx, cy + 2, 13, 15, hp > 60 ? '#e0b48a' : hp > 30 ? '#d8a27a' : '#c98f6a');
  g.fillStyle = '#3b2716';
  g.beginPath(); g.ellipse(cx, cy - 9, 14, 8, 0, Math.PI, 0); g.fill();
  g.fillRect(cx - 14, cy - 9, 4, 8); g.fillRect(cx + 10, cy - 9, 4, 8);
  // casque audio
  g.strokeStyle = '#222'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy - 2, 16, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
  g.fillStyle = '#333'; g.fillRect(cx - 18, cy - 4, 5, 10); g.fillRect(cx + 13, cy - 4, 5, 10);
  g.strokeStyle = '#333'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - 16, cy + 5); g.quadraticCurveTo(cx - 12, cy + 16, cx - 4, cy + 13); g.stroke();
  // lunettes & yeux
  const lk = P.look * 1.5;
  g.fillStyle = god ? '#ffd700' : '#9ef';
  g.fillRect(cx - 10, cy - 3, 8, 6); g.fillRect(cx + 2, cy - 3, 8, 6);
  g.fillStyle = '#000';
  if (mood === 'dead') {
    g.font = '6px monospace'; g.fillText('x', cx - 8, cy + 2); g.fillText('x', cx + 4, cy + 2);
  } else {
    g.fillRect(cx - 7 + lk, cy - 1, 2, 2); g.fillRect(cx + 5 + lk, cy - 1, 2, 2);
  }
  g.strokeStyle = '#111'; g.lineWidth = 1; g.strokeRect(cx - 10, cy - 3, 8, 6); g.strokeRect(cx + 2, cy - 3, 8, 6);
  g.beginPath(); g.moveTo(cx - 2, cy - 1); g.lineTo(cx + 2, cy - 1); g.stroke();
  // bouche
  g.fillStyle = '#5a1a1a';
  if (mood === 'ouch' || mood === 'dead') ell(g, cx, cy + 9, 3, 3, '#5a1a1a');
  else if (mood === 'grin' || god) { g.beginPath(); g.arc(cx, cy + 6, 5, 0.2, Math.PI - 0.2); g.fill(); }
  else if (hp < 40) g.fillRect(cx - 4, cy + 9, 8, 1);
  else g.fillRect(cx - 4, cy + 8, 8, 2);
  // blessures
  if (hp < 60) { g.fillStyle = '#b01515'; g.fillRect(cx + 7, cy - 8, 2, 6); }
  if (hp < 30) { g.fillRect(cx - 9, cy + 4, 2, 8); g.fillRect(cx + 3, cy + 10, 5, 2); }
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
  big(w.ammo ? String(INV.ammo[w.ammo]) : '--', 36, '#ff4d2e'); label('MUNITIONS', 36);
  big(INV.hp + '%', 107, INV.hp > 30 ? '#ff4d2e' : '#ff1a1a'); label('SANTÉ', 107);
  // armes
  g.font = `7px ${FONT}`; g.textAlign = 'center';
  for (let i = 0; i < 5; i++) {
    const x = 156 + (i % 3) * 22, yy = y + 12 + ((i / 3) | 0) * 11;
    g.fillStyle = i === INV.cur ? '#ffe14a' : INV.weapons[i] ? '#d8dde3' : '#3a3f46';
    g.fillText(String(i + 1), x, yy + 4);
  }
  label('ARMES', 178);
  g.fillStyle = '#0e1013'; g.fillRect(216, y + 3, 50, HUD_H - 4);
  if (P.hurtT > 0) { g.fillStyle = 'rgba(255,0,0,0.25)'; g.fillRect(216, y + 3, 50, HUD_H - 4); }
  drawFace(g, 241, y + 20);
  big(INV.armor + '%', 301, '#4fb4ff'); label('ARMURE', 301);
  // badges
  const badge = (on, col, yy) => { g.fillStyle = on ? col : '#2a2e34'; g.fillRect(347, y + yy, 14, 9); g.fillStyle = on ? '#eee' : '#1c1f24'; g.fillRect(349, y + yy + 5, 10, 2); };
  badge(L.keys.red, '#d42020', 7); badge(L.keys.blue, '#1f58d6', 20);
  // munitions détaillées
  g.font = `5px ${FONT}`; g.textAlign = 'left';
  const rows = [['PKT', 'bullets'], ['TRM', 'shells'], ['NRJ', 'cells']];
  rows.forEach(([n, k], i) => {
    const yy = y + 12 + i * 10;
    g.fillStyle = '#9aa3ad'; g.fillText(n, 380, yy);
    g.fillStyle = w.ammo === k ? '#ffe14a' : '#e8c21a';
    g.textAlign = 'right'; g.fillText(`${INV.ammo[k]}/${AMMO_MAX[k]}`, 472, yy); g.textAlign = 'left';
  });
}

function drawOverlayText(g) {
  // messages
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
    g.globalAlpha = 1;
  }
  // nom de l'arme
  g.font = `5px ${FONT}`; g.textAlign = 'right';
  g.fillStyle = 'rgba(220,230,240,0.8)'; g.fillText(WEAPONS[INV.cur].name, W - 6, VH - 6);
  if (god) { g.fillStyle = '#ffd700'; g.fillText('MODE ROOT', W - 6, 12); }
  // boss
  const boss = L.enemies.find((e) => e.type === 'boss' && e.state !== 'dead' && e.state !== 'dying' && e.state !== 'idle');
  if (boss) {
    const f = Math.max(0, boss.hp / ETYPES.boss.hp);
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(W / 2 - 101, 21, 202, 10);
    g.fillStyle = '#7a0f0f'; g.fillRect(W / 2 - 100, 22, 200, 8);
    g.fillStyle = '#ff2a2a'; g.fillRect(W / 2 - 100, 22, 200 * f, 8);
    g.font = `5px ${FONT}`; g.textAlign = 'center'; g.fillStyle = '#fff';
    g.fillText('RANSOMWARE — CHIFFREMENT EN COURS', W / 2, 18);
  }
}

function drawMap(g) {
  const cs = Math.min((W - 40) / L.w, (VH - 30) / L.h);
  const ox = (W - cs * L.w) / 2, oy = (VH - cs * L.h) / 2;
  g.fillStyle = 'rgba(0,8,4,0.82)'; g.fillRect(0, 0, W, VH);
  const col = { '#': '#6b7178', R: '#2e8b3d', S: '#2e6da6', N: '#8a6d1f', C: '#b8bcc0', W: '#c2a020', X: '#3dff6a', D: '#9aa3ad', '1': '#d42020', '2': '#1f58d6' };
  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
    const t = L.map[y * L.w + x];
    if (!t) continue;
    g.fillStyle = col[String.fromCharCode(t)] || '#666';
    g.fillRect(ox + x * cs, oy + y * cs, cs - 0.5, cs - 0.5);
  }
  for (const it of L.items) if (!it.taken) { g.fillStyle = '#ffe14a'; g.fillRect(ox + it.x * cs - 1, oy + it.y * cs - 1, 2, 2); }
  for (const e of L.enemies) if (e.state !== 'dead' && e.state !== 'dying') { g.fillStyle = '#ff3b3b'; g.fillRect(ox + e.x * cs - 1.5, oy + e.y * cs - 1.5, 3, 3); }
  const px = ox + P.x * cs, py = oy + P.y * cs;
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(px + Math.cos(P.a) * 5, py + Math.sin(P.a) * 5);
  g.lineTo(px + Math.cos(P.a + 2.5) * 4, py + Math.sin(P.a + 2.5) * 4);
  g.lineTo(px + Math.cos(P.a - 2.5) * 4, py + Math.sin(P.a - 2.5) * 4);
  g.fill();
  g.font = `6px ${FONT}`; g.textAlign = 'center'; g.fillStyle = '#3dff6a';
  g.fillText('PLAN DU DATACENTER — ' + L.def.name, W / 2, 12);
}

function present() {
  vctx.setTransform(1, 0, 0, 1, 0, 0);
  vctx.imageSmoothingEnabled = false;
  vctx.drawImage(scr, 0, 0, W * K, VH * K);
  vctx.setTransform(K, 0, 0, K, 0, 0);
  const g = vctx;
  if (showMap) drawMap(g);
  // voiles de couleur
  if (P.hurtT > 0) { g.fillStyle = `rgba(255,0,0,${P.hurtT * 0.8})`; g.fillRect(0, 0, W, VH); }
  if (P.pickT > 0) { g.fillStyle = `rgba(255,230,80,${P.pickT * 0.5})`; g.fillRect(0, 0, W, VH); }
  if (P.dead) { g.fillStyle = `rgba(120,0,0,${Math.min(0.6, P.deadT * 0.4)})`; g.fillRect(0, 0, W, VH); }
  if (P.hurtT > 0 && P.hurtDir) {
    // indicateur de direction des dégâts
    g.save(); g.translate(W / 2, HORIZ); g.rotate(P.hurtDir);
    g.fillStyle = `rgba(255,40,40,${P.hurtT * 2})`;
    g.beginPath(); g.moveTo(60, -10); g.lineTo(74, 0); g.lineTo(60, 10); g.fill();
    g.restore();
  }
  drawOverlayText(g);
  drawHud(g);
}

/* ------------------------------------------------------------- déroulé */

function updateMsgs(dt) {
  for (const m of L.msgs) m.t -= dt;
  L.msgs = L.msgs.filter((m) => m.t > 0);
  if (L.titleT > 0) L.titleT -= dt;
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
  updateMsgs(dt);
  if (P.dead && P.deadT > 1.6 && state === 'playing') showDeath();
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0);
  last = ts;
  if (state === 'playing' || state === 'dying') update(dt);
  if (L && state !== 'title' && state !== 'loading') { render(); present(); }
  requestAnimationFrame(frame);
}

/* --------------------------------------------------------------- écrans */

const overlay = document.getElementById('overlay');
const panel = document.getElementById('panel');

function showPanel(html, onGo) {
  panel.innerHTML = html;
  overlay.classList.remove('hidden');
  const btn = panel.querySelector('[data-go]');
  if (btn) btn.onclick = (e) => { e.stopPropagation(); onGo(); };
  panel.querySelectorAll('[data-act]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); actions[b.dataset.act](); }; });
}

function hidePanel() { overlay.classList.add('hidden'); }

const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const CONTROLS = `
  <table class="ctl">
    <tr><td>ZQSD / WASD / ↑↓</td><td>Se déplacer</td></tr>
    <tr><td>Souris / ← →</td><td>Tourner</td></tr>
    <tr><td>Clic / Ctrl</td><td>Tirer</td></tr>
    <tr><td>E / Espace</td><td>Ouvrir / utiliser</td></tr>
    <tr><td>1-5 / molette</td><td>Changer d'arme</td></tr>
    <tr><td>Maj</td><td>Courir</td></tr>
    <tr><td>Tab / M</td><td>Plan du datacenter</td></tr>
    <tr><td>Échap</td><td>Pause</td></tr>
    <tr><td>N</td><td>Couper le son</td></tr>
  </table>`;

const actions = {
  newGame() { Sfx.init(); INV = newInventory(); startLevel(0); },
  resume() { resumeGame(); },
  restart() { INV = cloneInv(INV_START); startLevel(L.idx); },
  title() { showTitle(); },
};

function showTitle() {
  state = 'title';
  document.exitPointerLock && document.exitPointerLock();
  vctx.setTransform(1, 0, 0, 1, 0, 0);
  vctx.fillStyle = '#000'; vctx.fillRect(0, 0, view.width, view.height);
  showPanel(`
    <h1 class="logo">DOOOOOM</h1>
    <h2>L'ENFER DU DATACENTER</h2>
    <p class="story">Vous êtes l'ingénieur d'astreinte. Un ransomware s'est emparé du datacenter
    et ses processus corrompus ont pris forme physique entre les baies.
    Traversez les salles serveurs, récupérez les badges d'accès et atteignez
    les terminaux de <b>REBOOT</b>.</p>
    <button data-act="newGame" class="big">NOUVELLE PARTIE</button>
    ${CONTROLS}
    <p class="hint">Cliquez dans le jeu pour capturer la souris.</p>
  `);
}

function startLevel(idx) {
  loadLevel(idx);
  INV_START = cloneInv(INV);
  INV.cur = INV.weapons[INV.cur] ? INV.cur : 1;
  state = 'briefing';
  render(); present();
  showPanel(`
    <h2>${L.def.name}</h2>
    <p class="story">${L.def.intro}</p>
    <button data-go class="big">ENTRER</button>
  `, () => { hidePanel(); state = 'playing'; lockPointer(); });
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  firing = false;
  showPanel(`
    <h2>PAUSE</h2>
    <p class="story">${L.def.name}<br>Ennemis ${L.kills}/${L.totalKills} — Objets ${L.itemsGot}/${L.totalItems} — ${fmtTime(L.time)}</p>
    <button data-act="resume" class="big">REPRENDRE</button>
    <button data-act="restart">RECOMMENCER LE NIVEAU</button>
    <button data-act="title">MENU PRINCIPAL</button>
    <label class="sens">Sensibilité souris <input type="range" min="0.3" max="2.5" step="0.1" value="${sensitivity}" id="sens"></label>
    ${CONTROLS}
  `);
  const s = document.getElementById('sens');
  s.oninput = () => { sensitivity = +s.value; try { localStorage.setItem('dooooom.sens', s.value); } catch (e) { /* ignoré */ } };
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
    <h1 class="dead">SYSTÈME COMPROMIS</h1>
    <p class="story">Kernel panic : l'ingénieur d'astreinte ne répond plus.<br>Ennemis ${L.kills}/${L.totalKills} — ${fmtTime(L.time)}</p>
    <button data-act="restart" class="big">RESTAURER LE SNAPSHOT</button>
    <button data-act="title">MENU PRINCIPAL</button>
  `);
}

function completeLevel() {
  Sfx.exit();
  state = 'intermission';
  firing = false;
  document.exitPointerLock && document.exitPointerLock();
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '100%';
  const lastLevel = L.idx === LEVELS.length - 1;
  const stats = `
    <table class="stats">
      <tr><td>ENNEMIS</td><td>${pct(L.kills, L.totalKills)}</td></tr>
      <tr><td>OBJETS</td><td>${pct(L.itemsGot, L.totalItems)}</td></tr>
      <tr><td>TEMPS</td><td>${fmtTime(L.time)}</td></tr>
    </table>`;
  if (lastLevel) {
    showPanel(`
      <h1 class="logo">REBOOT RÉUSSI</h1>
      <h2>LE DATACENTER EST SAUVÉ</h2>
      <p class="story">Le ransomware est purgé, les baies redémarrent une à une.
      Les LEDs repassent au vert. Il est 6h47. Quelqu'un devra quand même
      écrire le post-mortem...</p>
      ${stats}
      <button data-act="title" class="big">MENU PRINCIPAL</button>
    `);
    return;
  }
  showPanel(`
    <h2>${L.def.name}<br><span class="ok">— REBOOTÉ —</span></h2>
    ${stats}
    <button data-go class="big">SALLE SUIVANTE</button>
  `, () => {
    INV.hp = Math.max(INV.hp, 1);
    startLevel(L.idx + 1);
  });
}

/* ---------------------------------------------------------------- entrées */

function lockPointer() {
  if (view.requestPointerLock && document.pointerLockElement !== view) {
    try { const p = view.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignoré */ }
  }
}

let cheatBuf = '';
function onCheat(k) {
  cheatBuf = (cheatBuf + k.toLowerCase()).slice(-8);
  if (cheatBuf.endsWith('iddqd')) { god = !god; msg(god ? 'MODE ROOT activé (sudo su)' : 'MODE ROOT désactivé'); }
  if (cheatBuf.endsWith('idkfa')) {
    INV.weapons = [true, true, true, true, true];
    INV.ammo = { ...AMMO_MAX }; INV.armor = 200;
    L.keys.red = L.keys.blue = true;
    msg('Arsenal complet + tous les badges');
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
  if (e.code.startsWith('Digit')) { const n = +e.code.slice(5) - 1; if (n >= 0 && n < 5) switchWeapon(n); }
  if (e.code === 'Tab' || e.key === 'm' || e.key === 'M') showMap = !showMap;
  if (e.code === 'Escape' || e.code === 'KeyP') pauseGame();
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') firing = true;
  if (e.key === 'n' || e.key === 'N') msg(Sfx.toggleMute() ? 'Son coupé' : 'Son activé');
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
  // Chrome envoie parfois un énorme movementX juste après la capture du pointeur
  if (skipMouse > 0) { skipMouse--; return; }
  if (Math.abs(e.movementX) > 250) return;
  mouseDX += e.movementX;
});
view.addEventListener('wheel', (e) => {
  if (state !== 'playing') return;
  e.preventDefault();
  const dir = e.deltaY > 0 ? 1 : -1;
  let i = INV.cur;
  for (let k = 0; k < 5; k++) { i = (i + dir + 5) % 5; if (INV.weapons[i]) { switchWeapon(i); break; } }
}, { passive: false });
view.addEventListener('contextmenu', (e) => e.preventDefault());

let hadLock = false;
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === view) { hadLock = true; skipMouse = 2; mouseDX = 0; }
  else if (hadLock && state === 'playing') pauseGame();
});

/* ------------------------------------------------------------ démarrage */

function boot() {
  resize();
  try { const s = localStorage.getItem('dooooom.sens'); if (s) sensitivity = +s; } catch (e) { /* ignoré */ }
  buildAssets();
  showTitle();
  requestAnimationFrame(frame);
  // accès de débogage pour les tests automatisés
  window.__dooooom = { get L() { return L; }, P, get INV() { return INV; }, get state() { return state; }, actions, keys, castRay };
}

if (document.fonts && document.fonts.load) {
  Promise.race([document.fonts.load(`10px ${FONT}`), new Promise((r) => setTimeout(r, 1500))]).then(boot, boot);
} else boot();
