/**
 * component-interop.js — a manifest-driven capability broker for web components.
 *
 * It knows nothing about any particular component library: everything it does is
 * driven by one or more MANIFESTS. Independently-authored web-component libraries
 * never import each other — they declare what they PROVIDE and CONSUME in a
 * manifest, and this broker pairs providers to consumers and loads their modules.
 *
 *   <script src="component-interop.js"
 *           data-stage="local"
 *           data-components="my-widgets"
 *           data-manifest="other-lib.manifest.json"></script>
 *
 * On load it (1) reads the `data-manifest` URLs; (2) injects an
 * importmap built from the manifests' `components` (stage chosen by `data-stage`);
 * (3) `import()`s the `data-components` modules (or all, with `data-components="*"`);
 * (4) brokers the libraries' `objects` blocks; (5) at DOM-ready, auto-loads any
 * `attributes` entry whose `data-*` is present; then fires `interop:ready`.
 *
 * A manifest's OFFERINGS (read these to use the library): `components` (elements to
 * place), `attributes` (data-* you can use, auto-loaded when present), `objects`
 * (values shared with other libraries). Its PLUMBING: `shared-modules` (deps it
 * externalizes by name, so peers dedupe — the dep-sharing contract) and `bundles`
 * (logical, NOT physical, module groups an attribute can point at).
 *   { "name": "…",                                            // library identity (required for sharing)
 *     "components":     { "my-el": url, … },                  // placeable elements → URL (data-components / "*")
 *     "shared-modules": { "rdflib": url, … },                 // externalized deps → URL (importmap, deduped)
 *     "bundles":        { "rdf": ["solid-ui", "sol-form", …] },// a name → module specifiers (logical group)
 *     "stages": { "local": {"components":{…},"shared-modules":{…}}, "cdn": {…} },
 *     "attributes": { "data-x": "./mod.js",                   // a data-* → module specifier(s) or a bundle name
 *                     "data-a data-b": "rdf" },               // (space-separated keys share modules)
 *     "objects": {
 *       "provides": { key: { service|respondTo: "…", sendValue: "…", priority?: n } }, // offer a value (service or event; respondTo may be a list)
 *       "consumes": { key: { call: "<registered-consumer>", from?: "<lib>", module?: "<spec>" } }, // adopt it by calling a handler (module: code to eager-load for data-objects)
 *       "accepts":  { key: { onElement: "…", applyValueTo: "…", transform?: "stripHash" } } } } // adopt it by setting a DOM attribute
 * Relative import URLs resolve against THAT manifest's URL. The earlier manifest
 * wins a conflicting specifier (so a shared dep stays single). The broker pairs a
 * `consumes` OR `accepts` key with ANOTHER library's `provides` key of the same
 * name (the adopt rule) — so a page mixing libraries needs no bridge script.
 *
 * A `consumes.call` names a handler the consuming library registered via
 * `ComponentInterop.registerConsumer(name, fn)` — the broker invokes the
 * registered function, never an arbitrary string. So the broker stays ignorant
 * of any library's actual API.
 *
 * data-* attributes: data-components (specifiers, or `*` for all), data-objects
 * (object-capability keys to consume — eager-loads each key's `module` before
 * data-components, so a consumer is registered before any provider fires),
 * data-stage (`local`|`cdn`|`auto` — auto picks local on localhost/file:, cdn
 * elsewhere), data-manifest (SAME-ORIGIN URLs to merge), data-importmap-extra
 * (inline importmap JSON), data-base (resolve data-manifest paths), data-prefer
 * (JSON map key→preferred provider library, for multi-library pages).
 *
 * API on window.ComponentInterop: ready (Promise), load(components), manifest,
 * loaded, version, registerCapability("data-x", modules),
 * registerConsumer(name,fn); the host-services registry .services
 * (register/get/has/names/whenReady) so libraries share resources without
 * importing each other; .has(name) / .capabilities; .on(name,fn) / .emit(name,detail).
 * Fires `interop:ready`, `interop:capability` (per capability), `interop:wired`
 * (per provide→consume binding). Zero dependencies.
 */
