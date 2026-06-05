// tests/interop.test.js — the broker/loader (component-interop.js) public surface.
//
// Each test loads the IIFE into a fresh jsdom realm via loadCI() and drives it
// through its public API + DOM events: the host-services registry, the consumer
// registry, capability/importmap handling, manifest merging (first-wins), the
// provide/consume broker incl. pickProvider, the resource channel, load(), and
// the lifecycle events.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCI, manifests, onceEvent, requireJsdom, plain } from './helpers.js';

// Convenience: a loaded, fully-ready broker with no manifests.
async function bareCI(extra = {}) {
  const ctx = loadCI({ dataset: { manifestDefault: 'off', ...(extra.dataset || {}) }, ...extra });
  await ctx.api.ready;
  return ctx;
}

// ── host-services registry ──────────────────────────────────────────────────────
test('services: register / get / has / names', requireJsdom(), async () => {
  const { api } = await bareCI();
  const store = { id: 'store' };
  assert.equal(api.services.has('rdf'), false);
  api.services.register('rdf', store);
  assert.equal(api.services.has('rdf'), true);
  assert.equal(api.services.get('rdf'), store);
  assert.deepEqual(plain(api.services.names()), ['rdf']);
});

test('services.whenReady resolves for an already-registered service', requireJsdom(), async () => {
  const { api } = await bareCI();
  const impl = {};
  api.services.register('session', impl);
  assert.equal(await api.services.whenReady('session'), impl);
});

test('services.whenReady resolves later when the service is registered', requireJsdom(), async () => {
  const { api } = await bareCI();
  const impl = { fetch: () => {} };
  const p = api.services.whenReady('fetch');
  let resolved = false;
  p.then(() => { resolved = true; });
  assert.equal(resolved, false, 'pending until registered');
  api.services.register('fetch', impl);
  assert.equal(await p, impl);
});

test('api.has(name) is true once a service is registered', requireJsdom(), async () => {
  const { api } = await bareCI();
  assert.equal(api.has('rdf'), false);
  api.services.register('rdf', {});
  assert.equal(api.has('rdf'), true);
});

// ── consumer registry ────────────────────────────────────────────────────────────
test('registerConsumer stores the fn, ignores non-functions, and is chainable', requireJsdom(), async () => {
  const { api } = await bareCI();
  const fn = () => {};
  assert.equal(api.registerConsumer('setStore', fn), api, 'returns api for chaining');
  assert.equal(api.consumers.setStore, fn);
  api.registerConsumer('bad', 'not-a-fn');
  assert.equal('bad' in api.consumers, false, 'non-function ignored');
});

// ── registerCapability / manifest.capabilities merge ─────────────────────────────
test('registerCapability merges modules + attributes and de-dupes', requireJsdom(), async () => {
  const { api } = await bareCI();
  api.registerCapability('view', { modules: ['m1', 'm2'], attributes: ['data-view'] });
  api.registerCapability('view', { modules: ['m2', 'm3'], attributes: ['data-view', 'data-mode'] });
  assert.deepEqual(plain(api.manifest.capabilities.view), {
    modules: ['m1', 'm2', 'm3'],
    attributes: ['data-view', 'data-mode'],
  });
});

// ── importmap ────────────────────────────────────────────────────────────────────
test('importmap: manifest imports are injected as <script type=importmap> with resolved URLs', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    libA: { name: 'libA', imports: { 'lib-a': 'lib-a.js' } },
  });
  const ctx = loadCI({ dataset: { manifestDefault: 'off', manifest }, fetchMap });
  await ctx.api.ready;

  const tag = ctx.document.querySelector('script[type="importmap"]');
  assert.ok(tag, 'an importmap was injected');
  const map = JSON.parse(tag.textContent);
  assert.equal(map.imports['lib-a'], 'http://localhost/lib-a.js', 'resolved against the manifest URL');
  assert.deepEqual(plain(ctx.api.importmap), map.imports);
});

test('importmap: data-importmap-extra is merged but a manifest import wins a conflict', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    libA: { name: 'libA', imports: { shared: 'shared.js' } },
  });
  const importmapExtra = JSON.stringify({ imports: { extra: 'http://x/extra.js', shared: 'http://x/loses.js' } });
  const ctx = loadCI({ dataset: { manifestDefault: 'off', manifest, importmapExtra }, fetchMap });
  await ctx.api.ready;

  assert.equal(ctx.api.importmap.extra, 'http://x/extra.js', 'consumer extra kept');
  assert.equal(ctx.api.importmap.shared, 'http://localhost/shared.js', 'manifest import wins the conflict');
});

