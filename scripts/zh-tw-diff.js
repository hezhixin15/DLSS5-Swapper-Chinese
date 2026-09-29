'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ window: {} });
for (const file of ['renderer/i18n.js', 'renderer/i18n-extra.js', 'shared/feature-i18n.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context, { filename: file });
}
const i18n = context.window.i18n;

const enKeys = Object.keys(i18n.S.en);
const tw = i18n.S['zh-TW'] || {};
const missing = enKeys.filter((k) => tw[k] === undefined);
const extra = Object.keys(tw).filter((k) => i18n.S.en[k] === undefined);

console.log('total en keys:', enKeys.length);
console.log('zh-TW keys present:', Object.keys(tw).length);
console.log('missing in zh-TW:', missing.length);
console.log('stale keys in zh-TW:', extra.length, extra.join(', '));
console.log('---missing entries (key | zh | en)---');
for (const k of missing) {
  const zh = String(i18n.S.zh[k]);
  const en = String(i18n.S.en[k]);
  console.log(`@${k}`);
  console.log(`ZH: ${zh}`);
  console.log(`EN: ${en}`);
}
