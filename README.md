<p align="center">
  <img src="docs/banner.jpg" alt="Duke Nutanix: The admin is back" width="100%">
</p>

# DUKE NUTANIX: The admin is back

A retro first-person shooter that runs in the browser, in the spirit of Duke Nukem 3D, where every level is a datacenter.
A ransomware has seized the server rooms and its corrupted processes have taken physical form between the racks.
The on-call admin, with his shades and his oversized ego, sets out to reboot everything: 5 episodes, 50 levels.

No external assets: textures, logos, sprites, weapons and sounds are all generated in code
(2D canvas + Web Audio API, with the admin's voice provided by the browser's speech synthesis). No build step, no dependencies.

Two visual styles, switched with **T**, from the title screen or from the pause menu (the choice is remembered):
- **MODERN** (default): a real 3D renderer on the GPU (WebGL2, `js/gl.js`) at the screen's native resolution,
  with per-pixel lighting, reflections, HDR post-processing and 3D props. You can look up and down with the mouse.
- **RETRO**: a renderer that follows Doom's own limits (`js/retro.js`), described below.

### The MODERN style

- **Geometry**: the grid becomes real walls, floors and ceilings; doors slide into the wall and secret walls
  slide back as real panels. Everything is depth tested, so sprites and props sit properly in the room.
- **Textures** keep logos, cabling and labels readable. They are stored in texture arrays with mipmaps and
  anisotropic filtering: distant floors and racks don't shimmer.
- **Lighting**, computed per pixel:
  - a directional lightmap baked per level (8 texels per cell): pools of light under the ceiling panels with soft
    shadows, green glow from the exit signs, red and blue from badge doors, LED spill from the racks, ambient occlusion,
    and the direction the light comes from, so surfaces are shaded against the real lamps;
  - normal, gloss and specular maps derived from every texture: grooves between rack units, rivets, door ribs,
    floor tiles catch the light;
  - up to 16 dynamic lights (muzzle flashes, projectiles, explosions, armed UPS batteries) with wall shadows;
  - the raised floor reflects the room (planar reflection, blurred by roughness, with Fresnel).
- **Objects**: pallets of servers, UPS batteries, water coolers and extinguishers are real meshes built from the same
  boxes as their sprites. Monsters show 8 rotations (you can see where they look) and, like items, are lit as volumes
  through a relief map, so lamps and explosions model them from the side. Everything standing on the floor casts a
  soft contact shadow.
- **Particles**: streaking sparks that bounce, embers, smoke, debris in the monsters' colors, ejected shells.
- **Post-processing**: HDR rendering with 4x MSAA, screen-space ambient occlusion, volumetric haze with light shafts
  under the ceiling panels, multi-level bloom, ACES tone mapping, a color grade and haze density per episode
  (icy blue in the cooling zone, sodium lamps in the archives...), vignette, slight chromatic aberration and film grain.
- **Weapons in hand** are small 3D models (boxes and tubes) rendered in perspective with per-face lighting:
  pixelated and outlined in RETRO, anti-aliased at 4x resolution in MODERN. They dim in dark areas and light up when firing.

Press **G** to switch to the LOW graphics mode (no reflections, dynamic lights, occlusion or haze). On a slow GPU the
game first lowers the 3D resolution, then switches to LOW by itself. Without WebGL2, MODERN uses the previous software
renderer (720x346 view, smoothly upscaled, with the baked lightmap, dynamic lights and bloom).

### The RETRO style, Doom-accurate

- **320x200**, like VGA Mode 13h: a 320x168 3D view above a 32 pixel status bar.
  The frame is shown at 4:3, so each pixel is 1.2 times taller than wide, as on a CRT;
  the vertical projection compensates so that rooms and monsters keep their proportions. 90 degree field of view.