test('importmap: if the page already owns an importmap, the broker does not inject one', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    libA: { name: 'libA', imports: { 'lib-a': 'lib-a.js' } },
  });
  const ctx = loadCI({
    dataset: { manifestDefault: 'off', manifest },
    fetchMap,
    domSetup: (doc) => {
      const el = doc.createElement('script');
      el.type = 'importmap';
      el.textContent = JSON.stringify({ imports: { 'lib-a': 'http://page/owns.js' } });
      doc.head.appendChild(el);
    },
  });
  await ctx.api.ready;

  const maps = ctx.document.querySelectorAll('script[type="importmap"]');
  assert.equal(maps.length, 1, 'the page-owned importmap is left untouched (no second one)');
  assert.equal(ctx.api.importmap, undefined, 'broker did not claim ownership');
  assert.equal(JSON.parse(maps[0].textContent).imports['lib-a'], 'http://page/owns.js');
});

// ── manifest merging (first-wins) ─────────────────────────────────────────────────
test('manifests: the earlier manifest wins a conflicting specifier; capabilities union', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    first:  { name: 'first',  imports: { shared: 'from-first.js' },  capabilities: { view: { modules: ['v1'], attributes: ['data-view'] } } },
    second: { name: 'second', imports: { shared: 'from-second.js' }, capabilities: { view: { modules: ['v2'], attributes: ['data-mode'] } } },
  });
  const ctx = loadCI({ dataset: { manifestDefault: 'off', manifest }, fetchMap });
  await ctx.api.ready;

  assert.equal(ctx.api.importmap.shared, 'http://localhost/from-first.js', 'first manifest wins the specifier');
  assert.deepEqual(plain(ctx.api.manifest.capabilities.view), {
    modules: ['v1', 'v2'],
    attributes: ['data-view', 'data-mode'],
  }, 'capability defs from both manifests are unioned');
});

// ── the broker: provide -> consume wiring over an event channel ───────────────────
test('broker: a consumer is wired to another library\'s provider and invoked with the value', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    provider: { name: 'provider', interop: { provides: { greeting: { event: 'ev:greet', path: 'detail.text' } } } },
    consumer: { name: 'consumer', interop: { consumes: { greeting: { call: 'setGreeting' } } } },
  });
  const ctx = loadCI({ dataset: { manifestDefault: 'off', manifest }, fetchMap });
  await ctx.api.ready;

  const got = [];
  ctx.api.registerConsumer('setGreeting', (v) => got.push(v));
  const wired = onceEvent(ctx.window, 'interop:wired');
  ctx.api.emit('ev:greet', { text: 'hello' });

  const e = await wired;
  assert.deepEqual(got, ['hello'], 'the registered consumer received the provided value');
  assert.deepEqual(
    { capability: e.detail.capability, from: e.detail.from, to: e.detail.to },
    { capability: 'greeting', from: 'provider', to: 'consumer' },
  );
});

test('broker: a null/undefined provided value does not invoke the consumer', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    provider: { name: 'provider', interop: { provides: { greeting: { event: 'ev:greet', path: 'detail.text' } } } },
    consumer: { name: 'consumer', interop: { consumes: { greeting: { call: 'setGreeting' } } } },
  });
  const ctx = loadCI({ dataset: { manifestDefault: 'off', manifest }, fetchMap });
  await ctx.api.ready;

  let calls = 0;
  ctx.api.registerConsumer('setGreeting', () => { calls++; });
  ctx.api.emit('ev:greet', {}); // detail.text is undefined
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 0);
});

// ── pickProvider: choosing among several providers of the same capability ─────────
// Each provider uses a DISTINCT event so we can detect which one the broker wired.
function providerPair(extra = {}) {
  return {
    libA: { name: 'libA', interop: { provides: { thing: { event: 'ev:a', path: 'detail.v', priority: extra.aPriority ?? 0 } } } },
    libB: { name: 'libB', interop: { provides: { thing: { event: 'ev:b', path: 'detail.v', priority: extra.bPriority ?? 0 } } } },
  };
}

