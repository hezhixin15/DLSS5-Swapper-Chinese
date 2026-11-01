'use strict';
// Rebuilds payload.lock.json from the trees that are already on disk. Run it
// deliberately after a payload change and review the diff: the diff is the
// review. A build never updates the lock on its own.
//
//   npm run payload        # build the trees; fails if they do not match the lock
//   npm run payload:lock   # write a new lock after reviewing the change
const fs = require('fs');
const path = require('path');
const { LOCK_SCHEMA, hashTree } = require('../src/core/payload-lock');

const ROOT = path.resolve(__dirname, '..');
const ROOTS = ['payload', 'addons', 'overlay-bin'];
const LOCK = path.join(ROOT, 'payload.lock.json');

async function main() {
  const lock = { schema: LOCK_SCHEMA, roots: {} };
  for (const name of ROOTS) {
    const dir = path.join(ROOT, name);
    let files;
    try {
      files = await hashTree(dir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`${name}/ does not exist. Run npm run payload first.`);
      }
      throw error;
    }
    lock.roots[name] = { files };
    console.log(`${name}: ${files.length} file${files.length === 1 ? '' : 's'}`);
  }
  fs.writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(ROOT, LOCK)}. Review the diff before committing it.`);
}

main().catch((error) => {
  console.error(`payload:lock failed: ${error.message}`);
  process.exit(1);
});
