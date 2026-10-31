'use strict';
// The anti-cheat list is a plain text file the maintainer edits in the repo,
// one English game name per line. This module holds everything about reading
// it and telling whether a game is named in it: no fs and no fetch, so the
// rules below can be tested on their own.
const LIMITS = {
  maxBytes: 512 * 1024,
  maxLines: 5000,
  maxLine: 100,
  // A partial match is only trusted when both sides are long enough: a short
  // stem like "escape" would otherwise flag everything called Escape*. Short
  // names can still match exactly, which is how "cod" finds cod.exe.
  minPrefix: 8
};

// "Escape from Tarkov", "EscapeFromTarkov-Win64-Shipping.exe" and a folder
// called "Escape from Tarkov" all become the same key. Punctuation carries no
// meaning here, so it is dropped rather than guessed at.
function normalize(text) {
  return String(text == null ? '' : text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

// A maintainer may paste a name out of a Markdown list or table. Strip only
// what wraps the name, never the name itself.
function cleanLine(line) {
  return String(line == null ? '' : line)
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .replace(/`/g, '')
    .trim();
}

function reject(names, error) { return { ok: false, names: [], error }; }

// A broken file is refused whole. Half a download must never quietly shrink
// what the app warns about.
function parse(text) {
  if (typeof text !== 'string') return reject([], 'errListNotText');
  if (Buffer.byteLength(text, 'utf8') > LIMITS.maxBytes) return reject([], 'errListTooBig');
  const lines = text.split(/\r?\n/);
  if (lines.length > LIMITS.maxLines) return reject([], 'errListTooManyLines');
  const names = [];
  for (const line of lines) {
    if (!line.trim() || /^\s*(#|\/\/)/.test(line)) continue;
    const name = cleanLine(line);
    if (!name) continue;
    if (name.length > LIMITS.maxLine) return reject([], 'errListLineTooLong');
    // Control characters and path separators have no place in a game name and
    // only ever appear in something trying to be more than a name.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f\\/]/.test(name) || name.includes('..')) continue;
    if (names.includes(name)) continue;
    names.push(name);
  }
  return { ok: true, names, error: null };
}

// Index by normalized name so the exact lookup is one map hit, and keep the
// written form to show the user which list entry flagged their game.
function index(names) {
  const byKey = new Map();
  for (const name of (Array.isArray(names) ? names : [])) {
    const key = normalize(name);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, name);
  }
  return byKey;
}

// The extension is not part of a game's name: "cod.exe" is the game "cod",
// and a short name like that must still match exactly.
function exeStem(file) {
  return String(file == null ? '' : file).replace(/\.[^.\\/]+$/, '');
}

// game: { title, dir, exe } - whatever the scanner knows this game as.
// Returns the list entry that flagged it, or null.
function match(names, game) {
  const byKey = index(names);
  const keys = [game && game.title, game && game.dir, exeStem(game && game.exe)]
    .map(normalize).filter(Boolean);
  for (const key of keys) {
    const hit = byKey.get(key);
    if (hit) return { name: hit, key };
  }
  // Prefixes cover executable names that carry a build suffix
  // ("EscapeFromTarkov-Win64-Shipping") and titles that carry a sequel number
  // ("Rainbow Six Siege" against "RainbowSix.exe"). Longest entry wins so the
  // banner names the game as precisely as the list allows.
  let best = null;
  for (const [listKey, name] of byKey) {
    if (listKey.length < LIMITS.minPrefix) continue;
    if (!keys.some(key => key.length >= LIMITS.minPrefix &&
      (key.startsWith(listKey) || listKey.startsWith(key)))) continue;
    if (!best || listKey.length > best.key.length) best = { name, key: listKey };
  }
  return best;
}

// What changed between two lists, in the names as written: the update dialog
// shows this so the reader can see what they are agreeing to.
function diff(oldNames, newNames) {
  const before = new Set((Array.isArray(oldNames) ? oldNames : []).map(normalize));
  const after = new Set((Array.isArray(newNames) ? newNames : []).map(normalize));
  return {
    added: (Array.isArray(newNames) ? newNames : []).filter(name => !before.has(normalize(name))),
    removed: (Array.isArray(oldNames) ? oldNames : []).filter(name => !after.has(normalize(name)))
  };
}

module.exports = { LIMITS, normalize, cleanLine, parse, index, match, diff };
