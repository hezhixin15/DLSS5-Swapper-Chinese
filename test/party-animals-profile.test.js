'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const scan = require('../src/core/scan');
const routes = require('../src/shared/install-routes');
const renderingApi = require('../src/shared/rendering-api');

test('Party Animals reads as DirectX 11, not the Unity player\'s OpenGL fallback', () => {
  const profile = scan.gameApiProfile('D:/Steam/steamapps/common/Party Animals/PartyAnimals.exe');
  assert.equal(profile.detected.api, 'dxgi');
  assert.equal(profile.detected.label, 'DirectX 11');
  assert.equal(profile.detected.via, 'game-profile');
  // The game offers no renderer switch, so DirectX 11 stays the only choice.
  assert.deepEqual(profile.choices, [{ api: 'dxgi', label: 'DirectX 11' }]);

  const target = { path: 'D:/Games/PartyAnimals.exe', bitness: 64, api: profile.detected.api, apiLabel: profile.detected.label };
  // A 64-bit DX11 game without native DLSS: the honest offers, with nothing
  // OpenGL-flavoured left over from the wrong detection.
  assert.deepEqual(routes.routesFor(target), ['feeder', 'renodx']);
  assert.equal(renderingApi.effective(target, 'auto').apiLabel, 'DirectX 11');
  // Any casing of the executable name reaches the same profile.
  assert.equal(scan.gameApiProfile('D:/Games/partyanimals.exe').detected.label, 'DirectX 11');
});
