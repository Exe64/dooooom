# DOOOOOM — L'enfer du datacenter

FPS rétro jouable dans le navigateur, façon Doom, dont les niveaux sont des datacenters.
Vous êtes l'ingénieur d'astreinte : un ransomware a pris le contrôle des salles serveurs
et ses processus corrompus ont pris forme physique entre les baies.

Aucun asset externe : textures, sprites, armes et sons sont générés par le code
(canvas 2D + Web Audio API). Pas de build, pas de dépendance.

## Jouer

Ouvrir `index.html` dans un navigateur, ou servir le dossier :

```sh
python3 -m http.server 8000
# puis http://localhost:8000
```

Le jeu fonctionne aussi tel quel sur GitHub Pages.

## Commandes

| Touche | Action |
| --- | --- |
| ZQSD / WASD / ↑↓ | Se déplacer (AZERTY et QWERTY) |
| Souris / ← → | Tourner |
| Clic / Ctrl | Tirer |
| E / Espace | Ouvrir une porte, activer le terminal de REBOOT |
| 1-5 / molette | Changer d'arme |
| Maj | Courir |
| Tab / M | Plan du datacenter |
| Échap / P | Pause (réglage de la sensibilité souris) |
| N | Couper le son |

Les codes de triche d'origine fonctionnent : `iddqd` (mode root) et `idkfa`.

## Contenu

**Niveaux**
1. DC-01 : Salle blanche Paris-Nord
2. DC-02 : Allées froides
3. DC-03 : Cœur de réseau (boss)

**Arsenal** : clavier mécanique, pistolet Ping, fusil à paquets, mitrailleuse Gigabit, canon Overclock.

**Ennemis** : Bugs (corps à corps), Drones viraux, Bots BSOD (rafales) et le RANSOMWARE, qui génère des bugs.

**Objets** : café, kit de secours, firewall (armure), paquets, trames jumbo, cellules d'énergie, badges rouge et bleu.

## Structure

```
index.html              page, écrans de menu, styles
js/levels.js            cartes ASCII des niveaux (légende en tête du fichier)
js/textures.js          génération procédurale des textures et sprites
js/audio.js             effets sonores synthétisés
js/game.js              moteur de raycasting, IA, armes, HUD, boucle de jeu
tools/validate-levels.js vérification des cartes (dimensions, bordures, accessibilité)
```

## Créer un niveau

Ajoutez une entrée dans `LEVELS` (`js/levels.js`) en suivant la légende, puis vérifiez-la :

```sh
node tools/validate-levels.js
```

Le script contrôle que chaque ligne a la même longueur, que la carte est fermée,
que chaque porte est encadrée par des murs, et que toutes les cases, ainsi que
la sortie, sont accessibles avec les badges disponibles.
