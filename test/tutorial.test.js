'use strict';
// The first-run guide. Two rules matter and both are one-way: Skip and Finish
// keep it away for good, and everything else - a half-finished walkthrough, a
// window closed mid-way - leaves it pending so the next launch shows it again.
// A reader who never finished it is the person the guide exists for.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const copy = require('../src/renderer/tutorial-copy');

function load(root) {
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
      Tray: function () { return { setContextMenu() {}, setToolTip() {}, on() {}, isDestroyed: () => false }; },
      Menu: { buildFromTemplate: (template) => template },
      nativeImage: { createFromPath: () => ({ isEmpty: () => false, resize: () => 'icon' }) },
      shell: {}, dialog: {}, clipboard: {}, Notification: function () {}, safeStorage: {}
    }
  };
  const context = vm.createContext({ require: (name) => stubs[name] || realRequire(name),
    __dirname: path.dirname(main), process, Buffer, console, setTimeout, setInterval, clearInterval });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
  return { handlers };
}

function temp(t, tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `swapper-tutorial-${tag}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('a fresh install is pending, and both outcomes are remembered for good', async (t) => {
  const root = temp(t, 'outcomes');
  const app = load(root);

  assert.equal((await app.handlers.get('boot')()).tutorial, 'pending', 'unset means pending');

  assert.equal(await app.handlers.get('set-tutorial')({}, 'skipped'), 'skipped');
  assert.equal((await load(root).handlers.get('boot')()).tutorial, 'skipped', 'skip survives a restart');

  assert.equal(await app.handlers.get('set-tutorial')({}, 'done'), 'done');
  assert.equal((await load(root).handlers.get('boot')()).tutorial, 'done', 'finish survives a restart');
});

test('only Skip and Finish count; anything else leaves the guide pending', async (t) => {
  const root = temp(t, 'pending');
  const app = load(root);
  const set = app.handlers.get('set-tutorial');

  for (const value of ['pending', '', null, undefined, 0, 'DONE', 'finished', {}, []]) {
    assert.equal(await set({}, value), 'pending', `${JSON.stringify(value)} is not an outcome`);
  }
  assert.equal((await load(root).handlers.get('boot')()).tutorial, 'pending', 'still pending');

  // A decided guide cannot be pushed back to pending by the renderer, and
  // unrelated settings must never write over the outcome.
  await set({}, 'done');
  assert.equal(await set({}, 'pending'), 'done', 'the decision stands');
  await app.handlers.get('set-close-to-tray')({}, false);
  await app.handlers.get('set-auto-scan-drives')({}, true);
  assert.equal((await load(root).handlers.get('boot')()).tutorial, 'done', 'other settings leave it alone');
});

test('both Chinese guides carry the same pages and the same shape', () => {
  assert.deepEqual(copy.codes, ['zh', 'zh-TW']);

  const shape = (page) => page.blocks.map((b) => Object.keys(b).sort().join('+'));
  const zh = copy.pages('zh');
  const tw = copy.pages('zh-TW');
  assert.equal(zh.length, 7, 'seven pages');
  assert.equal(tw.length, zh.length, 'a page missing in one language is a page of blank');
  assert.deepEqual(tw.map(shape), zh.map(shape), 'block order must match, or the pages diverge');

  for (const [code, pages] of [['zh', zh], ['zh-TW', tw]]) {
    pages.forEach((page, i) => {
      assert.ok(page.title.trim(), `${code} page ${i + 1} title`);
      assert.ok(page.blocks.length, `${code} page ${i + 1} has content`);
      for (const block of page.blocks) {
        const lines = block.p ? [block.p] : block.note ? [block.note]
          : block.list ? block.list : block.groups.flatMap((g) => [g.heading, ...g.items]);
        assert.ok(lines.every((line) => line && line.trim()), `${code} page ${i + 1} has an empty line`);
      }
    });
  }
});

test('every language without its own guide gets no guide at all', () => {
  for (const code of ['en', 'ja', 'de', 'ar', 'fa', '']) {
    assert.equal(copy.pages(code), null, `${code} must not be shown a Chinese guide`);
    assert.equal(copy.labels(code), null, `${code} must not get Chinese buttons`);
  }
  for (const code of copy.codes) {
    assert.ok(copy.labels(code).step(2, 7).includes('2'), 'the step counter reads the page number');
    assert.ok(copy.labels(code).finish.trim() && copy.labels(code).skip.trim());
  }
});