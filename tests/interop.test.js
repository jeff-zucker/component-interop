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
  const ctx = loadCI({ dataset: { ...(extra.dataset || {}) }, ...extra });
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

// ── registerCapability / manifest.attributes merge ─────────────────────────────
test('registerCapability maps a data-* to its module(s) and de-dupes', requireJsdom(), async () => {
  const { api } = await bareCI();
  api.registerCapability('data-view', ['m1', 'm2']);
  api.registerCapability('data-view', ['m2', 'm3']);
  assert.deepEqual(plain(api.manifest.attributes['data-view']), ['m1', 'm2', 'm3']);
});

// ── importmap ────────────────────────────────────────────────────────────────────
test('importmap: manifest imports are injected as <script type=importmap> with resolved URLs', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    libA: { name: 'libA', components: { 'lib-a': 'lib-a.js' } },
  });
  const ctx = loadCI({ dataset: { manifest }, fetchMap });
  await ctx.api.ready;

  const tag = ctx.document.querySelector('script[type="importmap"]');
  assert.ok(tag, 'an importmap was injected');
  const map = JSON.parse(tag.textContent);
  assert.equal(map.imports['lib-a'], 'http://localhost/lib-a.js', 'resolved against the manifest URL');
  assert.deepEqual(plain(ctx.api.importmap), map.imports);
});

test('importmap: data-importmap-extra is merged but a manifest import wins a conflict', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    libA: { name: 'libA', components: { shared: 'shared.js' } },
  });
  const importmapExtra = JSON.stringify({ imports: { extra: 'http://x/extra.js', shared: 'http://x/loses.js' } });
  const ctx = loadCI({ dataset: { manifest, importmapExtra }, fetchMap });
  await ctx.api.ready;

  assert.equal(ctx.api.importmap.extra, 'http://x/extra.js', 'consumer extra kept');
  assert.equal(ctx.api.importmap.shared, 'http://localhost/shared.js', 'manifest import wins the conflict');
});

test('importmap: if the page already owns an importmap, the broker does not inject one', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    libA: { name: 'libA', components: { 'lib-a': 'lib-a.js' } },
  });
  const ctx = loadCI({
    dataset: { manifest },
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
    first:  { name: 'first',  components: { shared: 'from-first.js' },  attributes: { 'data-view': 'v1.js' } },
    second: { name: 'second', components: { shared: 'from-second.js' }, attributes: { 'data-view': 'v2.js' } },
  });
  const ctx = loadCI({ dataset: { manifest }, fetchMap });
  await ctx.api.ready;

  assert.equal(ctx.api.importmap.shared, 'http://localhost/from-first.js', 'first manifest wins the specifier');
  assert.deepEqual(plain(ctx.api.manifest.attributes['data-view']), ['v1.js', 'v2.js'],
    'attribute modules from both manifests merge');
});

test('manifests: JSON-LD form — @-keys ignored; wrapped attributes/bundles merge like bare ones', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    lib: {
      '@context': 'https://jeff-zucker.github.io/component-interop/context.jsonld',
      '@id': '',
      '@type': 'Manifest',
      name: 'lib',
      attributes: { 'data-view': { module: 'v1.js' } },
      bundles: { rdf: { modules: ['m1', 'm2'] } },
    },
  });
  const ctx = loadCI({ dataset: { manifest, components: 'rdf' }, fetchMap });
  await ctx.api.ready;

  assert.deepEqual(plain(ctx.api.manifest.attributes['data-view']), ['v1.js'],
    'wrapped { module } unwraps to the bare form');
  assert.deepEqual(ctx.importedSpecs, ['m1', 'm2'],
    'wrapped { modules } bundle expands like a bare list');
});

// ── the broker: provide -> consume wiring over an event channel ───────────────────
test('broker: a consumer is wired to another library\'s provider and invoked with the value', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    provider: { name: 'provider', objects: { provides: { greeting: { respondTo: 'ev:greet', sendValue: 'detail.text' } } } },
    consumer: { name: 'consumer', objects: { consumes: { greeting: { call: 'setGreeting' } } } },
  });
  const ctx = loadCI({ dataset: { manifest, objects: 'greeting' }, fetchMap });
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
    provider: { name: 'provider', objects: { provides: { greeting: { respondTo: 'ev:greet', sendValue: 'detail.text' } } } },
    consumer: { name: 'consumer', objects: { consumes: { greeting: { call: 'setGreeting' } } } },
  });
  const ctx = loadCI({ dataset: { manifest, objects: 'greeting' }, fetchMap });
  await ctx.api.ready;

  let calls = 0;
  ctx.api.registerConsumer('setGreeting', () => { calls++; });
  ctx.api.emit('ev:greet', {}); // detail.text is undefined
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 0);
});

