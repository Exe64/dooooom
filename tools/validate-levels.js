// Vérifie les niveaux : dimensions, bordures, accessibilité (avec badges).
// Usage : node tools/validate-levels.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../js/levels.js'), 'utf8');
const LEVELS = new Function(src + '; return LEVELS;')();
const WALLS = '#RSNCWX';
let ok = true;
const fail = (l, m) => { ok = false; console.log(`[niveau ${l + 1}] ${m}`); };

LEVELS.forEach((lv, li) => {
  const m = lv.map, h = m.length, w = m[0].length;
  m.forEach((row, y) => { if (row.length !== w) fail(li, `ligne ${y} : longueur ${row.length} au lieu de ${w}`); });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = m[y][x];
    if ((y === 0 || x === 0 || y === h - 1 || x === w - 1) && !WALLS.includes(c)) fail(li, `bordure ouverte en ${x},${y} (${c})`);
  }
  const starts = [];
  m.forEach((r, y) => [...r].forEach((c, x) => { if (c === 'P') starts.push([x, y]); }));
  if (starts.length !== 1) { fail(li, `${starts.length} départs joueur`); return; }
  // BFS itératif avec badges
  const keys = new Set();
  let seen;
  for (let pass = 0; pass < 4; pass++) {
    seen = new Set();
    const q = [starts[0]];
    seen.add(starts[0].join());
    while (q.length) {
      const [x, y] = q.shift();
      const c = m[y][x];
      if (c === 'r') keys.add('1');
      if (c === 'u') keys.add('2');
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen.has(k)) continue;
        const n = m[ny][nx];
        if (WALLS.includes(n) || n === 'x') continue;
        if ((n === '1' || n === '2') && !keys.has(n)) continue;
        seen.add(k); q.push([nx, ny]);
      }
    }
  }
  let exit = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = m[y][x];
    if (c === 'X') for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (seen.has((x + dx) + ',' + (y + dy))) exit = true;
    if (!WALLS.includes(c) && c !== 'x' && c !== '#' && !seen.has(x + ',' + y)) fail(li, `case inaccessible ${x},${y} (${c})`);
    if ('D12'.includes(c)) {
      const horiz = WALLS.includes(m[y][x - 1]) && WALLS.includes(m[y][x + 1]);
      const vert = WALLS.includes(m[y - 1][x]) && WALLS.includes(m[y + 1][x]);
      if (!horiz && !vert) fail(li, `porte ${x},${y} sans encadrement`);
    }
  }
  if (!exit) fail(li, 'sortie inaccessible');
});
console.log(ok ? 'Niveaux OK' : 'Erreurs détectées');
process.exit(ok ? 0 : 1);
