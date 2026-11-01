'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { createRequire } = require('module');

// main.js verifies the update manifest against the public key compiled into the
// app. Tests use a key of their own and give main.js only its public half, so
// the production private key never exists anywhere near this repository.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const attacker = crypto.generateKeyPairSync('ed25519');

// The update lookup runs in the main process against the real GitHub endpoint.
// Here the network is a stub, so the test is about what the app concludes.
function load(t, { version = '2.2.1', fetchImpl, abortSignal } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const main = path.resolve(__dirname, '../main.js');
  const realRequire = createRequire(main);
  const handlers = new Map();
  const calls = { count: 0 };
  const opened = [];
  const stubs = {
    electron: {
      app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, quit() {}, getPath: () => root, getVersion: () => version },
      BrowserWindow: { fromWebContents: () => null },
      Menu: { buildFromTemplate: () => ({ popup() {} }) },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      dialog: { showMessageBox: async () => ({ response: 1 }) },
      clipboard: { writeText() {} },
      shell: { openPath: async (file) => { opened.push(file); return ''; } }
    },
    './src/core/scan.js': { scanGame: async () => ({ chosen: null, exeCandidates: [] }), scanSource: () => ({ ok: false }) },
    './src/core/update-public-key.js': { UPDATE_PUBLIC_KEY: publicPem }
  };
  const context = vm.createContext({
    require: name => stubs[name] || realRequire(name),
    __dirname: path.dirname(main), process, Buffer, console, setTimeout, clearTimeout, setImmediate,
    AbortSignal: abortSignal || AbortSignal,
    fetch: async (...args) => { calls.count++; return fetchImpl(...args); }
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
  return { handlers, calls, opened, root };
}

const release = (tag, extra = {}) => ({ ok: true, json: async () => ({ tag_name: tag, ...extra }) });
const notFound = { ok: false, status: 404, json: async () => ({}) };
const download = (text) => ({
  ok: true, headers: { get: () => String(text.length) },
  body: (async function* () { yield Buffer.from(text); })()
});

// A release the way a normal, honest publish looks: installers, a manifest that
// lists them by name, address and hash, and the detached signature made offline.
// `base` is where the release page hosts its files; `host` is the address the
// signed manifest points at, which for a mirror channel is somewhere else.
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const signText = (text) => crypto.sign(null, Buffer.from(text), privateKey).toString('base64');
function served(tag, { files, listed = files, overrides = {}, base = 'https://github.com/example', host = base } = {}) {
  const value = {
    schema: 1,
    version: tag.replace(/^v/, ''),
    issuedAt: '2026-11-01T00:00:00.000Z',
    assets: listed.map(({ name, bytes }) => ({
      name, url: `${host}/${name}`, size: Buffer.byteLength(bytes), sha256: sha256(bytes)
    })),
    ...overrides
  };
  const text = JSON.stringify(value, null, 2);
  const urls = new Map();
  const assets = [];
  const serve = (name, body) => {
    const url = `${base}/${name}`;
    urls.set(url, body);
    assets.push({ name, browser_download_url: url });
  };
  for (const file of files) serve(file.name, file.bytes);
  serve('update-manifest.json', text);
  serve('update-manifest.json.sig', signText(text));
  return { value, text, urls, release: { ok: true, json: async () => ({ tag_name: tag, assets }) } };
}
// Anything not served as an asset is an API lookup for this test's release.
const servedFetch = (source, asked = []) => async (url) => {
  asked.push(url);
  if (source.urls.has(url)) return download(source.urls.get(url));
  return source.release;
};

test('a newer release is reported, an older or equal one is not', async (t) => {
  for (const [tag, newer] of [['v2.2.2', true], ['v2.3.0', true], ['v3.0.0', true],
    ['v2.2.1', false], ['v2.2.0', false], ['v2.10.0', true]]) {
    const { handlers } = load(t, { fetchImpl: async () => release(tag) });
    const answer = await handlers.get('update-check')();
    assert.equal(answer.newer, newer, `${tag} against 2.2.1`);
    assert.equal(answer.current, '2.2.1');
    assert.equal(answer.latest, tag.replace(/^v/, ''));
  }
});

test('the lookup happens once per launch', async (t) => {
  const { handlers, calls } = load(t, { fetchImpl: async () => release('v9.0.0') });
  const first = await handlers.get('update-check')();
  const second = await handlers.get('update-check')();
  assert.equal(first.newer, true);
  assert.deepEqual(second, first);
  assert.equal(calls.count, 1, 'the answer is kept for the session');
});

test('being offline, rate-limited or blocked says nothing at all', async (t) => {
  for (const fetchImpl of [
    async () => { throw new Error('getaddrinfo ENOTFOUND'); },
    async () => ({ ok: false, status: 403 }),
    async () => ({ ok: true, json: async () => ({}) })
  ]) {
    const { handlers } = load(t, { fetchImpl });
    const answer = await handlers.get('update-check')();
    assert.equal(answer.newer, false, 'no notice is shown');
    assert.equal(answer.current, '2.2.1', 'and the running version is still reported');
  }
});

// A lookup that could not run reported {latest: null, newer: false}, which the
// sidebar rendered exactly like "nothing new". Someone on an old build whose
// check never completed was told nothing and had no reason to go and look.
test('a failed lookup is distinguishable from being up to date', () => {
  const failed = { current: '2.2.2', latest: null, newer: false };
  const current = { current: '2.2.3', latest: '2.2.3', newer: false };
  const behind = { current: '2.2.2', latest: '2.2.3', newer: true };

  // Exactly the branch order src/renderer/renderer.js uses.
  const shown = (a) => !a ? 'nothing' : !a.latest ? 'failed' : !a.newer ? 'nothing' : 'update';
  assert.equal(shown(failed), 'failed');
  assert.equal(shown(current), 'nothing');
  assert.equal(shown(behind), 'update');

  const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf8');
  assert.match(renderer, /if \(!answer\.latest\) \{[\s\S]*updateCheckFailed/,
    'the renderer separates the two before it decides there is no news');
});

test('the lookup targets the Chinese enhanced repository with a 10 second timeout', async (t) => {
  let url = null, timeout = 0;
  const { handlers } = load(t, {
    abortSignal: { timeout: (ms) => ({ timeout: ms }) },
    fetchImpl: async (u, opts) => { url = u; timeout = opts?.signal?.timeout ?? 0; return release('v2.2.2'); }
  });
  const answer = await handlers.get('update-check')();
  assert.equal(url, 'https://api.github.com/repos/hezhixin15/DLSS5-Swapper-Chinese/releases/latest',
    'the check asks the Chinese enhanced edition, not the original repository');
  assert.equal(timeout, 10000, 'the check gives up after 10 seconds');
  assert.equal(answer.newer, true);
});

test('a release with an .exe asset offers the one-click update', async (t) => {
  const { handlers } = load(t, {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        tag_name: 'v2.2.2',
        body: 'Fixed everything',
        assets: [
          { name: 'DLSS5-Swapper-Setup.exe', browser_download_url: 'https://github.com/example/Setup.exe' },
          { name: 'blockmap', browser_download_url: 'https://github.com/example/blockmap' }
        ]
      })
    })
  });
  const answer = await handlers.get('update-check')();
  assert.equal(answer.asset.name, 'DLSS5-Swapper-Setup.exe');
  assert.equal(answer.asset.url, 'https://github.com/example/Setup.exe');
  assert.equal(answer.notes, 'Fixed everything');
});