// ── opt-in gate: nothing cross-wires unless the page lists the key in data-objects ──
test('opt-in gate: a consumes channel does NOT wire without the data-objects opt-in', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    provider: { name: 'provider', objects: { provides: { greeting: { respondTo: 'ev:greet', sendValue: 'detail.text' } } } },
    consumer: { name: 'consumer', objects: { consumes: { greeting: { call: 'setGreeting' } } } },
  });
  const ctx = loadCI({ dataset: { manifest }, fetchMap });   // both manifests loaded, but no data-objects
  await ctx.api.ready;

  let calls = 0;
  ctx.api.registerConsumer('setGreeting', () => { calls++; });
  ctx.api.emit('ev:greet', { text: 'hello' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 0, 'the provider fired but the unlisted capability was never wired');
});

test('opt-in gate: an accepts channel does NOT fire without the data-objects opt-in', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    emitter: { name: 'emitter', objects: { provides: { resource: { respondTo: 'res:change', sendValue: 'detail.uri' } } } },
    raw:     { name: 'raw',     objects: { accepts:  { resource: { onElement: '#raw', applyValueTo: 'resource' } } } },
  });
  const ctx = loadCI({
    dataset: { manifest }, fetchMap,   // 'resource' not opted in
    domSetup: (doc) => { doc.body.innerHTML = '<div id="raw"></div>'; },
  });
  await ctx.api.ready;
  ctx.api.emit('res:change', { uri: 'http://pod/a' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(ctx.document.querySelector('#raw').getAttribute('resource'), null,
    'no opt-in → the accept target is left untouched');
});

// ── data-objects: eager-load a consumed object's module, before data-components ───
test('data-objects loads a consumed object\'s `module`, before data-components', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    consumer: {
      name: 'consumer',
      components: { 'x-widget': 'widget.js' },
      objects: { consumes: { store: { call: 'useStore', module: 'store-core.js' } } },
    },
  });
  const ctx = loadCI({ dataset: { manifest, objects: 'store', components: 'x-widget' }, fetchMap });
  await ctx.api.ready;

  assert.deepEqual(ctx.importedSpecs, ['store-core.js', 'x-widget'],
    'the object module loads first, then the components');
  assert.ok(ctx.api.has('store'), 'the object key is marked as a live capability');
});

test('data-objects with a declared but module-less key loads nothing and does NOT warn (wire-only)', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    consumer: { name: 'consumer', objects: { consumes: { store: { call: 'useStore' } } } },
  });
  const ctx = loadCI({ dataset: { manifest, objects: 'store' }, fetchMap });
  await ctx.api.ready;

  assert.deepEqual(ctx.importedSpecs, [], 'nothing imported when the key declares no module');
  assert.ok(!ctx.logs.warn.some((w) => w.includes('data-objects "store"')),
    'a declared key (e.g. an accepts/handler channel) is a legitimate wire-only opt-in, not a warning');
});

test('data-objects with an UNKNOWN key (declared by no manifest) warns', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    consumer: { name: 'consumer', objects: { consumes: { store: { call: 'useStore' } } } },
  });
  const ctx = loadCI({ dataset: { manifest, objects: 'bogus' }, fetchMap });
  await ctx.api.ready;

  assert.deepEqual(ctx.importedSpecs, [], 'nothing imported for an unknown key');
  assert.ok(ctx.logs.warn.some((w) => w.includes('data-objects "bogus"') && w.includes('unknown')),
    'warns that the opted-in key matches no declaration (likely a typo)');
});

// ── inline host: a data-objects token may be `key:provider` (opt in AND prefer) ───
test('inline host: "thing:libA" opts in AND prefers libA over a higher-priority libB', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    ...providerPair({ aPriority: 1, bPriority: 5 }),   // priority alone → libB
    consumer: { name: 'consumer', objects: { consumes: { thing: { call: 'take' } } } },
  });
  const ctx = loadCI({ dataset: { manifest, objects: 'thing:libA' }, fetchMap });
  await ctx.api.ready;
  const { from, got } = await wireAndDetect(ctx, 'ev:a');
  assert.equal(from, 'libA', 'the inline host beat the higher-priority provider');
  assert.deepEqual(got, ['X']);
});