async function wireAndDetect(ctx, fromEvent) {
  const got = [];
  ctx.api.registerConsumer('take', (v) => got.push(v));
  const wired = onceEvent(ctx.window, 'interop:wired', 500).catch(() => null);
  ctx.api.emit(fromEvent, { v: 'X' });
  const e = await wired;
  return { got, from: e && e.detail.from };
}

test('pickProvider: highest priority wins when there is no preference', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    ...providerPair({ aPriority: 1, bPriority: 5 }),
    consumer: { name: 'consumer', interop: { consumes: { thing: { call: 'take' } } } },
  });
  const ctx = loadCI({ dataset: { manifestDefault: 'off', manifest }, fetchMap });
  await ctx.api.ready;
  const { got, from } = await wireAndDetect(ctx, 'ev:b'); // libB has the higher priority
  assert.equal(from, 'libB');
  assert.deepEqual(got, ['X']);
});

test('pickProvider: the lower-priority (non-chosen) provider is NOT wired', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    ...providerPair({ aPriority: 1, bPriority: 5 }),
    consumer: { name: 'consumer', interop: { consumes: { thing: { call: 'take' } } } },
  });
  const ctx = loadCI({ dataset: { manifestDefault: 'off', manifest }, fetchMap });
  await ctx.api.ready;
  let calls = 0;
  ctx.api.registerConsumer('take', () => { calls++; });
  ctx.api.emit('ev:a', { v: 'X' }); // libA was not chosen — its channel is not listened to
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 0);
});

test('pickProvider: consumer "from" overrides priority', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    ...providerPair({ aPriority: 5, bPriority: 1 }),
    consumer: { name: 'consumer', interop: { consumes: { thing: { call: 'take', from: 'libB' } } } },
  });
  const ctx = loadCI({ dataset: { manifestDefault: 'off', manifest }, fetchMap });
  await ctx.api.ready;
  const { from } = await wireAndDetect(ctx, 'ev:b');
  assert.equal(from, 'libB', 'explicit "from" beats libA\'s higher priority');
});

test('pickProvider: data-prefer overrides everything', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    ...providerPair({ aPriority: 1, bPriority: 5 }),
    consumer: { name: 'consumer', interop: { consumes: { thing: { call: 'take', from: 'libB' } } } },
  });
  const ctx = loadCI({
    dataset: { manifestDefault: 'off', manifest, prefer: JSON.stringify({ thing: 'libA' }) },
    fetchMap,
  });
  await ctx.api.ready;
  const { from } = await wireAndDetect(ctx, 'ev:a');
  assert.equal(from, 'libA', 'data-prefer beats both "from" and priority');
});

test('pickProvider: equal priority falls back to manifest order (earliest wins)', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    ...providerPair({ aPriority: 0, bPriority: 0 }),
    consumer: { name: 'consumer', interop: { consumes: { thing: { call: 'take' } } } },
  });
  const ctx = loadCI({ dataset: { manifestDefault: 'off', manifest }, fetchMap });
  await ctx.api.ready;
  const { from } = await wireAndDetect(ctx, 'ev:a'); // libA declared first
  assert.equal(from, 'libA');
});

test('broker: a library never consumes its OWN provide', requireJsdom(), async () => {
  // One library both provides and consumes the same cap — there is no OTHER
  // provider, so nothing wires.
  const { fetchMap, manifest } = manifests({
    solo: { name: 'solo', interop: {
      provides: { thing: { event: 'ev:a', path: 'detail.v' } },
      consumes: { thing: { call: 'take' } },
    } },
  });
  const ctx = loadCI({ dataset: { manifestDefault: 'off', manifest }, fetchMap });
  await ctx.api.ready;
  let calls = 0;
  ctx.api.registerConsumer('take', () => { calls++; });
  ctx.api.emit('ev:a', { v: 'X' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 0, 'self-provision is not brokered');
});

// ── accepts: a provided value written onto a DOM attribute (the "resource" key) ──────
test('accepts: a provided value is written onto another lib\'s accept target, not the provider\'s own', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    emitter:  { name: 'emitter',  interop: {
      provides: { resource: { event: 'res:change', path: 'detail.uri' } },
      accepts:  { resource: { selector: '#self', attr: 'resource' } },           // only provider is itself → skipped
    } },
    follower: { name: 'follower', interop: {
      accepts: { resource: { selector: '#target', attr: 'resource', transform: 'stripHash' } },
    } },
  });
  const ctx = loadCI({
    dataset: { manifestDefault: 'off', manifest },
    fetchMap,
    domSetup: (doc) => {
      doc.body.innerHTML = '<div id="target"></div><div id="self"></div>';
    },
  });
  await ctx.api.ready;

  ctx.api.emit('res:change', { uri: 'http://pod/x/y#frag' });
  await new Promise((r) => setTimeout(r, 5));

  assert.equal(ctx.document.querySelector('#target').getAttribute('resource'), 'http://pod/x/y', 'follower updated, hash stripped');
  assert.equal(ctx.document.querySelector('#self').getAttribute('resource'), null, 'the provider\'s own accept target is not updated (no OTHER provider)');
});

