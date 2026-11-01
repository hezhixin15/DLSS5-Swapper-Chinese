'use strict';
// What was promised on the tracker for the next release, each pinned where it
// lives so it cannot quietly come undone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('DirectDraw gets dgVoodoo the way DX8 and DX9 do (#292, #279, #150)', () => {
  assert.match(read('main.js'),
    /if \(api === 'd3d8' \|\| api === 'd3d9' \|\| api === 'ddraw'\) \{\s*try \{\s*p\.source\.feeder\.dgVoodooDir = await ensureDgVoodoo/);
});

test('the overlay message no longer claims an install that has not finished (#275, #292)', () => {
  const i18n = read('src', 'renderer', 'i18n.js');
  assert.doesNotMatch(i18n, /DLSS was installed normally/);
  assert.match(i18n, /overlaySkipped: \(error\) => `The in-game overlay will not be installed/);
});

test('the driver warning says "may", because it is a warning (#300, #278, #270)', () => {
  const i18n = read('src', 'renderer', 'i18n.js');
  assert.doesNotMatch(i18n, /cannot run the neural pass/);
  assert.match(i18n, /MSI Afterburner and RivaTuner closed/);
});

test('a game folder Windows will not let us write to is refused in words, up front (#301)', () => {
  assert.match(read('src', 'core', 'backend-manager.js'),
    /if \(!core\.canWrite\(config\.gameDir\)\) throw Object\.assign\(new Error\('errNoWriteAccess'\), \{ code: 'errNoWriteAccess' \}\);/);
  assert.equal((read('src', 'renderer', 'i18n.js').match(/errNoWriteAccess: '/g) || []).length, 3, 'in English, Arabic and Chinese');
});

test('every installed game has its read-only ReShade.ini cleared once per start (#155)', () => {
  const main = read('main.js');
  assert.match(main, /function repairReadOnlyConfigs\(games\)/);
  assert.match(main, /repairReadOnlyConfigs\(lastGames\);\s*return lastGames;/);
});

test('the uninstaller says uninstalling does not restore games (#266)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.build.nsis.include, 'build/installer.nsh');
  const script = read('build', 'installer.nsh');
  assert.match(script, /!macro customUnInit/);
  assert.match(script, /Restore originals/);
  assert.match(script, /isUpdated/, 'and it stays out of the way of an update');
});