test('a release without an installer still reports the new version', async (t) => {
  const { handlers } = load(t, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: 'v2.2.2', assets: [] }) })
  });
  const answer = await handlers.get('update-check')();
  assert.equal(answer.newer, true);
  assert.equal(answer.asset, null);
});

test('the settings choose which source is asked first, and the answer names it', async (t) => {
  const urls = [];
  const { handlers } = load(t, {
    fetchImpl: async (url) => {
      urls.push(url);
      return url.includes('gitee.com') ? release('2.0.6') : release('v2.0.6');
    }
  });
  assert.equal(handlers.get('set-update-source')(null, 'gitee'), 'gitee');
  const answer = await handlers.get('update-check')();
  assert.equal(answer.source, 'gitee');
  assert.equal(answer.tag, '2.0.6');
  assert.match(urls[0], /^https:\/\/gitee\.com\/api\/v5\/repos\/hezhixin15\/DLSS5-Swapper-Chinese\/releases\/latest$/);
  assert.equal(handlers.get('set-update-source')(null, 'nonsense'), 'github', 'an unknown source falls back to GitHub');
});

test('a blocked source is skipped for the other one', async (t) => {
  const asked = [];
  const { handlers } = load(t, {
    fetchImpl: async (url) => {
      asked.push(url);
      if (url.includes('api.github.com')) throw new Error('getaddrinfo ENOTFOUND');
      return release('2.2.2');
    }
  });
  const answer = await handlers.get('update-check')();
  assert.equal(answer.source, 'gitee', 'the mirror answers when GitHub cannot');
  assert.equal(answer.newer, true);
  assert.equal(asked.length, 2);
});

