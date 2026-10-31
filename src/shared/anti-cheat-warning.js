'use strict';
const { t } = require('./feature-i18n');

// Main-process confirmation: never trust a renderer-supplied approval flag.
// Consent applies only to this installation attempt and is not saved globally.
// listName is the entry that flagged this game, shown as data: a name is a
// name in every language, which is why it is not a translated string.
function dialogOptions(language, gameDir, exePath, listName) {
  return {
    type: 'warning',
    title: t(language, 'antiCheatWarningTitle'),
    message: t(language, 'antiCheatWarningTitle'),
    detail: t(language, 'antiCheatWarning') + (listName ? '\n\n' + listName : '') + '\n\n' + gameDir + '\n' + exePath,
    buttons: [t(language, 'cancel'), t(language, 'antiCheatContinue')],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  };
}
module.exports = { dialogOptions };
