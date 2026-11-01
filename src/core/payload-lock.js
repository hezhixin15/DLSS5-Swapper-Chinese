'use strict';
// A release is only reproducible if what it ships is pinned. payload.lock.json
// records the exact files, sizes and hashes of the three trees that end up
// beside the executable, so a build either reproduces them or stops.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LOCK_SCHEMA = 1;

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function walk(root, current, out) {
  const entries = await fs.promises.readdir(path.join(root, current), { withFileTypes: true });
  for (const entry of entries) {
    const rel = current ? `${current}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(root, rel, out);
    else if (entry.isFile()) out.push(rel);
    // A symlink or device node in a payload tree would point at something the
    // lock cannot describe, so the tree is refused rather than half-checked.
    else throw new Error(`payload-lock: ${rel} is not a regular file or directory.`);
  }
  return out;
}

// Sorted by code unit, not by locale: the lock must diff the same way on every
// machine, including CI.
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

async function hashTree(root) {
  const files = (await walk(root, '', [])).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const entries = [];
  for (const rel of files) {
    const full = path.join(root, rel);
    const stat = await fs.promises.stat(full);
    entries.push({ path: rel, size: stat.size, sha256: await hashFile(full) });
  }
  return entries;
}

async function verifyTree(root, entries) {
  let actual;
  try {
    actual = await hashTree(root);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // A tree that was never built is not an exception: every pinned file is
    // simply missing, and the report says so.
    actual = [];
  }
  const wanted = new Map((Array.isArray(entries) ? entries : []).map((entry) => [entry.path, entry]));
  const found = new Map(actual.map((entry) => [entry.path, entry]));
  const missing = [];
  const extra = [];
  const mismatched = [];
  for (const [rel, entry] of wanted) {
    if (!found.has(rel)) missing.push(rel);
    else {
      const file = found.get(rel);
      if (file.size !== entry.size || file.sha256 !== entry.sha256) {
        mismatched.push({
          path: rel,
          expected: { size: entry.size, sha256: entry.sha256 },
          actual: { size: file.size, sha256: file.sha256 }
        });
      }
    }
  }
  for (const rel of found.keys()) if (!wanted.has(rel)) extra.push(rel);
  missing.sort();
  extra.sort();
  mismatched.sort(byPath);
  return {
    ok: !missing.length && !extra.length && !mismatched.length,
    files: wanted.size,
    missing,
    extra,
    mismatched
  };
}

function formatReport(result, root = 'payload') {
  if (result.ok) return `${root}: OK (${result.files} files)`;
  const lines = [`${root}: MISMATCH (${result.files} pinned)`];
  for (const rel of result.missing) lines.push(`  missing: ${rel}`);
  for (const rel of result.extra) lines.push(`  extra: ${rel}`);
  for (const entry of result.mismatched) {
    lines.push(`  changed: ${entry.path} (size ${entry.expected.size} -> ${entry.actual.size}, sha256 ${entry.expected.sha256} -> ${entry.actual.sha256})`);
  }
  return lines.join('\n');
}

module.exports = {
  LOCK_SCHEMA,
  hashTree,
  verifyTree,
  formatReport
};