test('the one-click download uses the installer rather than the portable build', async (t) => {
  const { handlers } = load(t, {
    fetchImpl: async () => release('v2.2.2', { assets: [
      { name: 'DLSS5-Swapper-2.2.2-portable.exe', browser_download_url: 'https://github.com/example/portable.exe' },
      { name: 'DLSS5-Swapper-Setup-2.2.2.exe', browser_download_url: 'https://github.com/example/Setup.exe' }
    ] })
  });
  const answer = await handlers.get('update-check')();
  assert.equal(answer.asset.name, 'DLSS5-Swapper-Setup-2.2.2.exe');
});

test('a download can take the other source at the same version', async (t) => {
  const asked = [];
  const files = [{ name: 'DLSS5-Swapper-Setup-2.2.2.exe', bytes: 'installer-from-gitee' }];
  const github = served('v2.2.2', { files, base: 'https://github.com/example' });
  // The mirror publishes its own copy and its own signed manifest, at the
  // same version: nothing here is borrowed from GitHub.
  const gitee = served('2.2.2', { files, base: 'https://gitee.com/hezhixin15/attach_files/1' });
  const giteeAsset = `https://gitee.com/hezhixin15/attach_files/1/${files[0].name}`;
  const { handlers, opened } = load(t, {
    version: '2.2.1',
    fetchImpl: async (url) => {
      asked.push(url);
      if (github.urls.has(url)) return download(github.urls.get(url));
      if (gitee.urls.has(url)) return download(gitee.urls.get(url));
      if (url.includes('gitee.com/api/v5/repos/hezhixin15/DLSS5-Swapper-Chinese/releases/tags/')) return notFound;
      if (url.includes('gitee.com/api/v5/repos/hezhixin15/DLSS5-Swapper-Chinese/releases/latest')) return gitee.release;
      if (url.includes('api.github.com/repos/hezhixin15/DLSS5-Swapper-Chinese/releases/latest')) return github.release;
      throw new Error(`unexpected URL ${url}`);
    }
  });
  await handlers.get('update-check')();
  const result = await handlers.get('download-update')({ sender: { send() {} } }, 'gitee');
  assert.equal(result.ok, true);
  assert.ok(asked.includes(giteeAsset), 'the Gitee asset was downloaded, not the GitHub one');
  assert.equal(opened.length, 1);
  assert.match(path.basename(opened[0]), /^DLSS5-Swapper-2\.2\.2-\d+\.exe$/);
});

