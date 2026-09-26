'use strict';
/*
 * DUKE NUTANIX — moteur de raycasting, esprit Duke Nukem, dans les datacenters.
 * Rendu logiciel dans un buffer 480x230 (vue 3D) + HUD en haute résolution.
 */

const W = 480, H = 270, HUD_H = 40, VH = H - HUD_H, HORIZ = VH / 2;
const PLANE = 0.8, PROJ = (W / 2) / PLANE;
const FONT = '"Press Start 2P", monospace';
const WALL_CHARS = '#RSNCWXD12?34567';
const SPECIAL_NAMES = { '3': 'Broadcom ESXi', '4': 'Proxmox', '5': 'Vates XCP-ng', '6': 'Hyper-V' };

/* ------------------------------------------------------------ définitions */

const WEAPONS = [
  { name: 'CLAVIER MÉCA', ammo: null, rate: 0.5, anim: 0.45, dmg: [20, 34], melee: true, range: 1.5 },
  { name: 'PISTOLET À ÉCROUS CAGÉS', ammo: 'nuts', rate: 0.3, anim: 0.25, dmg: [12, 18], proj: 'nut', speed: 19, spread: 0.01, sfx: 'nutgun' },
  { name: 'FUSIL À PAQUETS', ammo: 'shells', rate: 0.9, anim: 0.8, dmg: [7, 12], pellets: 8, spread: 0.085, sfx: 'shotgun' },
  { name: 'RIVETEUSE GATLING', ammo: 'nuts', rate: 0.085, anim: 0.08, dmg: [9, 14], proj: 'nut', speed: 21, spread: 0.04, sfx: 'rivet' },
  { name: 'BAZOOKA SFP', ammo: 'sfp', rate: 0.85, anim: 0.5, dmg: [110, 110], proj: 'sfp', speed: 13, spread: 0, sfx: 'rocket' },
  { name: 'DISQUES DURS', ammo: 'hdd', rate: 0.75, anim: 0.5, dmg: [130, 130], proj: 'hdd', speed: 9, spread: 0, sfx: 'throw' },
  { name: 'COMPRESSEUR ZIP', ammo: 'cells', use: 4, rate: 0.6, anim: 0.3, dmg: [0, 0], proj: 'zip', speed: 16, spread: 0, sfx: 'shrink' },
  { name: 'CANON OVERCLOCK', ammo: 'cells', rate: 0.11, anim: 0.1, dmg: [18, 26], proj: 'plasma', speed: 15, spread: 0, sfx: 'plasma' },
];
const AMMO_MAX = { nuts: 250, shells: 50, sfp: 30, hdd: 20, cells: 300 };
const AMMO_LABELS = [['ÉCR', 'nuts'], ['TRM', 'shells'], ['SFP', 'sfp'], ['HDD', 'hdd'], ['NRJ', 'cells']];
const WEAPON_SLOT = { F: 2, M: 3, K: 4, G: 5, Y: 6, L: 7 };

const BOSS_BASE = { speed: 1.0, radius: 0.7, scale: 1.9, z: 0, atkRange: 18, cd: 1.5, sight: 30, pain: 0.04, shotZ: 0.9, boss: true };
const ETYPES = {
  bug: { name: 'Bug', hp: 35, speed: 2.2, radius: 0.3, scale: 0.7, z: 0, melee: true, dmg: [5, 11], atkRange: 1.0, cd: 0.9, sight: 16, pain: 0.7 },
  drone: { name: 'Drone viral', hp: 50, speed: 1.6, radius: 0.3, scale: 0.6, z: 0.35, dmg: [8, 14], atkRange: 11, cd: 1.9, sight: 18, pain: 0.5, shotZ: 0.62, shot: 'orb' },
  bot: { name: 'Bot BSOD', hp: 85, speed: 1.2, radius: 0.32, scale: 1.0, z: 0, dmg: [5, 9], atkRange: 13, cd: 2.4, sight: 18, pain: 0.35, burst: 3, shotZ: 0.55, shot: 'bolt' },
  troll: { name: 'Troll de forum', hp: 170, speed: 1.6, radius: 0.4, scale: 1.15, z: 0, melee: true, dmg: [14, 24], atkRange: 1.2, cd: 1.2, sight: 16, pain: 0.2 },
  spam: { name: 'Spammeur', hp: 60, speed: 1.3, radius: 0.32, scale: 0.8, z: 0, dmg: [4, 7], atkRange: 10, cd: 2.2, sight: 16, pain: 0.5, shotZ: 0.45, shot: 'bolt', fan: 3 },
  botnet: { ...BOSS_BASE, name: 'BOTNET', tag: 'ZOMBIFICATION EN COURS', hp: 900, dmg: [7, 12], shot: 'botnet', minion: 'bug' },
  miner: { ...BOSS_BASE, name: 'CRYPTOMINEUR', tag: 'MINAGE EN COURS', hp: 1100, dmg: [8, 13], shot: 'miner', minion: 'drone' },
  rootkit: { ...BOSS_BASE, name: 'ROOTKIT', tag: 'ESCALADE DE PRIVILÈGES', hp: 1300, dmg: [9, 14], shot: 'boss', minion: 'spam' },
  zeroday: { ...BOSS_BASE, name: 'ZERO-DAY', tag: 'EXPLOITATION EN COURS', hp: 1500, speed: 1.2, dmg: [9, 15], shot: 'zeroday', minion: 'bot' },
  ransomware: { ...BOSS_BASE, name: 'RANSOMWARE', tag: 'CHIFFREMENT EN COURS', hp: 2200, dmg: [10, 16], shot: 'boss', minion: 'bug' },
};
const ENEMY_CHARS = { b: 'bug', d: 'drone', o: 'bot', t: 'troll', m: 'spam' };
const ITEM_CHARS = '+HAascrukgjFMKGYL';
const DECOR_CHARS = 'xef';

