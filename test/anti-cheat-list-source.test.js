'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LIMITS } = require('../src/core/anti-cheat-list');
const { SOURCES, SOURCES_BY_CHANNEL, sourcesFor, fetchList } = require('../src/anti-cheat-list-source');

const body = (text) => ({ ok: true, status: 200, text: async () => text });
const notFound = { ok: false, status: 404, text: async () => 'nope' };

test('the first source that answers with a list wins', async () => {
  const asked = [];
  const answer = await fetchList({
    sources: ['https://a/list.txt', 'https://b/list.txt'],
    fetchImpl: async (url) => { asked.push(url); return body('Escape from Tarkov\n'); }
  });
  assert.equal(answer.ok, true);
  assert.equal(answer.url, 'https://a/list.txt');
  assert.deepEqual(answer.names, ['Escape from Tarkov']);
  assert.deepEqual(asked, ['https://a/list.txt'], 'a good source is enough');
});

test('a source that is down is skipped for the next one', async () => {
  const answer = await fetchList({
    sources: ['https://a/list.txt', 'https://b/list.txt'],
    fetchImpl: async (url) => url.includes('/a/') ? notFound : body('VALORANT\n')
  });
  assert.equal(answer.ok, true);
  assert.equal(answer.url, 'https://b/list.txt');
  assert.deepEqual(answer.names, ['VALORANT']);
});

test('an error page or a JSON error is a failed source, not a short list', async () => {
  for (const junk of ['<!DOCTYPE html><html><body>404</body></html>', '{"error":"nope"}']) {
    const answer = await fetchList({
      sources: ['https://a/list.txt', 'https://b/list.txt'],
      fetchImpl: async (url) => url.includes('/a/') ? body(junk) : body('VALORANT\n')
    });
    assert.equal(answer.url, 'https://b/list.txt', junk.slice(0, 12));
    assert.deepEqual(answer.names, ['VALORANT']);
  }
});

test('a body over the size limit is refused', async () => {
  const answer = await fetchList({
    sources: ['https://a/list.txt'],
    fetchImpl: async () => body('x'.repeat(LIMITS.maxBytes + 1))
  });
  assert.equal(answer.ok, false);
  assert.match(answer.error, /too big/);
});

test('a request that throws is a failed source too', async () => {
  const answer = await fetchList({
    sources: ['https://a/list.txt', 'https://b/list.txt'],
    fetchImpl: async (url) => {
      if (url.includes('/a/')) throw new Error('ETIMEDOUT');
      return body('Escape from Tarkov\n');
    }
  });
  assert.equal(answer.ok, true);
  assert.equal(answer.url, 'https://b/list.txt');
});

test('when every source fails the caller is told why', async () => {
  const answer = await fetchList({
    sources: ['https://a/list.txt', 'https://b/list.txt'],
    fetchImpl: async () => notFound
  });
  assert.equal(answer.ok, false);
  assert.match(answer.error, /HTTP 404.*HTTP 404/s);
  assert.equal(answer.text, undefined);
});

test('the caller decides which sources are tried', async () => {
  const asked = [];
  await fetchList({
    sources: ['https://mine/list.txt'],
    fetchImpl: async (url) => { asked.push(url); return body('VALORANT\n'); }
  });
  assert.deepEqual(asked, ['https://mine/list.txt']);
  assert.ok(SOURCES.every(url => url.startsWith('https://')), 'nothing but https is configured');
  assert.ok(SOURCES.length >= 2, 'a mirror is configured before the first release');
});

test('each channel has its own sources, and GitHub is the fallback', () => {
  assert.deepEqual(sourcesFor('github'), SOURCES_BY_CHANNEL.github);
  assert.deepEqual(sourcesFor('gitee'), SOURCES_BY_CHANNEL.gitee);
  assert.ok(SOURCES_BY_CHANNEL.gitee.length >= 1);
  assert.ok(SOURCES_BY_CHANNEL.gitee.every(url => url.startsWith('https://gitee.com/hezhixin15/DLSS5-Swapper-Chinese/')));
  assert.deepEqual(sourcesFor('nonsense'), SOURCES, 'an unknown channel reads GitHub');
});
