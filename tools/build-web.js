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
console.log('dist/ ready');