(function () {
  'use strict';

  var self = document.currentScript;
  var ds = (self && self.dataset) || {};
  var loaderSrc = (self && self.src) || '';
  // data-manifest URLs resolve against the PAGE by default (the loader is usually
  // in node_modules / a CDN, the page's manifests sit with the page). `data-base`
  // overrides.
  var base = ds.base || (typeof document !== 'undefined' && document.baseURI) || loaderSrc.replace(/[^/]*$/, '') || './';

  // data-stage="auto" → `local` on localhost/127.0.0.1/::1/file:, else `cdn`. Lets one
  // page work from a dev server (local sources) and a CDN-hosted deploy with no edits.
  function resolveStage(s) {
    s = (s || 'local').trim();
    if (s !== 'auto') return s;
    var h = (typeof location !== 'undefined' && location.hostname) || '';
    var dev = h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' ||
      (typeof location !== 'undefined' && location.protocol === 'file:');
    return dev ? 'local' : 'cdn';
  }
  var STAGE = resolveStage(ds.stage);

  // Page-level provider preference for multi-library pages: data-prefer is a JSON
  // map of capability → preferred provider library name (highest-priority tiebreak).
  var PREFER = {};
  try { PREFER = JSON.parse(ds.prefer || '{}') || {}; }
  catch (e) { console.warn('[component-interop] data-prefer is not valid JSON — ignored'); }

  var MANIFEST = { components: {}, attributes: {}, bundles: {} };   // grows as manifests merge in

  var api = window.ComponentInterop = window.ComponentInterop || {};
  api.manifest = MANIFEST;
  api.loaded = api.loaded || [];
  api._caps = api._caps || {};        // capability names whose modules finished loading
  api.version = api.version || '1';   // surface version (feature detection)
  var resolveReady;
  api.ready = new Promise(function (r) { resolveReady = r; });

  // ── host-services surface ──────────────────────────────────────────────────
  // A tiny registry libraries register their shared services into. Created here,
  // import-free, so the surface exists from the first parser-blocking moment — a
  // component can `await ComponentInterop.services.whenReady('rdf')` before
  // anything loads. Duck-typed, so an import-side accessor can adopt it.
  function makeRegistry() {
    var map = {}, waiters = {};
    return {
      register: function (name, impl) {
        map[name] = impl;
        var ws = waiters[name];
        if (ws) { delete waiters[name]; ws.forEach(function (fn) { fn(impl); }); }
      },
      get:   function (name) { return map[name]; },
      has:   function (name) { return Object.prototype.hasOwnProperty.call(map, name); },
      names: function () { return Object.keys(map); },
      whenReady: function (name) {
        if (Object.prototype.hasOwnProperty.call(map, name)) return Promise.resolve(map[name]);
        return new Promise(function (res) { (waiters[name] = waiters[name] || []).push(res); });
      }
    };
  }
  api.services = api.services || makeRegistry();

  function define(name, getter) {
    if (!(name in api)) { try { Object.defineProperty(api, name, { get: getter, configurable: true }); } catch (e) {} }
  }
  define('capabilities', function () { return Object.keys(api._caps); });
  api.has = api.has || function (name) { return !!api._caps[name] || api.services.has(name); };
  api.on  = api.on  || function (name, fn) {
    document.addEventListener(name, fn);
    return function () { document.removeEventListener(name, fn); };
  };
  api.emit = api.emit || function (name, detail) {
    var e = new CustomEvent(name, { bubbles: true, composed: true, detail: detail });
    document.dispatchEvent(e);
    return e;
  };

  // Consumer handlers a library registers so the broker can adopt a foreign
  // value without knowing the library's API. A `consumes.call` names one of these.
  api.consumers = api.consumers || {};
  api.registerConsumer = api.registerConsumer || function (name, fn) {
    if (name && typeof fn === 'function') api.consumers[name] = fn;
    return api;
  };

  // ── helpers ──────────────────────────────────────────────────────────────
  function toList(v) {
    return (Array.isArray(v) ? v.slice() : String(v || '').trim().split(/\s+/)).filter(Boolean);
  }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function assign(t, s) { if (s) for (var k in s) if (own(s, k)) t[k] = s[k]; return t; }
  function resolveUrl(v, baseUrl) { try { return new URL(v, baseUrl).href; } catch (e) { return v; } }

  // ── importmap ──────────────────────────────────────────────────────────────
  var imports = {};   // accumulated importmap entries (resolved absolute), first-wins

  function extraImports() {
    var raw = (ds.importmapExtra || '').trim();
    if (!raw) return {};
    try { var o = JSON.parse(raw); return (o && o.imports) ? o.imports : (o || {}); }
    catch (e) { console.warn('[component-interop] data-importmap-extra is not valid JSON — ignored', e); return {}; }
  }

  function ensureImportmap() {
    if (api._mapInjected) return;
    api._mapInjected = true;
    if (document.querySelector('script[type="importmap"]')) return; // page owns it
    var out = {};
    assign(out, extraImports());   // consumer extras first…
    assign(out, imports);          // …manifest imports win on conflict (coherence)
    if (!Object.keys(out).length) return;
    var el = document.createElement('script');
    el.type = 'importmap';
    el.textContent = JSON.stringify({ imports: out });
    (document.head || document.documentElement).appendChild(el);
    api.importmap = out;
  }
  api.ensureImportmap = ensureImportmap;

  // ── manifests ────────────────────────────────────────────────────────────
  // A module specifier is resolved against THIS manifest's URL when relative
  // (`./`, `../`, `/`, or a full URL); a bare specifier (e.g. "solid-logic") or a
  // bundle name passes through (the importmap / bundles resolve it at load time).
  function resolveSpec(spec, url) {
    return /^(\.{0,2}\/|https?:)/.test(spec) ? resolveUrl(spec, url) : spec;
  }
  function addSpecs(into, value, url) {
    (Array.isArray(value) ? value : [value]).forEach(function (s) {
      if (!s) return;
      var r = resolveSpec(s, url);
      if (into.indexOf(r) === -1) into.push(r);
    });
    return into;
  }
  // `attributes`: a data-* (or space-separated set) → module specifier(s)/bundle name.
  function mergeAttributes(key, value, url) {
    MANIFEST.attributes[key] = addSpecs((MANIFEST.attributes[key] || []), value, url);
  }
  api.registerCapability = function (key, value) { mergeAttributes(key, value, ''); return api; };
  // `bundles`: a logical name → a list of module specifiers (not a physical file).
  function mergeBundle(name, value, url) {
    MANIFEST.bundles[name] = addSpecs((MANIFEST.bundles[name] || []), value, url);
  }
  // `components` (placeable) + `shared-modules` (deps) → the importmap (first-wins).
  // Only `components` keys count for data-components="*".
  function mergeUrlMap(map, url, areComponents) {
    if (!map) return;
    for (var s in map) if (own(map, s) && !own(imports, s)) {
      imports[s] = resolveUrl(map[s], url);
      if (areComponents) MANIFEST.components[s] = imports[s];
    }
  }

  function mergeManifest(m, url) {
    if (!m) return;
    var staged = (m.stages && m.stages[STAGE]) || {};
    mergeUrlMap(m.components, url, true);
    mergeUrlMap(staged.components, url, true);
    mergeUrlMap(m['shared-modules'], url, false);
    mergeUrlMap(staged['shared-modules'], url, false);
    var bundles = m.bundles || {};
    for (var b in bundles) if (own(bundles, b)) mergeBundle(b, bundles[b], url);
    var attrs = m.attributes || {};
    for (var a in attrs) if (own(attrs, a)) mergeAttributes(a, attrs[a], url);
    // objects: per-library shared-value declarations (keyed by library name).
    if (m.objects && m.name) {
      interopSources.push({ name: m.name, interop: m.objects });
      // An object declaration may name the `module` that registers its code
      // (e.g. a `consumes.call` handler). `data-objects="key"` eager-loads it.
      ['provides', 'consumes', 'accepts'].forEach(function (g) {
        var blk = m.objects[g]; if (!blk) return;
        for (var key in blk) if (own(blk, key) && blk[key] && blk[key].module)
          objectModules[key] = addSpecs((objectModules[key] || []), blk[key].module, url);
      });
    }
  }

  // The manifests to merge: the SAME-ORIGIN data-manifest URLs — each names the
  // modules the loader will import().
  function manifestEntries() {
    return toList(ds.manifest);
  }

  function loadManifests() {
    var urls = manifestEntries();
    if (!urls.length) return Promise.resolve();
    return Promise.all(urls.map(function (u) {
      var abs;
      try { abs = new URL(u, base).href; }
      catch (x) { console.warn('[component-interop] bad manifest URL: ' + u); return null; }
      if (abs.indexOf(location.origin + '/') !== 0 && abs !== location.origin) {
        var o; try { o = new URL(abs); } catch (x) { o = null; }
        if (!o || o.origin !== location.origin) {
          console.error('[component-interop] data-manifest must be same-origin — ignored: ' + u);
          return null;
        }
      }
      return fetch(abs)
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (m) { return { m: m, url: abs }; })
        .catch(function (err) { console.error('[component-interop] manifest ' + u + ': ' + err.message); return null; });
    })).then(function (results) {
      results.forEach(function (r) { if (r && r.m) mergeManifest(r.m, r.url); });   // in order → first wins
    });
  }

  // ── the broker: glueless provide/consume matchmaking ───────────────────────
  var interopSources = [];   // [{ name, interop }] collected from manifests
  api.interop = interopSources;
  var objectModules = {};    // object key → module specifier(s) (for data-objects)

  function getByPath(obj, path) {
    if (!path) return obj;
    return String(path).split('.').reduce(function (o, k) { return (o == null) ? undefined : o[k]; }, obj);
  }
  function applyTransform(v, t) {
    if (t === 'stripHash') return String(v).split('#')[0];
    return v;
  }
  // Invoke a library-registered consumer handler — never an arbitrary string.
  function invokeConsumer(call, value) {
    if (value == null) return;
    var fn = api.consumers[call];
    if (fn) { try { fn(value); } catch (e) { console.error('[component-interop] consumer "' + call + '" failed', e); } }
    else console.warn('[component-interop] no consumer registered for "' + call + '" (the library must call ComponentInterop.registerConsumer)');
  }
  // A provider sources its value from an event (`respondTo`, one or many) or a
  // registered service (`service`); `sendValue` dot-walks to the value.
  function onProvide(p, onValue) {
    if (p.respondTo) {
      [].concat(p.respondTo).forEach(function (ev) {
        api.on(ev, function (e) { var v = getByPath(e, p.sendValue); if (v != null) onValue(v); });
      });
    } else if (p.service) {
      api.services.whenReady(p.service).then(function (impl) { onValue(getByPath(impl, p.sendValue)); });
    }
  }

  // Choose ONE provider when several libraries provide the same capability:
  //   1. page preference  (data-prefer[cap] === a library's name)
  //   2. consumer's `from` (consumes[cap].from === a library's name)
  //   3. highest provider `priority` (default 0)
  //   4. earliest in manifest order  (candidates are already in that order)
  function pickProvider(candidates, cap, consumer) {
    if (!candidates.length) return null;
    var want = PREFER[cap];
    if (want) { for (var i = 0; i < candidates.length; i++) if (candidates[i].name === want) return candidates[i]; }
    var from = consumer && consumer.from;
    if (from) { for (var j = 0; j < candidates.length; j++) if (candidates[j].name === from) return candidates[j]; }
    var best = candidates[0], bestP = (best.prov.priority || 0);
    for (var k = 1; k < candidates.length; k++) {
      var p = (candidates[k].prov.priority || 0);
      if (p > bestP) { best = candidates[k]; bestP = p; }
    }
    return best;
  }

  function installInterop() {
    if (api._interopWired) return;
    api._interopWired = true;
    var libs = interopSources.filter(function (s) { return s && s.interop; });
    if (!libs.length) return;

    // Providers of `cap` declared by some OTHER library (manifest order preserved).
    function providersOf(cap, exceptName) {
      var out = [];
      for (var i = 0; i < libs.length; i++) {
        var prov = libs[i].interop.provides && libs[i].interop.provides[cap];
        if (prov && libs[i].name !== exceptName) out.push({ name: libs[i].name, prov: prov });
      }
      return out;
    }

    // Each library adopts a value another library `provides` either by handing it
    // to a registered handler (`consumes` → call) or by writing it onto a DOM
    // attribute (`accepts` → onElement.setAttribute(applyValueTo, …)). Matched by key.
    libs.forEach(function (cLib) {
      var consumes = cLib.interop.consumes || {};
      Object.keys(consumes).forEach(function (cap) {
        var consumer = consumes[cap];
        var chosen = pickProvider(providersOf(cap, cLib.name), cap, consumer);
        if (!chosen) return;
        onProvide(chosen.prov, function (value) {
          invokeConsumer(consumer.call, value);
          api.emit('interop:wired', { capability: cap, from: chosen.name, to: cLib.name });
        });
      });

      var accepts = cLib.interop.accepts || {};
      Object.keys(accepts).forEach(function (cap) {
        var a = accepts[cap];
        var chosen = pickProvider(providersOf(cap, cLib.name), cap, a);
        if (!chosen) return;
        onProvide(chosen.prov, function (value) {
          var el = document.querySelector(a.onElement);
          if (!el) return;
          el.setAttribute(a.applyValueTo, applyTransform(value, a.transform));
          api.emit('interop:wired', { capability: cap, from: chosen.name, to: cLib.name });
        });
      });
    });
  }
  api.installInterop = installInterop;

  // ── loading ────────────────────────────────────────────────────────────────
  function importModule(spec) {
    return import(spec).then(
      function () { if (api.loaded.indexOf(spec) === -1) api.loaded.push(spec); },
      function (e) { console.error('[component-interop] failed to import', spec, e); }
    );
  }
  function importSeq(mods) {
    return mods.reduce(function (p, spec) { return p.then(function () { return importModule(spec); }); }, Promise.resolve());
  }
  function markCapability(name) {
    if (api._caps[name]) return;
    api._caps[name] = true;
    api.emit('interop:capability', { name: name });
  }

  // Expand a token to its modules: a bundle name → the bundle's modules; else itself.
  function expandModules(token) {
    return (MANIFEST.bundles[token] || [token]).slice();
  }
  function expandAll(tokens) {
    var out = [];
    tokens.forEach(function (t) {
      expandModules(t).forEach(function (m) { if (out.indexOf(m) === -1) out.push(m); });
    });
    return out;
  }
  // Import the listed components/bundles; `*` = every placeable `components` entry.
  function load(components) {
    ensureImportmap();
    var list = toList(components);
    if (list.indexOf('*') !== -1) list = Object.keys(MANIFEST.components);
    return importSeq(expandAll(list));
  }
  api.load = load;

  // Eager-load the code behind `data-objects` keys. An object capability's
  // handler (e.g. a `consumes.call` like `rdf.useStore`) must be REGISTERED
  // before a provider fires its value — so these load before `data-components`.
  function loadObjects(keys) {
    ensureImportmap();
    var list = toList(keys);
    if (!list.length) return Promise.resolve();
    var specs = [];
    list.forEach(function (k) {
      if (objectModules[k]) addSpecs(specs, objectModules[k], '');
      else console.warn('[component-interop] data-objects "' + k + '": no `module` declared in any manifest objects block');
    });
    return importSeq(expandAll(specs)).then(function () {
      list.forEach(function (k) { if (objectModules[k]) markCapability(k); });
    });
  }
  api.loadObjects = loadObjects;

  function announce() {
    resolveReady(api);
    var detail = { loaded: api.loaded };
    document.dispatchEvent(new CustomEvent('interop:ready', { detail: detail }));
    window.dispatchEvent(new CustomEvent('interop:ready', { detail: detail }));
  }

  // Auto-load attributes: when a manifest-declared `data-*` attribute appears on
  // the page, import the module(s) that power it. A key may be a space-separated
  // set of attributes that share modules. Runs after the DOM is parsed.
  function autoLoadAttributes() {
    if (typeof document === 'undefined') return;
    var sets = MANIFEST.attributes || {};
    Object.keys(sets).forEach(function (key) {
      if (api._caps[key]) return;
      var present = key.split(/\s+/).filter(Boolean).some(function (attr) {
        try { return !!document.querySelector('[' + attr + ']'); } catch (e) { return false; }
      });
      if (!present) return;
      importSeq(expandAll(sets[key])).then(function () { markCapability(key); });
    });
  }
  function whenDomReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  // Auto-load chain: fetch manifest(s), inject importmap, broker, import the
  // `data-components`, then (at DOM-ready) auto-load attributes that appear.
  var auto = (ds.components || ds.load || '').trim();
  loadManifests().then(function () {
    ensureImportmap();
    installInterop();   // before load(): so listeners catch provider events that
                        // fire while a library's modules import
    return loadObjects(ds.objects);   // consumer code first, before providers boot
  }).then(function () {
    return load(auto);
  }).then(function () {
    announce();
    whenDomReady(autoLoadAttributes);
  });
})();