test('inline host: an explicit data-prefer wins over the data-objects inline host', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    ...providerPair({ aPriority: 0, bPriority: 0 }),
    consumer: { name: 'consumer', objects: { consumes: { thing: { call: 'take' } } } },
  });
  const ctx = loadCI({
    dataset: { manifest, objects: 'thing:libA', prefer: JSON.stringify({ thing: 'libB' }) },
    fetchMap,
  });
  await ctx.api.ready;
  const { from } = await wireAndDetect(ctx, 'ev:b');
  assert.equal(from, 'libB', 'data-prefer libB beat the inline host libA');
});

test('inline host: the key still eager-loads its module (host stripped for loading)', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    consumer: {
      name: 'consumer',
      components: { 'x-widget': 'widget.js' },
      objects: { consumes: { store: { call: 'useStore', module: 'store-core.js' } } },
    },
  });
  const ctx = loadCI({ dataset: { manifest, objects: 'store:libA', components: 'x-widget' }, fetchMap });
  await ctx.api.ready;
  assert.deepEqual(ctx.importedSpecs, ['store-core.js', 'x-widget'], 'store:libA still loads the store module');
  assert.ok(ctx.api.has('store'), 'capability marked on the stripped key');
});

test('inline host: an unknown key warns on the stripped key (host dropped from the message)', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    consumer: { name: 'consumer', objects: { consumes: { store: { call: 'useStore' } } } },
  });
  const ctx = loadCI({ dataset: { manifest, objects: 'bogus:libX' }, fetchMap });
  await ctx.api.ready;
  assert.ok(ctx.logs.warn.some((w) => w.includes('data-objects "bogus"') && w.includes('unknown')),
    'warns about the stripped key, not "bogus:libX"');
});

// ── pickProvider: choosing among several providers of the same capability ─────────
// Each provider uses a DISTINCT event so we can detect which one the broker wired.
function providerPair(extra = {}) {
  return {
    libA: { name: 'libA', objects: { provides: { thing: { respondTo: 'ev:a', sendValue: 'detail.v', priority: extra.aPriority ?? 0 } } } },
    libB: { name: 'libB', objects: { provides: { thing: { respondTo: 'ev:b', sendValue: 'detail.v', priority: extra.bPriority ?? 0 } } } },
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
    consumer: { name: 'consumer', objects: { consumes: { thing: { call: 'take' } } } },
  });
  const ctx = loadCI({ dataset: { manifest, objects: 'thing' }, fetchMap });
  await ctx.api.ready;
  const { got, from } = await wireAndDetect(ctx, 'ev:b'); // libB has the higher priority
  assert.equal(from, 'libB');
  assert.deepEqual(got, ['X']);
});

test('pickProvider: the lower-priority (non-chosen) provider is NOT wired', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    ...providerPair({ aPriority: 1, bPriority: 5 }),
    consumer: { name: 'consumer', objects: { consumes: { thing: { call: 'take' } } } },
  });
  const ctx = loadCI({ dataset: { manifest, objects: 'thing' }, fetchMap });
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
    consumer: { name: 'consumer', objects: { consumes: { thing: { call: 'take', from: 'libB' } } } },
  });
  const ctx = loadCI({ dataset: { manifest, objects: 'thing' }, fetchMap });
  await ctx.api.ready;
  const { from } = await wireAndDetect(ctx, 'ev:b');
  assert.equal(from, 'libB', 'explicit "from" beats libA\'s higher priority');
});

test('pickProvider: data-prefer overrides everything', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    ...providerPair({ aPriority: 1, bPriority: 5 }),
    consumer: { name: 'consumer', objects: { consumes: { thing: { call: 'take', from: 'libB' } } } },
  });
  const ctx = loadCI({
    dataset: { manifest, objects: 'thing', prefer: JSON.stringify({ thing: 'libA' }) },
    fetchMap,
  });
  await ctx.api.ready;
  const { from } = await wireAndDetect(ctx, 'ev:a');
  assert.equal(from, 'libA', 'data-prefer beats both "from" and priority');
});

