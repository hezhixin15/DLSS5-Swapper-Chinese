'use strict';
// The suite is picked here instead of by the shell. npm runs scripts through
// cmd.exe on Windows, which does not expand test/*.test.js, and Node 20's own
// glob handling reported the literal pattern as a file it could not find.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname, '..', 'test');
const files = fs.readdirSync(testDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(testDir, name));
if (!files.length) throw new Error(`No *.test.js files found in ${testDir}`);

const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
