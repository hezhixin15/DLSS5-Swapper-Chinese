'use strict';
// The list is one small text file fetched from wherever the maintainer put
// it. Sources are tried in order, and anything that does not parse as a list
// counts as a failed source rather than a shorter list: an error page must
// never replace what the app already knows.
const { LIMITS, parse } = require('./core/anti-cheat-list');

const SOURCES_BY_CHANNEL = Object.freeze({
  github: [
    // The file is edited in this app's own repository, so the raw copy is the
    // canonical one...
    'https://raw.githubusercontent.com/hezhixin15/DLSS5-Swapper-Chinese/main/anti-cheat-list.txt',
    // ...and jsDelivr serves the same file to anyone raw.githubusercontent is
    // slow or unreachable for.
    'https://cdn.jsdelivr.net/gh/hezhixin15/DLSS5-Swapper-Chinese@main/anti-cheat-list.txt'
  ],
  // The mirror for people who cannot reach GitHub reliably.
  gitee: [
    'https://gitee.com/hezhixin15/DLSS5-Swapper-Chinese/raw/main/anti-cheat-list.txt'
  ]
});
const SOURCES = SOURCES_BY_CHANNEL.github;
const sourcesFor = (channel) => SOURCES_BY_CHANNEL[channel] || SOURCES;
const TIMEOUT_MS = 10_000;

async function fetchList({ sources = SOURCES, fetchImpl = global.fetch, timeoutMs = TIMEOUT_MS, signal } = {}) {
  const failures = [];
  for (const url of sources) {
    let text;
    try {
      const response = await fetchImpl(url, {
        headers: { accept: 'text/plain' },
        signal: signal || AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) { failures.push(`${url}: HTTP ${response.status}`); continue; }
      text = await response.text();
    } catch (error) {
      failures.push(`${url}: ${error.message}`); continue;
    }
    if (Buffer.byteLength(text, 'utf8') > LIMITS.maxBytes) { failures.push(`${url}: too big`); continue; }
    const parsed = parse(text);
    if (!parsed.ok) { failures.push(`${url}: ${parsed.error}`); continue; }
    return { ok: true, url, text, names: parsed.names };
  }
  return { ok: false, error: failures.join('; ') };
}

module.exports = { SOURCES, SOURCES_BY_CHANNEL, sourcesFor, TIMEOUT_MS, fetchList };
