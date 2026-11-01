'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hashTree, verifyTree, formatReport, LOCK_SCHEMA } = require('../src/core/payload-lock');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

function tree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'streamline'), { recursive: true });
  fs.writeFileSync(path.join(root, 'streamline', 'a.dll'), 'alpha');
  fs.writeFileSync(path.join(root, 'streamline', 'b.dll'), 'beta');
  fs.writeFileSync(path.join(root, 'top.txt'), 'top');
  return root;
}

test('the lock lists every file once, sorted, with a forward-slash path', async (t) => {
  const lock = await hashTree(tree(t));
  assert.equal(LOCK_SCHEMA, 1);
  assert.deepEqual(lock.map((entry) => entry.path), ['streamline/a.dll', 'streamline/b.dll', 'top.txt']);
  assert.deepEqual(lock[0], { path: 'streamline/a.dll', size: 5, sha256: sha256('alpha') });
});

test('a tree that matches the lock verifies', async (t) => {
  const root = tree(t);
  const result = await verifyTree(root, await hashTree(root));
  assert.equal(result.ok, true);
  assert.deepEqual(result, { ok: true, files: 3, missing: [], extra: [], mismatched: [] });
});

test('a missing file is reported by name', async (t) => {
  const root = tree(t);
  const lock = await hashTree(root);
  fs.unlinkSync(path.join(root, 'streamline', 'b.dll'));
  const result = await verifyTree(root, lock);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['streamline/b.dll']);
  assert.deepEqual(result.extra, []);
  assert.deepEqual(result.mismatched, []);
});

test('a file the lock does not mention is refused, not ignored', async (t) => {
  const root = tree(t);
  const lock = await hashTree(root);
  fs.writeFileSync(path.join(root, 'streamline', 'extra.dll'), 'sneaky');
  const result = await verifyTree(root, lock);
  assert.equal(result.ok, false);
  assert.deepEqual(result.extra, ['streamline/extra.dll']);
});

test('a different size is a mismatch', async (t) => {
  const root = tree(t);
  const lock = await hashTree(root);
  fs.writeFileSync(path.join(root, 'top.txt'), 'top and more');
  const result = await verifyTree(root, lock);
  assert.equal(result.ok, false);
  assert.equal(result.mismatched.length, 1);
  assert.equal(result.mismatched[0].path, 'top.txt');
  assert.equal(result.mismatched[0].expected.size, 3);
  assert.equal(result.mismatched[0].actual.size, 12);
});

test('same size, different bytes is caught by the hash', async (t) => {
  const root = tree(t);
  const lock = await hashTree(root);
  fs.writeFileSync(path.join(root, 'streamline', 'a.dll'), 'alphA');
  const result = await verifyTree(root, lock);
  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatched.map((entry) => entry.path), ['streamline/a.dll']);
  assert.equal(result.mismatched[0].actual.sha256, sha256('alphA'));
});

test('a tree that was never built reports every pinned file as missing', async (t) => {
  const root = tree(t);
  const lock = await hashTree(root);
  const result = await verifyTree(path.join(root, 'does-not-exist'), lock);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['streamline/a.dll', 'streamline/b.dll', 'top.txt']);
});

test('the report names what is wrong and stays quiet when it is right', () => {
  assert.equal(formatReport({ ok: true, files: 3, missing: [], extra: [], mismatched: [] }, 'payload'),
    'payload: OK (3 files)');
  const report = formatReport({
    ok: false, files: 3,
    missing: ['a.dll'],
    extra: ['b.dll'],
    mismatched: [{ path: 'c.dll', expected: { size: 1, sha256: 'aa' }, actual: { size: 2, sha256: 'bb' } }]
  }, 'payload');
  assert.match(report, /^payload: MISMATCH \(3 pinned\)/);
  assert.match(report, /missing: a\.dll/);
  assert.match(report, /extra: b\.dll/);
  assert.match(report, /changed: c\.dll \(size 1 -> 2, sha256 aa -> bb\)/);
});
