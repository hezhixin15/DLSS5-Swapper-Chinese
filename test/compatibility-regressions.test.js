'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writePe } = require('./fixtures/pe');
const { scanGame } = require('../src/core/scan');
const { dedupe } = require('../src/library');
const core = require('../src/core/apply');
const manager = require('../src/core/backend-manager');
const compatibility = require('../src/core/compatibility');
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-compat-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('small Source, GoldSrc, UE2 and Ubisoft dispatchers use actual engine-module evidence', async t => {
  const root = temp(t);
  for (const [name, module, bitness, marker, api] of [
    ['left4dead2.exe', 'bin/shaderapidx9.dll', 32, 'Direct3DCreate9', 'd3d9'],
    ['hl2.exe', 'bin/engine.dll', 32, 'Direct3DCreate9', 'd3d9'],
    ['hl.exe', 'hw.dll', 32, 'wglCreateContext', 'opengl'],
    ['KillingFloor.exe', 'System/D3D9Drv.dll', 32, 'Direct3DCreate9', 'd3d9'],
    ['FarCry5.exe', 'bin/FC_m64.dll', 64, 'D3D11CreateDevice', 'dxgi'],
    ['Watch_Dogs.exe', 'bin/Disrupt_b64.dll', 64, 'D3D11CreateDevice', 'dxgi'],
    ['KingdomCome.exe', 'WHGame.dll', 64, 'D3D12CreateDevice', 'dxgi']
  ]) {
    const dir = path.join(root, name);
    const nested = /Killing|FarCry|Watch/.test(name) ? path.dirname(module) : '';
    const exe = writePe(path.join(dir, nested, name), { bitness });
    writePe(path.join(dir, module), { bitness, text: marker });
    writePe(path.join(dir, 'helper.exe'), { bitness, text: 'D3D12CreateDevice' });
    writePe(path.join(dir, 'dxgi.dll'), { bitness, text: 'D3D12CreateDevice' });
    const scan = await scanGame(dir);
    assert.equal(scan.chosen?.path, exe, name);
    assert.equal(scan.chosen.api, api, name);
    assert.match(scan.chosen.via, /^engine-module:/);
    assert.equal(scan.exeCandidates.length, 1);
  }
});

test('small real PE with API evidence is kept; tools and wrong-architecture modules are not', async t => {
  const dir = temp(t);
  writePe(path.join(dir, 'hl2.exe'), { bitness: 32 });
  writePe(path.join(dir, 'bin/engine.dll'), { bitness: 64, text: 'D3D12CreateDevice' });
  writePe(path.join(dir, 'ModOrganizer.exe'), { text: 'D3D12CreateDevice' });
  writePe(path.join(dir, 'REDlauncher.exe'), { text: 'D3D12CreateDevice' });
  writePe(path.join(dir, 'Generic.exe'));
  assert.equal((await scanGame(dir)).chosen, null);
  const exe = writePe(path.join(dir, 'SmallGame.exe'), { text: 'D3D11CreateDevice' });
  assert.equal((await scanGame(dir)).chosen.path, exe);
});

test('LoreRim Stock Game is found without selecting ModOrganizer or downloaded/mod copies', async t => {
  const dir = temp(t);
  for (const rel of ['ModOrganizer.exe', 'mods/Copy/SkyrimSE.exe', 'downloads/Tool.exe', 'Stock Game/SkyrimSE.exe']) {
    writePe(path.join(dir, rel), { text: 'D3D11CreateDevice' });
  }
  const scan = await scanGame(dir);
  assert.equal(scan.exeCandidates.length, 1);
  assert.equal(scan.chosen.rel, path.join('Stock Game', 'SkyrimSE.exe'));
  assert.equal(compatibility.targetIssue(dir, scan.chosen.path), 'errManagedModpack');
});

