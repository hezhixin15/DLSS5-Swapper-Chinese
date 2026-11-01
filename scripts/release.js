'use strict';
// Cuts a release from a tree the gate accepts: manifests every installer in
// dist/, signs the manifest with the offline key, and writes SHA256SUMS.
// It never uploads anything and never touches the private key beyond reading it.
//
//   node scripts/release.js --key <private-key.pem> [--build]
//       [--channel github|gitee] [--download-base <url>] [--allow-host <host>]
//
// Each channel gets its own manifest in dist/<channel>/, because the signed
// text now names where the bytes are downloaded from: a mirror that cannot host
// the installer carries only the manifest and its signature, and points at a
// host that can. Run it once per channel.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { checkReleaseTree } = require('./check-release-tree');
const { verifyManifest, sha256File } = require('../src/core/update-integrity');
const { UPDATE_PUBLIC_KEY } = require('../src/core/update-public-key');
const { links } = require('../src/core/project-links');

const ROOT = path.resolve(__dirname, '..');
const CHANNELS = {
  github: links.zhGithub,
  gitee: links.zhGitee
};
// Checked when the manifest is made, never when it is read: a new mirror must
// not cost an app release, and a pinned list in the app protects nothing once
// the signing key is compromised anyway.
const DEFAULT_ALLOW_HOSTS = ['github.com', 'gitee.com'];

// Gitee forwards an attachment to a CDN address carrying a token and an expiry.
// Signing that form would kill the update the day the token ages out.
function assertDownloadBase(base, allowHosts) {
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`The download address is not an absolute URL: ${base}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`The download address must be https, got ${url.protocol} ${base}`);
  }
  if (url.search || url.hash) {
    throw new Error(`A download address with a query string expires; sign a stable one instead: ${base}`);
  }
  if (url.hostname === 'foruda.gitee.com') {
    throw new Error('foruda.gitee.com links carry expiring tokens; use the stable https://gitee.com/…/releases/download/… form.');
  }
  if (!allowHosts.includes(url.hostname)) {
    throw new Error(`${url.hostname} is not on the allowed host list (${allowHosts.join(', ')}). `
      + `Pass --allow-host ${url.hostname} if you mean it.`);
  }
  return base.replace(/\/+$/, '');
}

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

// The manifest covers every installer the release offers, and says where each
// one is fetched from. The checksum file covers installers and archives,
// because a person checking a hand download should be able to verify whichever
// file they took.
async function writeManifest({
  distDir, version, privateKey, channel = 'github', downloadBase = null, allowHosts = []
}) {
  if (!Object.hasOwn(CHANNELS, channel)) {
    throw new Error(`Unknown release channel: ${channel}. Choose ${Object.keys(CHANNELS).join(' or ')}.`);
  }
  const hosts = [...new Set([...DEFAULT_ALLOW_HOSTS, ...allowHosts])];
  const base = assertDownloadBase(
    downloadBase || `${CHANNELS[channel]}/releases/download/v${version}`, hosts
  );
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
    const name = path.basename(file);
    assets.push({
      name,
      url: `${base}/${encodeURIComponent(name)}`,
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
  const outDir = path.join(distDir, channel);
  fs.mkdirSync(outDir, { recursive: true });
  const manifestPath = path.join(outDir, 'update-manifest.json');
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
  const options = { build: false, key: null, channel: 'github', downloadBase: null, allowHosts: [] };
  const need = (flag, value) => {
    if (!value) throw new Error(`${flag} needs a value.`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--build') options.build = true;
    else if (arg === '--key') options.key = need(arg, argv[++i]);
    else if (arg === '--channel') options.channel = need(arg, argv[++i]);
    else if (arg === '--download-base') options.downloadBase = need(arg, argv[++i]);
    else if (arg === '--allow-host') options.allowHosts.push(need(arg, argv[++i]));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.key) {
    throw new Error('Usage: node scripts/release.js --key <private-key.pem> [--build] '
      + '[--channel github|gitee] [--download-base <url>] [--allow-host <host>]');
  }
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
  const result = await writeManifest({
    distDir,
    version: gate.version,
    privateKey,
    channel: options.channel,
    downloadBase: options.downloadBase,
    allowHosts: options.allowHosts
  });

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
  console.log(`channel:   ${options.channel}`);
  console.log(`signing:   ${signingKey}`);
  console.log(`manifest:  ${path.relative(ROOT, result.manifestPath)}`);
  console.log(`signature: ${path.relative(ROOT, result.signaturePath)}`);
  console.log(`checksums: ${path.relative(ROOT, result.sumsPath)}`);
  console.log('\nassets:');
  for (const asset of result.manifest.assets) {
    console.log(`  ${String(asset.size).padStart(10)}  ${asset.sha256}  ${asset.name}`);
    console.log(`  ${''.padStart(10)}  ${asset.url}`);
  }
  console.log(`\nUpload update-manifest.json and update-manifest.json.sig from `
    + `dist/${options.channel}/ to the ${options.channel} release.`);
  console.log('Upload the installers to whichever host the manifest names - it does not have to be this one.');
  console.log('The updater refuses a release that does not carry the manifest and its signature.');
  console.log('For the other channel, run this script again with --channel <name> [--download-base <url>].');
  console.log('Nothing was uploaded and nothing was pushed.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nrelease failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { writeManifest, readPrivateKey, fingerprintOf };
