// Génère et vérifie les 50 niveaux : dimensions, bordures, portes encadrées,
// accessibilité avec badges, racks spéciaux.  Usage : node tools/validate-levels.js
const fs = require('fs');
const path = require('path');
const load = (f) => fs.readFileSync(path.join(__dirname, '../js', f), 'utf8');
const { getLevel, LEVEL_COUNT, LevelGen } = new Function(load('levelgen.js').replace(/if \(typeof module[^\n]*/, '') + load('levels.js') + '; return { getLevel, LEVEL_COUNT, LevelGen };')();
let ok = true;
const t0 = Date.now();
for (let i = 0; i < LEVEL_COUNT; i++) {
  const def = getLevel(i);
  const r = LevelGen.validate(def.map);
  const n = (c) => def.map.join('').split(c).length - 1;
  const enemies = [...'bdotmZ'].reduce((a, c) => a + n(c), 0);
  console.log(`${def.code.padEnd(6)} ${String(def.map[0].length).padStart(2)}x${String(def.map.length).padEnd(2)} ennemis ${String(enemies).padStart(2)}  secret ${n('?')}  badges ${n('1') + n('2')}  ${def.bossType || ''} ${r.ok ? 'OK' : 'ERREUR'}`);
  if (!r.ok) { ok = false; r.errors.slice(0, 5).forEach((e) => console.log('   ' + e)); }
}
console.log(`${ok ? 'Niveaux OK' : 'Erreurs détectées'} (${Date.now() - t0} ms)`);
process.exit(ok ? 0 : 1);
