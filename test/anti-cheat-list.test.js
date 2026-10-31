'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const list = require('../src/core/anti-cheat-list');

test('names are read from plain lines, comments and blanks are skipped', () => {
  const parsed = list.parse([
    '# anti-cheat games',
    '',
    'Escape from Tarkov',
    '  VALORANT  ',
    '// another comment',
    'Escape from Tarkov', // the maintainer pasted it twice
    'Apex Legends'
  ].join('\n'));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.names, ['Escape from Tarkov', 'VALORANT', 'Apex Legends']);
});

test('markdown decoration around a name is stripped, the name is not', () => {
  const parsed = list.parse(['- Escape from Tarkov', '* VALORANT', '| Apex Legends |', '`Destiny 2`'].join('\n'));
  assert.deepEqual(parsed.names, ['Escape from Tarkov', 'VALORANT', 'Apex Legends', 'Destiny 2']);
  assert.equal(list.cleanLine('1. Escape from Tarkov'), 'Escape from Tarkov');
  assert.equal(list.cleanLine('| Name | Note |'), 'Name | Note');
});

test('a file that is too big, too long or not text is refused whole', () => {
  assert.equal(list.parse(null).error, 'errListNotText');
  assert.equal(list.parse(42).error, 'errListNotText');
  assert.equal(list.parse('x'.repeat(list.LIMITS.maxBytes + 1)).error, 'errListTooBig');
  assert.equal(list.parse(Array(list.LIMITS.maxLines + 2).join('a\n')).error, 'errListTooManyLines');
  assert.equal(list.parse('a'.repeat(list.LIMITS.maxLine + 1)).error, 'errListLineTooLong');
  for (const answer of [list.parse('x'.repeat(list.LIMITS.maxBytes + 1)), list.parse(null)]) {
    assert.deepEqual(answer.names, [], 'a refused file yields no names');
    assert.equal(answer.ok, false);
  }
});

test('lines trying to be a path or an escape are dropped, not honoured', () => {
  const parsed = list.parse(['Escape from Tarkov', '..\\..\\evil', 'C:\\Windows\\evil', 'bad\u0000name', 'VALORANT'].join('\n'));
  assert.deepEqual(parsed.names, ['Escape from Tarkov', 'VALORANT']);
});

test('the same game is recognised under any of its names', () => {
  const names = ['Escape from Tarkov'];
  assert.deepEqual(list.match(names, { title: 'Escape from Tarkov', dir: 'EFT', exe: 'EscapeFromTarkov.exe' }),
    { name: 'Escape from Tarkov', key: 'escapefromtarkov' });
  assert.deepEqual(list.match(names, { title: null, dir: 'Escape from Tarkov', exe: null }),
    { name: 'Escape from Tarkov', key: 'escapefromtarkov' });
  // The shipping executable carries a build suffix the list does not know.
  assert.equal(list.match(names, { title: null, dir: null, exe: 'EscapeFromTarkov-Win64-Shipping.exe' }).name,
    'Escape from Tarkov');
  // Case, punctuation and width are all noise.
  assert.equal(list.match(names, { title: 'ESCAPE　from—Tarkov™', dir: null, exe: null }).name, 'Escape from Tarkov');
});

test('a title carrying a sequel number still finds the exe name', () => {
  const names = ['Rainbow Six Siege'];
  assert.equal(list.match(names, { title: null, dir: null, exe: 'RainbowSix.exe' }).name, 'Rainbow Six Siege');
  assert.equal(list.match(names, { title: 'Rainbow Six Siege', dir: null, exe: null }).name, 'Rainbow Six Siege');
});

test('short names never catch unrelated games', () => {
  const names = ['War', 'Sim'];
  assert.equal(list.match(names, { title: 'Warhammer 40,000', dir: 'Warhammer', exe: 'Warhammer.exe' }), null);
  assert.equal(list.match(names, { title: 'Farming Simulator 25', dir: null, exe: null }), null);
});

test('a game that only shares a word with the list is not flagged', () => {
  const names = ['Escape from Tarkov'];
  assert.equal(list.match(names, { title: 'Escape Academy', dir: 'Escape Academy', exe: 'Escape.exe' }), null);
});

test('the 2009 Modern Warfare 2 is not swept in by its 2019 sibling', () => {
  // The two folders differ by one digit, which is exactly why the Ricochet
  // titles are keyed on the executable name and not on the folder.
  const names = ['ModernWarfare'];
  assert.equal(list.match(names, { title: 'Call of Duty: Modern Warfare', dir: 'Call of Duty Modern Warfare', exe: 'modernwarfare.exe' }).name,
    'ModernWarfare');
  assert.equal(list.match(names, { title: 'Call of Duty: Modern Warfare 2', dir: 'Call of Duty Modern Warfare 2', exe: 'iw4mp.exe' }),
    null);
});

test('a short name matches its own executable and nothing else', () => {
  // "cod" is too short for the prefix rule, so the exact stem is what it has.
  const names = ['cod'];
  assert.equal(list.match(names, { title: 'Call of Duty', dir: null, exe: 'cod.exe' }).name, 'cod');
  assert.equal(list.match(names, { title: 'Call of Duty: Modern Warfare 2', dir: 'Call of Duty Modern Warfare 2', exe: 'iw4mp.exe' }), null);
  assert.equal(list.match(names, { title: 'Coda', dir: null, exe: null }), null);
});

test('the longest entry wins so the banner names the game precisely', () => {
  const names = ['Escape', 'Escape from Tarkov'];
  assert.equal(list.match(names, { title: 'Escape from Tarkov', dir: null, exe: null }).name, 'Escape from Tarkov');
});

test('an empty or missing list flags nothing and never throws', () => {
  for (const names of [[], null]) {
    assert.equal(list.match(names, { title: 'Escape from Tarkov', dir: 'x', exe: 'y.exe' }), null);
    assert.equal(list.match(names, {}), null);
    assert.equal(list.match(names, null), null);
  }
});

test('the update dialog can show what changed', () => {
  const before = ['Escape from Tarkov', 'VALORANT', 'Apex Legends'];
  const after = ['escape from tarkov', 'VALORANT', 'Destiny 2'];
  assert.deepEqual(list.diff(before, after), {
    added: ['Destiny 2'],
    removed: ['Apex Legends']
  });
  assert.deepEqual(list.diff([], after), { added: after, removed: [] });
  assert.deepEqual(list.diff(before, before), { added: [], removed: [] });
});
