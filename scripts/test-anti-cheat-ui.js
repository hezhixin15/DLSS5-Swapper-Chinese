'use strict';

// Run with npm run test:ui:anticheat. Same isolated window as the filters
// suite, but about the anti-cheat list: the shield on a card, the notice on the
// home page, the settings that steer the list, the update offer and what stops
// an install while the list is still being checked.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'dlss5-anticheat-ui-')));
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
  const output = path.join(__dirname, '../dist/ui-tests');
  fs.mkdirSync(output, { recursive: true });
  const shot = async (name) => {
    // A hidden window composites lazily, so capturePage can hand back the
    // previous frame. Let it paint, throw one capture away, then take the one
    // that is written out - a screenshot of the wrong screen is worse than
    // none, it looks like proof of something that never rendered.
    await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 150))))`);
    await win.webContents.capturePage();
    await new Promise(resolve => setTimeout(resolve, 200));
    fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
  };
  const askOpen = () => run(`new Promise(resolve => {
    const check = () => {
      const dialog = document.querySelector('dialog.ask');
      dialog && dialog.open ? resolve() : setTimeout(check, 10);
    };
    check();
  })`);
  const settle = (ms = 40) => run(`new Promise(resolve => setTimeout(resolve, ${ms}))`);

  await run(`new Promise(resolve => {
    const check = () => state.games.length === 9 && $('statusText').textContent === t('ready')
      ? resolve() : setTimeout(check, 10);
    check();
  })`);

  // A game the list flags carries a shield on its card, and it is visible
  // without hovering: the warning has to be seen before anybody reaches Install.
  // The flag arrives here rather than in the shared fixture: the filters suite
  // asks the sheet's warning what it says, and a notice on the home page would
  // answer that question first.
  await run(`state.games[0].antiCheat = { name: 'Euro Truck Simulator', key: 'eurotrucksimulator' }; renderGames(); renderAntiCheatNotice()`);
  await run(`show('games')`);
  assert.equal(await run(`document.querySelectorAll('#groups .ac-flag').length`), 1);
  assert.equal(await run(`document.querySelector('#groups .ac-flag').getAttribute('aria-label')`), await run(`t('acBadge')`));
  assert.equal(await run(`document.querySelector('#groups .ac-flag').title`), await run(`t('acListedAs') + ': Euro Truck Simulator'`));
  assert.equal(await run(`(() => {
    const flag = document.querySelector('#groups .ac-flag');
    return getComputedStyle(flag).opacity === '1' && flag.getBoundingClientRect().width > 10;
  })()`), true, 'the shield is drawn, not hidden behind a hover');
  await shot('anticheat-cards-light.png');
  await run(`document.documentElement.dataset.theme = 'dark'`);
  await shot('anticheat-cards-dark.png');
  await run(`document.documentElement.dataset.theme = 'light'`);

  // The home page says how many games in the library are affected.
  await run(`show('home')`);
  assert.equal(await run(`$('antiCheatNotice').hidden`), false);
  assert.equal(await run(`$('antiCheatNotice').querySelector('b').textContent`), await run(`t('acNotice', 1)`));
  assert.match(await run(`$('antiCheatNotice').textContent`), /Euro Truck Simulator/);
  await shot('anticheat-notice-home.png');

  // The sheet names the entry that flagged the game, next to the warning.
  const banner = await run(`installOptions({ antiCheatWarning: true, antiCheatMatch: { name: 'VALORANT', key: 'valorant' } }, null, 'Fixture')`);
  assert.match(banner, /anti-cheat-warning/);
  assert.ok(banner.includes('VALORANT'), 'the list entry is named');
  assert.ok(banner.includes(await run(`t('acListedAs')`)), 'and labelled');
  // A game the list does not carry keeps the warning it had, with no name.
  const unnamed = await run(`installOptions({ antiCheatWarning: true }, null, 'Fixture')`);
  assert.doesNotMatch(unnamed, /VALORANT/);

  // Settings: the switch, the three ways to update and the check button.
  // show('settings') renders the panel itself - calling renderSettings() as
  // well would race two renders and paint the settings section twice.
  await run(`show('settings')`);
  await settle(120);
  assert.equal(await run(`$('setAntiCheat').getAttribute('aria-checked')`), 'true');
  assert.equal(await run(`$('setAntiCheatMode').value`), 'prompt');
  assert.equal(await run(`$('setAntiCheatMode').options.length`), 3);
  assert.equal(await run(`$('setAntiCheatCheck').textContent`), await run(`t('setAntiCheatCheck')`));
  assert.equal(await run(`$('setAntiCheatChannel').value`), 'github');
  assert.equal(await run(`$('setAntiCheatChannel').options.length`), 2);
  assert.match(await run(`$('setAntiCheatChannel').options[1].textContent`), /Gitee/);
  assert.equal(await run(`$('setUpdateSource').value`), 'github');
  assert.equal(await run(`$('setUpdateSource').options.length`), 2);
  assert.match(await run(`$('setUpdateSource').options[1].textContent`), /Gitee/);
  await run(`$('setAntiCheat').scrollIntoView({ block: 'center' })`);
  await shot('anticheat-settings-light.png');
  await run(`document.documentElement.dataset.theme = 'dark'`);
  await shot('anticheat-settings-dark.png');
  await run(`document.documentElement.dataset.theme = 'light'`);
  await run(`$('setAntiCheatMode').value = 'auto'; $('setAntiCheatMode').dispatchEvent(new Event('change'))`);
  await settle();
  assert.equal(await run(`window.lab.antiCheatState().then(s => s.mode)`), 'auto');
  await run(`$('setAntiCheatChannel').value = 'gitee'; $('setAntiCheatChannel').dispatchEvent(new Event('change'))`);
  await settle();
  assert.equal(await run(`window.lab.antiCheatState().then(s => s.channel)`), 'gitee', 'the list channel is remembered');
  await run(`$('setUpdateSource').value = 'gitee'; $('setUpdateSource').dispatchEvent(new Event('change'))`);
  await settle();
  assert.equal(await run(`state.updateSource`), 'gitee', 'the update source is remembered');
  await run(`$('setUpdateSource').value = 'github'; $('setUpdateSource').dispatchEvent(new Event('change'))`);
  await settle();
  await run(`$('setAntiCheat').click()`);
  await settle();
  assert.equal(await run(`$('setAntiCheat').getAttribute('aria-checked')`), 'false');
  assert.equal(await run(`window.lab.antiCheatState().then(s => s.detect)`), false);
  await run(`$('setAntiCheat').click()`);
  await settle();

  // An update shows what changed before anything is downloaded, and ignoring
  // it is what "ignore this version" means - no write happens either way.
  await run(`window.lab.testAntiCheatReset()`);
  await run(`window.lab.testAntiCheatResult({
    ok: true, mode: 'prompt', checked: true, update: true, entries: 15,
    change: { added: ['Test Game Alpha'], removed: ['Old Game'] }
  })`);
  const offered = run(`checkAntiCheatList({ manual: true })`);
  await askOpen();
  assert.equal(await run(`$('askTitle').textContent`), await run(`t('acUpdateTitle')`));
  assert.match(await run(`document.querySelector('dialog.ask .ask-copy').textContent`), /Test Game Alpha/);
  assert.match(await run(`document.querySelector('dialog.ask .ask-copy').textContent`), /Old Game/);
  await shot('anticheat-update-dialog.png');
  await run(`document.querySelector('dialog.ask [data-ask="cancel"]').click()`);
  await offered;
  assert.deepEqual(await run(`window.lab.testAntiCheatCalls().map(c => c[0])`), ['check', 'ignore']);
  const accepted = run(`checkAntiCheatList({ manual: true })`);
  await askOpen();
  await run(`document.querySelector('dialog.ask [data-ask="confirm"]').click()`);
  await accepted;
  assert.deepEqual(await run(`window.lab.testAntiCheatCalls().map(c => c[0])`), ['check', 'ignore', 'check', 'apply']);

  // The release dialog asks which host to download from, and links to both
  // release pages for a manual download.
  await run(`window.lab.testUpdateAnswer({
    current: '2.0.5', latest: '9.9.9', newer: true, tag: 'v9.9.9', source: 'github',
    asset: { name: 'DLSS5-Swapper-Setup-9.9.9.exe', url: 'https://example.test/Setup.exe' },
    notes: 'Fixture notes'
  })`);
  await run(`checkForUpdates({ manual: true })`);
  await run(`new Promise(resolve => {
    const check = () => $('updateOverlay').classList.contains('hidden') ? setTimeout(check, 10) : resolve();
    check();
  })`);
  assert.equal(await run(`$('updateGitee').textContent`), await run(`t('updateOpenGitee')`));
  await run(`$('updateGitee').click()`);
  assert.deepEqual(await run(`window.lab.testProjectLinks()`), ['zhGiteeReleases']);
  await run(`$('updateNow').click()`);
  await settle();
  assert.equal(await run(`$('updatePick').classList.contains('hidden')`), false);
  assert.equal(await run(`$('updatePick').querySelectorAll('[data-update-source]').length`), 2);
  assert.match(await run(`$('updatePick').textContent`), /Gitee/);
  await shot('update-source-picker.png');
  await run(`$('updatePick').querySelector('[data-update-source="gitee"]').click()`);
  await settle();
  assert.deepEqual(await run(`window.lab.testUpdateDownloads()`), ['gitee']);
  await run(`closeUpdateDialog()`);

  // Installing while the list is still being checked asks before skipping:
  // warning with stale data is the person's decision to make.
  await run(`window.lab.testAntiCheatChecking(true); openSheet(state.games[1].dir, true)`);
  await run(`new Promise(resolve => { const check = () => $('doInstall') ? resolve() : setTimeout(check, 10); check(); })`);
  const installsBefore = await run(`window.lab.testInstallCalls().length`);
  const stopped = run(`runJob('install', state.games[1].dir)`);
  await askOpen();
  assert.equal(await run(`$('askTitle').textContent`), await run(`t('acPendingTitle')`));
  assert.equal(await run(`document.querySelector('dialog.ask [data-ask="confirm"]').textContent`), await run(`t('acSkip')`));
  await shot('anticheat-install-gate.png');
  await run(`document.querySelector('dialog.ask [data-ask="cancel"]').click()`);
  await stopped;
  assert.equal(await run(`window.lab.testInstallCalls().length`), installsBefore, 'skipping the question never installs');
  assert.equal(await run(`$('doInstall').disabled`), false, 'the sheet hands its buttons back');

  assert.deepEqual(errors, []);
  console.log('PASS: anti-cheat badge, home notice, named warning, settings, update offer and the install gate.');
  console.log(`Screenshots: ${output}`);
  clearTimeout(timeout);
  win.destroy();
  app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
