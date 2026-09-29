'use strict';
// Settings' "clear cache" button. The whole point is that it clears the half of
// the data folder the app can rebuild and leaves the half the user would be
// angry to lose, so these tests hold both halves in place: what it deletes, and
// what it must never touch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function load(root, overrides = {}) {
  const main = path.resolve(__dirname, '../main.js');
  const realRequire = createRequire(main);
  const handlers = new Map();
  const win = {
    on() {}, once() {}, loadFile() {}, show() {}, focus() {}, restore() {},
    isMinimized: () => false, isDestroyed: () => false, hide() {},
    webContents: { on() {}, send() {} }
  };
  const stubs = {
    electron: {
      app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {},
        getPath: () => root, requestSingleInstanceLock: () => true, quit() {} },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },
      BrowserWindow: function () { return win; },
      Tray: function () {
        return { setContextMenu() {}, setToolTip() {}, on() {}, isDestroyed: () => false };
      },
      Menu: { buildFromTemplate: (template) => template },
      nativeImage: { createFromPath: () => ({ isEmpty: () => false, resize: () => 'icon' }) },
      shell: {}, dialog: {}, clipboard: {}, Notification: function () {}, safeStorage: {}
    }
  };
  const context = vm.createContext({
    require: (name) => overrides[name] || stubs[name] || realRequire(name),
    __dirname: path.dirname(main), process, Buffer, console, setTimeout, setInterval, clearInterval
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
  return { handlers, context };
}

// One of everything: the rebuildable half, and the half that is the user's.
function seed(root) {
  const put = (rel, body = 'x') => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };
  put('art/cover.jpg');
  put('components/OptiScaler-1.0/optiscaler.dll');
  put('crash.log');
  put('posters/abc.png');
  put('overlay-library/entries/deadbeef.json', '{}');
  put('history.jsonl', '{"kind":"install"}\n');
  put('community.json', '{"name":"me"}');
  put('library.json', JSON.stringify({
    folders: ['D:\\Games'],
    hidden: ['D:\\Games\\Bad'],
    posters: { abc: 'posters/abc.png' },
    scans: { abc: { rules: 7, api: 'DirectX 12' } },
    art: { abc: { rules: 3, cover: 'file:///art/cover.jpg' } }
  }, null, 2));
}

const readState = (root) => JSON.parse(fs.readFileSync(path.join(root, 'library.json'), 'utf8'));

test('clearing the cache deletes the rebuildable files and keeps the user’s', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seed(root);
  const app = load(root);

  const answer = await app.handlers.get('clear-cache')();
  assert.equal(answer.ok, true);
  assert.deepEqual([...answer.removed].sort(), ['art', 'components', 'crash.log']);
  assert.deepEqual([...answer.failed], []);

  for (const gone of ['art', 'components', 'crash.log']) {
    assert.equal(fs.existsSync(path.join(root, gone)), false, `${gone} is deleted`);
  }
  for (const kept of ['posters/abc.png', 'overlay-library/entries/deadbeef.json',
    'history.jsonl', 'community.json', 'library.json']) {
    assert.equal(fs.existsSync(path.join(root, kept)), true, `${kept} stays`);
  }
});

test('the scan results and the art index go with the files they describe', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-cache-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seed(root);
  const app = load(root);

  await app.handlers.get('clear-cache')();
  const state = readState(root);
  // An empty scan index is what makes every game scan itself again, and a stale
  // art index would keep pointing the grid at the files that just went away.
  assert.deepEqual(state.scans, {});
  assert.deepEqual(state.art, {});
  assert.deepEqual(state.folders, ['D:\\Games'], 'folders the user added are not a cache');
  assert.deepEqual(state.hidden, ['D:\\Games\\Bad']);
  assert.deepEqual(state.posters, { abc: 'posters/abc.png' }, 'a chosen poster is not a cache');
});

test('the handler takes no argument, so the renderer cannot aim it elsewhere', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-cache-args-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-cache-keep-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  seed(root);
  fs.writeFileSync(path.join(outside, 'precious.txt'), 'keep me');
  const app = load(root);

  const answer = await app.handlers.get('clear-cache')({}, outside, '..', 'C:\\Windows');
  assert.equal(answer.ok, true);
  assert.equal(fs.existsSync(path.join(outside, 'precious.txt')), true,
    'a path from the renderer is not a path to delete');
});

test('an entry that cannot be removed is reported, not fatal, and the rest still goes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-cache-busy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seed(root);
  // A file held open by the renderer, or by an antivirus mid-scan, is the
  // ordinary failure here - it must not take the other entries down with it.
  const busy = new Proxy(fs, {
    get: (target, prop) => prop !== 'rmSync' ? target[prop] : (file, options) => {
      if (String(file).endsWith('components')) {
        throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
      }
      return fs.rmSync(file, options);
    }
  });
  const app = load(root, { fs: busy });

  const answer = await app.handlers.get('clear-cache')();
  assert.equal(answer.ok, true, 'the clear still succeeds');
  assert.deepEqual([...answer.removed].sort(), ['art', 'crash.log']);
  assert.deepEqual([...answer.failed].map((item) => item.name), ['components']);
  assert.equal(fs.existsSync(path.join(root, 'components')), true, 'the busy entry is left alone');
  assert.equal(fs.existsSync(path.join(root, 'art')), false, 'and the rest still went');

  const again = await app.handlers.get('clear-cache')();
  assert.equal(again.ok, true);
  assert.deepEqual([...again.removed], [], 'nothing left to delete');
  assert.deepEqual([...again.failed].map((item) => item.name), ['components'],
    'the entry that was busy is still busy, and still reported');
});