test('Cyberpunk shared DLC install resolves to base game and base artwork ID, without merging separate installs', t => {
  const dir = temp(t);
  writePe(path.join(dir, 'bin/x64/Cyberpunk2077.exe'));
  const dlc = { dir, launcher: 'Steam', name: 'Cyberpunk 2077: Phantom Liberty', id: '2138330', poster: 'DLC' };
  const base = { dir, launcher: 'Steam', name: 'Cyberpunk 2077', id: '1091500', poster: null };
  for (const entries of [[dlc], [dlc, base], [base, dlc]]) {
    const games = dedupe(entries);
    assert.equal(games.length, 1);
    assert.equal(games[0].name, 'Cyberpunk 2077');
    assert.equal(games[0].id, '1091500');
    assert.equal(games[0].poster, null);
  }
  assert.equal(dedupe([base, { ...base, dir: path.join(dir, 'separate') }]).length, 2);
});

test('ARC Raiders and detected anti-cheat require per-attempt consent, not a hard block', async t => {
  const root = temp(t);
  for (const name of ['ARC Raiders', 'ProtectedGame']) {
    const dir = path.join(root, name);
    const exePath = writePe(path.join(dir, 'Game.exe'));
    if (name === 'ProtectedGame') fs.mkdirSync(path.join(dir, 'EasyAntiCheat'));
    assert.equal(compatibility.hasAntiCheat(dir, exePath), true);
    assert.equal(compatibility.targetIssue(dir, exePath), null);
    assert.doesNotThrow(() => compatibility.assertSafeTarget(dir, exePath));
    assert.doesNotThrow(() => compatibility.assertAntiCheatConsent(dir, exePath, true));
    for (const value of [false, undefined, 'true', 1]) {
      assert.throws(() => compatibility.assertAntiCheatConsent(dir, exePath, value), { code: 'errAntiCheatConsent' });
    }
    for (const route of ['native', 'feeder', 'optiscaler']) {
      await assert.rejects(manager.install({ gameDir: dir, exePath, route }), { code: 'errAntiCheatConsent' });
      assert.equal(fs.existsSync(core.backupRoot(dir)), false);
    }
  }
});

test('WARDOGS and modern Call of Duty need consent, the 2009 game does not', async t => {
  const root = temp(t);
  // RICOCHET keeps its kernel driver outside the game folder, so these titles
  // are keyed on the executable name - the folder name is shared with games
  // that carry no anti-cheat at all.
  for (const exe of ['cod.exe', 'ModernWarfare.exe', 'BlackOpsColdWar.exe', 'Vanguard.exe']) {
    const dir = path.join(root, 'Call of Duty');
    const exePath = writePe(path.join(dir, exe));
    assert.equal(compatibility.hasAntiCheat(dir, exePath), true, exe);
    assert.throws(() => compatibility.assertAntiCheatConsent(dir, exePath, false), { code: 'errAntiCheatConsent' });
    assert.doesNotThrow(() => compatibility.assertAntiCheatConsent(dir, exePath, true));
  }
  // The 2009 game shares most of that name but ships no kernel anti-cheat, so a
  // ban warning there would be wrong.
  const old = path.join(root, 'Call of Duty Modern Warfare 2');
  const oldExe = writePe(path.join(old, 'iw4sp.exe'));
  assert.equal(compatibility.hasAntiCheat(old, oldExe), false);
  assert.doesNotThrow(() => compatibility.assertAntiCheatConsent(old, oldExe, false));
  // WARDOGS runs Easy Anti-Cheat; the folder name backs up the file scan.
  const wardogs = path.join(root, 'WARDOGS');
  const wardogsExe = writePe(path.join(wardogs, 'WARDOGS.exe'));
  assert.equal(compatibility.hasAntiCheat(wardogs, wardogsExe), true);
  await assert.rejects(manager.install({ gameDir: wardogs, exePath: wardogsExe, route: 'native' }), { code: 'errAntiCheatConsent' });
  assert.equal(fs.existsSync(core.backupRoot(wardogs)), false);
});

test('anti-cheat consent does not bypass independent mod-manager or file-conflict protection', async t => {
  const dir = temp(t);
  const exePath = writePe(path.join(dir, 'Stock Game/SkyrimSE.exe'));
  writePe(path.join(dir, 'ModOrganizer.exe'));
  fs.mkdirSync(path.join(dir, 'EasyAntiCheat'));
  assert.equal(compatibility.hasAntiCheat(dir, exePath), true);
  await assert.rejects(manager.install({ gameDir: dir, exePath, route: 'native', antiCheatAcknowledged: true }), { code: 'errManagedModpack' });
  assert.equal(fs.existsSync(core.backupRoot(dir)), false);
});

