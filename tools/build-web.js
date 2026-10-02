#!/usr/bin/env node
// Copies the files the game needs into dist/: the folder packaged by the
// desktop app (src-tauri) and zipped for the web release.
// Node rather than a shell script so that it also runs on Windows.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
for (const p of ['index.html', 'js', 'fonts', 'docs/icon.png']) {
  fs.cpSync(path.join(root, p), path.join(dist, p), { recursive: true });
}
// the version shown by the update check: the one of the desktop app (set from the git tag by the release workflow)
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
fs.writeFileSync(path.join(dist, 'js', 'version.js'), `'use strict';\nconst GAME_VERSION = '${version}';\n`);
console.log(`dist/ ready (version ${version})`);
