'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../src/core/anti-cheat-list-store');

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-list-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('a fresh install warns from the snapshot that shipped with it', (t) => {
  const loaded = store.load(scratch(t));
  assert.equal(loaded.source, 'bundled');
  assert.ok(loaded.names.includes('Escape from Tarkov'), 'the snapshot carries the known titles');
  assert.ok(loaded.names.includes('VALORANT'));
  assert.equal(loaded.hash, store.hash(loaded.text));
});

test('the downloaded copy is what the app runs on', (t) => {
  const root = scratch(t);
  const saved = store.save(root, 'Escape from Tarkov\nVALORANT\n');
  assert.equal(saved.ok, true);
  assert.equal(saved.file, path.join(root, store.FILE_NAME));
  const loaded = store.load(root);
  assert.equal(loaded.source, 'downloaded');
  assert.deepEqual(loaded.names, ['Escape from Tarkov', 'VALORANT']);
  assert.equal(loaded.hash, saved.hash);
});

test('a download that is not a list falls back to the snapshot', (t) => {
  const root = scratch(t);
  fs.writeFileSync(path.join(root, store.FILE_NAME), 'x'.repeat(require('../src/core/anti-cheat-list').LIMITS.maxBytes + 1), 'utf8');
  assert.equal(store.load(root).source, 'bundled');
  fs.writeFileSync(path.join(root, store.FILE_NAME), '<!DOCTYPE html><html>', 'utf8');
  assert.equal(store.load(root).source, 'bundled');
});

test('saving replaces the file whole and leaves no debris', (t) => {
  const root = scratch(t);
  store.save(root, 'Escape from Tarkov\n');
  store.save(root, 'VALORANT\n');
  assert.deepEqual(fs.readdirSync(root), [store.FILE_NAME]);
  assert.equal(store.load(root).names.join(), 'VALORANT');
});

test('a save that cannot write says so instead of pretending', (t) => {
  const root = scratch(t);
  const file = path.join(root, 'not-a-folder');
  fs.writeFileSync(file, 'x', 'utf8');
  const saved = store.save(path.join(file, 'sub'), 'Escape from Tarkov\n');
  assert.equal(saved.ok, false);
  assert.ok(saved.error, 'the caller gets the reason');
  assert.deepEqual(fs.readdirSync(root), ['not-a-folder']);
});

test('the same content always hashes the same', () => {
  assert.equal(store.hash('a\nb\n'), store.hash('a\nb\n'));
  assert.notEqual(store.hash('a\nb\n'), store.hash('a\nb'));
});
