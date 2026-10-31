'use strict';
// Where the anti-cheat list lives on disk and what is in it right now. The
// downloaded copy wins, the snapshot that shipped with this version only
// fills the gap before the first download: a fresh install must warn about
// the known titles without ever touching the network.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const list = require('./anti-cheat-list');

const FILE_NAME = 'anti-cheat-list.txt';
const bundledFile = () => path.join(__dirname, '..', 'data', FILE_NAME);

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}
function hash(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

// userData is passed in rather than asked of Electron, so this stays testable
// and the caller decides what "%APPDATA%/<app>" means for this build.
function load(userData) {
  for (const [source, text] of [
    ['downloaded', read(path.join(String(userData || ''), FILE_NAME))],
    ['bundled', read(bundledFile())]
  ]) {
    if (text == null) continue;
    const parsed = list.parse(text);
    if (parsed.ok) return { names: parsed.names, source, text, hash: hash(text) };
  }
  return { names: [], source: 'none', text: '', hash: '' };
}

// Atomic replace: a half-written list must never be what the next launch reads.
function save(userData, text) {
  const file = path.join(String(userData || ''), FILE_NAME);
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, text, 'utf8');
    fs.renameSync(temporary, file);
    return { ok: true, file, hash: hash(text), names: list.parse(text).names };
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* the target kept its old list */ }
    return { ok: false, file, error };
  }
}

module.exports = { FILE_NAME, bundledFile, read, hash, load, save };