- **256 colors**, one fixed palette built from strict ramps (grays, steel, concrete, reds, greens, blues,
  Nutanix purple...) like Doom's `PLAYPAL`, plus 16 fixed brand and LED colors. Every texture and sprite is
  quantized to it once; the frame is a buffer of palette indices.
  **Palette flashes** swap the whole palette for a pre-tinted copy, as in Doom: 8 reds when you take damage,
  4 golds on pickups, green under TURBO (Doom's radiation suit).
- **No 3D lights.** Each map cell has a brightness from 0 to 255 in steps of 16 (Doom's sector light),
  taken from the baked lightmap. A 32 level **COLORMAP** darkens colors with distance down to near black,
  which gives the natural fog of dim rooms. Walls get Doom's fake contrast (east-west faces brighter),
  emissive texels (LEDs, screens, exit signs) stay full bright, and firing briefly raises the light level.
- **Vertical walls** with repeating 128 texel patches; floors and ceilings are **64x64 flats**.
- **Sprites** are strict billboards. Monsters have **8 rotations** (front, three-quarters, profile, back),
  so you can see where they look and sneak behind an idle one. Props use 8 of their 16 rotations.
  The weapon is drawn at the bottom center at native resolution and swings left and right as you walk.
  No vertical look (aiming is automatic in height, as in Doom).
- **35 FPS**: the game logic advances in Doom's 35 Hz tics and a frame is drawn per tic.
  Animations keep 2 to 4 frames per action.
- The status bar, messages and automap are drawn in the 320x200 frame with a 3x5 pixel font.

## Download and play

Grab the latest version from the [Releases page](../../releases/latest):

| System | File |
| --- | --- |
| Windows 10/11 | `Duke.Nutanix_*_x64-setup.exe` (or the `.msi`) |
| macOS 10.15+ (Intel and Apple silicon) | `Duke.Nutanix_*_universal.dmg` |
| Linux | `.AppImage` (any distribution), `.deb` (Debian, Ubuntu), `.rpm` (Fedora) |
| Any browser, no install | `duke-nutanix-*-web.zip`: unzip and open `index.html` |

The desktop apps wrap the game in the system's web view (WebView2 on Windows, WebKit on macOS and Linux)
with [Tauri](https://tauri.app), so they stay small: a few MB, except the AppImage (about 80 MB) which carries its own WebKit. They are not signed with a paid certificate yet:
- **Windows**: SmartScreen shows "Windows protected your PC": click **More info** then **Run anyway**.
- **macOS**: if it says the app is damaged or cannot be checked, move it to Applications and run
  `xattr -cr "/Applications/Duke Nutanix.app"` in a Terminal, or right-click the app and choose **Open**.
- **Linux**: make the AppImage executable (`chmod +x Duke*.AppImage`). The admin's voice needs a browser
  with speech synthesis; WebKitGTK has none, so on Linux the one-liners are subtitles only.

From the source, open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Progress is saved locally (CONTINUE button, and a level select for unlocked levels).

### Building a release

Push a version tag and GitHub Actions does the rest (`.github/workflows/release.yml`):

```sh
git tag v1.0.0 && git push origin v1.0.0
```

It checks the levels, zips the web version, builds the desktop apps on Windows, macOS and Linux,
attaches everything to a draft release and publishes it once all builds succeed.
Running the workflow by hand (Actions, Release, Run workflow) builds the same files as run artifacts, without a release.

To build the desktop app locally, install [Rust](https://rustup.rs), Node.js and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/), then:

```sh
cd src-tauri
npx @tauri-apps/cli@2 build      # or "dev" to run it without packaging
```

## Controls

| Key | Action |
| --- | --- |
| WASD / ZQSD / ↑↓ | Move (QWERTY and AZERTY) |
| Mouse / ← → | Turn (and look up and down with the mouse in MODERN) |
| Click / Ctrl | Fire |
| E / Space | Open doors, search walls (secret areas), drink from water coolers, activate the REBOOT terminal |
| 1-8 / wheel | Switch weapon |
| Shift | Run |
| Tab / M | Datacenter map |
| Esc / P | Pause (mouse sensitivity, graphics, style) |
| N / V | Mute sound / the admin's voice |
| G | Graphics quality (high / low) |
| T | Style: modern / retro (Doom-like 320x200) |

Cheat codes: `iddqd` (root mode) and `idkfa`.

## Nutanix migrations

Every level contains 5 special racks, each in its vendor's colors:

| Rack | Count | Colors |
| --- | --- | --- |
| Broadcom ESXi | 2 | Broadcom red, round badge |
| Proxmox | 1 | orange and black, the "X" |
| Vates XCP-ng | 1 | navy and blue |
| Hyper-V | 1 | the four Microsoft squares |

Hit one with the **keyboard** (weapon 1) and it migrates into a **Nutanix** rack (charcoal and Iris purple).
Migrating all 5 racks in a level grants an armor bonus. The counter is shown in the top-right corner
and in the end-of-level summary.

## Arsenal

| # | Weapon | Ammo |
| --- | --- | --- |
| 1 | Mechanical keyboard (also the migration tool) | none |
| 2 | Cage nut pistol | M6 cage nuts |
| 3 | Packet shotgun | jumbo frames |
| 4 | Gatling riveter (cage nuts) | M6 cage nuts |
| 5 | SFP bazooka | SFP+ modules |
| 6 | Hard drives (bouncing grenades) | hard drives |
| 7 | ZIP compressor: shrinks enemies so you can stomp them | energy cells |
| 8 | Overclock cannon | energy cells |

## Bestiary

- **Enemies**: bugs, viral drones, BSOD bots, forum trolls and spammers.
- **Mini-bosses** guard the exit of every x5 level. The exit stays locked until they go down.

  | Level | Mini-boss | Tactic |
  | --- | --- | --- |
  | E1M5 | Cable Spaghetti Monster | throws RJ45 plugs |
  | E2M5 | Hot Spot | fireball fans |
  | E3M5 | Packet Storm | rapid packet bursts |
  | E4M5 | Bit Rot | slow and tough, summons bugs |
  | E5M5 | Shadow IT | fast, teleports around you |

- **Bosses**, one per episode: BOTNET, CRYPTOMINER, ROOTKIT, ZERO-DAY, and the RANSOMWARE in the finale.

Also featured:
- explosive UPS batteries;
- secret areas behind fake walls;
- water coolers and energy drinks (turbo);
- the admin's one-liners, shown as subtitles and spoken by speech synthesis.

## Levels

- E1M1, E1M2 and the E5M10 finale are hand-drawn in `js/levels.js`.
- The other 47 are generated procedurally by `js/levelgen.js`, but each one from a fixed seed:
  a given level is identical in every playthrough and on every machine, as if it had been drawn once and for all.
  - BSP split into rooms linked by doors.
  - Badge doors on the critical path.
  - A secret room in a dead end.
  - Per-room decoration: rack rows with hot and cold aisles, CRAC units, pillars, storage.
  - Rising difficulty, a mini-boss on the 5th level and a boss arena on the 10th level of each episode.

Check all 50 levels:

```sh
node tools/validate-levels.js
```

For every level, the script checks:
- dimensions and borders;
- that every door is framed by walls;
- that every cell, the exit and the special racks are reachable with the available badges;
- that the exit cannot be triggered from another room;
- that every x5 level has exactly one mini-boss.

## Project layout

```
index.html               page, menus, styles
docs/banner.jpg          README banner
js/levelgen.js           procedural generator + map validation
js/levels.js             episodes, level names, hand-drawn levels, difficulty settings
js/textures.js           textures, rack logos, sprites
js/weapons.js            first-person weapon models and their pre-rendering
js/gl.js                 MODERN renderer on the GPU (WebGL2)
js/lighting.js           lightmap baking, dynamic lights, bloom
js/retro.js              RETRO renderer: 320x200, 256 color palette, COLORMAP, 35 Hz
js/audio.js              synthesized sound effects
js/game.js               raycasting engine, AI, weapons, HUD, save game, game loop
tools/validate-levels.js checks all 50 levels
tools/build-web.js       copies the game into dist/ (packaged by the desktop app, zipped for the web release)
fonts/                   Press Start 2P, bundled so the game works offline (SIL Open Font License)
docs/icon.png            app icon
src-tauri/               desktop app (Tauri): window settings, bundle formats, icons
.github/workflows/       release build
```
