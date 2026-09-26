'use strict';
/*
 * Levels: 5 episodes of 10 levels. E1M1, E1M2 and the E5M10 finale are
 * hand-drawn; the others are generated (js/levelgen.js) from a fixed seed,
 * so they are identical in every playthrough.
 *
 * Walls       # concrete   R compute rack   S storage array   N network rack
 *             C air conditioning unit (CRAC)   W "danger" wall   X exit terminal
 * Doors       D door   1 red badge door   2 blue badge door   ? secret passage
 * Player      P
 * Enemies     b bug   d viral drone   o BSOD bot   t forum troll   m spammer
 *             Z episode boss
 * Items       + coffee   H medkit   A firewall (armor)   j energy drink
 *             a cage nuts   s jumbo frames   k SFP modules (rockets)
 *             g hard drives (grenades)   c energy cells   r red badge   u blue badge
 * Weapons     F packet shotgun   M Gatling riveter   K SFP bazooka
 *             G hard drives   Y ZIP compressor   L Overclock cannon
 * Special     3 Broadcom ESXi   4 Proxmox   5 Vates   6 Hyper-V   7 Nutanix
 * racks       (placed automatically: 2 ESXi, 1 Proxmox, 1 Vates, 1 Hyper-V per level;
 *             a keyboard hit migrates them to Nutanix)
 * Props       x pallet of servers (blocking)   B UPS battery (explosive)
 *             e fire extinguisher   f water cooler (usable)
 */

const EPISODES = [
  { name: 'CLEAN ROOMS', boss: 'botnet', ambient: 1.0,
    intro: 'The server rooms are infested. Bugs crawl between the racks and somebody switched prod to read-only.' },
  { name: 'COOLING ZONE', boss: 'miner', ambient: 0.85,
    intro: "The AC is running flat out, and so are the viral drones. It's 57°F in here and you're about to bring the heat." },
  { name: 'NETWORK CORE', boss: 'rootkit', ambient: 0.8,
    intro: 'The cabling is spaghetti and the trolls have taken the meet-me room. Nothing gets routed without your say-so.' },
  { name: 'COLD ARCHIVES', boss: 'zeroday', ambient: 0.68,
    intro: "Tape libraries, SAN arrays and snapshots forgotten since 2009. It's dark and it smells like a degraded RAID." },
  { name: 'THE HYPERSCALE', boss: 'ransomware', ambient: 0.9,
    intro: "Acres of servers as far as the eye can see. The RANSOMWARE is waiting at the end. It has no backup. Neither do you." },
];

const LEVEL_NAMES = [
  'CLEAN ROOM NORTH', 'COLD AISLES', 'UPS ROOM', 'LOADING DOCK', 'PATCH ROOM',
  'CUSTOMER CAGE 42', 'THE NOC', 'MAIN SWITCHBOARD', 'TECH MEZZANINE', 'BOTNET LAIR',
  'CHILLERS', 'RAISED FLOOR', 'HOT AISLE', 'COOLING TOWER', 'CRAC ROOM',
  'CONTAINMENT', 'FREE COOLING', 'CHILLED WATER LOOP', 'PUMP ROOM', 'MINING FARM',
  'MEET-ME ROOM', 'SPINE & LEAF', 'CARRIER ROOM', 'CROSS-CONNECT', 'BACKBONE',
  'DMZ', 'PERIMETER FIREWALL', 'EDGE ROUTERS', 'BGP TABLE', 'ROOTKIT NEST',
  'TAPE LIBRARY', 'DISK ROOM', 'SAN ARRAYS', 'DEGRADED RAID 5', 'FORGOTTEN SNAPSHOTS',
  'BACKUP VAULT', 'OBJECT STORAGE', 'DEDUPLICATION', 'DISASTER RECOVERY', 'ZERO-DAY EXPLOIT',
  'HYPERSCALE HALL A', 'AVAILABILITY ZONE 2', 'EU-WEST REGION', 'GPU FARM', 'KUBERNETES CLUSTER',
  'CONTROL PLANE', 'SERVERLESS', 'EDGE COMPUTING', 'HSM ROOM', 'THE KERNEL',
];