test('anti-cheat confirmation defaults to cancel in every supported language', () => {
  const { dialogOptions } = require('../src/shared/anti-cheat-warning');
  const i18n = require('../src/shared/feature-i18n');
  for (const lang of Object.keys(i18n.catalog)) {
    const options = dialogOptions(lang, 'C:\\Games\\Example', 'C:\\Games\\Example\\Game.exe');
    assert.equal(options.defaultId, 0);
    assert.equal(options.cancelId, 0);
    assert.equal(options.type, 'warning');
    assert.equal(options.buttons[1], i18n.t(lang, 'antiCheatContinue'));
    assert.ok(options.detail.includes(i18n.t(lang, 'antiCheatWarning')));
    assert.match(options.detail, /Game\.exe/);
  }
});

test('unmanaged ENB/DXVK proxy is never overwritten or erased on failed install', async t => {
  const dir = temp(t);
  const exePath = writePe(path.join(dir, 'GTAIV.exe'), { bitness: 32 });
  const proxy = writePe(path.join(dir, 'd3d9.dll'), { bitness: 32, text: 'external DXVK/ENB fixture' });
  const bytes = fs.readFileSync(proxy);
  await assert.rejects(manager.install({ gameDir: dir, exePath, bitness: 32, api: 'd3d9', route: 'feeder' }), { code: 'errLoaderConflict' });
  assert.deepEqual(fs.readFileSync(proxy), bytes);
  assert.equal(fs.existsSync(path.join(core.backupRoot(dir), 'manifest.json')), false);
});

// Games that still support Windows 7 ship Microsoft's D3D12-on-7 runtime as
// d3d12.dll (Modern Warfare 2019 among them). It is the game's own file - no
// hook this app installs is ever d3d12.dll - so it must not read as a loader
// conflict, while a d3d12.dll without Microsoft's stamp still does.
test('a game-owned Microsoft D3D12 runtime is not a loader conflict', t => {
  const dir = temp(t);
  const exePath = writePe(path.join(dir, 'ModernWarfare.exe'), { bitness: 64 });
  writePe(path.join(dir, 'd3d12.dll'), { bitness: 64 });
  const config = { gameDir: dir, exePath, api: 'dxgi', bitness: 64, route: 'native' };
  const microsoft = (_file, text) => text === 'Microsoft Corporation' || text === 'Direct3D';
  assert.doesNotThrow(() => compatibility.assertLoaderCompatible(config, null, microsoft));
  assert.throws(() => compatibility.assertLoaderCompatible(config, null, () => false), { code: 'errLoaderConflict' });
});

test('original restoration survives missing executable and optional profile-save failure', async t => {
  const dir = temp(t);
  const dll = path.join(dir, 'd3d9.dll');
  fs.writeFileSync(dll, 'original bytes');
  const manifest = core.beginManifest(dir, path.join(dir, 'RE5DX9.exe'), 'd3d9');
  manifest.route = 'feeder';
  await core.writeTracked(manifest, dir, dll, 'injected bytes');
  await core.writeTracked(manifest, dir, path.join(dir, 'dxgi.dll'), 'injected hook');
  fs.writeFileSync(path.join(core.backupRoot(dir), '.profiles'), 'not a directory');
  const logs = [];
  assert.equal(await manager.restore(dir, entry => logs.push(entry.code)), true);
  assert.equal(fs.readFileSync(dll, 'utf8'), 'original bytes');
  assert.equal(fs.existsSync(path.join(dir, 'dxgi.dll')), false);
  assert.ok(logs.includes('restoreProfileWarning'));
  assert.ok(logs.includes('restoreDone'));
});

