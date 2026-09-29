'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

// The update lookup runs in the main process against the real GitHub endpoint.
// Here the network is a stub, so the test is about what the app concludes.
function load(t, { version = '2.2.1', fetchImpl, abortSignal } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const main = path.resolve(__dirname, '../main.js');
  const realRequire = createRequire(main);
  const handlers = new Map();
  const calls = { count: 0 };
  const stubs = {
    electron: {
      app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => root, getVersion: () => version },
      BrowserWindow: { fromWebContents: () => null },
      Menu: { buildFromTemplate: () => ({ popup() {} }) },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      dialog: { showMessageBox: async () => ({ response: 1 }) },
      clipboard: { writeText() {} }
    },
    './src/core/scan.js': { scanGame: async () => ({ chosen: null, exeCandidates: [] }), scanSource: () => ({ ok: false }) }
  };
  const context = vm.createContext({
    require: name => stubs[name] || realRequire(name),
    __dirname: path.dirname(main), process, Buffer, console, setTimeout, clearTimeout,
    AbortSignal: abortSignal || AbortSignal,
    fetch: async (...args) => { calls.count++; return fetchImpl(...args); }
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
  return { handlers, calls };
}

const release = (tag) => ({ ok: true, json: async () => ({ tag_name: tag }) });

test('a newer release is reported, an older or equal one is not', async (t) => {
  for (const [tag, newer] of [['v2.2.2', true], ['v2.3.0', true], ['v3.0.0', true],
    ['v2.2.1', false], ['v2.2.0', false], ['v2.10.0', true]]) {
    const { handlers } = load(t, { fetchImpl: async () => release(tag) });
    const answer = await handlers.get('update-check')();
    assert.equal(answer.newer, newer, `${tag} against 2.2.1`);
    assert.equal(answer.current, '2.2.1');
    assert.equal(answer.latest, tag.replace(/^v/, ''));
  }
});

test('the lookup happens once per launch', async (t) => {
  const { handlers, calls } = load(t, { fetchImpl: async () => release('v9.0.0') });
  const first = await handlers.get('update-check')();
  const second = await handlers.get('update-check')();
  assert.equal(first.newer, true);
  assert.deepEqual(second, first);
  assert.equal(calls.count, 1, 'the answer is kept for the session');
});

test('being offline, rate-limited or blocked says nothing at all', async (t) => {
  for (const fetchImpl of [
    async () => { throw new Error('getaddrinfo ENOTFOUND'); },
    async () => ({ ok: false, status: 403 }),
    async () => ({ ok: true, json: async () => ({}) })
  ]) {
    const { handlers } = load(t, { fetchImpl });
    const answer = await handlers.get('update-check')();
    assert.equal(answer.newer, false, 'no notice is shown');
    assert.equal(answer.current, '2.2.1', 'and the running version is still reported');
  }
});

// A lookup that could not run reported {latest: null, newer: false}, which the
// sidebar rendered exactly like "nothing new". Someone on an old build whose
// check never completed was told nothing and had no reason to go and look.
test('a failed lookup is distinguishable from being up to date', () => {
  const failed = { current: '2.2.2', latest: null, newer: false };
  const current = { current: '2.2.3', latest: '2.2.3', newer: false };
  const behind = { current: '2.2.2', latest: '2.2.3', newer: true };

  // Exactly the branch order src/renderer/renderer.js uses.
  const shown = (a) => !a ? 'nothing' : !a.latest ? 'failed' : !a.newer ? 'nothing' : 'update';
  assert.equal(shown(failed), 'failed');
  assert.equal(shown(current), 'nothing');
  assert.equal(shown(behind), 'update');

  const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf8');
  assert.match(renderer, /if \(!answer\.latest\) \{[\s\S]*updateCheckFailed/,
    'the renderer separates the two before it decides there is no news');
});

test('the lookup targets the Chinese enhanced repository with a 10 second timeout', async (t) => {
  let url = null, timeout = 0;
  const { handlers } = load(t, {
    abortSignal: { timeout: (ms) => ({ timeout: ms }) },
    fetchImpl: async (u, opts) => { url = u; timeout = opts?.signal?.timeout ?? 0; return release('v2.2.2'); }
  });
  const answer = await handlers.get('update-check')();
  assert.equal(url, 'https://api.github.com/repos/hezhixin15/DLSS5-Swapper-Chinese/releases/latest',
    'the check asks the Chinese enhanced edition, not the original repository');
  assert.equal(timeout, 10000, 'the check gives up after 10 seconds');
  assert.equal(answer.newer, true);
});

test('a release with an .exe asset offers the one-click update', async (t) => {
  const { handlers } = load(t, {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        tag_name: 'v2.2.2',
        body: 'Fixed everything',
        assets: [
          { name: 'DLSS5-Swapper-Setup.exe', browser_download_url: 'https://github.com/example/Setup.exe' },
          { name: 'blockmap', browser_download_url: 'https://github.com/example/blockmap' }
        ]
      })
    })
  });
  const answer = await handlers.get('update-check')();
  assert.equal(answer.asset.name, 'DLSS5-Swapper-Setup.exe');
  assert.equal(answer.asset.url, 'https://github.com/example/Setup.exe');
  assert.equal(answer.notes, 'Fixed everything');
});

test('a release without an installer still reports the new version', async (t) => {
  const { handlers } = load(t, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: 'v2.2.2', assets: [] }) })
  });
  const answer = await handlers.get('update-check')();
  assert.equal(answer.newer, true);
  assert.equal(answer.asset, null);
});
