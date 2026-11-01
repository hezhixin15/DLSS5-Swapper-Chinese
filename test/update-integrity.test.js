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

const RELEASE_URL = 'https://github.com/hezhixin15/DLSS5-Swapper-Chinese/releases/download/v2.0.5';
const setup = (overrides = {}) => ({
  name: 'DLSS5-Swapper-Setup-2.0.5.exe',
  size: 11,
  sha256: 'a'.repeat(64),
  url: `${RELEASE_URL}/DLSS5-Swapper-Setup-2.0.5.exe`,
  ...overrides
});
const manifest = (overrides = {}) => ({
  schema: 1,
  version: '2.0.5',
  issuedAt: '2026-11-01T00:00:00.000Z',
  assets: [setup()],
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
  const { bytes, sig } = signed(manifest({ assets: [setup({ sha256: 'A'.repeat(64) })] }));
  const parsed = integrity.verifyManifest(bytes, sig, publicPem);
  assert.equal(parsed.schema, 1);
  assert.equal(parsed.version, '2.0.5');
  assert.equal(parsed.assets[0].sha256, 'a'.repeat(64), 'the hash is normalised to lower case');
  assert.equal(parsed.assets[0].url, `${RELEASE_URL}/DLSS5-Swapper-Setup-2.0.5.exe`);
});

// The manifest is the authority on where the bytes come from, so a release can
// carry only these two small files and host the installer anywhere. That also
// means a forged manifest cannot be limited by the app guessing at hosts: the
// checks here are about the shape of the address, not its reputation.
test('an asset without a usable download url is refused', () => {
  for (const url of [undefined, null, '', '   ', 42, {}, []]) {
    const { bytes, sig } = signed(manifest({ assets: [setup({ url })] }));
    assert.throws(() => integrity.verifyManifest(bytes, sig, publicPem), reason('bad-manifest'),
      `url ${JSON.stringify(url)} must not pass`);
  }
});

test('only https downloads are accepted', () => {
  for (const url of [
    'http://example.com/setup.exe',
    'ftp://example.com/setup.exe',
    'file:///C:/Windows/setup.exe',
    '//example.com/setup.exe',
    'example.com/setup.exe',
    'javascript:alert(1)'
  ]) {
    const { bytes, sig } = signed(manifest({ assets: [setup({ url })] }));
    assert.throws(() => integrity.verifyManifest(bytes, sig, publicPem), reason('bad-manifest'),
      `${url} must not pass`);
  }
});

// WHATWG parsing fixes up a missing slash and reads a bare name as a host. The
// app must download the address it validated, so what it keeps is the
// normalised form, not whatever string the manifest happened to contain.
test('a sloppy https url is normalised before it is ever fetched', () => {
  for (const [value, expected] of [
    ['https:/mirror.example.com/setup.exe', 'https://mirror.example.com/setup.exe'],
    ['https:///setup.exe', 'https://setup.exe/']
  ]) {
    const parsed = integrity.parseManifest(bytesOf(manifest({ assets: [setup({ url: value })] })));
    assert.equal(parsed.assets[0].url, expected, `${value} normalises to ${expected}`);
    assert.equal(integrity.hostOf(parsed.assets[0].url), new URL(expected).hostname);
  }
});

// Credentials in a signed URL would leak into logs, and a host that resolves
// locally means the updater is being pointed at the person's own machine.
test('a url that carries credentials or names a local host is refused', () => {
  for (const url of [
    'https://user:pass@example.com/setup.exe',
    'https://localhost/setup.exe',
    'https://app.localhost/setup.exe',
    'https://127.0.0.1/setup.exe',
    'https://0.0.0.0/setup.exe',
    'https://[::1]/setup.exe',
    'https://169.254.169.254/latest/setup.exe'
  ]) {
    const { bytes, sig } = signed(manifest({ assets: [setup({ url })] }));
    assert.throws(() => integrity.verifyManifest(bytes, sig, publicPem), reason('bad-manifest'),
      `${url} must not pass`);
  }
});

// Cloud drives hand out signed links with a query string, and Gitee forwards
// attachments to a token-carrying CDN host. Both are legitimate at check time;
// only the release script refuses to bake an expiring link into a signature.
test('a signed url with a query string is accepted as-is', () => {
  const url = 'https://pan.example.com/dl/setup.exe?token=abc&expires=1800000000';
  const parsed = integrity.parseManifest(bytesOf(manifest({ assets: [setup({ url })] })));
  assert.equal(parsed.assets[0].url, url);
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
    setup({ name: '../setup.exe' }),
    setup({ name: 'dir/setup.exe' }),
    setup({ name: '' }),
    setup({ size: -1 }),
    setup({ size: 1.5 }),
    setup({ sha256: 'xyz' })
  ];
  for (const asset of bad) {
    const { bytes, sig } = signed(manifest({ assets: [asset] }));
    assert.throws(() => integrity.verifyManifest(bytes, sig, publicPem), reason('bad-manifest'),
      `${JSON.stringify(asset)} must not pass`);
  }
});

test('the same asset listed twice is rejected', () => {
  const { bytes, sig } = signed(manifest({ assets: [setup(), setup()] }));
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

test('the installer is preferred over the portable build, from the manifest', () => {
  const parsed = integrity.parseManifest(bytesOf(manifest({ assets: [
    setup({ name: 'DLSS5-Swapper-2.0.5-portable.exe' }),
    setup({ name: 'DLSS5-Swapper-Setup-2.0.5.exe' }),
    setup({ name: 'release-notes.zip' })
  ] })));
  assert.equal(integrity.pickInstaller(parsed).name, 'DLSS5-Swapper-Setup-2.0.5.exe');

  const portableOnly = integrity.parseManifest(bytesOf(manifest({ assets: [
    setup({ name: 'DLSS5-Swapper-2.0.5-portable.exe' })
  ] })));
  assert.equal(integrity.pickInstaller(portableOnly).name, 'DLSS5-Swapper-2.0.5-portable.exe');

  const noExe = integrity.parseManifest(bytesOf(manifest({ assets: [setup({ name: 'release-notes.zip' })] })));
  assert.equal(integrity.pickInstaller(noExe), null, 'a manifest of archives offers nothing to run');
  assert.equal(integrity.pickInstaller(null), null);
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
