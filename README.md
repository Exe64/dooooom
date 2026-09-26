# DUKE NUTANIX — L'admin est de retour

FPS rétro jouable dans le navigateur, dans l'esprit de Duke Nukem 3D, où les niveaux sont des datacenters.
Un ransomware s'est emparé des salles serveurs et ses processus corrompus ont pris forme physique
entre les baies. L'admin d'astreinte, avec ses lunettes noires et son ego surdimensionné, part
tout rebooter : 5 épisodes, 50 niveaux.

Aucun asset externe : textures, logos, sprites, armes et sons sont générés par le code
(canvas 2D + Web Audio API, voix par synthèse vocale du navigateur). Pas de build, pas de dépendance.

## Jouer

Ouvrir `index.html` dans un navigateur, ou servir le dossier :

```sh
python3 -m http.server 8000
# puis http://localhost:8000
```

La progression est sauvegardée dans le navigateur (bouton CONTINUER, choix des niveaux débloqués).

## Commandes

| Touche | Action |
| --- | --- |
| ZQSD / WASD / ↑↓ | Se déplacer (AZERTY et QWERTY) |
| Souris / ← → | Tourner |
| Clic / Ctrl | Tirer |
| E / Espace | Ouvrir une porte, fouiller un mur (zones secrètes), boire à la fontaine, activer le terminal de REBOOT |
| 1-8 / molette | Changer d'arme |
| Maj | Courir |
| Tab / M | Plan du datacenter |
| Échap / P | Pause (sensibilité souris) |
| N / V | Couper le son / la voix de l'admin |

Codes de triche : `iddqd` (mode root) et `idkfa`.

## Migrations Nutanix

Chaque niveau contient 5 racks spéciaux, chacun aux couleurs de sa techno :

| Rack | Nombre | Couleurs |
| --- | --- | --- |
| Broadcom ESXi | 2 | rouge Broadcom, pastille ronde |
| Proxmox | 1 | orange et noir, le « X » |
| Vates XCP-ng | 1 | bleu nuit et bleu |
| Hyper-V | 1 | les quatre carrés Microsoft |

Un coup de **clavier** (arme 1) sur l'un d'eux le migre en rack **Nutanix** (anthracite et violet Iris).
Migrer les 5 racks d'un niveau donne un bonus d'armure. Le compteur s'affiche en haut à droite
et dans le bilan de fin de niveau.

## Arsenal

| # | Arme | Munitions |
| --- | --- | --- |
| 1 | Clavier mécanique (et outil de migration) | — |
| 2 | Pistolet à écrous cagés | écrous cagés M6 |
| 3 | Fusil à paquets | trames jumbo |
| 4 | Riveteuse Gatling (écrous cagés) | écrous cagés M6 |
| 5 | Bazooka SFP | modules SFP+ |
| 6 | Disques durs (grenades qui rebondissent) | disques durs |
| 7 | Compresseur ZIP : rétrécit l'ennemi, il n'y a plus qu'à l'écraser | cellules |
| 8 | Canon Overclock | cellules |

## Bestiaire

Bugs, drones viraux, bots BSOD, trolls de forum, spammeurs, et un boss par épisode :
BOTNET, CRYPTOMINEUR, ROOTKIT, ZERO-DAY, et le RANSOMWARE en finale.

Autres éléments : batteries d'onduleur explosives, zones secrètes derrière de faux murs,
fontaines à eau, boissons énergisantes (turbo) et répliques de l'admin, affichées en sous-titres
et prononcées par la synthèse vocale.

## Niveaux

- E1M1, E1M2 et le final E5M10 sont dessinés à la main dans `js/levels.js`.
- Les 47 autres sont générés par `js/levelgen.js`, avec une graine fixe : ils sont identiques à chaque partie.
  - Découpage BSP en salles reliées par des portes.
  - Portes à badge sur le chemin critique.
  - Une salle secrète dans un cul-de-sac.
  - Décor par salle : rangées de baies en allées chaudes et froides, climatiseurs, piliers, stockage.
  - Difficulté croissante, et une arène de boss au 10e niveau de chaque épisode.

Vérifier les 50 niveaux :

```sh
node tools/validate-levels.js
```

Le script contrôle, pour chaque niveau :
- les dimensions et les bordures ;
- que chaque porte est encadrée par des murs ;
- que toutes les cases, la sortie et les racks spéciaux sont accessibles avec les badges disponibles ;
- que la sortie ne peut pas être activée depuis une autre salle.

## Structure

```
index.html               page, menus, styles
js/levelgen.js           générateur procédural + validation des cartes
js/levels.js             épisodes, noms, niveaux faits main, paramètres de difficulté
js/textures.js           textures, logos des racks, sprites
js/audio.js              effets sonores synthétisés
js/game.js               moteur de raycasting, IA, armes, HUD, sauvegarde, boucle de jeu
tools/validate-levels.js vérification des 50 niveaux
```