/* --------------------------------------------------------------- répliques */

const QUIPS = {
  start: ["L'admin est dans la place. Et il n'a pas eu son café.", 'Qui a encore touché à la prod ?',
    "Je suis venu rebooter des serveurs et botter des culs. Et j'ai presque fini de rebooter.",
    'Personne ne ferme mon ticket à ma place.', 'Allez. Fenêtre de maintenance ouverte... sur vos têtes.'],
  kill: ['Ctrl Alt Suppr, bébé !', 'Retourne dans slash dev slash null.', 'Kernel panic ? Pas chez moi.', 'Bug corrigé. En prod. Comme toujours.',
    'Ticket clôturé.', 'Garbage collected !', 'Erreur 404 : ennemi introuvable.', "Ça, c'est du hotfix.", "Tu n'étais pas dans le SLA.", 'Segfault, mon gars.'],
  weapon: ['Viens voir papa.', "Ooh, ça c'est du matos de prod.", 'Enfin un outil digne de moi.', 'Ça va chiffrer... mais pas pour eux.'],
  secret: ['Une zone secrète ! Personne ne cache rien à l\'admin.', "Tiens, un placard qui n'était pas dans le plan de câblage."],
  stomp: ['Écrasé comme un vieux ticket Jira.', 'Compressé, écrasé, archivé.', 'Taille du fichier : zéro octet.'],
  nutanix: ['Encore un cluster migré sur Nutanix.', 'Un coup de clavier, une migration.', 'Hyperconvergé, bébé !', 'Et hop, un de plus dans Prism.'],
  nutanixAll: ["Datacenter cent pour cent Nutanix. Ça, c'est de l'infra !"],
  hurt: ["J'ai connu des migrations plus douces.", 'Aïe. Faudra ouvrir un ticket.', 'Je saigne en RAID zéro.'],
  boss: ['Toi, je vais te désinstaller.', 'Pas de rançon pour toi, mon grand.', 'Enfin un adversaire à ma taille.'],
  bossKill: ['Ton chiffrement, tu peux te le garder.', 'Et voilà. Restauration terminée.', 'Désinstallé. Sans redémarrage.'],
  fountain: ["Ahhh. L'eau de la clim, rien de tel.", "Ça hydrate l'ego."],
  drink: ['Turbo activé !', 'Vingt-quatre heures sans dormir, pas de souci.'],
  barrel: ['Boum ! Onduleur déchargé.', 'Coupure de courant... pour vous.'],
  exit: ['Reboot lancé. Au suivant.', 'Le datacenter vous dit merci. De rien.'],
};
let voiceOn = true;
let lastQuip = -99;
let frenchVoice = null;
function pickVoice() {
  if (!window.speechSynthesis) return;
  const v = speechSynthesis.getVoices().filter((x) => x.lang && x.lang.toLowerCase().startsWith('fr'));
  frenchVoice = v.find((x) => /thomas|paul|henri|male|homme/i.test(x.name)) || v[0] || null;
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
      u.lang = 'fr-FR'; u.pitch = 0.35; u.rate = 1.05; u.volume = 0.9;
      if (frenchVoice) u.voice = frenchVoice;
      speechSynthesis.speak(u);
    } catch (e) { /* synthèse vocale indisponible */ }
  }
}

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
  return { hp: 100, armor: 0, ammo: { nuts: 60, shells: 0, sfp: 0, hdd: 0, cells: 0 }, weapons: [true, true, false, false, false, false, false, false], cur: 1 };
}
// Équipement de départ quand on commence directement à un niveau avancé.
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
// famille de sons d'un ennemi
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
    L.ceil[i] = (x % 3 === 1 && y % 3 === 1) ? 1 : 0;
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
    else if (ENEMY_CHARS[c]) spawnEnemy(ENEMY_CHARS[c], x + 0.5, y + 0.5);
    else if (ITEM_CHARS.includes(c)) { L.items.push({ x: x + 0.5, y: y + 0.5, type: c, taken: false }); L.totalItems++; }
    else if (c === 'B') { L.barrels.push({ x: x + 0.5, y: y + 0.5, hp: 25, fuse: -1, dead: false }); L.block[i] = 1; }
    else if (DECOR_CHARS.includes(c)) { L.decor.push({ x: x + 0.5, y: y + 0.5, type: c, uses: 0 }); if (c === 'x') L.block[i] = 1; }
  }
  // dalles perforées devant les baies (allées froides)
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
    faceMood: '', faceT: 0, look: 0, lookT: 0, hurtDir: 0, shake: 0, boostT: 0, nutT: 0 });
  computeFlow();
}