const BOSS_NAMES = { botnet: 'the BOTNET', miner: 'the CRYPTOMINER', rootkit: 'the ROOTKIT', zeroday: 'the ZERO-DAY', ransomware: 'the RANSOMWARE' };

const HANDMADE = {
  0: {
    intro: "3:12 AM. PagerDuty alert. The servers in room 1 stopped responding... and something is crawling between the racks. Find the red badge and reach the REBOOT terminal.",
    map: [
      '################################',
      '#P...#.........#...............#',
      '#....#..b......#..RRRRRRRRRR...#',
      '#....D.........D..RRRRRRRRRR.d.#',
      '#....#..+......#...............#',
      '##D###....a....#..NNNNNNNNNN...#',
      '#....###########..NNNNNNNNNN.b.#',
      '#.a..#......................B..#',
      '#....#..SSSS..SSSS....b........#',
      '#.x..D..SSSS..SSSS....CCC..CCC.#',
      '#.F..#.............b...........#',
      '#....#..SSSS..SSSS.............#',
      '#.+..#..SSSS..SSSS...####1######',
      '######..B............#.........#',
      '#....W.....d.........#...o.....#',
      '#....#...............#..RRRRR..#',
      '#.r..D...NNNN..NNNN..#..RRRRR..#',
      '#....#...NNNN..NNNN..#.........#',
      '#.b..#.....e.........W.o.....+.#',
      '#....#.......b.......#..SSSSS..#',
      '#.H..#.......A.......#..SSSSS..#',
      '#....#...........B...#.........#',
      '#.x..#.......a.......#....s....#',
      '###########################X####',
    ],
  },
  1: {
    intro: "The virus has spread to the cooling zone. Infected drones patrol the cold aisles. Blue badge, then red badge: the terminal is waiting at the back of the network room.",
    map: [
      '################################',
      '#P..#....................#.....#',
      '#...D..RRRRRR....RRRRRR..D..u..#',
      '#...#..RRRRRR....RRRRRR..#.d...#',
      '#.a.#........d...........#..+..#',
      '#...#..RRRRRR....RRRRRR..#######',
      '##D##..RRRRRR....RRRRRR..#.....#',
      '#.......b.........b......2..M..#',
      '#.+...CCC..CCC..CCC..CCC.#.o...#',
      '#..x................B....#.a...#',
      '######D############1#######D####',
      '#.......#..............#.......#',
      '#..SSS..#..NNNN..NNNN..#..SS...#',
      '#..SSS..#..NNNN..NNNN..#..SS...#',
      '#.....o.#......o.......#..SS.r.#',
      '#..SSS..#..NNNN..NNNN..#.......#',
      '#..SSS..#..NNNN..NNNN..#..SS...#',
      '#.......#..............#..SS...#',
      '#.s.H...#....b....b....#..SS...#',
      '#..SSS..W......e.......W.......#',
      '#..SSS..#..CCC....CCC..#.o..s..#',
      '#....A..#......B.......#.......#',
      '#.......#...a.....o....#...c...#',
      '#################X##############',
    ],
  },
  49: {
    intro: "The RANSOMWARE has taken physical form in the datacenter kernel. It encrypts everything in its path. Force your way in and reboot the world. No backup, no mercy.",
    map: [
      '################################',
      '#P..........#.......#..........#',
      '#..NNNNNN...D...d...D..SSSSSS..#',
      '#..NNNNNN...#.......#..SSSSSS..#',
      '#......b....#...+...#......o...#',
      '#.a.........#.......#..SSSSSS..#',
      '#..NNNNNN...#..o....#..SSSSSS..#',
      '#..NNNNNN...#.......#..........#',
      '#......d....#...s...#..b.u..A..#',
      '#.x.........#.......#...s......#',
      '###2######################1#####',
      '#.........#..B...............B.#',
      '#..SSSS...#..RR....RR....RR....#',
      '#..SSSS...#..RR....RR....RR....#',
      '#.....L.k.#....................#',
      '#..SSSS...#.......d......d.....#',
      '#..SSSS...#..........Z.........#',
      '#.........#..k..............k..#',
      '#.r..o....#..RR....RR....RR....#',
      '#.........#..RR....RR....RR....#',
      '#..H..c...#.....c.........c....#',
      '#.s....a..#...H.........s......#',
      '#.....c...#..........A....c....#',
      '###############X################',
    ],
  },
};