test('pickProvider: equal priority falls back to manifest order (earliest wins)', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    ...providerPair({ aPriority: 0, bPriority: 0 }),
    consumer: { name: 'consumer', objects: { consumes: { thing: { call: 'take' } } } },
  });
  const ctx = loadCI({ dataset: { manifest, objects: 'thing' }, fetchMap });
  await ctx.api.ready;
  const { from } = await wireAndDetect(ctx, 'ev:a'); // libA declared first
  assert.equal(from, 'libA');
});

test('broker: a library never consumes its OWN provide', requireJsdom(), async () => {
  // One library both provides and consumes the same cap — there is no OTHER
  // provider, so nothing wires.
  const { fetchMap, manifest } = manifests({
    solo: { name: 'solo', objects: {
      provides: { thing: { respondTo: 'ev:a', sendValue: 'detail.v' } },
      consumes: { thing: { call: 'take' } },
    } },
  });
  const ctx = loadCI({ dataset: { manifest, objects: 'thing' }, fetchMap });
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
    emitter:  { name: 'emitter',  objects: {
      provides: { resource: { respondTo: 'res:change', sendValue: 'detail.uri' } },
      accepts:  { resource: { onElement: '#self', applyValueTo: 'resource' } },           // only provider is itself → skipped
    } },
    follower: { name: 'follower', objects: {
      accepts: { resource: { onElement: '#target', applyValueTo: 'resource', transform: 'stripHash' } },
    } },
  });
  const ctx = loadCI({
    dataset: { manifest, objects: 'resource' },
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

// ── load() + auto-load + bundles ──────────────────────────────────────────────────
test('auto-load: an attribute named in data-attributes AND present imports its module(s) and marks it', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    lib: { name: 'lib', attributes: { 'data-handler': '@x/handler' } },
  });
  const ctx = loadCI({
    dataset: { manifest, attributes: 'data-handler' },
    fetchMap,
    domSetup: (doc) => { doc.body.innerHTML = '<button data-handler="x">go</button>'; },
  });
  const capEvent = onceEvent(ctx.window, 'interop:capability');
  await ctx.api.ready;
  await new Promise((r) => setTimeout(r, 10));   // let the DOM-ready auto-load run
  const e = await capEvent;

  assert.equal(e.detail.name, 'data-handler');
  assert.deepEqual(ctx.importedSpecs, ['@x/handler'], 'the attribute module auto-loaded');
  assert.deepEqual(plain(ctx.api.capabilities), ['data-handler']);
  assert.ok(ctx.api.loaded.includes('@x/handler'));
});

test('auto-load: an attribute named in data-attributes but NOT present loads nothing', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    lib: { name: 'lib', attributes: { 'data-handler': '@x/handler' } },
  });
  const ctx = loadCI({ dataset: { manifest, attributes: 'data-handler' }, fetchMap });   // named, but no [data-handler] on page
  await ctx.api.ready;
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(ctx.importedSpecs, [], 'nothing imported when the named attribute is absent');
});

test('opt-in gate: an attribute present but NOT named in data-attributes loads nothing', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    lib: { name: 'lib', attributes: { 'data-handler': '@x/handler' } },
  });
  const ctx = loadCI({
    dataset: { manifest },   // data-handler is used below but never opted in
    fetchMap,
    domSetup: (doc) => { doc.body.innerHTML = '<button data-handler="x">go</button>'; },
  });
  await ctx.api.ready;
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(ctx.importedSpecs, [], 'present on the page but not named in data-attributes → not loaded');
});

test('load: data-components are imported in order', requireJsdom(), async () => {
  const ctx = loadCI({ dataset: { components: 'compA compB' } });
  await ctx.api.ready;
  assert.deepEqual(ctx.importedSpecs, ['compA', 'compB'], 'in listed order');
});

test('load: a data-components token that names a bundle expands to its modules', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    lib: { name: 'lib', bundles: { 'rdf': ['m1', 'm2'] } },
  });
  const ctx = loadCI({ dataset: { manifest, components: 'rdf compX' }, fetchMap });
  await ctx.api.ready;
  assert.deepEqual(ctx.importedSpecs, ['m1', 'm2', 'compX'], 'bundle name expands; non-bundle passes through');
});

