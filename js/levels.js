'use strict';
/*
 * Niveaux : 5 épisodes de 10 niveaux. Les niveaux E1M1, E1M2 et le final E5M10
 * sont dessinés à la main ; les autres sont générés (js/levelgen.js) avec une
 * graine fixe, ils sont donc identiques à chaque partie.
 *
 * Murs        # béton   R rack calcul   S baie de stockage   N rack réseau
 *             C armoire de climatisation   W mur "danger"   X terminal de sortie
 * Portes      D porte   1 porte badge rouge   2 porte badge bleu   ? passage secret
 * Joueur      P
 * Ennemis     b bug   d drone viral   o bot BSOD   t troll de forum   m spammeur
 *             Z boss de l'épisode
 * Objets      + café   H kit de secours   A firewall (armure)   j boisson énergisante
 *             a écrous cagés   s trames jumbo   k modules SFP (roquettes)
 *             g disques durs (grenades)   c cellules d'énergie   r badge rouge   u badge bleu
 * Armes       F fusil à paquets   M riveteuse gatling   K bazooka SFP
 *             G lance-disques durs   Y compresseur ZIP   L canon overclock
 * Racks spé.  3 Broadcom ESXi   4 Proxmox   5 Vates   6 Hyper-V   7 Nutanix
 *             (placés automatiquement : 2 ESXi, 1 Proxmox, 1 Vates, 1 Hyper-V par niveau ;
 *             un coup de clavier les migre vers Nutanix)
 * Décor       x palette de serveurs (bloquant)   B batterie d'onduleur (explosive)
 *             e extincteur   f fontaine à eau (utilisable)
 */

const EPISODES = [
  { name: 'SALLES BLANCHES', boss: 'botnet', ambient: 1.0,
    intro: "Les salles serveurs sont infestées. Les bugs rampent entre les baies et quelqu'un a mis la prod en read-only." },
  { name: 'ZONE DE REFROIDISSEMENT', boss: 'miner', ambient: 0.85,
    intro: "La clim tourne à fond, les drones viraux aussi. Il fait 14°C et c'est vous qui allez chauffer." },
  { name: 'CŒUR DE RÉSEAU', boss: 'rootkit', ambient: 0.8,
    intro: "Les câbles sont des spaghettis, les trolls ont pris la meet-me room. Personne ne route sans votre accord." },
  { name: 'ARCHIVES FROIDES', boss: 'zeroday', ambient: 0.68,
    intro: "Bandes magnétiques, baies SAN et snapshots oubliés depuis 2009. Il fait noir et ça sent le RAID dégradé." },
  { name: "L'HYPERSCALE", boss: 'ransomware', ambient: 0.9,
    intro: "Des hectares de serveurs à perte de vue. Le RANSOMWARE vous attend au bout. Il n'a pas de backup. Vous non plus." },
];

const LEVEL_NAMES = [
  'SALLE BLANCHE PARIS-NORD', 'ALLÉES FROIDES', 'LOCAL ONDULEURS', 'QUAI DE LIVRAISON', 'SALLE DE BRASSAGE',
  'CAGE CLIENT 42', 'LE NOC', 'SALLE TGBT', 'MEZZANINE TECHNIQUE', 'REPAIRE DU BOTNET',
  'GROUPES FROIDS', 'FAUX PLANCHER', 'ALLÉE CHAUDE', 'TOUR AÉRORÉFRIGÉRANTE', 'SALLE DES CRAC',
  'CONFINEMENT', 'FREE COOLING', "CIRCUIT D'EAU GLACÉE", 'SALLE DES POMPES', 'FERME DE MINAGE',
  'MEET-ME ROOM', 'SPINE & LEAF', 'SALLE OPÉRATEURS', 'CROSS-CONNECT', 'BACKBONE',
  'ZONE DMZ', 'PARE-FEU PÉRIMÉTRIQUE', 'ROUTEURS DE BORDURE', 'TABLE BGP', 'NID DU ROOTKIT',
  'BANDOTHÈQUE', 'SALLE DES DISQUES', 'BAIES SAN', 'RAID 5 DÉGRADÉ', 'SNAPSHOTS OUBLIÉS',
  'COFFRE DE SAUVEGARDE', 'OBJECT STORAGE', 'DÉDUPLICATION', 'LE PLAN DE REPRISE', 'FAILLE ZERO-DAY',
  'HALL HYPERSCALE A', 'ZONE DE DISPONIBILITÉ 2', 'RÉGION EU-WEST', 'FERME GPU', 'CLUSTER KUBERNETES',
  'CONTROL PLANE', 'SERVERLESS', 'EDGE COMPUTING', 'SALLE DES HSM', 'LE NOYAU',
];

const BOSS_NAMES = { botnet: 'le BOTNET', miner: 'le CRYPTOMINEUR', rootkit: 'le ROOTKIT', zeroday: 'la ZERO-DAY', ransomware: 'le RANSOMWARE' };

const HANDMADE = {
  0: {
    intro: "3h12. Alerte PagerDuty. Les serveurs de la salle 1 ne répondent plus... et quelque chose rampe entre les baies. Trouvez le badge rouge et atteignez le terminal de REBOOT.",
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
    intro: "Le virus s'est propagé à la zone de refroidissement. Les drones infectés patrouillent les allées froides. Badge bleu, puis badge rouge : le terminal vous attend au fond de la salle réseau.",
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
    intro: "Le RANSOMWARE s'est incarné dans le noyau du datacenter. Il chiffre tout sur son passage. Forcez l'accès et rebootez le monde. Pas de backup, pas de pitié.",
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

// Premier niveau où chaque arme apparaît.
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
    const obj = spec.boss ? `${BOSS_NAMES[spec.boss].replace(/^./, (c) => c.toUpperCase())} garde le terminal de REBOOT. Détruisez-le.`
      : spec.keys >= 2 ? 'Badge bleu, badge rouge, puis le terminal de REBOOT.' : 'Trouvez le badge rouge et atteignez le terminal de REBOOT.';
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
