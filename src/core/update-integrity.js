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
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

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

// The manifest says where the bytes live, so the release page no longer has to
// host them: a channel can carry nothing but this file and its signature. The
// cost is that the signed text now steers the app to a host, so the address is
// held to https, and to nothing that resolves inside the person's own machine.
// Host reputation is deliberately not checked here - a pinned list would force
// a new app release for every mirror, and it protects nothing once the key is
// compromised. scripts/release.js is where the allow list belongs.
function downloadUrl(value, name) {
  const label = `The download address for ${name}`;
  if (typeof value !== 'string' || !value.trim()) {
    fail('bad-manifest', `${label} is missing.`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('bad-manifest', `${label} is not an absolute URL: ${value}.`);
  }
  if (url.protocol !== 'https:') {
    fail('bad-manifest', `${label} must be https, got ${url.protocol}.`);
  }
  if (url.username || url.password) {
    fail('bad-manifest', `${label} must not carry credentials.`);
  }
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host.endsWith('.internal') || IPV4.test(host) || host.includes(':')) {
    fail('bad-manifest', `${label} points at a local address: ${host || value}.`);
  }
  return url.href;
}

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
    return { name, url: downloadUrl(asset.url, name), size: asset.size, sha256: asset.sha256.toLowerCase() };
  });
  return {
    schema: 1,
    version: manifest.version.trim(),
    issuedAt: typeof manifest.issuedAt === 'string' ? manifest.issuedAt : null,
    assets
  };
}

// The updater wants to tell the person which host the bytes actually come
// from. The address has already been through downloadUrl above.
function hostOf(url) {
  return new URL(url).hostname;
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

// One-click update runs the installer rather than the portable build when a
// release carries both - the same preference the release page used to express
// through its asset list, now read from the signed text instead.
function pickInstaller(manifest) {
  const exes = (manifest && Array.isArray(manifest.assets) ? manifest.assets : [])
    .filter((asset) => /\.exe$/i.test(asset.name));
  return exes.find((asset) => /setup/i.test(asset.name)) || exes[0] || null;
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
  pickInstaller,
  hostOf,
  sha256File,
  verifyFile
};