// First level in which each weapon appears.
const WEAPON_FIRST_LEVEL = { F: 0, M: 1, K: 4, G: 7, Y: 11, L: 15 };

function levelSpec(i) {
  const ep = Math.floor(i / 10), k = i % 10;
  const R = LevelGen.rng(4242 + i * 31);
  const weapons = [];
  for (const [ch, first] of Object.entries(WEAPON_FIRST_LEVEL)) {
    if (first === i) weapons.push(ch);
    else if (first < i && R() < 0.25) weapons.push(ch);
  }
  const has = (ch) => WEAPON_FIRST_LEVEL[ch] <= i;
  return {
    seed: 1000 + i * 97,
    name: LEVEL_NAMES[i],
    episode: ep,
    w: Math.min(56, 30 + ep * 5 + k),
    h: Math.min(42, 22 + ep * 4 + Math.floor(k / 2)),
    boss: k === 9 ? EPISODES[ep].boss : null,
    keys: i < 4 ? 1 : (R() < 0.35 ? 1 : 2),
    secret: true,
    barrels: Math.min(0.6, 0.25 + ep * 0.08),
    fountains: R() < 0.5 ? 1 : 0,
    enemies: Math.round(9 + i * 0.8 + ep * 1.5),
    enemyPool: {
      b: Math.max(1, 4 - ep), d: i >= 1 ? 3 : 0, o: i >= 3 ? 3 : 0,
      t: i >= 6 ? 2 + (ep >= 2 ? 1 : 0) : 0, m: i >= 12 ? 2 + (ep >= 3 ? 1 : 0) : 0,
    },
    items: {
      '+': 3 + ep, H: 1 + (i >= 20 ? 1 : 0) + (k === 9 ? 2 : 0), A: R() < 0.5 || k === 9 ? 1 : 0, j: R() < 0.4 ? 1 : 0,
      a: 3 + ep, s: 2 + (ep >= 2 ? 1 : 0), k: has('K') ? 1 + Math.floor(ep / 2) + (k === 9 ? 2 : 0) : 0,
      g: has('G') ? 1 : 0, c: has('Y') ? 2 + (k === 9 ? 3 : 0) : 0,
    },
    weapons,
    secretLoot: ['A', 'H', has('K') ? 'k' : 's', has('L') ? 'c' : 'a', 'j'],
  };
}

const levelCache = {};
function getLevel(i) {
  if (levelCache[i]) return levelCache[i];
  const ep = Math.floor(i / 10), k = i % 10;
  const code = `E${ep + 1}M${k + 1}`;
  let def;
  if (HANDMADE[i]) {
    def = { map: LevelGen.placeSpecials(HANDMADE[i].map, 777 + i), intro: HANDMADE[i].intro };
  } else {
    const spec = levelSpec(i);
    const gen = LevelGen.generate(spec);
    const obj = spec.boss ? `${BOSS_NAMES[spec.boss].replace(/^./, (c) => c.toUpperCase())} guards the REBOOT terminal. Destroy it.`
      : spec.keys >= 2 ? 'Blue badge, red badge, then the REBOOT terminal.' : 'Find the red badge and reach the REBOOT terminal.';
    def = { map: gen.map, intro: `${EPISODES[ep].intro} ${obj}` };
  }
  def.index = i;
  def.code = code;
  def.episode = ep;
  def.name = `${code} : ${LEVEL_NAMES[i]}`;
  def.ambient = EPISODES[ep].ambient;
  def.bossType = k === 9 ? EPISODES[ep].boss : null;
  levelCache[i] = def;
  return def;
}

const LEVEL_COUNT = 50;
