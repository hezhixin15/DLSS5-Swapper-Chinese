'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const integrity = require('../src/core/update-integrity');

// A key pair made per test run: no private key for the update channel ever
// lives in the repository, and the production key is not touched.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const otherPem = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });

const manifest = (overrides = {}) => ({
  schema: 1,
  version: '2.0.5',
  issuedAt: '2026-11-01T00:00:00.000Z',
  assets: [
    { name: 'DLSS5-Swapper-Setup-2.0.5.exe', size: 11, sha256: 'a'.repeat(64) }
  ],
  ...overrides
});
const bytesOf = (value) => Buffer.from(JSON.stringify(value, null, 2));
const sign = (bytes) => crypto.sign(null, Buffer.from(bytes), privateKey).toString('base64');
const signed = (value) => {
  const bytes = bytesOf(value);
  return { bytes, sig: sign(bytes) };
};
const reason = (expected) => (error) => {
  assert.ok(error instanceof integrity.IntegrityError, `expected IntegrityError, got ${error && error.name}`);
  assert.equal(error.reason, expected, error.message);
  return true;
};

test('a correctly signed manifest is accepted and normalised', () => {
  const { bytes, sig } = signed(manifest({ assets: [
    { name: 'DLSS5-Swapper-Setup-2.0.5.exe', size: 11, sha256: 'A'.repeat(64) }
  ] }));
  const parsed = integrity.verifyManifest(bytes, sig, publicPem);
  assert.equal(parsed.schema, 1);
  assert.equal(parsed.version, '2.0.5');
  assert.equal(parsed.assets[0].sha256, 'a'.repeat(64), 'the hash is normalised to lower case');
});

test('changing one byte of the manifest invalidates the signature', () => {
  const { bytes, sig } = signed(manifest());
  const tampered = Buffer.from(bytes);
  tampered[0] ^= 1;
  assert.throws(() => integrity.verifyManifest(tampered, sig, publicPem), reason('bad-signature'));
});

test('a manifest signed by a different key is rejected', () => {
  const { bytes, sig } = signed(manifest());
  assert.throws(() => integrity.verifyManifest(bytes, sig, otherPem), reason('bad-signature'));
});

test('a missing or truncated signature is rejected before parsing', () => {
  const { bytes } = signed(manifest());
  assert.throws(() => integrity.verifyManifest(bytes, '', publicPem), reason('bad-signature'));
  assert.throws(() => integrity.verifyManifest(bytes, 'AAAA', publicPem), reason('bad-signature'));
});

test('a valid signature over invalid JSON is still a bad manifest', () => {
  const bytes = Buffer.from('{ not json');
  assert.throws(() => integrity.verifyManifest(bytes, sign(bytes), publicPem), reason('bad-manifest'));
});

test('unsupported schema, missing version and missing assets are rejected', () => {
  for (const value of [
    manifest({ schema: 2 }),
    manifest({ version: '' }),
    manifest({ assets: null }),
    manifest({ assets: {} })
  ]) {
    const { bytes, sig } = signed(value);
    assert.throws(() => integrity.verifyManifest(bytes, sig, publicPem), reason('bad-manifest'));
  }
});

test('asset names, sizes and hashes are validated', () => {
  const bad = [
    { name: '../setup.exe', size: 1, sha256: 'a'.repeat(64) },
    { name: 'dir/setup.exe', size: 1, sha256: 'a'.repeat(64) },
    { name: '', size: 1, sha256: 'a'.repeat(64) },
    { name: 'setup.exe', size: -1, sha256: 'a'.repeat(64) },
    { name: 'setup.exe', size: 1.5, sha256: 'a'.repeat(64) },
    { name: 'setup.exe', size: 1, sha256: 'xyz' }
  ];
  for (const asset of bad) {
    const { bytes, sig } = signed(manifest({ assets: [asset] }));
    assert.throws(() => integrity.verifyManifest(bytes, sig, publicPem), reason('bad-manifest'));
  }
});

test('the same asset listed twice is rejected', () => {
  const asset = { name: 'setup.exe', size: 1, sha256: 'a'.repeat(64) };
  const { bytes, sig } = signed(manifest({ assets: [asset, { ...asset }] }));
  assert.throws(() => integrity.verifyManifest(bytes, sig, publicPem), reason('bad-manifest'));
});

test('the manifest must be for the version the release offered', () => {
  const parsed = integrity.parseManifest(bytesOf(manifest()));
  assert.equal(integrity.assertVersion(parsed, '2.0.5'), parsed);
  assert.throws(() => integrity.assertVersion(parsed, '2.0.6'), reason('manifest-version'));
  assert.throws(() => integrity.assertVersion(null, '2.0.5'), reason('manifest-version'));
});

test('an asset that is not in the manifest is refused by exact name', () => {
  const parsed = integrity.parseManifest(bytesOf(manifest()));
  assert.equal(integrity.findAsset(parsed, 'DLSS5-Swapper-Setup-2.0.5.exe').size, 11);
  assert.throws(() => integrity.findAsset(parsed, 'DLSS5-Swapper-2.0.5-portable.exe'), reason('asset-not-listed'));
  assert.throws(() => integrity.findAsset(parsed, 'dlss5-swapper-setup-2.0.5.exe'), reason('asset-not-listed'));
});

test('the downloaded file must match the manifest size and hash', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-integrity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'installer.exe');
  fs.writeFileSync(file, 'installer!!');

  const entry = {
    name: 'installer.exe',
    size: fs.statSync(file).size,
    sha256: await integrity.sha256File(file)
  };
  const verified = await integrity.verifyFile(file, entry);
  assert.deepEqual(verified, { path: file, size: entry.size, sha256: entry.sha256 });

  await assert.rejects(() => integrity.verifyFile(file, { ...entry, size: entry.size + 1 }), reason('size-mismatch'));

  // Same length, different bytes: only the hash catches this one.
  fs.writeFileSync(file, 'INSTALLER!!');
  await assert.rejects(() => integrity.verifyFile(file, entry), reason('sha256-mismatch'));

  fs.unlinkSync(file);
  await assert.rejects(() => integrity.verifyFile(file, entry), (error) => error.code === 'ENOENT');
});

test('a directory is not accepted as a downloaded file', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-integrity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await assert.rejects(
    () => integrity.verifyFile(dir, { name: 'x', size: 0, sha256: 'a'.repeat(64) }),
    reason('size-mismatch')
  );
});
