'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const scan = require('../src/core/scan');
const routes = require('../src/shared/install-routes');
const renderingApi = require('../src/shared/rendering-api');

test('Cities: Skylines II reads as DirectX 11, not the Unity player\'s OpenGL fallback', () => {
  const profile = scan.gameApiProfile('D:/Steam/steamapps/common/Cities Skylines II/Cities2.exe');
  assert.equal(profile.detected.api, 'dxgi');
  assert.equal(profile.detected.label, 'DirectX 11');
  assert.equal(profile.detected.via, 'game-profile');
  // The game offers no renderer switch, so DirectX 11 stays the only choice.
  assert.deepEqual(profile.choices, [{ api: 'dxgi', label: 'DirectX 11' }]);

  const target = {
    path: 'D:/Games/Cities2.exe', bitness: 64, hasNativeDlss: true,
    api: profile.detected.api, apiLabel: profile.detected.label
  };
  // A 64-bit DX11 game with its own DLSS: the honest offers, with nothing
  // OpenGL-flavoured left over from the wrong detection.
  assert.deepEqual(routes.routesFor(target), ['feeder', 'optiscaler', 'renodx']);
  assert.equal(renderingApi.effective(target, 'auto').apiLabel, 'DirectX 11');
  // Any casing of the executable name reaches the same profile.
  assert.equal(scan.gameApiProfile('D:/Games/cities2.exe').detected.label, 'DirectX 11');
  // The profile is exact-name: another Unity binary in the same folder is
  // left to the generic detection.
  assert.equal(scan.gameApiProfile('D:/Games/Cities II.exe'), null);
});