test('native Unreal install preserves Streamline/FG/RR/x86 runtime and restores exact SR originals', async t => {
  const root = temp(t);
  const dir = path.join(root, 'MidnightSuns');
  const exePath = writePe(path.join(dir, 'Binaries/Win64/MidnightSuns-Win64-Shipping.exe'), { text: 'D3D12CreateDevice' });
  const native = writePe(path.join(dir, 'Engine/Binaries/ThirdParty/nvngx_dlss.dll'), { text: 'original SR' });
  const originals = [native];
  for (const name of ['sl.interposer.dll', 'sl.common.dll', 'sl.dlss.dll', 'nvngx_dlssg.dll', 'nvngx_dlssd.dll']) {
    originals.push(writePe(path.join(path.dirname(exePath), name), { text: 'original ' + name }));
  }
  originals.push(writePe(path.join(dir, 'Binaries/Win32/nvngx_dlss.dll'), { bitness: 32, text: 'x86 original' }));
  const snapshots = new Map(originals.map(file => [file, fs.readFileSync(file)]));
  const names = ['nvngx_dlss.dll', 'nvngx_dlssnr.dll', 'nvngx_dlssg.dll', 'nvngx_dlssd.dll', 'sl.interposer.dll', 'sl.common.dll', 'sl.dlss.dll'];
  const source = { hasNeuralRendering: true, payload: names.map(name => ({ name,
    path: writePe(path.join(root, 'payload', name), { text: 'NEW ' + name }), version: '2.0.0' })) };
  for (let i = 0; i < 2; i++) await core.applySwap({ gameDir: dir, exePath, bitness: 64, api: 'dxgi', route: 'native', source, addMissingDlss: true });
  assert.notDeepEqual(fs.readFileSync(native), snapshots.get(native));
  for (const file of originals.slice(1)) assert.deepEqual(fs.readFileSync(file), snapshots.get(file), file);
  assert.equal(fs.existsSync(path.join(path.dirname(exePath), 'nvngx_dlss.dll')), false, 'no duplicate SR beside an existing nested runtime');
  await core.restore(dir);
  for (const [file, bytes] of snapshots) assert.deepEqual(fs.readFileSync(file), bytes, file);
});

// #232, #217: engines that pick a renderer at startup and load it with
// LoadLibrary leave nothing in the executable's import table, so the scanner
// found no 3D in them and refused the game. Each of these is named evidence,
// not a sweep of the folder - a stray DLL beside a tool still proves nothing.
test('engines that load their renderer dynamically are recognised by it', async t => {
  const root = temp(t);
  for (const [name, module, bitness, marker, api] of [
    ['xrEngine.exe', 'xrRender_R2.dll', 32, 'Direct3DCreate9', 'd3d9'],
    ['xrEngine.exe', 'xrRender_R4.dll', 64, 'D3D11CreateDevice', 'dxgi'],
    ['portal2.exe', 'bin/shaderapidx9.dll', 32, 'Direct3DCreate9', 'd3d9'],
    ['garrysmod.exe', 'bin/win64/shaderapidx9.dll', 64, 'D3D11CreateDevice', 'dxgi']
  ]) {
    const dir = path.join(root, name + bitness);
    const exe = writePe(path.join(dir, name), { bitness });
    writePe(path.join(dir, module), { bitness, text: marker });
    const scan = await scanGame(dir);
    assert.equal(scan.chosen && scan.chosen.path, exe, `${name} via ${module}`);
    assert.equal(scan.chosen.api, api);
  }
});

test('a renderer of the wrong architecture, or none at all, still proves nothing', async t => {
  const wrongArch = temp(t);
  writePe(path.join(wrongArch, 'xrEngine.exe'), { bitness: 32 });
  writePe(path.join(wrongArch, 'xrRender_R2.dll'), { bitness: 64, text: 'Direct3DCreate9' });
  assert.equal((await scanGame(wrongArch)).chosen, null);

  const bare = temp(t);
  writePe(path.join(bare, 'xrEngine.exe'), { bitness: 32 });
  writePe(path.join(bare, 'xrRender_R2.dll'), { bitness: 32 });
  assert.equal((await scanGame(bare)).chosen, null, 'a renderer with no API evidence is not evidence');
});
