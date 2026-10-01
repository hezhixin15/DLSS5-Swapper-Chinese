'use strict';
// The title bar is drawn by the page, so the maximise button cannot read the
// window state off a native frame the way a system button would. Main has to
// push it on every change: the button only ever sees the clicks it receives
// itself, and Win+Up and Aero Snap never reach it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function load(root) {
  const main = path.resolve(__dirname, '../main.js');
  const realRequire = createRequire(main);
  const handlers = new Map();
  const windowEvents = new Map();
  const appEvents = new Map();
  const sent = [];
  const win = {
    on: (name, fn) => windowEvents.set(name, fn),
    once() {}, loadFile() {}, show() {}, focus() {}, restore() {},
    isMinimized: () => false, isDestroyed: () => false, hide() {},
    isMaximized: () => false, maximize() {}, unmaximize() {}, minimize() {}, close() {},
    webContents: { on() {}, send: (channel, payload) => sent.push({ channel, payload }) }
  };
  const tray = {
    made: 0, destroyed: false,
    setContextMenu() {}, setToolTip() {}, on() {}, isDestroyed: () => tray.destroyed
  };
  const stubs = {
    electron: {
      app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on: (n, fn) => appEvents.set(n, fn),
        getPath: () => root, requestSingleInstanceLock: () => true, quit() {} },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },
      BrowserWindow: function () { return win; },
      Tray: function () { tray.made += 1; return tray; },
      Menu: { buildFromTemplate: (template) => template },
      nativeImage: { createFromPath: () => ({ isEmpty: () => false, resize: () => 'icon' }) },
      shell: {}, dialog: {}, clipboard: {}, Notification: function () {}, safeStorage: {}
    }
  };
  const context = vm.createContext({ require: (name) => stubs[name] || realRequire(name),
    __dirname: path.dirname(main), process, Buffer, console, setTimeout, setInterval, clearInterval });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
  // createWindow is only called from whenReady, which the stub never resolves.
  vm.runInContext('createWindow();', context);
  return { windowEvents, sent, win };
}

test('the window reports every maximise and restore to the drawn title bar', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-max-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = load(root);

  assert.ok(app.windowEvents.has('maximize'), 'main listens for maximise');
  assert.ok(app.windowEvents.has('unmaximize'), 'main listens for restore');

  app.windowEvents.get('maximize')();
  app.windowEvents.get('unmaximize')();
  assert.deepEqual(app.sent, [
    { channel: 'window-state', payload: true },
    { channel: 'window-state', payload: false }
  ]);
});

test('nothing is sent across a window that is already gone', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-max-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = load(root);

  app.win.isDestroyed = () => true;
  app.windowEvents.get('maximize')();
  assert.deepEqual(app.sent, [], 'quitting while maximised must not throw');
});
