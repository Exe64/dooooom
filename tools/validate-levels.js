// Generates and checks all 50 levels: dimensions, borders, framed doors,
// reachability with badges, special racks.  Usage: node tools/validate-levels.js
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
  const enemies = [...'bdotmZV'].reduce((a, c) => a + n(c), 0);
  console.log(`${def.code.padEnd(6)} ${String(def.map[0].length).padStart(2)}x${String(def.map.length).padEnd(2)} enemies ${String(enemies).padStart(2)}  secret ${n('?')}  badge doors ${n('1') + n('2')}  ${def.bossType || def.miniType || ''} ${r.ok ? 'OK' : 'ERROR'}`);
  if (def.miniType && n('V') !== 1) { r.ok = false; r.errors.push(`expected 1 mini-boss, found ${n('V')}`); }
  if (!r.ok) { ok = false; r.errors.slice(0, 5).forEach((e) => console.log('   ' + e)); }
}
console.log(`${ok ? 'Levels OK' : 'Errors found'} (${Date.now() - t0} ms)`);
process.exit(ok ? 0 : 1);
