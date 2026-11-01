'use strict';
// Generates the Ed25519 key pair that signs update-manifest.json.
//
// The private key must never enter the repository or CI. Generate it once on an
// offline machine, keep a backup somewhere that is not this disk, and pass its
// path to scripts/release.js when publishing. The public key is committed in
// src/core/update-public-key.js.
//
//   node scripts/update-keygen.js --out <private-key.pem> [--public-out <module.js>] [--force]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : null;
}

const out = arg('--out');
const publicOut = arg('--public-out');
const force = process.argv.includes('--force');

if (!out) {
  console.error('Usage: node scripts/update-keygen.js --out <private-key.pem> [--public-out <module.js>] [--force]');
  process.exit(1);
}

if (fs.existsSync(out) && !force) {
  console.error(`Refusing to overwrite ${out}. Pass --force only if you are rotating the key.`);
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, privatePem, { mode: 0o600 });

if (publicOut) {
  fs.mkdirSync(path.dirname(path.resolve(publicOut)), { recursive: true });
  fs.writeFileSync(publicOut, `'use strict';
// Public half of the offline update-signing key. The private key is never
// committed; see scripts/update-keygen.js for how this pair is produced.
const UPDATE_PUBLIC_KEY = \`${publicPem}\`;

module.exports = { UPDATE_PUBLIC_KEY };
`);
}

const der = publicKey.export({ type: 'spki', format: 'der' });
const fingerprint = crypto.createHash('sha256').update(der).digest('hex');
console.log(`private key: ${path.resolve(out)}  (mode 0600)`);
if (publicOut) console.log(`public key:  ${path.resolve(publicOut)}`);
else console.log(publicPem);
console.log(`fingerprint: ${fingerprint}`);
console.log('');
console.log('Move the private key off this machine (password manager / offline USB) and keep a second backup.');
console.log('Anyone who has it can sign an update that every 2.0.5+ install will trust.');
