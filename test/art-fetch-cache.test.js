'use strict';
// The art lookup writes its result to disk so the next launch does not ask
// Steam again. The one thing it must never write down is a failed download:
// doing that turns one offline minute into a card that stays blank forever.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const ART_RULES = 5;

function load(root, art) {
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
    require: (name) => (name === './src/steamart' ? art : stubs[name] || realRequire(name)),
    __dirname: path.dirname(main), process, Buffer, console, setTimeout, setInterval, clearInterval
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
  return handlers;
}

// The same key the handler computes for a folder.
const keyFor = (dir) => crypto.createHash('sha1')
  .update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 16);

const readState = (root) => JSON.parse(fs.readFileSync(path.join(root, 'library.json'), 'utf8'));

function seed(root, art) {
  fs.writeFileSync(path.join(root, 'library.json'), JSON.stringify({ art }, null, 2));
}

function stub(overrides = {}) {
  return {
    available: () => true,
    look: async () => null,
    download: async (_url, dest) => dest,
    cleanName: (name) => name,
    ...overrides
  };
}

const HIT = {
  appid: 1867240,
  name: 'WARDOGS',
  coverUrl: 'https://cdn.test/1867240/library_600x900.jpg',
  heroUrl: 'https://cdn.test/1867240/library_hero.jpg',
  heroFallbackUrl: 'https://cdn.test/1867240/header.jpg'
};

test('an offline lookup is not written down, so the next launch tries again', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-art-offline-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = 'C:\\Games\\Offline';
  const handlers = load(root, stub({
    look: async () => HIT,
    download: async () => { throw new Error('offline'); }
  }));

  const record = await handlers.get('art-fetch')({}, dir, 'WARDOGS', 1867240);
  assert.equal(record.cover, null);
  assert.equal(record.hero, null);
  assert.equal(readState(root).art?.[keyFor(dir)], undefined,
    'a record with no artwork must not outlive the failure');
});

test('the wide banner alone is a result and is cached', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-art-wide-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = 'C:\\Games\\WARDOGS';
  const handlers = load(root, stub({
    look: async () => HIT,
    download: async (url, dest) => {
      if (String(url).endsWith('library_600x900.jpg')) throw new Error('404');
      return dest;
    }
  }));

  const record = await handlers.get('art-fetch')({}, dir, 'WARDOGS', 1867240);
  assert.equal(record.cover, null, 'no portrait capsule on the store');
  assert.ok(record.hero, 'the wide banner is still artwork');
  const saved = readState(root).art[keyFor(dir)];
  assert.equal(saved.rules, ART_RULES);
  assert.equal(saved.cover, null);
  assert.equal(saved.hero, record.hero);
});

test('a cached record with no artwork is looked up again', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-art-bad-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = 'C:\\Games\\Bad';
  seed(root, { [keyFor(dir)]: { rules: ART_RULES, cover: null, hero: null } });
  let looks = 0;
  const handlers = load(root, stub({
    look: async () => { looks += 1; return null; }
  }));

  const record = await handlers.get('art-fetch')({}, dir, 'Bad', 1);
  assert.equal(looks, 1, 'the poisoned record must not be handed back as an answer');
  assert.equal(record.none, true);
});

test('a cached record with a cover is answered without another lookup', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-art-cover-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = 'C:\\Games\\Control';
  const saved = { rules: ART_RULES, cover: 'file:///art/control-cover.jpg', hero: null };
  seed(root, { [keyFor(dir)]: saved });
  let looks = 0;
  const handlers = load(root, stub({
    look: async () => { looks += 1; return null; }
  }));

  const record = await handlers.get('art-fetch')({}, dir, 'Control', 870780);
  assert.equal(looks, 0);
  assert.equal(record.cover, saved.cover);
});

test('a cached record with only a hero is answered without another lookup', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-art-hero-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = 'C:\\Games\\WARDOGS';
  const saved = { rules: ART_RULES, cover: null, hero: 'file:///art/wardogs-hero.jpg' };
  seed(root, { [keyFor(dir)]: saved });
  let looks = 0;
  const handlers = load(root, stub({
    look: async () => { looks += 1; return null; }
  }));

  const record = await handlers.get('art-fetch')({}, dir, 'WARDOGS', 1867240);
  assert.equal(looks, 0);
  assert.equal(record.hero, saved.hero);
});
