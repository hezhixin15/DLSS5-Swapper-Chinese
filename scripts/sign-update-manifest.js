'use strict';
// Re-signs an update-manifest.json that already exists. The release script does
// this itself; this is for a manifest produced elsewhere or re-signed after a
// failed copy.
//
//   node scripts/sign-update-manifest.js --key <private-key.pem> [--manifest <file>]
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseManifest, verifyManifest } = require('../src/core/update-integrity');
const { UPDATE_PUBLIC_KEY } = require('../src/core/update-public-key');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : null;
}

function fingerprintOf(key) {
  const publicKey = key.type === 'public' ? key : crypto.createPublicKey(key);
  return crypto.createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

const keyPath = arg('--key');
const manifestPath = path.resolve(arg('--manifest') || path.join(__dirname, '..', 'dist', 'update-manifest.json'));

if (!keyPath) {
  console.error('Usage: node scripts/sign-update-manifest.js --key <private-key.pem> [--manifest <file>]');
  process.exit(1);
}

try {
  const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath, 'utf8'));
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(`${keyPath} is a ${privateKey.asymmetricKeyType} key; the manifest needs Ed25519.`);
  }
  const bytes = fs.readFileSync(manifestPath);
  // Refuse to sign something the app would reject anyway; a signature over an
  // invalid manifest only makes a broken release look deliberate.
  const manifest = parseManifest(bytes);
  const signature = crypto.sign(null, bytes, privateKey);
  verifyManifest(bytes, signature.toString('base64'), UPDATE_PUBLIC_KEY);
  const signaturePath = `${manifestPath}.sig`;
  fs.writeFileSync(signaturePath, `${signature.toString('base64')}\n`);
  console.log(`signed ${path.basename(manifestPath)} for v${manifest.version} (${manifest.assets.length} assets)`);
  console.log(`signature: ${signaturePath}`);
  console.log(`signing key: ${fingerprintOf(privateKey)}`);
  console.log('The signature was checked against the public key inside the app.');
} catch (error) {
  if (error.reason === 'bad-signature') {
    console.error('The signature this key produces is not one the app trusts.');
    console.error('The release would be refused by every 2.0.5+ install. Check that --key is the update key.');
  } else {
    console.error(`sign-update-manifest failed: ${error.message}`);
  }
  process.exit(1);
}
