'use strict';
// A release may only be cut from a tree that can be identified afterwards:
// every change committed, HEAD tagged with the version being shipped, and the
// three shipped trees exactly the ones payload.lock.json pins.
//
//   npm run release:check              # the gate on its own
//   node scripts/check-release-tree.js --allow-dirty   # local experiments only
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { LOCK_SCHEMA, verifyTree, formatReport } = require('../src/core/payload-lock');

const ROOT = path.resolve(__dirname, '..');
const ROOTS = ['payload', 'addons', 'overlay-bin'];

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const indent = (text) => text.split('\n').map((line) => `       ${line}`).join('\n');

async function checkReleaseTree({ root = ROOT, allowDirty = false } = {}) {
  const lines = [];
  let ok = true;
  const fail = (message) => { ok = false; lines.push(`FAIL ${message}`); };
  const pass = (message) => lines.push(`ok   ${message}`);

  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  } catch {
    fail('package.json is missing or unreadable');
  }

  let status = '';
  try {
    status = git(root, ['status', '--porcelain']);
  } catch (error) {
    fail(`git status failed: ${error.message}`);
  }
  if (status && !allowDirty) fail(`the working tree is not clean:\n${indent(status)}`);
  else if (status) lines.push(`warn uncommitted changes are allowed for this check:\n${indent(status)}`);
  else if (!status) pass('the working tree is clean');

  let tag = null;
  try {
    tag = git(root, ['describe', '--tags', '--exact-match', 'HEAD']);
  } catch { /* HEAD carries no exact tag */ }
  if (version && tag === `v${version}`) pass(`HEAD is tagged v${version}`);
  else fail(`HEAD is not tagged v${version || '<version>'} (found ${tag || 'no exact tag'})`);

  const lockPath = path.join(root, 'payload.lock.json');
  let lock = null;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (error) {
    fail(`payload.lock.json is missing or unreadable (${error.code || error.message})`);
  }
  if (lock) {
    if (lock.schema !== LOCK_SCHEMA) {
      fail(`payload.lock.json has schema ${lock.schema}, expected ${LOCK_SCHEMA}`);
    }
    if (!lock.roots || typeof lock.roots !== 'object' || Array.isArray(lock.roots)) {
      fail('payload.lock.json has no roots object');
    } else {
      for (const name of Object.keys(lock.roots)) {
        if (!ROOTS.includes(name)) fail(`payload.lock.json pins an unknown tree: ${name}`);
      }
      for (const name of ROOTS) {
        const entry = lock.roots[name];
        if (!entry || !Array.isArray(entry.files)) {
          fail(`payload.lock.json does not pin ${name}/`);
          continue;
        }
        const result = await verifyTree(path.join(root, name), entry.files);
        const report = formatReport(result, name);
        if (result.ok) pass(report);
        else fail(report);
      }
    }
  }

  return { ok, version, tag, lines };
}

if (require.main === module) {
  checkReleaseTree({ allowDirty: process.argv.includes('--allow-dirty') })
    .then((result) => {
      console.log(result.lines.join('\n'));
      if (!result.ok) {
        console.error('\nThe release tree is not buildable. Nothing was built.');
        process.exit(1);
      }
      console.log(`\nRelease tree OK: v${result.version}`);
    })
    .catch((error) => {
      console.error(`release:check failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { checkReleaseTree, ROOTS };
