'use strict';
// Everything the updater needs to refuse a file it did not sign itself.
//
// The release publishes update-manifest.json (the exact bytes of an installer
// and its hash) and update-manifest.json.sig. The app carries only the public
// key, so a compromised GitHub/Gitee account cannot hand a different binary to
// an existing install: it cannot produce a matching signature.
const crypto = require('crypto');
const fs = require('fs');

const MANIFEST_MAX_BYTES = 64 * 1024;
const SIGNATURE_MAX_BYTES = 4 * 1024;
const SHA256 = /^[0-9a-f]{64}$/i;

class IntegrityError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'IntegrityError';
    this.reason = reason;
  }
}

const fail = (reason, message) => {
  throw new IntegrityError(reason, message);
};

function parseManifest(bytes) {
  let manifest;
  try {
    manifest = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    fail('bad-manifest', 'The update manifest is not valid JSON.');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('bad-manifest', 'The update manifest is not an object.');
  }
  if (manifest.schema !== 1) {
    fail('bad-manifest', `Unsupported update manifest schema: ${manifest.schema}.`);
  }
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    fail('bad-manifest', 'The update manifest has no version.');
  }
  if (!Array.isArray(manifest.assets)) {
    fail('bad-manifest', 'The update manifest has no asset list.');
  }
  const names = new Set();
  const assets = manifest.assets.map((asset) => {
    if (!asset || typeof asset !== 'object') {
      fail('bad-manifest', 'An update manifest asset is not an object.');
    }
    const name = typeof asset.name === 'string' ? asset.name.trim() : '';
    if (!name || name !== asset.name || /[\\/]/.test(name) || name === '.' || name === '..') {
      fail('bad-manifest', `Invalid update asset name: ${JSON.stringify(asset.name)}.`);
    }
    if (names.has(name)) {
      fail('bad-manifest', `The update manifest lists ${name} twice.`);
    }
    names.add(name);
    if (!Number.isSafeInteger(asset.size) || asset.size < 0) {
      fail('bad-manifest', `Invalid size for ${name}.`);
    }
    if (typeof asset.sha256 !== 'string' || !SHA256.test(asset.sha256)) {
      fail('bad-manifest', `Invalid sha256 for ${name}.`);
    }
    return { name, size: asset.size, sha256: asset.sha256.toLowerCase() };
  });
  return {
    schema: 1,
    version: manifest.version.trim(),
    issuedAt: typeof manifest.issuedAt === 'string' ? manifest.issuedAt : null,
    assets
  };
}

// The signature is over the manifest bytes exactly as published, not over a
// re-serialised object: JSON key order must never become a way to change what
// the signature covers.
function verifyManifest(bytes, signatureBase64, publicKeyPem) {
  const signature = Buffer.from(String(signatureBase64 || '').trim(), 'base64');
  if (signature.length !== 64) {
    fail('bad-signature', 'The update manifest signature is missing or the wrong length.');
  }
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(bytes), publicKeyPem, signature);
  } catch {
    fail('bad-signature', 'The update manifest signature could not be checked.');
  }
  if (!valid) fail('bad-signature', 'The update manifest signature does not match.');
  return parseManifest(bytes);
}

function assertVersion(manifest, expected) {
  if (!manifest || manifest.version !== expected) {
    fail('manifest-version', `The manifest is for ${manifest && manifest.version}, not ${expected}.`);
  }
  return manifest;
}

function findAsset(manifest, name) {
  const asset = manifest && Array.isArray(manifest.assets)
    ? manifest.assets.find((entry) => entry.name === name)
    : null;
  if (!asset) fail('asset-not-listed', `${name} is not listed in the update manifest.`);
  return asset;
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function verifyFile(filePath, entry) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) fail('size-mismatch', `${filePath} is not a file.`);
  if (stat.size !== entry.size) {
    fail('size-mismatch', `Expected ${entry.size} bytes, got ${stat.size}.`);
  }
  const actual = await sha256File(filePath);
  if (actual !== entry.sha256) {
    fail('sha256-mismatch', `Expected sha256 ${entry.sha256}, got ${actual}.`);
  }
  return { path: filePath, size: stat.size, sha256: actual };
}

module.exports = {
  IntegrityError,
  MANIFEST_MAX_BYTES,
  SIGNATURE_MAX_BYTES,
  parseManifest,
  verifyManifest,
  assertVersion,
  findAsset,
  sha256File,
  verifyFile
};
