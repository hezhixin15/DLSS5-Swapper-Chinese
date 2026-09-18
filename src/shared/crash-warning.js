'use strict';
const path = require('path');
const { t } = require('./feature-i18n');

// Games the maintainer has personally tested where a DLSS 5 install is known
// to crash mid-session rather than at launch. The executable name is the
// stable key: it survives library moves and is what the scanner reports.
const KNOWN_CRASH_RISK = {
  'partyanimals.exe': 'Party Animals'
};

function known(exePath) {
  if (!exePath) return null;
  const name = path.basename(exePath).toLowerCase();
  return Object.hasOwn(KNOWN_CRASH_RISK, name) ? KNOWN_CRASH_RISK[name] : null;
}

// Main-process confirmation, mirroring the anti-cheat consent: the risk is
// real but the choice stays with the person, one installation attempt at a
// time and nothing is saved globally.
function dialogOptions(language, gameDir, exePath) {
  return {
    type: 'warning',
    title: t(language, 'crashWarningTitle'),
    message: t(language, 'crashWarningTitle'),
    detail: t(language, 'crashWarning') + '\n\n' + gameDir + '\n' + exePath,
    buttons: [t(language, 'cancel'), t(language, 'antiCheatContinue')],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  };
}
module.exports = { known, dialogOptions };