function spawnEnemy(type, x, y) {
  const T = ETYPES[type];
  const e = { type, x, y, hp: T.hp, state: 'idle', timer: 0, cd: 0, animT: Math.random(), painT: 0, flash: 0, sees: false, losT: Math.random() * 0.2,
    alerted: false, strafe: Math.random() < 0.5 ? 1 : -1, shots: 0, shotT: 0, attacks: 0, shrunk: 0 };
  L.enemies.push(e);
  L.totalKills++;
  if (T.boss) L.bossAlive = true;
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
    // un passage secret recule dans le mur comme dans Wolfenstein
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

/* ------------------------------------------------------------------ joueur */

const keys = {};
let mouseDX = 0, firing = false, showMap = false;
let sensitivity = 1;

function useAction() {
  const dx = Math.cos(P.a), dy = Math.sin(P.a);
  // fontaine à eau devant soi
  for (const f of L.decor) {
    if (f.type !== 'f') continue;
    const fx = f.x - P.x, fy = f.y - P.y, d = Math.hypot(fx, fy);
    if (d < 1.4 && (fx * dx + fy * dy) / d > 0.7) {
      if (INV.hp >= 100) { msg("Vous n'avez pas soif. Votre ego non plus."); return; }
      if (f.uses >= 6) { msg('La fontaine est vide.'); return; }
      f.uses++; INV.hp = Math.min(100, INV.hp + 5);
      Sfx.slurp(); msg("Glou glou... +5 d'ego"); quip('fountain', 0.4);
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
        msg(d.lock === 'red' ? 'Accès refusé : BADGE ROUGE requis' : 'Accès refusé : BADGE BLEU requis');
        return;
      }
      if (d.secret) {
        L.secrets++;
        Sfx.secret();
        msg('Zone secrète découverte !');
        quip('secret', 1, true);
      }
      openDoor(d);
      return;
    }
    if (String.fromCharCode(t) === 'X') {
      if (L.bossAlive) { Sfx.deny(); msg('Le système est verrouillé ! Détruisez le boss.'); return; }
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

  // écrasement des ennemis compressés
  for (const e of L.enemies) {
    if (!alive(e) || e.shrunk <= 0) continue;
    if ((e.x - P.x) ** 2 + (e.y - P.y) ** 2 < 0.45 * 0.45) {
      e.hp = 0; killEnemy(e, 'stomp');
      Sfx.squish(); msg('SPLAT !'); quip('stomp', 0.8, true);
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
    case '+': if (INV.hp >= 100) return false; INV.hp = Math.min(100, INV.hp + 10); text = "Café serré : +10 d'ego"; break;
    case 'H': if (INV.hp >= 100) return false; INV.hp = Math.min(100, INV.hp + 25); text = "Kit de secours : +25 d'ego"; break;
    case 'A': if (INV.armor >= 100) return false; INV.armor = 100; text = 'Firewall activé : armure 100%'; break;
    case 'j': P.boostT = 15; text = 'Boisson énergisante : TURBO pendant 15 s !'; quip('drink', 0.7); break;
    case 'a': ok = add('nuts', it.drop ? 10 : 30); text = 'Écrous cagés M6'; break;
    case 's': ok = add('shells', 8); text = 'Trames jumbo (+8)'; break;
    case 'k': ok = add('sfp', 4); text = 'Modules SFP+ (+4 roquettes)'; break;
    case 'g':
      if (!INV.weapons[5]) return giveWeapon('G', 'hdd', 2, 'DISQUES DURS récupérés ! [6]');
      ok = add('hdd', 2); text = 'Disques durs (+2)'; break;
    case 'c': ok = add('cells', 40); text = "Cellules d'énergie (+40)"; break;
    case 'r': L.keys.red = true; msg("Badge d'accès ROUGE récupéré"); Sfx.key(); P.pickT = 0.3; return true;
    case 'u': L.keys.blue = true; msg("Badge d'accès BLEU récupéré"); Sfx.key(); P.pickT = 0.3; return true;
    case 'F': return giveWeapon('F', 'shells', 8, 'FUSIL À PAQUETS récupéré ! [3]');
    case 'M': return giveWeapon('M', 'nuts', 60, 'RIVETEUSE GATLING récupérée ! [4]');
    case 'K': return giveWeapon('K', 'sfp', 5, 'BAZOOKA SFP récupéré ! [5]');
    case 'G': return giveWeapon('G', 'hdd', 5, 'DISQUES DURS récupérés ! [6]');
    case 'Y': return giveWeapon('Y', 'cells', 40, 'COMPRESSEUR ZIP récupéré ! [7]');
    case 'L': return giveWeapon('L', 'cells', 60, 'CANON OVERCLOCK récupéré ! [8]');
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
  Sfx[w.sfx]();
  // le bruit réveille les ennemis
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
  // coup de clavier dans une baie : migration Nutanix des racks spéciaux
  castRay(P.x, P.y, dx, dy);
  if (RH.d > 1.5 || !RH.tile) return;
  const ch = String.fromCharCode(RH.tile);
  const i = RH.my * L.w + RH.mx;
  if ('3456'.includes(ch)) {
    L.map[i] = '7'.charCodeAt(0);
    L.migrated++;
    Sfx.nutanix();
    const hx = P.x + dx * (RH.d - 0.1), hy = P.y + dy * (RH.d - 0.1);
    addFx(hx, hy, 'nutanix', 0.55, 0.7, 0.5);
    P.pickT = 0.2;
    msg(`Rack ${SPECIAL_NAMES[ch]} migré vers NUTANIX ! (${L.migrated}/${L.totalSpecials})`);
    if (L.migrated === L.totalSpecials) {
      msg('DATACENTER 100% NUTANIX ! Bonus : armure +50');
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

/* ----------------------------------------------------- explosions & barils */

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

/* ----------------------------------------------------------------- ennemis */

function killEnemy(e, how) {
  const T = ETYPES[e.type];
  const dist = Math.hypot(e.x - P.x, e.y - P.y);
  e.state = 'dying'; e.timer = 0.5; e.shrunk = 0;
  L.kills++;
  Sfx.enemyDeath(sndKind(e), dist);
  if (how !== 'stomp') addFx(e.x, e.y, 'boom', 0.2 + T.z, T.boss ? 1.5 : 0.5);
  if ((e.type === 'bot' || e.type === 'spam') && Math.random() < 0.7) L.items.push({ x: e.x, y: e.y, type: 'a', taken: false, drop: true });
  if (T.boss) {
    L.bossAlive = false;
    P.shake = 1;
    msg(`${T.name} ÉLIMINÉ ! Le terminal de REBOOT est déverrouillé.`);
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
  if (T.boss) { msg(`${T.name} est trop gros pour être compressé !`); damageEnemy(e, 40); return; }
  e.shrunk = 8; e.state = 'chase'; e.painT = 0.3; e.alerted = true;
  msg(`${T.name} compressé en .zip ! Écrasez-le !`);
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
    const n = e.type === 'zeroday' ? 7 : 5;
    for (let k = 0; k < n; k++) shoot(ang + (k - (n - 1) / 2) * 0.13, T.shot, 7.5, 0.5);
    e.attacks++;
    if (e.attacks % 4 === 0) spawnMinions(e);
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
  msg(`${ETYPES[boss.type].name} appelle des renforts !`);
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
  if (shrunk) { e.shrunk -= dt; if (e.shrunk <= 0) msg(`${T.name} s'est décompressé !`); }
  e.cd -= dt;
  if (e.state === 'attack') {
    e.timer -= dt;
    if (e.shots > 0) { e.shotT -= dt; if (e.shotT <= 0) { if (!P.dead) enemyFire(e); e.shots--; e.shotT = 0.17; } }
    if (e.timer <= 0) e.state = 'chase';
    return;
  }
  if (P.dead) return;

  if (!shrunk && e.cd <= 0 && e.sees) {
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

  let tx, ty;
  if (shrunk) {
    // un ennemi compressé fuit
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

// Disque dur lancé : trajectoire en cloche, rebonds sur murs et sol, mèche de 1,7 s.
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

/* ------------------------------------------------------------------ rendu */

function shade(c, s) {
  return 0xff000000 | ((((c >> 16) & 255) * s >> 8) << 16) | ((((c >> 8) & 255) * s >> 8) << 8) | ((c & 255) * s >> 8);
}

function lightAt(d) {
  const amb = L.def.ambient + (P.flashT > 0 ? 0.35 : 0);
  const s = 256 * amb / (1 + d * 0.1 + d * d * 0.012);
  return s > 256 ? 256 : s | 0;
}

function render() {
  const dirX = Math.cos(P.a), dirY = Math.sin(P.a);
  const plX = -dirY * PLANE, plY = dirX * PLANE;
  const w = L.w, h = L.h;
  const floorT = Assets.floor, ceilT = Assets.ceil;
  const concreteT = Assets.concrete[L.def.episode % 5];

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
      buf[fo + x] = shade(floorT[L.floor[ci]].px[ti], s);
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
    const ch = String.fromCharCode(RH.tile);
    const vars = ch === '#' || ch === '?' ? concreteT : Assets.walls[ch];
    const frames = vars[L.variant[vi] % vars.length];
    const tex = frames[(animFrame + L.variant[vi]) % frames.length];
    let tx = (RH.wx * 64) | 0;
    if ((RH.side === 0 && rdx < 0) || (RH.side === 1 && rdy > 0)) tx = 63 - tx;
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
  const frameOf = (a, t, fps) => (Array.isArray(a) ? a[((t * fps) | 0) % a.length] : a);
  for (const d of L.decor) add(d.x, d.y, Assets.items[d.type], d.type === 'x' ? 0.9 : d.type === 'f' ? 0.75 : 0.6, 0);
  for (const b of L.barrels) if (!b.dead) add(b.x, b.y, Assets.items.B, 0.75, 0, b.fuse >= 0);
  const bobT = performance.now() / 400;
  for (const it of L.items) {
    if (it.taken) continue;
    const floaty = 'ruFMKGYL'.includes(it.type);
    add(it.x, it.y, Assets.items[it.type], 0.5, floaty ? 0.05 + Math.sin(bobT + it.x) * 0.03 : 0, 0, it.type === 'r' || it.type === 'u');
  }
  for (const e of L.enemies) {
    const T = ETYPES[e.type], S = Assets.enemies[e.type];
    let spr;
    if (e.state === 'dead') spr = S.dead;
    else if (e.state === 'dying') spr = S.die[e.timer > 0.25 ? 0 : 1];
    else if (e.state === 'attack') spr = S.atk;
    else if (e.state === 'idle') spr = S.walk[0];
    else spr = S.walk[((e.animT * (e.type === 'drone' ? 6 : e.shrunk > 0 ? 10 : 4)) | 0) % 2];
    let z = T.z;
    let scale = T.scale;
    if (e.type === 'drone' && e.state !== 'dead') z += Math.sin(e.animT * 3 + e.x) * 0.05;
    if (e.state === 'dead') { z = 0; scale = Math.max(0.8, T.scale * 0.7); }
    if (e.shrunk > 0 && alive(e)) { scale *= e.shrunk < 1 ? 0.3 + 0.7 * (1 - e.shrunk) : 0.3; z = 0; }
    add(e.x, e.y, spr, scale, z, e.flash > 0);
  }
  for (const p of L.proj) add(p.x, p.y, frameOf(Assets.proj[p.kind], p.t, 16), p.scale || 0.35, p.z, false, true);
  for (const f of L.fx) {
    const fr = Assets.fx[f.kind];
    const i = Math.min(fr.length - 1, (f.t / f.dur * fr.length) | 0);
    add(f.x, f.y, fr[i], f.scale, f.z - f.scale / 2 + (f.kind === 'smoke' ? f.t * 0.4 : 0), false, true);
  }
  list.sort((a, b) => b.ty - a.ty);
  for (const s of list) drawSprite(s);

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
  g.fillStyle = '#5a4a2a'; g.fillRect(x - 16 * s, y, 40 * s, 60);           // manche (t-shirt kaki de Duke... d'admin)
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
      g.fillStyle = '#5a4a2a'; g.fillRect(34, 16, 40, 60);
      ell(g, 44, 14, 20, 13, '#d9a47a');
      break;
    }
    case 1: { // pistolet à écrous cagés
      g.translate(cx + 10, base + t * 18);
      g.rotate(-t * 0.15);
      drawHand(g, 0, -28);
      g.fillStyle = '#2b2f35'; g.fillRect(-12, -100, 24, 72);
      g.fillStyle = '#e8741a'; g.fillRect(-12, -100, 24, 32);           // corps orange façon cloueur
      g.fillStyle = '#ff9a3a'; g.fillRect(-12, -100, 4, 32);
      g.fillStyle = '#111'; g.fillRect(-6, -104, 12, 6);
      // chargeur tubulaire d'écrous
      g.fillStyle = '#555c64'; g.fillRect(14, -96, 10, 50);
      for (let i = 0; i < 5; i++) drawCageNut(g, 19, -90 + i * 10, 0.35, 0);
      if (t < 0.6) drawCageNut(g, 0, -108, 0.55, 0);
      if (flash) drawFlash(g, 0, -112, 20, '#fff6b0', '#ffb040');
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
    case 3: { // riveteuse gatling
      g.translate(cx, base + t * 6);
      drawHand(g, -34, -24);
      g.fillStyle = '#3a3f46'; g.fillRect(-34, -72, 68, 72);
      g.fillStyle = '#50565e'; g.fillRect(-34, -72, 68, 6);
      // trémie d'écrous
      g.fillStyle = '#6b4a2a'; g.fillRect(22, -66, 26, 30);
      for (let i = 0; i < 6; i++) drawCageNut(g, 28 + (i % 3) * 7, -58 + ((i / 3) | 0) * 9, 0.3, i);
      const bars = [];
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + P.spin; bars.push({ x: Math.cos(a) * 14, d: Math.sin(a) }); }
      bars.sort((a, b) => a.d - b.d);
      for (const b of bars) {
        const l = 70 + b.d * 30 | 0;
        g.fillStyle = `rgb(${l},${l + 6},${l + 14})`;
        g.fillRect(b.x - 4, -132, 8, 62);
      }
      g.fillStyle = '#e8741a'; g.fillRect(-22, -110, 44, 6); g.fillRect(-22, -80, 44, 6);
      if (flash) drawFlash(g, randi(-8, 8), -140, 26, '#fff6b0', '#ffb040');
      break;
    }
    case 4: { // bazooka SFP (à l'épaule, à droite)
      g.translate(cx + 40, base + t * 22);
      drawHand(g, -10, -30);
      g.fillStyle = '#3a4a2a'; g.beginPath(); g.moveTo(-6, 0); g.lineTo(60, 0); g.lineTo(28, -118); g.lineTo(4, -118); g.closePath(); g.fill();
      g.fillStyle = '#4c6038'; g.beginPath(); g.moveTo(-6, 0); g.lineTo(10, 0); g.lineTo(10, -118); g.lineTo(4, -118); g.closePath(); g.fill();
      ell(g, 16, -118, 13, 7, '#1a1a1a');
      if (t < 0.4) { g.fillStyle = '#c9cdd1'; g.fillRect(9, -128, 14, 10); g.fillStyle = '#1f58d6'; g.fillRect(9, -130, 14, 3); }
      g.fillStyle = '#e8c21a'; g.fillRect(12, -70, 30, 4);
      if (flash) drawFlash(g, 16, -128, 34, '#fff6b0', '#ff7a1a');
      break;
    }
    case 5: { // disque dur à lancer
      const s = t > 0 ? Math.sin(t * Math.PI) : 0;
      g.translate(cx + 50 - s * 60, base - 20 - s * 70);
      drawHand(g, 0, 0);
      if (t === 0 || t < 0.2) {
        g.save(); g.translate(0, -16); g.rotate(-0.2);
        g.fillStyle = '#9aa1a8'; g.fillRect(-24, -34, 48, 34);
        g.fillStyle = '#c9ced4'; g.fillRect(-24, -34, 48, 4);
        ell(g, -4, -17, 12, 12, '#b4bac1'); ell(g, -4, -17, 3, 3, '#5a6068');
        g.fillStyle = '#fff'; g.fillRect(10, -30, 12, 18); g.fillStyle = '#c21d1d'; g.fillRect(10, -30, 12, 4);
        g.fillStyle = '#111'; g.font = 'bold 4px monospace'; g.fillText('4 To', 11, -18);
        g.restore();
      }
      break;
    }
    case 6: { // compresseur ZIP
      g.translate(cx, base + t * 10);
      drawHand(g, -30, -20); drawHand(g, 30, -20);
      g.fillStyle = '#4a34a8'; g.fillRect(-36, -80, 72, 80);
      g.fillStyle = '#6a4ae0'; g.fillRect(-36, -80, 72, 6);
      g.fillStyle = '#e8c21a'; g.fillRect(-6, -80, 12, 80);
      for (let y = -76; y < 0; y += 5) { g.fillStyle = '#8a7a2a'; g.fillRect(-4, y, 8, 2); }
      g.fillStyle = '#0a1a0a'; g.fillRect(12, -64, 20, 14);
      g.fillStyle = '#3dff6a'; g.font = 'bold 6px monospace'; g.fillText('.ZIP', 13, -54);
      ell(g, 0, -86, 10, 6, t > 0.5 ? '#fff' : '#b6a4ff');
      if (t > 0.5) drawFlash(g, 0, -92, 22, '#ffffff', '#8a6aff');
      break;
    }
    case 7: {
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

// Visage de l'admin façon Duke : brosse blonde, lunettes noires, sourire en coin.
function drawFace(g, cx, cy) {
  const hp = INV.hp;
  const mood = P.dead ? 'dead' : P.faceMood;
  g.fillStyle = hp > 60 ? '#e0a877' : hp > 30 ? '#d0966a' : '#c0845e';
  g.fillRect(cx - 12, cy - 8, 24, 22);                        // mâchoire carrée
  g.fillRect(cx - 10, cy + 14, 20, 3);
  g.fillStyle = '#e8c23a'; g.fillRect(cx - 13, cy - 16, 26, 9); // brosse blonde
  g.fillStyle = '#c9a020'; for (let x = cx - 12; x < cx + 13; x += 3) g.fillRect(x, cy - 16, 1, 8);
  g.fillStyle = '#e8c23a'; g.fillRect(cx - 13, cy - 8, 3, 6); g.fillRect(cx + 10, cy - 8, 3, 6);
  // lunettes noires
  if (mood === 'dead') {
    g.fillStyle = '#000'; g.font = '6px monospace'; g.fillText('x', cx - 8, cy + 1); g.fillText('x', cx + 3, cy + 1);
  } else {
    g.fillStyle = '#0a0a0a'; g.fillRect(cx - 12, cy - 5, 11, 6); g.fillRect(cx + 1, cy - 5, 11, 6); g.fillRect(cx - 1, cy - 4, 2, 2);
    g.fillStyle = god ? '#ffd700' : 'rgba(120,180,255,0.6)'; g.fillRect(cx - 10 + P.look, cy - 4, 3, 1); g.fillRect(cx + 3 + P.look, cy - 4, 3, 1);
  }
  // bouche
  g.fillStyle = '#5a1a1a';
  if (mood === 'ouch' || mood === 'dead') ell(g, cx, cy + 9, 3, 3, '#5a1a1a');
  else if (mood === 'grin' || god) { g.fillRect(cx - 6, cy + 7, 12, 3); g.fillStyle = '#fff'; g.fillRect(cx - 5, cy + 7, 10, 1); }
  else { g.fillRect(cx - 2, cy + 9, 8, 2); g.fillRect(cx + 5, cy + 7, 2, 2); }  // sourire en coin
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
  big(w.ammo ? String(INV.ammo[w.ammo]) : '--', 36, '#ff4d2e'); label('MUNITIONS', 36);
  big(INV.hp + '%', 107, INV.hp > 30 ? '#ff4d2e' : '#ff1a1a'); label('EGO', 107);
  g.font = `7px ${FONT}`; g.textAlign = 'center';
  for (let i = 0; i < 8; i++) {
    const x = 153 + (i % 4) * 17, yy = y + 12 + ((i / 4) | 0) * 11;
    g.fillStyle = i === INV.cur ? '#ffe14a' : INV.weapons[i] ? '#d8dde3' : '#3a3f46';
    g.fillText(String(i + 1), x, yy + 4);
  }
  label('ARMES', 178);
  g.fillStyle = '#0e1013'; g.fillRect(216, y + 3, 50, HUD_H - 4);
  if (P.hurtT > 0) { g.fillStyle = 'rgba(255,0,0,0.25)'; g.fillRect(216, y + 3, 50, HUD_H - 4); }
  drawFace(g, 241, y + 20);
  big(INV.armor + '%', 301, '#4fb4ff'); label('ARMURE', 301);
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
    g.fillText(`ÉPISODE ${L.def.episode + 1} : ${EPISODES[L.def.episode].name}`, W / 2, 72);
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
  // compteur de migrations Nutanix
  g.fillStyle = L.migrated === L.totalSpecials ? '#b6a4ff' : '#7855fa';
  g.fillText(`NUTANIX ${L.migrated}/${L.totalSpecials}`, W - 6, 12);
  if (god) { g.fillStyle = '#ffd700'; g.fillText('MODE ROOT', W - 6, 21); }
  if (P.boostT > 0) { g.fillStyle = '#3dff6a'; g.fillText(`TURBO ${Math.ceil(P.boostT)}`, W - 6, god ? 30 : 21); }
  const boss = L.enemies.find((e) => ETYPES[e.type].boss && alive(e) && e.state !== 'idle');
  if (boss) {
    const T = ETYPES[boss.type];
    const f = Math.max(0, boss.hp / T.hp);
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(W / 2 - 101, 21, 202, 10);
    g.fillStyle = '#7a0f0f'; g.fillRect(W / 2 - 100, 22, 200, 8);
    g.fillStyle = '#ff2a2a'; g.fillRect(W / 2 - 100, 22, 200 * f, 8);
    g.font = `5px ${FONT}`; g.textAlign = 'center'; g.fillStyle = '#fff';
    g.fillText(`${T.name} — ${T.tag}`, W / 2, 18);
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
  g.fillText('PLAN DU DATACENTER — ' + L.def.name, W / 2, 12);
}

function present() {
  vctx.setTransform(1, 0, 0, 1, 0, 0);
  vctx.imageSmoothingEnabled = false;
  const sh = P.shake > 0 ? P.shake * 7 * K : 0;
  if (sh) { vctx.fillStyle = '#000'; vctx.fillRect(0, 0, W * K, VH * K); }
  vctx.drawImage(scr, sh ? rand(-sh, sh) : 0, sh ? rand(-sh, sh) : 0, W * K, VH * K);
  vctx.setTransform(K, 0, 0, K, 0, 0);
  const g = vctx;
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

/* ------------------------------------------------------------- déroulé */

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

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0);
  last = ts;
  if (state === 'playing') update(dt);
  if (L && state !== 'title' && state !== 'loading' && state !== 'select') { render(); present(); }
  requestAnimationFrame(frame);
}

/* ---------------------------------------------------------- sauvegarde */

const SAVE_KEY = 'dukenutanix.save';
function readSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || null; } catch (e) { return null; }
}
function writeSave(idx, inv) {
  const s = readSave() || { maxLevel: 0 };
  s.maxLevel = Math.max(s.maxLevel || 0, idx);
  s.level = idx; s.inv = inv;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { /* stockage indisponible */ }
}

/* --------------------------------------------------------------- écrans */

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
    <tr><td>ZQSD / WASD / ↑↓</td><td>Se déplacer</td></tr>
    <tr><td>Souris / ← →</td><td>Tourner</td></tr>
    <tr><td>Clic / Ctrl</td><td>Tirer</td></tr>
    <tr><td>E / Espace</td><td>Ouvrir, fouiller les murs, boire</td></tr>
    <tr><td>1-8 / molette</td><td>Changer d'arme</td></tr>
    <tr><td>Maj</td><td>Courir</td></tr>
    <tr><td>Tab / M</td><td>Plan du datacenter</td></tr>
    <tr><td>Échap</td><td>Pause</td></tr>
    <tr><td>N / V</td><td>Couper le son / la voix</td></tr>
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
};

function showTitle() {
  state = 'title';
  document.exitPointerLock && document.exitPointerLock();
  if (window.speechSynthesis) speechSynthesis.cancel();
  vctx.setTransform(1, 0, 0, 1, 0, 0);
  vctx.fillStyle = '#000'; vctx.fillRect(0, 0, view.width, view.height);
  const s = readSave();
  const cont = s ? `<button data-act="continueGame" class="big">CONTINUER — ${getLevel(s.level).code}</button>` : '';
  showPanel(`
    <h1 class="logo">DUKE <span class="ntnx">NUTANI<span class="x">X</span></span></h1>
    <h2>L'ADMIN EST DE RETOUR<br><span class="ok">ET IL N'A PAS EU SON CAFÉ</span></h2>
    <p class="story">Un ransomware s'est emparé du datacenter et ses processus corrompus ont pris
    forme physique entre les baies. Armé d'un pistolet à <b>écrous cagés</b>, de disques durs
    et d'un ego surdimensionné, traversez <b>5 épisodes et 50 niveaux</b>, trouvez les zones secrètes
    et migrez au clavier chaque rack ESXi, Proxmox, Vates et Hyper-V vers <b>Nutanix</b>.</p>
    ${cont}
    <button data-act="newGame" class="${s ? '' : 'big'}">NOUVELLE PARTIE</button>
    <button data-act="select">CHOISIR UN NIVEAU</button>
    ${CONTROLS}
    <p class="hint">Cliquez dans le jeu pour capturer la souris. Codes : iddqd, idkfa.</p>
  `);
}

function showSelect() {
  state = 'select';
  const s = readSave();
  const max = s ? s.maxLevel : 0;
  let html = '<h2>CHOISIR UN NIVEAU</h2>';
  EPISODES.forEach((ep, e) => {
    html += `<h3>ÉPISODE ${e + 1} : ${ep.name}</h3><div class="grid">`;
    for (let k = 0; k < 10; k++) {
      const i = e * 10 + k;
      const locked = i > max;
      html += `<button ${locked ? 'disabled' : `data-act="play" data-arg="${i}"`} title="${locked ? 'Verrouillé' : LEVEL_NAMES[i]}" class="lvl${k === 9 ? ' boss' : ''}">${e + 1}-${k + 1}</button>`;
    }
    html += '</div>';
  });
  html += '<p class="hint">Les niveaux se débloquent en progressant.</p><button data-act="title">RETOUR</button>';
  showPanel(html);
}

function startLevel(idx) {
  loadLevel(idx);
  INV_START = cloneInv(INV);
  writeSave(idx, INV_START);
  if (!INV.weapons[INV.cur]) INV.cur = 1;
  state = 'briefing';
  render(); present();
  showPanel(`
    <h2>${L.def.name}<br><span class="ep">ÉPISODE ${L.def.episode + 1} : ${EPISODES[L.def.episode].name}</span></h2>
    <p class="story">${L.def.intro}</p>
    <p class="story small">Racks à migrer vers Nutanix : ${L.totalSpecials} — Zones secrètes : ${L.totalSecrets}</p>
    <button data-go class="big">ENTRER</button>
  `, () => { hidePanel(); state = 'playing'; lockPointer(); quip('start', 0.9, true); });
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  firing = false;
  showPanel(`
    <h2>PAUSE</h2>
    <p class="story">${L.def.name}<br>Ennemis ${L.kills}/${L.totalKills} — Objets ${L.itemsGot}/${L.totalItems} — Secrets ${L.secrets}/${L.totalSecrets}<br>
    Migrations Nutanix ${L.migrated}/${L.totalSpecials} — ${fmtTime(L.time)}</p>
    <button data-act="resume" class="big">REPRENDRE</button>
    <button data-act="restart">RECOMMENCER LE NIVEAU</button>
    <button data-act="title">MENU PRINCIPAL</button>
    <label class="sens">Sensibilité souris <input type="range" min="0.3" max="2.5" step="0.1" value="${sensitivity}" id="sens"></label>
    ${CONTROLS}
  `);
  const s = document.getElementById('sens');
  s.oninput = () => { sensitivity = +s.value; try { localStorage.setItem('dukenutanix.sens', s.value); } catch (e) { /* ignoré */ } };
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
    <p class="story">Kernel panic : l'admin d'astreinte ne répond plus.<br>Ennemis ${L.kills}/${L.totalKills} — ${fmtTime(L.time)}</p>
    <button data-act="restart" class="big">RESTAURER LE SNAPSHOT</button>
    <button data-act="title">MENU PRINCIPAL</button>
  `);
}

function completeLevel() {
  Sfx.exit();
  quip('exit', 0.7, true);
  state = 'intermission';
  firing = false;
  document.exitPointerLock && document.exitPointerLock();
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
  const lastLevel = L.idx === LEVEL_COUNT - 1;
  if (!lastLevel) {
    const next = cloneInv(INV);
    next.hp = Math.max(next.hp, 1);
    writeSave(L.idx + 1, next);
  }
  const stats = `
    <table class="stats">
      <tr><td>ENNEMIS</td><td>${pct(L.kills, L.totalKills)}</td></tr>
      <tr><td>OBJETS</td><td>${pct(L.itemsGot, L.totalItems)}</td></tr>
      <tr><td>SECRETS</td><td>${pct(L.secrets, L.totalSecrets)}</td></tr>
      <tr><td>MIGRATIONS NUTANIX</td><td>${L.migrated}/${L.totalSpecials}</td></tr>
      <tr><td>TEMPS</td><td>${fmtTime(L.time)}</td></tr>
    </table>`;
  if (lastLevel) {
    showPanel(`
      <h1 class="logo">REBOOT RÉUSSI</h1>
      <h2>LE DATACENTER EST SAUVÉ</h2>
      <p class="story">Le ransomware est purgé, les baies redémarrent une à une et les LEDs repassent au vert.
      Il est 6h47. L'admin allume une cigarette électronique, remet ses lunettes de soleil et
      laisse à quelqu'un d'autre le soin d'écrire le post-mortem.</p>
      ${stats}
      <button data-act="title" class="big">MENU PRINCIPAL</button>
    `);
    return;
  }
  const epDone = L.idx % 10 === 9;
  showPanel(`
    <h2>${L.def.name}<br><span class="ok">— REBOOTÉ —</span></h2>
    ${epDone ? `<p class="story"><b>ÉPISODE ${L.def.episode + 1} TERMINÉ !</b> Direction : ${EPISODES[L.def.episode + 1].name}.</p>` : ''}
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
    INV.weapons = INV.weapons.map(() => true);
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
  if (e.code.startsWith('Digit')) { const n = +e.code.slice(5) - 1; if (n >= 0 && n < 8) switchWeapon(n); }
  if (e.code === 'Tab' || e.key === 'm' || e.key === 'M') showMap = !showMap;
  if (e.code === 'Escape' || e.code === 'KeyP') pauseGame();
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') firing = true;
  if (e.key === 'n' || e.key === 'N') msg(Sfx.toggleMute() ? 'Son coupé' : 'Son activé');
  if (e.key === 'v' || e.key === 'V') {
    voiceOn = !voiceOn;
    if (!voiceOn && window.speechSynthesis) speechSynthesis.cancel();
    try { localStorage.setItem('dukenutanix.voice', voiceOn ? '1' : '0'); } catch (err) { /* ignoré */ }
    msg(voiceOn ? "Voix de l'admin activée" : "Voix de l'admin coupée (sous-titres conservés)");
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
  for (let k = 0; k < 8; k++) { i = (i + dir + 8) % 8; if (INV.weapons[i]) { switchWeapon(i); break; } }
}, { passive: false });
view.addEventListener('contextmenu', (e) => e.preventDefault());

let hadLock = false;
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === view) { hadLock = true; skipMouse = 2; mouseDX = 0; }
  else if (hadLock && state === 'playing') pauseGame();
});

/* ------------------------------------------------------------ démarrage */

// Reprend les sauvegardes et réglages enregistrés sous l'ancien nom du jeu (DOOOOOM).
function migrateStorage() {
  try {
    for (const k of ['save', 'sens', 'voice']) {
      const old = localStorage.getItem('dooooom.' + k);
      if (old !== null && localStorage.getItem('dukenutanix.' + k) === null) localStorage.setItem('dukenutanix.' + k, old);
      localStorage.removeItem('dooooom.' + k);
    }
  } catch (e) { /* stockage indisponible */ }
}

function boot() {
  resize();
  migrateStorage();
  try {
    const s = localStorage.getItem('dukenutanix.sens'); if (s) sensitivity = +s;
    if (localStorage.getItem('dukenutanix.voice') === '0') voiceOn = false;
  } catch (e) { /* ignoré */ }
  buildAssets();
  showTitle();
  requestAnimationFrame(frame);
  // accès de débogage pour les tests automatisés
  window.__duke = { get L() { return L; }, P, get INV() { return INV; }, get state() { return state; }, actions, keys, castRay };
}

if (document.fonts && document.fonts.load) {
  Promise.race([document.fonts.load(`10px ${FONT}`), new Promise((r) => setTimeout(r, 1500))]).then(boot, boot);
} else boot();