test('a source without an installer for that version says so instead of downloading an older build', async (t) => {
  const { handlers } = load(t, {
    version: '2.2.1',
    fetchImpl: async (url) => {
      if (url.includes('api.github.com')) return release('v2.2.2');
      if (url.includes('/releases/tags/')) return notFound;
      // The mirror still carries the previous version; it must not be used.
      return release('2.2.0', { assets: [{ name: 'DLSS5-Swapper-Setup-2.2.0.exe', browser_download_url: 'https://gitee.com/example/Setup.exe' }] });
    }
  });
  await handlers.get('update-check')();
  const result = await handlers.get('download-update')({ sender: { send() {} } }, 'gitee');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-asset');
  assert.equal(result.source, 'gitee');
  assert.equal(result.sourceName, 'Gitee');
});

// Everything below runs the real manifest verification in main.js. A refusal
// only counts if the installer was neither launched nor left on disk.
const installer = (tag) => `DLSS5-Swapper-Setup-${tag}.exe`;
const urlOf = (source, name) => [...source.urls.keys()].find((url) => url.endsWith(name));

async function downloadWith(t, source, requested = 'github', version = '2.2.1') {
  const loaded = load(t, { version, fetchImpl: servedFetch(source) });
  await loaded.handlers.get('update-check')();
  const result = await loaded.handlers.get('download-update')({ sender: { send() {} } }, requested);
  return { ...loaded, result };
}

test('an installer whose manifest and hash verify is launched', async (t) => {
  const files = [{ name: installer('2.2.2'), bytes: 'installer-bytes' }];
  const { result, opened, root } = await downloadWith(t, served('v2.2.2', { files }));
  assert.equal(result.ok, true);
  assert.equal(opened.length, 1);
  assert.equal(fs.readdirSync(root).filter((name) => name.endsWith('.exe')).length, 1,
    'the verified installer is still there for the running installer to use');
});

// Signing the address is the whole point: a channel that cannot host the
// installer at all can still offer an update, and whoever owns the release page
// cannot move the download by editing their own file list.
test('the signed manifest, not the release page, decides where the bytes come from', async (t) => {
  const setup = installer('2.2.2');
  const bytes = 'installer-bytes';
  const mirror = 'https://pan.example.net/releases';
  const source = served('2.2.2', {
    files: [{ name: setup, bytes }],
    base: 'https://gitee.com/hezhixin15/DLSS5-Swapper-Chinese/releases/download/2.2.2',
    host: mirror
  });
  const pageUrl = urlOf(source, setup);
  // The copy the release page offers has the right name and the wrong bytes.
  source.urls.set(pageUrl, 'trojan-bytes');
  source.urls.set(`${mirror}/${setup}`, bytes);
  const asked = [];
  const loaded = load(t, { version: '2.2.1', fetchImpl: servedFetch(source, asked) });
  await loaded.handlers.get('update-check')();
  const result = await loaded.handlers.get('download-update')({ sender: { send() {} } }, 'gitee');
  assert.equal(result.ok, true, 'the honest copy at the signed address is what ran');
  assert.ok(asked.includes(`${mirror}/${setup}`), 'the signed address was fetched');
  assert.ok(!asked.includes(pageUrl), 'the release page copy was never requested');
  assert.equal(loaded.opened.length, 1);
});

test('a download that breaks off leaves no executable behind', async (t) => {
  const setup = installer('2.2.2');
  const source = served('v2.2.2', { files: [{ name: setup, bytes: 'installer-bytes' }] });
  const { handlers, opened, root } = load(t, {
    version: '2.2.1',
    fetchImpl: async (url) => {
      if (url === urlOf(source, setup)) {
        return {
          ok: true, headers: { get: () => '15' },
          body: (async function* () { yield Buffer.from('install'); throw new Error('connection reset'); })()
        };
      }
      return servedFetch(source)(url);
    }
  });
  await handlers.get('update-check')();
  const result = await handlers.get('download-update')({ sender: { send() {} } }, 'github');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'download');
  assert.deepEqual(opened, []);
  assert.deepEqual(fs.readdirSync(root), [], 'the partial file is removed');
});