// ── load() + data-extend-with ─────────────────────────────────────────────────────
test('load: data-extend-with imports a capability\'s modules and marks it loaded', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    lib: { name: 'lib', capabilities: { handler: { modules: ['@x/handler'], attributes: ['data-handler'] } } },
  });
  const ctx = loadCI({ dataset: { manifestDefault: 'off', manifest, extendWith: 'handler' }, fetchMap });

  const capEvent = onceEvent(ctx.window, 'interop:capability');
  await ctx.api.ready;
  const e = await capEvent;

  assert.equal(e.detail.name, 'handler');
  assert.deepEqual(ctx.importedSpecs, ['@x/handler'], 'the capability module was import()ed');
  assert.deepEqual(plain(ctx.api.capabilities), ['handler'], 'capability surfaced as loaded');
  assert.ok(ctx.api.loaded.includes('@x/handler'));
  assert.equal(ctx.api.has('handler'), true);
});

test('load: data-bundles modules are imported in order before capabilities', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    lib: { name: 'lib', capabilities: { handler: { modules: ['@x/handler'] } } },
  });
  const ctx = loadCI({ dataset: { manifestDefault: 'off', manifest, bundles: 'bundleA bundleB', extendWith: 'handler' }, fetchMap });
  await ctx.api.ready;
  assert.deepEqual(ctx.importedSpecs, ['bundleA', 'bundleB', '@x/handler'], 'bundles first, in order, then capability modules');
});

test('load: an unknown capability warns and imports nothing', requireJsdom(), async () => {
  const ctx = loadCI({ dataset: { manifestDefault: 'off', extendWith: 'nope' } });
  await ctx.api.ready;
  assert.deepEqual(ctx.importedSpecs, []);
  assert.ok(ctx.logs.warn.some((m) => m.includes('unknown capability') && m.includes('nope')), 'warned about the unknown capability');
});

// ── lifecycle ──────────────────────────────────────────────────────────────────────
test('lifecycle: interop:ready fires and api.ready resolves with the api', requireJsdom(), async () => {
  const ctx = loadCI({ dataset: { manifestDefault: 'off' } });
  const readyEvent = onceEvent(ctx.window, 'interop:ready');
  const resolved = await ctx.api.ready;
  const e = await readyEvent;
  assert.equal(resolved, ctx.api, 'api.ready resolves with the ComponentInterop object');
  assert.ok(Array.isArray(e.detail.loaded), 'interop:ready carries the loaded list');
});

test('lifecycle: a bad data-prefer JSON is ignored with a warning, not a throw', requireJsdom(), async () => {
  const ctx = loadCI({ dataset: { manifestDefault: 'off', prefer: '{not json' } });
  await ctx.api.ready;
  assert.ok(ctx.logs.warn.some((m) => m.includes('data-prefer')), 'warned about invalid data-prefer');
});

test('lifecycle: a non-OK manifest fetch is reported and skipped, load still completes', requireJsdom(), async () => {
  // data-manifest points at a URL that is not in the fetchMap -> 404.
  const ctx = loadCI({ dataset: { manifestDefault: 'off', manifest: 'missing.manifest.json' }, fetchMap: {} });
  await ctx.api.ready; // resolves despite the failed manifest
  assert.ok(ctx.logs.error.some((m) => m.includes('missing.manifest.json')), 'the failed manifest was reported');
});

