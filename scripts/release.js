'use strict';
// Cuts a release from a tree the gate accepts: manifests every installer in
// dist/, signs the manifest with the offline key, and writes SHA256SUMS.
// It never uploads anything and never touches the private key beyond reading it.
//
//   node scripts/release.js --key <private-key.pem> [--build]
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { checkReleaseTree } = require('./check-release-tree');
const { verifyManifest, sha256File } = require('../src/core/update-integrity');
const { UPDATE_PUBLIC_KEY } = require('../src/core/update-public-key');

const ROOT = path.resolve(__dirname, '..');

function fingerprintOf(key) {
  const publicKey = key.type === 'public' ? key : crypto.createPublicKey(key);
  return crypto.createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

function readPrivateKey(file) {
  let key;
  try {
    key = crypto.createPrivateKey(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read an Ed25519 private key from ${file}: ${error.message}`);
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`${file} is a ${key.asymmetricKeyType} key; the update manifest needs Ed25519.`);
  }
  return key;
}

function listDist(distDir) {
  if (!fs.existsSync(distDir)) throw new Error('dist/ does not exist. Run with --build, or build first.');
  return fs.readdirSync(distDir)
    .filter((name) => /\.(exe|zip)$/i.test(name))
    .sort()
    .map((name) => path.join(distDir, name))
    .filter((file) => fs.statSync(file).isFile());
}

// The manifest covers every installer the release offers. The checksum file
// covers installers and archives, because a person checking a hand download
// should be able to verify whichever file they took.
async function writeManifest({ distDir, version, privateKey }) {
  const files = listDist(distDir);
  const installers = files.filter((file) => /\.exe$/i.test(file));
  if (!installers.length) throw new Error(`No .exe in ${distDir}: build the installers first.`);
  // dist/ keeps old builds. Signing one of those under the new version would
  // hand every user an older binary with a fresh, valid signature.
  const stale = installers.filter((file) => {
    const name = path.basename(file);
    return !name.includes(`-${version}.`) && !name.includes(`-${version}-`);
  });
  if (stale.length) {
    throw new Error([
      `These installers do not name version ${version}:`,
      ...stale.map((file) => `  ${path.basename(file)}`),
      'Build this version before releasing, or remove the old installers from dist/.'
    ].join('\n'));
  }

  const assets = [];
  for (const file of installers) {
    assets.push({
      name: path.basename(file),
      size: fs.statSync(file).size,
      sha256: await sha256File(file)
    });
  }
  const manifest = {
    schema: 1,
    version,
    issuedAt: new Date().toISOString(),
    assets
  };
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const signature = crypto.sign(null, bytes, privateKey);
  const manifestPath = path.join(distDir, 'update-manifest.json');
  const signaturePath = `${manifestPath}.sig`;
  fs.writeFileSync(manifestPath, bytes);
  fs.writeFileSync(signaturePath, `${signature.toString('base64')}\n`);

  const sums = [];
  for (const file of files) sums.push(`${await sha256File(file)}  ${path.basename(file)}`);
  const sumsPath = path.join(distDir, 'SHA256SUMS');
  fs.writeFileSync(sumsPath, `${sums.join('\n')}\n`);

  return { manifest, bytes, signature, manifestPath, signaturePath, sumsPath, files };
}

function parseArgs(argv) {
  const options = { build: false, key: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--build') options.build = true;
    else if (arg === '--key') {
      options.key = argv[++i];
      if (!options.key) throw new Error('--key needs the path to the private key.');
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.key) throw new Error('Usage: node scripts/release.js --key <private-key.pem> [--build]');
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const privateKey = readPrivateKey(options.key);
  const signingKey = fingerprintOf(privateKey);

  const gate = await checkReleaseTree();
  console.log(gate.lines.join('\n'));
  if (!gate.ok) {
    console.error('\nThe release tree is not buildable. Nothing was built.');
    process.exit(1);
  }

  if (options.build) {
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  }

  const distDir = path.join(ROOT, 'dist');
  const result = await writeManifest({ distDir, version: gate.version, privateKey });

  // The signature is checked with the key that ships inside the app. A release
  // signed by any other key would be refused by every install already out there.
  try {
    verifyManifest(result.bytes, result.signature.toString('base64'), UPDATE_PUBLIC_KEY);
  } catch (error) {
    if (error.reason === 'bad-signature') {
      console.error('\nThe manifest was signed with a key this app does not trust.');
      console.error(`  signing key: ${signingKey}`);
      console.error(`  app trusts:  ${fingerprintOf(UPDATE_PUBLIC_KEY)}`);
      console.error('Do not upload this release: every 2.0.5+ install would refuse it.');
    } else {
      console.error(`\nThe manifest failed its own check: ${error.message}`);
    }
    process.exit(1);
  }

  console.log(`\nversion:   ${gate.version}`);
  console.log(`signing:   ${signingKey}`);
  console.log(`manifest:  ${path.relative(ROOT, result.manifestPath)}`);
  console.log(`signature: ${path.relative(ROOT, result.signaturePath)}`);
  console.log(`checksums: ${path.relative(ROOT, result.sumsPath)}`);
  console.log('\nassets:');
  for (const asset of result.manifest.assets) {
    console.log(`  ${String(asset.size).padStart(10)}  ${asset.sha256}  ${asset.name}`);
  }
  console.log('\nUpload the installers, update-manifest.json and update-manifest.json.sig to the release.');
  console.log('The updater refuses a release that does not carry the manifest and its signature.');
  console.log('Nothing was uploaded and nothing was pushed.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nrelease failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { writeManifest, readPrivateKey, fingerprintOf };