// The main process refuses for distinct reasons, and each one means "do not
// retry this source". A missing branch would fall through to the generic
// "update failed" toast, which reads like a network problem.
test('every refusal reason has its own message in the UI', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf8');
  const branch = renderer.slice(renderer.indexOf('async function startUpdateDownload'));
  for (const reason of ['bad-signature', 'bad-manifest', 'manifest-version',
    'asset-not-listed', 'size-mismatch', 'sha256-mismatch']) {
    assert.match(branch, new RegExp(`'${reason}'`), `${reason} must reach the integrity toast`);
  }
  assert.match(branch, /updateIntegrityFailed/);
  // A channel that carries no signed manifest has a configuration gap, not a
  // broken file: "checksum failed" would send people hunting the wrong thing.
  assert.match(branch, /'no-manifest'[\s\S]{0,160}updateNoManifest/,
    'a missing manifest gets its own message');
  const i18n = fs.readFileSync(path.join(__dirname, '../src/renderer/i18n.js'), 'utf8');
  assert.equal((i18n.match(/\n\s+updateIntegrityFailed:/g) || []).length, 2,
    'English and Chinese both define updateIntegrityFailed');
  assert.equal((i18n.match(/\n\s+updateNoManifest:/g) || []).length, 2,
    'English and Chinese both define updateNoManifest');
});

test('an update the signed manifest does not vouch for never reaches the installer', async (t) => {
  const setup = installer('2.2.2');
  const bytes = 'installer-bytes';
  const honest = () => served('v2.2.2', { files: [{ name: setup, bytes }] });
  const cases = [
    ['no-manifest', () => ({
      urls: new Map(),
      release: release('v2.2.2', { assets: [{ name: setup, browser_download_url: 'https://github.com/example/setup.exe' }] })
    })],
    // A stolen release account can swap the signature, but not produce one the
    // app trusts.
    ['bad-signature', () => {
      const source = honest();
      source.urls.set(urlOf(source, 'update-manifest.json.sig'),
        crypto.sign(null, Buffer.from(source.text), attacker.privateKey).toString('base64'));
      return source;
    }],
    // The app's own key signed this, but the bytes are not a manifest.
    ['bad-manifest', () => {
      const source = honest();
      source.urls.set(urlOf(source, 'update-manifest.json'), 'not json');
      source.urls.set(urlOf(source, 'update-manifest.json.sig'), signText('not json'));
      return source;
    }],
    // A correctly signed manifest for a different version: the mirror cannot
    // satisfy a newer release by pointing at an older one.
    ['manifest-version', () => served('v2.2.2', { files: [{ name: setup, bytes }], overrides: { version: '2.2.1' } })],
    // The release offers an installer the manifest has never heard of.
    ['asset-not-listed', () => served('v2.2.2', {
      files: [{ name: setup, bytes }, { name: 'DLSS5-Swapper-2.2.2-portable.exe', bytes: 'portable' }],
      listed: [{ name: 'DLSS5-Swapper-2.2.2-portable.exe', bytes: 'portable' }]
    })],
    ['size-mismatch', () => {
      const source = honest();
      source.urls.set(urlOf(source, setup), 'short');
      return source;
    }],
    // Same length, one byte different: only the hash can tell.
    ['sha256-mismatch', () => {
      const source = honest();
      source.urls.set(urlOf(source, setup), 'installer-bytez');
      return source;
    }]
  ];
  for (const [reason, make] of cases) {
    const { result, opened, root } = await downloadWith(t, make());
    assert.equal(result.ok, false, reason);
    assert.equal(result.reason, reason);
    assert.deepEqual(opened, [], `${reason} must not launch the installer`);
    assert.deepEqual(fs.readdirSync(root), [], `${reason} must not leave the file on disk`);
  }
});