test('manifests: the default sibling <basename>.manifest.json is auto-loaded (trusted)', requireJsdom(), async () => {
  // No manifestDefault:'off' here — the loader fetches its own sibling manifest,
  // derived from its script src.
  const ctx = loadCI({
    src: 'http://localhost/component-interop.js',
    fetchMap: {
      'http://localhost/component-interop.manifest.json': {
        name: 'component-interop',
        imports: { '@ci/handler': 'handler.js' },
        capabilities: { handler: { modules: ['@ci/handler'], attributes: ['data-handler'] } },
      },
    },
  });
  await ctx.api.ready;
  assert.equal(ctx.api.importmap['@ci/handler'], 'http://localhost/handler.js', 'sibling manifest imports resolved');
  assert.ok(ctx.api.manifest.capabilities.handler, 'sibling manifest capability merged');
});

test('broker: a provider can deliver its value over a SERVICE channel', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    provider: { name: 'provider', interop: { provides: { store: { service: 'rdf', path: 'value' } } } },
    consumer: { name: 'consumer', interop: { consumes: { store: { call: 'useStore' } } } },
  });
  const ctx = loadCI({ dataset: { manifestDefault: 'off', manifest }, fetchMap });
  await ctx.api.ready;

  const got = [];
  ctx.api.registerConsumer('useStore', (v) => got.push(v));
  ctx.api.services.register('rdf', { value: 'THE-STORE' }); // resolves the provider's whenReady
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(got, ['THE-STORE'], 'the consumer received the value read from the service');
});

test('broker: a provided value with no registered consumer warns', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    provider: { name: 'provider', interop: { provides: { greeting: { event: 'ev:greet', path: 'detail.text' } } } },
    consumer: { name: 'consumer', interop: { consumes: { greeting: { call: 'missingConsumer' } } } },
  });
  const ctx = loadCI({ dataset: { manifestDefault: 'off', manifest }, fetchMap });
  await ctx.api.ready;
  ctx.api.emit('ev:greet', { text: 'hi' }); // 'missingConsumer' was never registered
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(
    ctx.logs.warn.some((m) => m.includes('no consumer registered') && m.includes('missingConsumer')),
    'warned that the consumer handler is missing',
  );
});

test('accepts: with no transform the raw provided value is written (hash kept)', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    emitter: { name: 'emitter', interop: { provides: { resource: { event: 'res:change', path: 'detail.uri' } } } },
    raw:     { name: 'raw',     interop: { accepts:  { resource: { selector: '#raw', attr: 'resource' } } } },
  });
  const ctx = loadCI({
    dataset: { manifestDefault: 'off', manifest }, fetchMap,
    domSetup: (doc) => { doc.body.innerHTML = '<div id="raw"></div>'; },
  });
  await ctx.api.ready;
  ctx.api.emit('res:change', { uri: 'http://pod/a#frag' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(ctx.document.querySelector('#raw').getAttribute('resource'), 'http://pod/a#frag', 'no transform → hash preserved');
});

test('dev aid: warns when a capability\'s data-* attribute is on the page but the capability is not loaded', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    lib: { name: 'lib', capabilities: { handler: { modules: ['@x/h'], attributes: ['data-handler'] } } },
  });
  const ctx = loadCI({
    dataset: { manifestDefault: 'off', manifest },        // note: NOT extend-with'd
    fetchMap,
    domSetup: (doc) => { doc.body.innerHTML = '<button data-handler="x">go</button>'; },
  });
  await ctx.api.ready;
  await new Promise((r) => setTimeout(r, 5)); // let whenDomReady -> warnUnusedCapabilityAttrs run
  assert.ok(
    ctx.logs.warn.some((m) => m.includes('data-handler') && m.includes('not loaded')),
    'warned about the unused capability attribute',
  );
});

test('security: a cross-origin data-manifest is refused', requireJsdom(), async () => {
  const ctx = loadCI({
    dataset: { manifestDefault: 'off', manifest: 'http://evil.example/m.manifest.json' },
    fetchMap: { 'http://evil.example/m.manifest.json': { name: 'evil', imports: { x: 'x.js' } } },
  });
  await ctx.api.ready;
  assert.ok(ctx.logs.error.some((m) => m.includes('same-origin')), 'cross-origin manifest rejected');
  assert.equal(ctx.api.importmap, undefined, 'nothing from the cross-origin manifest was applied');
});
