'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkReleaseTree } = require('../scripts/check-release-tree');
const { writeManifest } = require('../scripts/release');
const { hashTree } = require('../src/core/payload-lock');
const { verifyManifest } = require('../src/core/update-integrity');

const git = (root, args) => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
}).trim();

// A throwaway repository shaped like the real one: three pinned trees, a lock,
// and a tagged commit. Every gate check runs against it, so a test never needs
// to touch the actual release tree.
async function releaseTree(t, { version = '2.0.5' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'gate-fixture', version }, null, 2)}\n`);
  for (const [rel, body] of Object.entries({
    'payload/streamline/a.dll': 'alpha',
    'addons/extra.addon64': 'addon',
    'overlay-bin/overlay.addon64': 'overlay'
  })) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  const lock = { schema: 1, roots: {} };
  for (const name of ['payload', 'addons', 'overlay-bin']) {
    lock.roots[name] = { files: await hashTree(path.join(root, name)) };
  }
  fs.writeFileSync(path.join(root, 'payload.lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'fixture']);
  git(root, ['tag', `v${version}`]);
  return root;
}

const report = (result) => result.lines.join('\n');

test('a clean, tagged tree whose payload matches the lock passes', async (t) => {
  const root = await releaseTree(t);
  const result = await checkReleaseTree({ root });
  assert.equal(result.ok, true, report(result));
  assert.equal(result.version, '2.0.5');
  assert.equal(result.tag, 'v2.0.5');
  assert.match(report(result), /ok {3}the working tree is clean/);
  assert.match(report(result), /payload: OK \(1 files\)/);
  assert.match(report(result), /addons: OK \(1 files\)/);
  assert.match(report(result), /overlay-bin: OK \(1 files\)/);
});

test('an uncommitted change stops the release', async (t) => {
  const root = await releaseTree(t);
  fs.writeFileSync(path.join(root, 'payload', 'streamline', 'a.dll'), 'changed');
  const result = await checkReleaseTree({ root });
  assert.equal(result.ok, false);
  assert.match(report(result), /not clean/);
  assert.match(report(result), /payload: MISMATCH/);
});

test('--allow-dirty is a warning, not a bypass of the lock', async (t) => {
  const root = await releaseTree(t);
  fs.writeFileSync(path.join(root, 'notes.txt'), 'local scratch');
  const allowed = await checkReleaseTree({ root, allowDirty: true });
  assert.equal(allowed.ok, true, report(allowed));
  assert.match(report(allowed), /uncommitted changes are allowed/);

  fs.appendFileSync(path.join(root, 'payload', 'streamline', 'a.dll'), '!');
  const tampered = await checkReleaseTree({ root, allowDirty: true });
  assert.equal(tampered.ok, false, 'a dirty tree still has to match the lock');
  assert.match(report(tampered), /changed: streamline\/a\.dll/);
});

test('HEAD must carry the tag of the version being built', async (t) => {
  const root = await releaseTree(t);
  git(root, ['tag', '-d', 'v2.0.5']);
  const untagged = await checkReleaseTree({ root });
  assert.equal(untagged.ok, false);
  assert.match(report(untagged), /not tagged v2\.0\.5/);

  git(root, ['tag', 'v2.0.4']);
  const wrong = await checkReleaseTree({ root });
  assert.equal(wrong.ok, false, 'the tag has to name this version, not any version');
  assert.equal(wrong.tag, 'v2.0.4');
});

test('an extra file in a shipped tree is refused, not ignored', async (t) => {
  const root = await releaseTree(t);
  fs.writeFileSync(path.join(root, 'payload', 'streamline', 'sneaky.dll'), 'x');
  const result = await checkReleaseTree({ root, allowDirty: true });
  assert.equal(result.ok, false);
  assert.match(report(result), /extra: streamline\/sneaky\.dll/);
});

test('a missing or unpinned lock stops the release', async (t) => {
  const root = await releaseTree(t);
  fs.unlinkSync(path.join(root, 'payload.lock.json'));
  const missing = await checkReleaseTree({ root, allowDirty: true });
  assert.equal(missing.ok, false);
  assert.match(report(missing), /payload\.lock\.json is missing/);

  // A lock that simply omits a tree is not a pin for that tree.
  fs.writeFileSync(path.join(root, 'payload.lock.json'),
    `${JSON.stringify({ schema: 1, roots: { payload: { files: [] } } }, null, 2)}\n`);
  const partial = await checkReleaseTree({ root, allowDirty: true });
  assert.equal(partial.ok, false);
  assert.match(report(partial), /does not pin addons\//);
  assert.match(report(partial), /does not pin overlay-bin\//);
});

// writeManifest is the part of release.js that turns dist/ into the files the
// updater consumes; the signing round trip is the whole point of it.
test('the release manifest lists the installers and verifies against its key', async (t) => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-dist-'));
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  for (const [name, body] of [
    ['DLSS5-Swapper-Setup-2.0.5.exe', 'installer'],
    ['DLSS5-Swapper-2.0.5-portable.exe', 'portable'],
    ['DLSS5-Swapper-2.0.5.zip', 'archive'],
    ['notes.txt', 'not shipped']
  ]) fs.writeFileSync(path.join(dist, name), body);

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const result = await writeManifest({ distDir: dist, version: '2.0.5', privateKey });

  assert.equal(result.manifest.version, '2.0.5');
  assert.deepEqual(result.manifest.assets.map((asset) => asset.name), [
    'DLSS5-Swapper-2.0.5-portable.exe',
    'DLSS5-Swapper-Setup-2.0.5.exe'
  ]);
  assert.equal(result.manifest.assets[1].size, 'installer'.length);
  assert.equal(result.manifest.assets[1].sha256, crypto.createHash('sha256').update('installer').digest('hex'));

  const parsed = verifyManifest(result.bytes, fs.readFileSync(result.signaturePath, 'utf8'),
    publicKey.export({ type: 'spki', format: 'pem' }));
  assert.equal(parsed.version, '2.0.5');

  const sums = fs.readFileSync(result.sumsPath, 'utf8').trim().split('\n');
  assert.deepEqual(sums.map((line) => line.split('  ')[1]), [
    'DLSS5-Swapper-2.0.5-portable.exe',
    'DLSS5-Swapper-2.0.5.zip',
    'DLSS5-Swapper-Setup-2.0.5.exe'
  ]);
  assert.match(sums[1], new RegExp(`^${crypto.createHash('sha256').update('archive').digest('hex')}  `));
});

test('a dist without an installer produces no manifest at all', async (t) => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-dist-'));
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dist, 'notes.txt'), 'x');
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  await assert.rejects(
    () => writeManifest({ distDir: dist, version: '2.0.5', privateKey }),
    /No \.exe/
  );
  assert.equal(fs.existsSync(path.join(dist, 'update-manifest.json')), false);
});

test('an older installer left in dist is not signed under the new version', async (t) => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-dist-'));
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dist, 'DLSS5-Swapper-Setup-2.0.4.exe'), 'old installer');
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  await assert.rejects(
    () => writeManifest({ distDir: dist, version: '2.0.5', privateKey }),
    /do not name version 2\.0\.5[\s\S]*Setup-2\.0\.4\.exe/
  );
  assert.equal(fs.existsSync(path.join(dist, 'update-manifest.json')), false,
    'a stale tree must not leave a manifest behind');
});
