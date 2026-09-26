'use strict';
/*
 * Niveaux : grilles ASCII de 32 x 24.
 *
 * Murs        # béton   R rack calcul   S baie de stockage   N rack réseau
 *             C armoire de climatisation   W mur "danger"   X terminal de sortie
 * Portes      D porte   1 porte badge rouge   2 porte badge bleu
 * Joueur      P
 * Ennemis     b bug   d drone viral   o bot BSOD   Z Ransomware (boss)
 * Objets      + café   H kit de secours   A firewall (armure)
 *             a paquets   s trames jumbo   c cellules d'énergie
 *             r badge rouge   u badge bleu
 *             F fusil à paquets   M mitrailleuse gigabit   L canon overclock
 * Décor       x palette de serveurs (bloquant)   e extincteur
 */
const LEVELS = [
  {
    name: 'DC-01 : SALLE BLANCHE PARIS-NORD',
    intro: "3h12. Alerte PagerDuty. Les serveurs de la salle 1 ne répondent plus... et quelque chose rampe entre les baies. Trouvez le badge rouge et atteignez le terminal de REBOOT.",
    ambient: 1.0,
    map: [
      '################################',
      '#P...#.........#...............#',
      '#....#..b......#..RRRRRRRRRR...#',
      '#....D.........D..RRRRRRRRRR.d.#',
      '#....#..+......#...............#',
      '##D###....a....#..NNNNNNNNNN...#',
      '#....###########..NNNNNNNNNN.b.#',
      '#.a..#.........................#',
      '#....#..SSSS..SSSS....b........#',
      '#.x..D..SSSS..SSSS....CCC..CCC.#',
      '#.F..#.............b...........#',
      '#....#..SSSS..SSSS.............#',
      '#.+..#..SSSS..SSSS...####1######',
      '######...............#.........#',
      '#....W.....d.........#...o.....#',
      '#....#...............#..RRRRR..#',
      '#.r..D...NNNN..NNNN..#..RRRRR..#',
      '#....#...NNNN..NNNN..#.........#',
      '#.b..#.....e.........W.o.....+.#',
      '#....#.......b.......#..SSSSS..#',
      '#.H..#.......A.......#..SSSSS..#',
      '#....#...............#.........#',
      '#.x..#.......a.......#....s....#',
      '###########################X####',
    ],
  },
  {
    name: 'DC-02 : ALLÉES FROIDES',
    intro: "Le virus s'est propagé à la zone de refroidissement. Les drones infectés patrouillent les allées froides. Badge bleu, puis badge rouge : le terminal vous attend au fond de la salle réseau.",
    ambient: 0.85,
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
      '#..x.....................#.a...#',
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
      '#....A..#..............#.......#',
      '#.......#...a.....o....#...c...#',
      '#################X##############',
    ],
  },
  {
    name: 'DC-03 : CŒUR DE RÉSEAU',
    intro: "Le RANSOMWARE s'est incarné dans le cœur de réseau. Il chiffre tout sur son passage. Récupérez le canon Overclock, forcez l'accès et rebootez le datacenter. Pas de backup, pas de pitié.",
    ambient: 0.75,
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
      '#.........#....................#',
      '#..SSSS...#..RR....RR....RR....#',
      '#..SSSS...#..RR....RR....RR....#',
      '#.....L...#....................#',
      '#..SSSS...#.......d......d.....#',
      '#..SSSS...#..........Z.........#',
      '#.........#....................#',
      '#.r..o....#..RR....RR....RR....#',
      '#.........#..RR....RR....RR....#',
      '#..H..c...#.....c.........c....#',
      '#.s....a..#...H.........s......#',
      '#.....c...#..........A....c....#',
      '###############X################',
    ],
  },
];
