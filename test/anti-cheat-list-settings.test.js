'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

// The list and its settings run in the main process against a real profile
// directory, with the network stubbed at the source module. A new context is
// a fresh launch, so what is on disk is what a restart would see.
function launch(t, { fetchImpl } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-anticheat-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const main = path.resolve(__dirname, '../main.js');
  const realRequire = createRequire(main);
  const source = realRequire('./src/anti-cheat-list-source');
  const handlers = new Map();
  const calls = { count: 0, options: null };
  const stubs = {
    electron: {
      app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => profile, getVersion: () => '2.0.5' },
      BrowserWindow: { fromWebContents: () => null },
      Menu: { buildFromTemplate: () => ({ popup() {} }) },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      dialog: { showMessageBox: async () => ({ response: 1 }) },
      clipboard: { writeText() {} }
    },
    './src/core/scan.js': {
      scanGame: async () => ({ chosen: null, exeCandidates: [], dlssFiles: [], streamlineFiles: [], reshade: { installed: false } }),
      scanSource: () => ({ ok: false })
    },
    './src/anti-cheat-list-source': {
      ...source,
      fetchList: async (...args) => {
        calls.count++;
        calls.options = args[0];
        return fetchImpl ? fetchImpl(...args) : { ok: false, error: 'offline' };
      }
    }
  };
  const context = vm.createContext({
    require: name => stubs[name] || realRequire(name),
    __dirname: path.dirname(main), process, Buffer, console, setTimeout, clearTimeout, setImmediate, AbortSignal
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
  return { profile, calls, call: (channel, ...args) => handlers.get(channel)(null, ...args) };
}

const listFile = (profile) => path.join(profile, 'anti-cheat-list.txt');
const answer = (text) => async () => ({
  ok: true, url: 'https://mirror/list.txt', text,
  names: text.split('\n').map(s => s.trim()).filter(Boolean)
});

test('a fresh profile warns from the built-in list and downloads nothing', (t) => {
  const { profile, calls, call } = launch(t);
  const settings = call('settings').antiCheat;
  assert.equal(settings.detect, true, 'detection is on by default');
  assert.equal(settings.mode, 'prompt', 'an update is offered, never forced');
  assert.equal(settings.source, 'bundled');
  assert.ok(settings.entries > 10, 'the snapshot covers the known titles');
  assert.equal(fs.existsSync(listFile(profile)), false, 'nothing is written before an update');
  assert.equal(calls.count, 0, 'reading settings makes no request');
});

test('detection off means no list at all, and says so in the state', (t) => {
  const { call } = launch(t);
  assert.equal(call('set-anti-cheat-detect', false), false);
  assert.equal(call('anti-cheat-list-state').entries, 0, 'the list is not consulted at all');
  assert.equal(call('settings').antiCheat.entries, 0);
  assert.equal(call('set-anti-cheat-detect', true), true);
  assert.ok(call('anti-cheat-list-state').entries > 10, 'and it comes back when the switch does');
});

test('updates turned off never touch the network', async (t) => {
  const { calls, call } = launch(t, { fetchImpl: answer('Test Game Alpha\n') });
  call('set-anti-cheat-list-mode', 'off');
  const result = await call('anti-cheat-list-check');
  assert.equal(result.checked, false);
  assert.equal(calls.count, 0);
});

test('a changed list is offered, not applied, and nothing lands on disk first', async (t) => {
  const { profile, calls, call } = launch(t, { fetchImpl: answer('Escape from Tarkov\nVALORANT\nTest Game Alpha\n') });
  const result = await call('anti-cheat-list-check', true);
  assert.equal(calls.count, 1);
  assert.equal(result.update, true);
  assert.deepEqual(result.change.added, ['Test Game Alpha'], 'what the list gained is named');
  assert.ok(result.change.removed.length > 0, 'and what it no longer carries');
  assert.equal(fs.existsSync(listFile(profile)), false, 'saying nothing leaves the disk alone');
  const applied = await call('anti-cheat-list-apply');
  assert.equal(applied.ok, true);
  assert.equal(applied.file, listFile(profile));
  assert.equal(fs.readFileSync(listFile(profile), 'utf8'), 'Escape from Tarkov\nVALORANT\nTest Game Alpha\n');
  const after = call('anti-cheat-list-state');
  assert.equal(after.source, 'downloaded');
  assert.equal(after.entries, 3);
  assert.equal(after.updateAvailable, false);
});

test('ignoring skips that version only; the next change is offered again', async (t) => {
  const current = { text: 'Test Game Alpha\n' };
  const { call } = launch(t, { fetchImpl: async () => answer(current.text)() });
  assert.equal((await call('anti-cheat-list-check', true)).update, true);
  assert.equal((await call('anti-cheat-list-ignore')).ok, true);
  const same = await call('anti-cheat-list-check', true);
  assert.equal(same.skipped, true, 'the same version is not offered twice');
  assert.equal(same.update, undefined);
  current.text = 'Test Game Alpha\nTest Game Beta\n';
  const next = await call('anti-cheat-list-check', true);
  assert.equal(next.update, true, 'a new version is offered again');
  // Both names are new next to the list still in place - the one that was
  // never downloaded is not what anything is compared against.
  assert.deepEqual(next.change.added, ['Test Game Alpha', 'Test Game Beta']);
});

test('auto applies without asking', async (t) => {
  const { profile, call } = launch(t, { fetchImpl: answer('VALORANT\n') });
  call('set-anti-cheat-list-mode', 'auto');
  const result = await call('anti-cheat-list-check');
  assert.equal(result.applied.ok, true);
  assert.equal(fs.readFileSync(listFile(profile), 'utf8'), 'VALORANT\n');
});

test('the list channel decides which sources are fetched, and is remembered', async (t) => {
  const { calls, call } = launch(t, { fetchImpl: answer('Test Game Alpha\n') });
  assert.equal(call('settings').antiCheat.channel, 'github', 'GitHub is the channel until it is changed');
  await call('anti-cheat-list-check', true);
  assert.ok(calls.options.sources.some((url) => url.includes('raw.githubusercontent.com')));
  assert.ok(calls.options.sources.every((url) => !url.includes('gitee.com')));
  assert.equal(call('set-anti-cheat-list-channel', 'gitee'), 'gitee');
  assert.equal(call('settings').antiCheat.channel, 'gitee');
  await call('anti-cheat-list-check', true);
  assert.deepEqual(calls.options.sources, ['https://gitee.com/hezhixin15/DLSS5-Swapper-Chinese/raw/main/src/data/anti-cheat-list.txt']);
  assert.equal(call('set-anti-cheat-list-channel', 'nonsense'), 'github', 'an unknown channel falls back to GitHub');
});

test('the automatic check is throttled to one per interval', async (t) => {
  const { calls, call } = launch(t, { fetchImpl: answer('Test Game Alpha\n') });
  const first = await call('anti-cheat-list-check');
  assert.equal(first.checked, true);
  assert.equal(calls.count, 1);
  const second = await call('anti-cheat-list-check');
  assert.equal(second.checked, false, 'one lookup is enough for a launch');
  assert.equal(calls.count, 1);
});

test('a listed game is flagged on its card and in its details', async (t) => {
  const { call } = launch(t, { fetchImpl: answer('Escape from Tarkov\n') });
  await call('anti-cheat-list-check', true);
  await call('anti-cheat-list-apply');
  const dir = path.join(path.dirname(call('anti-cheat-list-state').file), 'Escape from Tarkov');
  fs.mkdirSync(dir, { recursive: true });
  call('add-game-path', dir);
  const game = call('library').find((g) => g.dir === dir);
  assert.ok(game, 'the game is in the library');
  assert.equal(game.antiCheat.name, 'Escape from Tarkov');
  const details = await call('details', dir);
  assert.deepEqual(details.antiCheatMatch, { name: 'Escape from Tarkov', key: 'escapefromtarkov' });
  assert.equal(details.antiCheatWarning, true);
});

test('with detection off the same game is not flagged by the list', async (t) => {
  const { call } = launch(t, { fetchImpl: answer('Escape from Tarkov\n') });
  await call('anti-cheat-list-check', true);
  await call('anti-cheat-list-apply');
  const dir = path.join(path.dirname(call('anti-cheat-list-state').file), 'Escape from Tarkov');
  fs.mkdirSync(dir, { recursive: true });
  call('add-game-path', dir);
  call('set-anti-cheat-detect', false);
  const game = call('library').find((g) => g.dir === dir);
  assert.equal(game.antiCheat, null);
  assert.equal((await call('details', dir)).antiCheatMatch, null);
});

test('a download that fails never replaces what is already in place', async (t) => {
  const current = { result: answer('Escape from Tarkov\n') };
  const { call } = launch(t, { fetchImpl: async () => current.result() });
  await call('anti-cheat-list-check', true);
  await call('anti-cheat-list-apply');
  assert.equal(call('anti-cheat-list-state').entries, 1);
  current.result = async () => ({ ok: false, error: 'every source failed' });
  const failed = await call('anti-cheat-list-check', true);
  assert.equal(failed.ok, false);
  assert.equal(call('anti-cheat-list-state').entries, 1, 'the applied list is untouched');
});
