'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const art = require('../src/steamart');

// steamart talks to the live Steam endpoints. Here the network is a stub, so
// the test is about which URL the app ends up trusting.
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });

function stubNetwork(t, { search = null, details = null } = {}) {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('storesearch')) return search ? ok(search) : fail(500);
    if (target.includes('appdetails')) return details ? ok(details) : fail(429);
    return fail(404);
  };
}

// The real URL WARDOGS' store page serves: a per-asset content hash sits
// between the app id and the filename, so no path built by hand can reach it.
const WARDOGS_HEADER = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1867240/59d4daf753bd5d982e6675f7eee363bc817c574e/header.jpg?t=1789503126';

test('details survive a reply keyed by an app id other than the one asked for', async (t) => {
  stubNetwork(t, {
    search: { items: [{ id: 1867240, name: 'WARDOGS', type: 'app' }] },
    // Steam answers for WARDOGS under 4840670 while reporting steam_appid
    // 1867240, so indexing the reply by the requested id loses all of it.
    details: {
      4840670: {
        success: true,
        data: {
          name: 'WARDOGS',
          short_description: 'TACTICAL ALL OUT WARFARE FPS',
          release_date: { date: '10 Sep, 2026' },
          metacritic: { score: 81 },
          genres: [{ description: 'Action' }, { description: 'Indie' }, { description: 'MMO' }, { description: 'Dropped' }],
          header_image: WARDOGS_HEADER
        }
      }
    }
  });

  const hit = await art.look('WARDOGS');
  assert.equal(hit.appid, 1867240);
  assert.equal(hit.name, 'WARDOGS');
  assert.equal(hit.summary, 'TACTICAL ALL OUT WARFARE FPS');
  assert.equal(hit.released, 2026);
  assert.equal(hit.rating, 81);
  assert.deepEqual(hit.genres, ['Action', 'Indie', 'MMO']);
});

test('the store header is used ahead of the hand-built path that newer apps 404 on', async (t) => {
  stubNetwork(t, {
    search: { items: [{ id: 1867240, name: 'WARDOGS', type: 'app' }] },
    details: { 1867240: { success: true, data: { name: 'WARDOGS', header_image: WARDOGS_HEADER } } }
  });

  const hit = await art.look('WARDOGS');
  assert.equal(hit.heroFallbackUrl, WARDOGS_HEADER);
  // The two shapes WARDOGS does not ship stay as built: they simply 404 and
  // the fallback above is what the card ends up drawing.
  assert.ok(hit.coverUrl.endsWith('/1867240/library_600x900.jpg'));
  assert.ok(hit.heroUrl.endsWith('/1867240/library_hero.jpg'));
});

test('a failed details lookup still leaves every art URL intact', async (t) => {
  // The details endpoint is rate limited and fails on its own; the art is the
  // point of the module, so losing it there would be the wrong trade.
  stubNetwork(t, { search: { items: [{ id: 1245620, name: 'ELDEN RING', type: 'app' }] } });

  const hit = await art.look('ELDEN RING');
  assert.equal(hit.summary, null);
  assert.equal(hit.released, null);
  assert.ok(hit.coverUrl.endsWith('/1245620/library_600x900.jpg'));
  assert.ok(hit.heroUrl.endsWith('/1245620/library_hero.jpg'));
  assert.ok(hit.heroFallbackUrl.endsWith('/1245620/header.jpg'));
});