test('load: data-components="*" imports every component (not shared-modules)', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    lib: { name: 'lib', components: { 'el-a': 'a.js', 'el-b': 'b.js' }, 'shared-modules': { 'dep': 'dep.js' } },
  });
  const ctx = loadCI({ dataset: { manifest, components: '*' }, fetchMap });
  await ctx.api.ready;
  assert.deepEqual(ctx.importedSpecs.slice().sort(), ['el-a', 'el-b'], 'all components, no shared-modules');
});

// ── lifecycle ──────────────────────────────────────────────────────────────────────
test('lifecycle: interop:ready fires and api.ready resolves with the api', requireJsdom(), async () => {
  const ctx = loadCI({ dataset: {} });
  const readyEvent = onceEvent(ctx.window, 'interop:ready');
  const resolved = await ctx.api.ready;
  const e = await readyEvent;
  assert.equal(resolved, ctx.api, 'api.ready resolves with the ComponentInterop object');
  assert.ok(Array.isArray(e.detail.loaded), 'interop:ready carries the loaded list');
});

test('lifecycle: a bad data-prefer JSON is ignored with a warning, not a throw', requireJsdom(), async () => {
  const ctx = loadCI({ dataset: { prefer: '{not json' } });
  await ctx.api.ready;
  assert.ok(ctx.logs.warn.some((m) => m.includes('data-prefer')), 'warned about invalid data-prefer');
});

test('lifecycle: a non-OK manifest fetch is reported and skipped, load still completes', requireJsdom(), async () => {
  // data-manifest points at a URL that is not in the fetchMap -> 404.
  const ctx = loadCI({ dataset: { manifest: 'missing.manifest.json' }, fetchMap: {} });
  await ctx.api.ready; // resolves despite the failed manifest
  assert.ok(ctx.logs.error.some((m) => m.includes('missing.manifest.json')), 'the failed manifest was reported');
});

test('broker: a provider can deliver its value over a SERVICE channel', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    provider: { name: 'provider', objects: { provides: { store: { service: 'rdf', sendValue: 'value' } } } },
    consumer: { name: 'consumer', objects: { consumes: { store: { call: 'useStore' } } } },
  });
  const ctx = loadCI({ dataset: { manifest, objects: 'store' }, fetchMap });
  await ctx.api.ready;

  const got = [];
  ctx.api.registerConsumer('useStore', (v) => got.push(v));
  ctx.api.services.register('rdf', { value: 'THE-STORE' }); // resolves the provider's whenReady
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(got, ['THE-STORE'], 'the consumer received the value read from the service');
});

test('broker: a provided value with no registered consumer warns', requireJsdom(), async () => {
  const { fetchMap, manifest } = manifests({
    provider: { name: 'provider', objects: { provides: { greeting: { respondTo: 'ev:greet', sendValue: 'detail.text' } } } },
    consumer: { name: 'consumer', objects: { consumes: { greeting: { call: 'missingConsumer' } } } },
  });
  const ctx = loadCI({ dataset: { manifest, objects: 'greeting' }, fetchMap });
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
    emitter: { name: 'emitter', objects: { provides: { resource: { respondTo: 'res:change', sendValue: 'detail.uri' } } } },
    raw:     { name: 'raw',     objects: { accepts:  { resource: { onElement: '#raw', applyValueTo: 'resource' } } } },
  });
  const ctx = loadCI({
    dataset: { manifest, objects: 'resource' }, fetchMap,
    domSetup: (doc) => { doc.body.innerHTML = '<div id="raw"></div>'; },
  });
  await ctx.api.ready;
  ctx.api.emit('res:change', { uri: 'http://pod/a#frag' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(ctx.document.querySelector('#raw').getAttribute('resource'), 'http://pod/a#frag', 'no transform → hash preserved');
});

test('a cross-origin data-manifest is accepted (CORS permitting)', requireJsdom(), async () => {
  const ctx = loadCI({
    dataset: { manifest: 'http://other.example/m.manifest.json', stage: 'local' },
    fetchMap: { 'http://other.example/m.manifest.json': { name: 'remote', stages: { local: { components: { 'x-el': './x.js' } } } } },
  });
  await ctx.api.ready;
  assert.ok(!ctx.logs.error.some((m) => m.includes('same-origin')), 'no same-origin rejection');
  assert.ok(ctx.api.importmap && ctx.api.importmap['x-el'], 'the cross-origin manifest contributed to the importmap');
  assert.equal(ctx.api.importmap['x-el'], 'http://other.example/x.js', 'its relative URL resolved against the manifest origin');
});
