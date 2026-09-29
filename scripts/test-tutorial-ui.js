'use strict';

// Run with npm run test:ui:tutorial. Drives the real renderer in a hidden
// Electron window with an isolated profile, so the guide is exercised as the
// reader meets it: shown on launch, walked through, and closed.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Read by the fixture preload when the window is created.
process.env.TUTORIAL_FIXTURE = 'pending';
process.env.TUTORIAL_FIXTURE_LANG = 'zh';

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'dlss5-tutorial-ui-')));
const timeout = setTimeout(() => { console.error('UI test timed out'); app.exit(1); }, 60000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: {
      preload: path.join(__dirname, '../test/fixtures/game-filters-preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
    }
  });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) { errors.push(message); console.error('[renderer]', message); }
  });
  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
  const run = (code) => win.webContents.executeJavaScript(code)
    .catch((error) => { console.error('FAILED SCRIPT:', code); throw error; });
  const text = (id) => run(`$('${id}').textContent`);
  const hidden = () => run(`$('tutorial').classList.contains('hidden')`);
  const calls = () => run(`window.lab.testTutorialCalls()`);
  const press = (key) => run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`);
  // Settings rows are redrawn from an async read, so the assertions poll rather
  // than race the render.
  const waitFor = (condition) => run(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (${condition}) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('timed out waiting for: ' + ${JSON.stringify(condition)}));
      setTimeout(check, 10);
    };
    check();
  })`);
  const shot = async (name) => {
    await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const output = path.join(__dirname, '../dist/ui-tests');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
  };

  // The guide is on screen from launch, in Chinese, without holding up boot.
  await run(`new Promise(resolve => { const check = () => state.games.length === 9 ? resolve() : setTimeout(check, 10); check(); })`);
  assert.equal(await hidden(), false, 'the guide is up on launch');
  assert.equal(await text('tutorialTitle'), '欢迎使用 DLSS 5 Swapper');
  assert.equal(await text('tutorialStep'), '第 1 / 7 步');
  assert.equal(await text('tutorialSkip'), '跳过');
  assert.equal(await text('tutorialNext'), '下一步');
  assert.equal(await run(`$('tutorialBack').hidden`), true, 'nothing to go back to on page one');
  assert.equal(await run(`document.querySelectorAll('#tutorialDots i').length`), 7);
  assert.equal(await run(`$('tutorialDots').querySelectorAll('i.on').length`), 1);
  // The app kept loading underneath: a guide that blocks the library would be a
  // guide that leaves the reader staring at an empty window.
  assert.equal(await run(`state.games.length`), 9, 'the library loaded behind the guide');
  assert.equal(await run(`getComputedStyle($('tutorial')).position`), 'fixed');
  assert.equal(await run(`$('tutorial').getAttribute('aria-modal')`), 'true');
  assert.equal(await run(`$('tutorial').getAttribute('aria-label')`), '新手教程');
  assert.equal(await run(`document.activeElement.id`), 'tutorialNext', 'the keyboard starts on the way forward');
  await shot('tutorial-zh-1.png');

  // Paging forward and back.
  await run(`$('tutorialSkip').focus(); $('tutorialNext').click()`);
  assert.equal(await text('tutorialStep'), '第 2 / 7 步');
  assert.equal(await run(`document.activeElement.id`), 'tutorialSkip', 'a redraw does not move focus');
  assert.equal(await run(`$('tutorialBack').hidden`), false);
  assert.match(await text('tutorialTitle'), /第一步/);
  assert.match(await run(`$('tutorialBody').textContent`), /自动扫描所有驱动器/);
  await run(`$('tutorialBack').click()`);
  assert.equal(await text('tutorialStep'), '第 1 / 7 步');
  assert.equal(await run(`$('tutorialBack').hidden`), true);

  // The long pages are readable: the body scrolls inside a card that fits.
  for (let i = 0; i < 3; i += 1) await run(`$('tutorialNext').click()`);
  assert.equal(await text('tutorialStep'), '第 4 / 7 步');
  assert.match(await run(`$('tutorialBody').textContent`), /_DLSS5_Backup/, 'the restore page names the backup folder');
  for (let i = 0; i < 3; i += 1) await run(`$('tutorialNext').click()`);
  assert.equal(await text('tutorialStep'), '第 7 / 7 步');
  assert.equal(await text('tutorialNext'), '开始使用', 'the last page offers a way out, not another page');
  assert.equal(await run(`$('tutorialSkip').hidden`), false, 'Skip stays available to the end');
  assert.match(await run(`$('tutorialBody').textContent`), /主菜单/, 'page seven carries the in-game DLSS toggle rules');
  // The long pages are readable on a small window: the body scrolls and the
  // actions stay inside the card instead of being pushed off the bottom.
  win.setSize(900, 520);
  await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  assert.equal(await run(`innerHeight <= 560`), true, 'the window really shrank');
  assert.equal(await run(`$('tutorialBody').scrollHeight > $('tutorialBody').clientHeight`), true, 'page seven scrolls');
  assert.equal(await run(`document.querySelector('.tutorial-card').getBoundingClientRect().height <= innerHeight`), true, 'the card fits the window');
  await run(`$('tutorialBody').scrollTop = $('tutorialBody').scrollHeight`);
  assert.match(await run(`$('tutorialBody').textContent`), /叠加层就无法开启/, 'the notes page carries the overlay reminder');
  await shot('tutorial-zh-7.png');
  win.setSize(1280, 900);
  await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);

  // Finish is remembered, and it is the only thing written on that path.
  await run(`$('tutorialNext').click()`);
  assert.equal(await hidden(), true, 'finishing closes the guide');
  assert.deepEqual(await calls(), ['done'], 'finishing writes done, once');

  // Reopening the same window must not bring it back: nothing re-reads boot.
  await run(`window.tutorialUi.maybeShow('zh', 'pending')`);
  assert.equal(await hidden(), false, 'the show rule can still be exercised directly');
  await press('Escape');
  assert.equal(await hidden(), true, 'Escape closes without deciding');
  assert.deepEqual(await calls(), ['done'], 'Escape writes nothing, so the guide stays pending for next launch');

  // Skip is remembered too, and is a different outcome from Finish.
  await run(`window.tutorialUi.maybeShow('zh', 'pending')`);
  await run(`$('tutorialSkip').click()`);
  assert.equal(await hidden(), true);
  assert.deepEqual(await calls(), ['done', 'skipped'], 'skip writes its own outcome');

  // Nothing is shown for a language the guide does not carry, or once decided.
  assert.equal(await run(`window.tutorialUi.maybeShow('en', 'pending')`), false, 'no English guide exists');
  assert.equal(await run(`window.tutorialUi.maybeShow('ja', 'pending')`), false, 'and none for Japanese');
  assert.equal(await run(`window.tutorialUi.maybeShow('zh', 'done')`), false, 'a finished guide stays away');
  assert.equal(await run(`window.tutorialUi.maybeShow('zh', 'skipped')`), false, 'so does a skipped one');
  assert.equal(await hidden(), true);

  // Switching language while it is open redraws it in the other script.
  await run(`window.tutorialUi.maybeShow('zh', 'pending')`);
  await run(`applyLang('zh-TW')`);
  assert.equal(await text('tutorialTitle'), '歡迎使用 DLSS 5 Swapper');
  assert.equal(await text('tutorialSkip'), '跳過');
  assert.equal(await text('tutorialNext'), '下一步');
  assert.equal(await run(`$('tutorial').getAttribute('aria-label')`), '新手教學');
  assert.match(await run(`$('tutorialBody').textContent`), /這個工具會掃描/, 'the body is redrawn in Traditional Chinese');
  assert.equal(await run(`document.documentElement.dir`), 'ltr');
  await shot('tutorial-zh-TW-1.png');
  // Leaving Chinese while it is open closes it: there is no copy to show.
  await run(`applyLang('en')`);
  assert.equal(await hidden(), true, 'switching to a language without a guide closes it');

  // The settings row is how a reader gets the guide back after deciding. It is
  // offered only for the two Chinese scripts, and reopening must not disturb the
  // outcome that was already written.
  await run(`show('settings')`);
  await run(`applyLang('zh')`);
  await waitFor(`$('setReopenTutorial') !== null`);
  assert.equal(await run(`$('settings').textContent.includes('新手教程')`), true, 'the settings row is named the way the guide names it');
  assert.equal(await run(`$('setReopenTutorial').textContent`), '重新查看');
  await run(`$('setReopenTutorial').scrollIntoView({ block: 'center' })`);
  await shot('settings-reopen-tutorial-zh.png');
  await run(`$('setReopenTutorial').click()`);
  assert.equal(await hidden(), false, 'the settings row opens a guide that was already decided');
  assert.equal(await text('tutorialStep'), '第 1 / 7 步', 'it starts over from page one');
  assert.equal(await run(`document.activeElement.id`), 'tutorialNext');
  await press('Escape');
  assert.equal(await hidden(), true, 'Escape closes the reopened guide');
  assert.deepEqual(await calls(), ['done', 'skipped'], 'reopening writes no outcome of its own');
  // The row follows the script, and English gets none: there is no English guide.
  await run(`applyLang('zh-TW')`);
  await waitFor(`$('settings').textContent.includes('新手教學')`);
  assert.equal(await run(`$('setReopenTutorial').textContent`), '重新查看');
  await run(`applyLang('en')`);
  await waitFor(`$('setReopenTutorial') === null`);
  assert.equal(await run(`document.querySelector('#setReopenTutorial') === null`), true, 'English gets no row');

  // Every control the guide names has to read exactly as the app does. Two
  // files carry these strings and they disagree on some of them, so this reads
  // the live catalog instead of either source file.
  const guideText = (code) => run(`(() => {
    const out = [];
    const walk = (value) => {
      if (typeof value === 'string') out.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(window.tutorialCopy.pages(${JSON.stringify(code)}));
    return out.join('\\n');
  })()`);
  const liveString = (code, key) => run(`(() => {
    const value = window.i18n.S[${JSON.stringify(code)}][${JSON.stringify(key)}];
    return typeof value === 'function' ? value(1, 2) : String(value);
  })()`);
  const named = ['setAutoScan', 'addFolder', 'addGame', 'navGames', 'navHistory', 'navAddons', 'navOverlay',
    'navCommunity', 'navSettings', 'navAbout', 'install', 'restore', 'antiCheatWarningTitle', 'antiCheatContinue',
    'crashWarningTitle', 'notesTitle', 'setReopenTutorial', 'setReopenTutorialBtn'];
  for (const code of ['zh', 'zh-TW']) {
    const body = await guideText(code);
    for (const key of named) {
      const live = await liveString(code, key);
      assert.equal(body.includes(live), true, `${code}: the guide names ${key} the way the app does ("${live}")`);
    }
  }

  // The in-game overlay is drawn by this app, so it is dead once the app is
  // really gone. The guide has to say so.
  const overlayRule = { zh: /叠加层就无法开启/, 'zh-TW': /疊加層就無法開啟/ };
  for (const code of ['zh', 'zh-TW']) {
    assert.match(await guideText(code), overlayRule[code], `${code}: the guide says the overlay needs the app running`);
  }

  // The guide has to point at the settings row that brings it back, naming it
  // exactly as that row is labelled.
  const reopenRule = { zh: /到「设置」里找到「新手教程」/, 'zh-TW': /到「設定」裡找到「新手教學」/ };
  for (const code of ['zh', 'zh-TW']) {
    assert.match(await guideText(code), reopenRule[code], `${code}: the guide points at the settings row`);
  }

  // The keyboard cannot escape the guide, and focus goes back to whatever had
  // it before the guide opened.
  const navGames = `document.querySelector('.nav-item[data-view="games"]')`;
  await run(`${navGames}.focus()`);
  assert.equal(await run(`document.activeElement === ${navGames}`), true, 'the app holds focus before the guide opens');
  await run(`window.tutorialUi.maybeShow('zh', 'pending')`);
  assert.equal(await run(`document.activeElement.id`), 'tutorialNext');
  await press('Tab');
  assert.equal(await run(`document.activeElement.id`), 'tutorialSkip', 'Tab wraps to the first control');
  await press('Tab');
  assert.equal(await run(`document.activeElement.id`), 'tutorialNext');
  await press('Tab');
  assert.equal(await run(`document.activeElement.id`), 'tutorialSkip');
  await press('Escape');
  assert.equal(await hidden(), true);
  assert.equal(await run(`document.activeElement === ${navGames}`), true, 'focus returns where it was');

  assert.deepEqual(errors, []);
  assert.deepEqual(await calls(), ['done', 'skipped'], 'no stray outcomes were written');
  console.log('PASS: first-run guide shows on launch in Chinese, pages, skips and finishes into persisted state, closes on Escape without deciding, and stays away for other languages and decided readers.');
  clearTimeout(timeout);
  win.destroy();
  app.exit(0);
}).catch((error) => { console.error(error); clearTimeout(timeout); app.exit(1); });