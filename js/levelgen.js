'use strict';
/*
 * Générateur procédural de niveaux "datacenter" (navigateur et Node).
 *
 * Découpage BSP en salles séparées par des murs d'un bloc, reliées par des
 * portes (le graphe des salles est un arbre). On en déduit :
 *  - la salle de départ et la salle de sortie (la plus éloignée),
 *  - les portes à badge placées sur le chemin critique, badges placés en amont,
 *  - une salle secrète (cul-de-sac) derrière un faux mur,
 *  - la décoration de chaque salle (rangées de baies, climatiseurs, piliers...),
 *  - ennemis, objets et armes selon la difficulté.
 * Les graines sont fixes : un niveau donné est toujours identique.
 */
const LevelGen = (() => {
  // 3 Broadcom ESXi, 4 Proxmox, 5 Vates, 6 Hyper-V, 7 Nutanix (racks spéciaux)
  const WALLS = '#RSNCWX34567';
  const OBSTACLES = '#RSNCWX34567xB';
  const SPECIALS = '33456';

  function rng(seed) {
    let s = (seed * 2654435761 + 0x9e3779b9) >>> 0 || 1;
    const next = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
    for (let i = 0; i < 8; i++) next();
    return next;
  }

  function generate(spec) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const out = tryGenerate(spec, spec.seed + attempt * 7919);
      if (!out) continue;
      out.map = placeSpecials(out.map, spec.seed + 17);
      if (validate(out.map).ok) return out;
    }
    throw new Error('Génération impossible pour ' + spec.name);
  }

  function tryGenerate(spec, seed) {
    const R = rng(seed);
    const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
    const pick = (arr) => arr[Math.floor(R() * arr.length)];
    const { w, h } = spec;
    const g = Array.from({ length: h }, () => Array(w).fill('#'));
    const roomId = Array.from({ length: h }, () => Array(w).fill(-1));
    const rooms = [];
    const MIN = 4;

    // --- BSP
    function split(x0, y0, x1, y1, depth, forceLeaf) {
      const iw = x1 - x0 + 1, ih = y1 - y0 + 1;
      const canV = iw >= MIN * 2 + 1, canH = ih >= MIN * 2 + 1;
      const big = iw * ih > 110 || iw > 13 || ih > 11;
      const want = !forceLeaf && (canV || canH) && (big || (depth < 3 && R() < 0.6) || R() < 0.2);
      if (!want) {
        const r = { id: rooms.length, x0, y0, x1, y1, doors: [], adj: [] };
        rooms.push(r);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { g[y][x] = '.'; roomId[y][x] = r.id; }
        return { leaf: r };
      }
      let vertical = canV && (!canH || iw > ih * 1.2 || (iw >= ih * 0.8 && R() < 0.5));
      if (vertical) {
        const sx = ri(x0 + MIN, x1 - MIN);
        return { vertical, pos: sx, a: split(x0, y0, sx - 1, y1, depth + 1), b: split(sx + 1, y0, x1, y1, depth + 1), x0, y0, x1, y1 };
      }
      const sy = ri(y0 + MIN, y1 - MIN);
      return { vertical, pos: sy, a: split(x0, y0, x1, sy - 1, depth + 1), b: split(x0, sy + 1, x1, y1, depth + 1), x0, y0, x1, y1 };
    }

    let tree, arena = null;
    if (spec.boss) {
      // arène du boss réservée à droite
      const sx = Math.floor(w * 0.52);
      const left = split(1, 1, sx - 1, h - 2, 1);
      const right = split(sx + 1, 1, w - 2, h - 2, 1, true);
      arena = right.leaf;
      tree = { vertical: true, pos: sx, a: left, b: right, x0: 1, y0: 1, x1: w - 2, y1: h - 2 };
    } else tree = split(1, 1, w - 2, h - 2, 0);

    // --- portes (une par nœud interne)
    const doors = [];
    function connect(node) {
      if (node.leaf) return;
      connect(node.a); connect(node.b);
      const cands = [];
      if (node.vertical) {
        const x = node.pos;
        for (let y = node.y0 + 1; y < node.y1; y++)
          if (g[y][x - 1] === '.' && g[y][x + 1] === '.' && g[y - 1][x] === '#' && g[y + 1][x] === '#') cands.push([x, y, x - 1, y, x + 1, y]);
      } else {
        const y = node.pos;
        for (let x = node.x0 + 1; x < node.x1; x++)
          if (g[y - 1][x] === '.' && g[y + 1][x] === '.' && g[y][x - 1] === '#' && g[y][x + 1] === '#') cands.push([x, y, x, y - 1, x, y + 1]);
      }
      if (!cands.length) throw new Error('pas de porte');
      // évite deux portes voisines
      const c = pick(cands);
      const [x, y, ax, ay, bx, by] = c;
      g[y][x] = 'D';
      const ra = rooms[roomId[ay][ax]], rb = rooms[roomId[by][bx]];
      const d = { x, y, a: ra.id, b: rb.id, ch: 'D' };
      doors.push(d);
      ra.doors.push(d); rb.doors.push(d);
      ra.adj.push({ to: rb.id, door: d }); rb.adj.push({ to: ra.id, door: d });
    }
    try { connect(tree); } catch (e) { return null; }

    // --- graphe : départ, sortie, chemin critique
    const bfsRooms = (from, blockedDoor) => {
      const dist = new Array(rooms.length).fill(-1), prev = new Array(rooms.length).fill(null);
      dist[from] = 0;
      const q = [from];
      while (q.length) {
        const c = q.shift();
        for (const e of rooms[c].adj) {
          if (e.door === blockedDoor || dist[e.to] >= 0) continue;
          dist[e.to] = dist[c] + 1; prev[e.to] = { room: c, door: e.door }; q.push(e.to);
        }
      }
      return { dist, prev };
    };
    const candidatesStart = rooms.filter((r) => r !== arena);
    let start = pick(candidatesStart);
    // départ = extrémité d'un diamètre du graphe pour de longs niveaux
    const far = (id) => { const { dist } = bfsRooms(id); let best = id; dist.forEach((d, i) => { if (d > dist[best] && rooms[i] !== arena) best = i; }); return best; };
    start = rooms[far(start.id)];
    let exitRoom;
    const { dist, prev } = bfsRooms(start.id);
    if (arena) exitRoom = arena;
    else { let best = start.id; dist.forEach((d, i) => { if (d > dist[best]) best = i; }); exitRoom = rooms[best]; }
    if (exitRoom === start) return null;
    const path = [];
    for (let c = exitRoom.id; prev[c]; c = prev[c].room) path.unshift(prev[c].door);

    const reserved = new Set();
    const key = (x, y) => x + ',' + y;
    for (const d of doors) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) reserved.add(key(d.x + dx, d.y + dy));

    // --- badges
    const keyRooms = {};
    const nKeys = Math.min(spec.keys, path.length);
    const reach = (blocked) => { const { dist: d } = bfsRooms(start.id, blocked); return rooms.filter((r) => d[r.id] >= 0); };
    if (nKeys >= 1) {
      const red = path[path.length - 1];
      red.ch = '1';
      if (nKeys >= 2 && path.length >= 2) {
        const blue = path[Math.max(0, Math.floor(path.length / 2) - 1)];
        blue.ch = '2';
        const beforeBlue = reach(blue);
        const beforeRed = reach(red).filter((r) => !beforeBlue.includes(r));
        keyRooms.u = farthestOf(beforeBlue.filter((r) => r !== start), start) || start;
        keyRooms.r = pick(beforeRed.length ? beforeRed : beforeBlue);
      } else {
        const beforeRed = reach(red).filter((r) => r !== start);
        keyRooms.r = beforeRed.length ? farthestOf(beforeRed, start) : start;
      }
    }
    function farthestOf(list, from) {
      if (!list.length) return null;
      const { dist: d } = bfsRooms(from.id);
      return list.reduce((a, b) => (d[b.id] > d[a.id] ? b : a));
    }

    // --- salle secrète : cul-de-sac hors chemin critique, sans badge
    let secret = null;
    if (spec.secret) {
      const onPath = new Set([start.id, exitRoom.id]);
      for (const d of path) { onPath.add(d.a); onPath.add(d.b); }
      const cands = rooms.filter((r) => r.adj.length === 1 && !onPath.has(r.id) && !Object.values(keyRooms).includes(r) && r.adj[0].door.ch === 'D');
      if (cands.length) { secret = pick(cands); secret.adj[0].door.ch = '?'; }
    }
    for (const d of doors) g[d.y][d.x] = d.ch;

    // --- sortie
    {
      const r = exitRoom, cands = [];
      for (let x = r.x0 + 1; x < r.x1; x++) { cands.push([x, r.y0 - 1, x, r.y0]); cands.push([x, r.y1 + 1, x, r.y1]); }
      for (let y = r.y0 + 1; y < r.y1; y++) { cands.push([r.x0 - 1, y, r.x0, y]); cands.push([r.x1 + 1, y, r.x1, y]); }
      // le mur ne doit pas donner sur une autre salle (sinon on contourne les portes)
      const ok = cands.filter(([x, y, ix, iy]) => {
        const ox = 2 * x - ix, oy = 2 * y - iy;
        return g[y][x] === '#' && !reserved.has(key(x, y)) && (!g[oy] || g[oy][ox] === undefined || g[oy][ox] === '#');
      });
      if (!ok.length) return null;
      const [x, y, ix, iy] = pick(ok);
      g[y][x] = 'X';
      reserved.add(key(ix, iy));
    }

    // --- décoration
    const free = (x, y) => g[y][x] === '.' && !reserved.has(key(x, y));
    const ep = spec.episode;
    const rackMix = [['R', 'R', 'S', 'N'], ['R', 'S', 'C'], ['N', 'N', 'R'], ['S', 'S', 'S', 'N'], ['R', 'S', 'N', 'N']][ep % 5];
    const place = (x, y, c) => { if (free(x, y)) { g[y][x] = c; return true; } return false; };

    for (const r of rooms) {
      if (r === arena) { decorateArena(r); continue; }
      const backup = [];
      for (let y = r.y0; y <= r.y1; y++) backup.push(g[y].slice(r.x0, r.x1 + 1));
      const iw = r.x1 - r.x0 + 1, ih = r.y1 - r.y0 + 1;
      const t = R();
      const rc = pick(rackMix);
      if (r === secret) { /* salle secrète : pas d'obstacles */ }
      else if (t < 0.55 && Math.min(iw, ih) >= 5) {
        // rangées de baies (allées chaudes / froides)
        const horiz = iw >= ih;
        const len0 = horiz ? r.x0 + 1 : r.y0 + 1, len1 = horiz ? r.x1 - 1 : r.y1 - 1;
        const a0 = horiz ? r.y0 : r.x0, a1 = horiz ? r.y1 : r.x1;
        const double = R() < 0.4;
        for (let a = a0 + 2; a + (double ? 1 : 0) <= a1 - 2; a += double ? 4 : 3) {
          const c = R() < 0.7 ? rc : pick(rackMix);
          for (let l = len0 + 1; l <= len1 - 1; l++) {
            if ((l - len0) % 7 === 6) continue; // passage
            for (let k = 0; k <= (double ? 1 : 0); k++) horiz ? place(l, a + k, c) : place(a + k, l, c);
          }
        }
      } else if (t < 0.7) {
        // climatiseurs contre les murs + îlot central
        for (let x = r.x0 + 1; x < r.x1; x += 2) { if (R() < 0.7) place(x, r.y0, 'C'); if (R() < 0.5) place(x, r.y1, 'C'); }
        if (iw >= 7 && ih >= 7) for (let y = r.y0 + 3; y <= r.y1 - 3; y++) for (let x = r.x0 + 3; x <= r.x1 - 3; x++) if (R() < 0.35) place(x, y, rc);
      } else if (t < 0.85 && iw >= 6 && ih >= 6) {
        // piliers de baies 2x2
        for (let y = r.y0 + 2; y + 1 <= r.y1 - 2; y += 4) for (let x = r.x0 + 2; x + 1 <= r.x1 - 2; x += 4) {
          const c = pick(rackMix);
          place(x, y, c); place(x + 1, y, c); place(x, y + 1, c); place(x + 1, y + 1, c);
        }
      } else {
        // zone de stockage : cartons
        const n = Math.floor(iw * ih / 12);
        for (let i = 0; i < n; i++) place(ri(r.x0 + 1, r.x1 - 1), ri(r.y0 + 1, r.y1 - 1), 'x');
        if (R() < 0.4) for (let y = r.y0 + 1; y < r.y1; y += 3) place(r.x0, y, 'W');
      }
      // batteries d'onduleur explosives
      const nb = R() < spec.barrels ? ri(1, 3) : 0;
      for (let i = 0; i < nb; i++) place(ri(r.x0 + 1, r.x1 - 1), ri(r.y0 + 1, r.y1 - 1), 'B');
      if (!roomConnected(r)) for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) g[y][x] = backup[y - r.y0][x - r.x0];
    }

    function decorateArena(r) {
      const iw = r.x1 - r.x0 + 1, ih = r.y1 - r.y0 + 1;
      for (let y = r.y0 + 3; y + 1 <= r.y1 - 3; y += 5) for (let x = r.x0 + 3; x + 1 <= r.x1 - 3; x += 5) {
        const c = pick(rackMix);
        place(x, y, c); place(x + 1, y, c); place(x, y + 1, c); place(x + 1, y + 1, c);
      }
      if (iw > 8 && ih > 8) for (let i = 0; i < 4; i++) place(ri(r.x0 + 1, r.x1 - 1), ri(r.y0 + 1, r.y1 - 1), 'B');
      if (!roomConnected(r)) for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (!'.'.includes(g[y][x])) g[y][x] = '.';
    }

    function roomConnected(r) {
      let sx = -1, sy = -1, total = 0;
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (g[y][x] === '.') { total++; if (sx < 0) { sx = x; sy = y; } }
      if (sx < 0) return false;
      const seen = new Set([key(sx, sy)]), q = [[sx, sy]];
      while (q.length) {
        const [x, y] = q.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < r.x0 || ny < r.y0 || nx > r.x1 || ny > r.y1 || g[ny][nx] !== '.' || seen.has(key(nx, ny))) continue;
          seen.add(key(nx, ny)); q.push([nx, ny]);
        }
      }
      return seen.size === total;
    }

    // --- entités
    const cellsOf = (r) => {
      const out = [];
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (g[y][x] === '.' && !reserved.has(key(x, y))) out.push([x, y]);
      return out;
    };
    const putIn = (r, ch) => {
      const c = cellsOf(r);
      if (!c.length) return false;
      const [x, y] = pick(c);
      g[y][x] = ch; return true;
    };
    // joueur au plus près du centre de la salle de départ
    {
      const c = cellsOf(start);
      const cx = (start.x0 + start.x1) / 2, cy = (start.y0 + start.y1) / 2;
      c.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy));
      if (!c.length) return null;
      g[c[0][1]][c[0][0]] = 'P';
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) reserved.add(key(c[0][0] + dx, c[0][1] + dy));
    }
    if (keyRooms.r && !putIn(keyRooms.r, 'r')) return null;
    if (keyRooms.u && !putIn(keyRooms.u, 'u')) return null;
    if (arena) {
      const cx = Math.round((arena.x0 + arena.x1) / 2), cy = Math.round((arena.y0 + arena.y1) / 2);
      let placed = false;
      for (let rr = 0; rr < 4 && !placed; rr++) for (let dy = -rr; dy <= rr && !placed; dy++) for (let dx = -rr; dx <= rr && !placed; dx++)
        if (g[cy + dy][cx + dx] === '.') { g[cy + dy][cx + dx] = 'Z'; placed = true; }
      if (!placed) return null;
    }

    const others = rooms.filter((r) => r !== start && r !== secret);
    const weighted = [];
    for (const r of others) { const n = Math.max(1, Math.round((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) / 25)); for (let i = 0; i < n; i++) weighted.push(r); }
    const pool = [];
    for (const [ch, wgt] of Object.entries(spec.enemyPool)) for (let i = 0; i < wgt; i++) pool.push(ch);
    for (let i = 0; i < spec.enemies; i++) putIn(pick(weighted), pick(pool));

    const allRooms = rooms.filter((r) => r !== secret);
    for (const [ch, n] of Object.entries(spec.items)) for (let i = 0; i < n; i++) putIn(pick(allRooms), ch);
    // armes : sur le chemin, avant la première porte à badge
    const early = reach(path.find((d) => d.ch === '2' || d.ch === '1') || null);
    for (const ch of spec.weapons) putIn(pick(early.length ? early : allRooms), ch);
    if (secret) for (const ch of spec.secretLoot) putIn(secret, ch);
    for (let i = 0; i < spec.fountains; i++) putIn(pick(allRooms), 'f');
    for (let i = 0; i < 3; i++) putIn(pick(allRooms), 'e');

    return { map: g.map((row) => row.join('')), secret: !!secret };
  }

  /* Vérification : dimensions, bordures, portes encadrées, tout est accessible. */
  function validate(map) {
    const errors = [];
    const h = map.length, w = map[0].length;
    map.forEach((row, y) => { if (row.length !== w) errors.push(`ligne ${y} : longueur ${row.length} au lieu de ${w}`); });
    if (errors.length) return { ok: false, errors };
    const isWall = (c) => WALLS.includes(c);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = map[y][x];
      if ((y === 0 || x === 0 || y === h - 1 || x === w - 1) && !isWall(c)) errors.push(`bordure ouverte en ${x},${y}`);
      if ('D12?'.includes(c)) {
        const horiz = isWall(map[y][x - 1]) && isWall(map[y][x + 1]) && !isWall(map[y - 1][x]) && !isWall(map[y + 1][x]);
        const vert = isWall(map[y - 1][x]) && isWall(map[y + 1][x]) && !isWall(map[y][x - 1]) && !isWall(map[y][x + 1]);
        if (!horiz && !vert) errors.push(`porte ${x},${y} mal encadrée`);
      }
    }
    const starts = [];
    map.forEach((r, y) => [...r].forEach((c, x) => { if (c === 'P') starts.push([x, y]); }));
    if (starts.length !== 1) { errors.push(`${starts.length} départs joueur`); return { ok: false, errors }; }
    const keys = new Set();
    let seen;
    for (let pass = 0; pass < 4; pass++) {
      seen = new Set([starts[0].join()]);
      const q = [starts[0]];
      while (q.length) {
        const [x, y] = q.shift();
        const c = map[y][x];
        if (c === 'r') keys.add('1');
        if (c === 'u') keys.add('2');
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
          if (seen.has(k)) continue;
          const n = map[ny][nx];
          if (OBSTACLES.includes(n)) continue;
          if ((n === '1' || n === '2') && !keys.has(n)) continue;
          seen.add(k); q.push([nx, ny]);
        }
      }
    }
    let exit = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = map[y][x];
      if (c === 'X') for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = map[y + dy] && map[y + dy][x + dx]; if (n && seen.has((x + dx) + ',' + (y + dy))) exit = true; }
      if (!OBSTACLES.includes(c) && !seen.has(x + ',' + y)) errors.push(`case inaccessible ${x},${y} (${c})`);
    }
    if (!exit) errors.push('sortie inaccessible');
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (map[y][x] === 'X' &&
      [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => !OBSTACLES.includes(map[y + dy][x + dx])).length > 1) errors.push(`sortie ${x},${y} accessible des deux côtés`);
    const count = (ch) => map.join('').split(ch).length - 1;
    if (count('3') !== 2 || count('4') !== 1 || count('5') !== 1 || count('6') !== 1) errors.push('racks spéciaux manquants');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ('3456'.includes(map[y][x]) &&
      ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has((x + dx) + ',' + (y + dy)))) errors.push(`rack spécial ${x},${y} inaccessible`);
    return { ok: errors.length === 0, errors };
  }

  /*
   * Place les 5 racks spéciaux (2 ESXi, 1 Proxmox, 1 Vates, 1 Hyper-V) sur des
   * baies (ou à défaut des murs) qui donnent sur une case accessible, en les
   * répartissant dans le niveau.
   */
  function placeSpecials(map, seed) {
    const R = rng(seed);
    const g = map.map((r) => [...r]);
    const h = g.length, w = g[0].length;
    const reach = reachable(map);
    const faces = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reach.has((x + dx) + ',' + (y + dy)));
    const collect = (chars) => {
      const out = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (chars.includes(g[y][x]) && faces(x, y)) out.push([x, y]);
      return out;
    };
    let cands = collect('RSN');
    if (cands.length < 10) cands = cands.concat(collect('#'));
    const chosen = [];
    for (const ch of SPECIALS) {
      let best = null, bestScore = -1;
      for (let t = 0; t < 30; t++) {
        const c = cands[Math.floor(R() * cands.length)];
        if (!c || chosen.some((o) => o[0] === c[0] && o[1] === c[1])) continue;
        const score = chosen.length ? Math.min(...chosen.map((o) => Math.hypot(o[0] - c[0], o[1] - c[1]))) : 1;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      if (!best) break;
      chosen.push(best);
      g[best[1]][best[0]] = ch;
    }
    return g.map((r) => r.join(''));
  }

  function reachable(map) {
    let sx = 0, sy = 0;
    map.forEach((r, y) => { const x = r.indexOf('P'); if (x >= 0) { sx = x; sy = y; } });
    const seen = new Set([sx + ',' + sy]), q = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
        const n = map[ny] && map[ny][nx];
        if (!n || seen.has(k) || OBSTACLES.includes(n)) continue;
        seen.add(k); q.push([nx, ny]);
      }
    }
    return seen;
  }

  return { generate, validate, placeSpecials, rng, SPECIALS };
})();

if (typeof module !== 'undefined') module.exports = LevelGen;
