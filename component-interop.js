/**
 * component-interop.js — a manifest-driven capability broker for web components.
 *
 * It knows nothing about any particular component library: everything it does is
 * driven by one or more MANIFESTS. Independently-authored web-component libraries
 * never import each other — they declare what they PROVIDE and CONSUME in a
 * manifest, and this broker pairs providers to consumers and loads their modules.
 *
 *   <script src="component-interop.js"
 *           data-manifest="my-lib.manifest.json other-lib.manifest.json"
 *           data-components="my-widget"
 *           data-objects="store"></script>
 *
 * On load it (1) reads the `data-manifest` URLs; (2) `import()`s the modules named
 * in `data-components` (or all, with `data-components="*"`); (3) brokers the
 * libraries' `objects` blocks — pairing each opted-in consumer with a provider;
 * (4) at DOM-ready, loads any `attributes` entry the page both names in
 * `data-attributes` and uses in the DOM; then fires `interop:ready`.
 *
 * The opt-in invariant: nothing ci activates that the script tag doesn't name —
 * components in `data-components`, shared objects in `data-objects`, attributes in
 * `data-attributes`. The tag is the full inventory of what links.
 *
 * A manifest's OFFERINGS — read these to use the library:
 *   `components` — placeable elements, loaded by `data-components` (or `"*"`).
 *   `attributes` — `data-*` you can use, loaded when named AND present in the DOM.
 *   `objects`    — values shared with other libraries (a store, an auth fetch, …).
 *   { "name": "…",                                  // library identity (required for sharing)
 *     "components": { "my-el": "./my-el.js" },       // placeable elements → module (URL or bare specifier)
 *     "attributes": { "data-x": "./mod.js",          // a data-* → module specifier(s) or a bundle name
 *                     "data-a data-b": "rdf" },       // (space-separated keys share modules)
 *     "bundles":    { "rdf": ["solid-ui", "sol-form"] }, // a name → module specifiers (logical group)
 *     "objects": {
 *       "provides": { key: { service|respondTo: "…", sendValue: "…", priority?: n } }, // offer a value (service or event; respondTo may be a list)
 *       "consumes": { key: { call: "<registered-consumer>", from?: "<lib>", module?: "<spec>" } }, // adopt it by calling a handler (module: code eager-loaded for data-objects)
 *       "accepts":  { key: { onElement: "…", applyValueTo: "…", transform?: "stripHash" } } } } // adopt it by setting a DOM attribute
 *
 * A module specifier resolves against THAT manifest's URL when relative/absolute
 * (`./…`, `/…`, `https://…`) and is import()ed directly; a bare specifier (e.g.
 * "solid-logic") is left for an import map to resolve (see the import-map section at
 * the end). The broker pairs a `consumes` OR `accepts` key with ANOTHER library's
 * `provides` key of the same name (the adopt rule) — but ONLY for keys the page lists
 * in `data-objects`, so nothing cross-wires until the page names it. A page mixing
 * libraries needs no bridge script, just the opt-in.
 *
 * A `consumes.call` names a handler the consuming library registered via
 * `ComponentInterop.registerConsumer(name, fn)` — the broker invokes the
 * registered function, never an arbitrary string. So the broker stays ignorant
 * of any library's actual API.
 *
 * data-* attributes: data-components (specifiers, or `*` for all), data-objects
 * (the object-capability keys this page opts into — the broker wires a `consumes`
 * or `accepts` channel ONLY if its key is listed here; a key whose declaration
 * carries a `module` is also eager-loaded before data-components, so its consumer
 * is registered before any provider fires. A token may name its host inline,
 * `key:provider` e.g. "store:pod-os", which also sets the provider preference —
 * one token saying opt-in AND from-whom), data-attributes (the manifest `data-*`
 * keys this page opts into — each loads only when named here AND present in the DOM;
 * no list → no attribute loads), data-manifest (manifest URLs to merge; cross-origin
 * allowed when the server sends CORS), data-base (resolve data-manifest paths),
 * data-prefer (JSON map key→preferred provider library, for multi-library pages; an
 * explicit data-prefer wins over a `key:provider` inline host in data-objects).
 * (data-stage and data-importmap-extra relate to the optional import map — see the
 * end section.)
 *
 * API on window.ComponentInterop: ready (Promise), load(components), manifest,
 * loaded, version, registerCapability("data-x", modules),
 * registerConsumer(name,fn); the host-services registry .services
 * (register/get/has/names/whenReady) so libraries share resources without
 * importing each other; .has(name) / .capabilities; .on(name,fn) / .emit(name,detail).
 * Fires `interop:ready`, `interop:capability` (per capability), `interop:wired`
 * (per provide→consume binding). Zero dependencies.
 *
 * ── Optional: using the manifest to supply an import map (and why) ──────────────
 * A manifest can ALSO carry an import map, so libraries reference their deps by bare
 * specifier instead of hard-coding URLs:
 *   "shared-modules": { "rdflib": "./vendor/rdflib.js", … }  // externalized deps → URL
 *   "components":     { "my-el": "./my-el.js", … }           // component URLs also feed the map
 *   "stages": { "local": { "shared-modules": {…} },          // optional per-env URL sets,
 *               "cdn":   { "shared-modules": {…} } }          //   chosen by data-stage
 * ci merges every manifest's entries FIRST-WINS into ONE `<script type="importmap">`
 * and injects it synchronously, before any module loads (a map added after a module
 * load is rejected — Firefox strict, Chromium lenient). `data-stage`
 * (`local`|`cdn`|`auto` — auto = local on localhost/file:, else cdn) picks the stage;
 * `data-importmap-extra` adds inline entries. If the page already owns an
 * `<script type="importmap">`, ci yields to it.
 *
 * Why you'd want it: bare specifiers stay location-flexible (swap dev↔CDN by editing
 * only the map/stage), and the union of every library's externalized deps is
 * collected and DEDUPED to one instance automatically (one rdflib) instead of each
 * app hand-authoring and reconciling a map. When you DON'T need it: reference modules
 * by relative/absolute URL in the manifest and ci imports them directly — no map.
 * (Bare runtime deps a library imports internally still need an import map — ci's or
 * a page-owned one — regardless; that part isn't ci-specific.)
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

  // A data-objects token may name its host inline: `key` or `key:provider`
  // (e.g. "store:pod-os"). The provider folds into PREFER so one token says both
  // "opt in" AND "from whom"; an explicit data-prefer (parsed above) wins on conflict.
  toList(ds.objects).forEach(function (tok) {
    var i = tok.indexOf(':'); if (i === -1) return;
    var k = tok.slice(0, i), host = tok.slice(i + 1);
    if (host && !PREFER[k]) PREFER[k] = host;
  });

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
  // A data-objects token is `key` or `key:provider`; the key alone is the opt-in /
  // module-load identity (the `:provider` host is handled once, into PREFER, above).
  function objKey(tok) { var i = tok.indexOf(':'); return i === -1 ? tok : tok.slice(0, i); }
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
      // Track every declared key (so data-objects can tell an opt-in from a typo),
      // and record the `module` a declaration names (e.g. a `consumes.call` handler)
      // so `data-objects="key"` can eager-load it.
      ['provides', 'consumes', 'accepts'].forEach(function (g) {
        var blk = m.objects[g]; if (!blk) return;
        for (var key in blk) if (own(blk, key) && blk[key]) {
          knownObjectKeys[key] = true;
          if (blk[key].module)
            objectModules[key] = addSpecs((objectModules[key] || []), blk[key].module, url);
        }
      });
    }
  }

  // The manifests to merge: the data-manifest URLs — each names the modules the
  // loader will import().
  function manifestEntries() {
    return toList(ds.manifest);
  }

  // SYNCHRONOUS by design. When a manifest carries an import map, ci has to inject it
  // before the parser yields past the loader's blocking <head> script: an import map
  // added after any module load/preload has started is rejected (Firefox enforces this
  // strictly; Chromium is lenient). So we fetch each manifest with a blocking XHR and
  // inject the map in the same synchronous pass, while no module has loaded yet. A
  // cross-origin manifest is allowed, but — like any cross-origin fetch — loads only if
  // that server sends CORS headers; otherwise it's skipped (logged below).
  function fetchJsonSync(url) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);   // false → synchronous
      xhr.send(null);
      if (xhr.status >= 200 && xhr.status < 300) return JSON.parse(xhr.responseText);
      console.error('[component-interop] manifest ' + url + ': HTTP ' + xhr.status);
    } catch (err) {
      console.error('[component-interop] manifest ' + url + ': ' + ((err && err.message) || err));
    }
    return null;
  }

  function loadManifests() {
    manifestEntries().forEach(function (u) {   // in order → first wins
      var abs;
      try { abs = new URL(u, base).href; }
      catch (x) { console.warn('[component-interop] bad manifest URL: ' + u); return; }
      var m = fetchJsonSync(abs);
      if (m) mergeManifest(m, abs);
    });
  }

  // ── the broker: glueless provide/consume matchmaking ───────────────────────
  var interopSources = [];   // [{ name, interop }] collected from manifests
  api.interop = interopSources;
  var objectModules = {};    // object key → module specifier(s) (for data-objects)
  var knownObjectKeys = {};  // every object key any manifest declares (provides/consumes/accepts)

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

    // Opt-in gate: the page wires a `consumes`/`accepts` capability only if its
    // key is listed in data-objects. No list → nothing cross-wires, even when two
    // manifests both declare the channel. The tag is the inventory of what links.
    var allow = {};
    toList(ds.objects).forEach(function (tok) { allow[objKey(tok)] = true; });

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
        if (!allow[cap]) return;
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
        if (!allow[cap]) return;
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
    var list = toList(keys).map(objKey);   // strip any inline `:provider` host
    if (!list.length) return Promise.resolve();
    var specs = [];
    list.forEach(function (k) {
      if (objectModules[k]) addSpecs(specs, objectModules[k], '');
      else if (!knownObjectKeys[k]) console.warn('[component-interop] data-objects "' + k + '": unknown capability — not declared in any manifest objects block');
      // else: declared but module-less (a wire-only channel, e.g. `accepts`) — nothing to eager-load
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

  // Auto-load attributes: opt-in by name (data-attributes), then by presence. A
  // manifest-declared `data-*` loads its module(s) only when the page BOTH lists
  // the attribute in data-attributes AND uses it in the DOM — so nothing ci
  // activates that the script tag doesn't name. No list → nothing loads. A key may
  // be a space-separated set sharing modules. Runs after the DOM is parsed.
  function autoLoadAttributes() {
    if (typeof document === 'undefined') return;
    var allow = {};
    toList(ds.attributes).forEach(function (a) { allow[a] = true; });
    var sets = MANIFEST.attributes || {};
    Object.keys(sets).forEach(function (key) {
      if (api._caps[key]) return;
      var on = key.split(/\s+/).filter(Boolean).some(function (attr) {
        if (!allow[attr]) return false;
        try { return !!document.querySelector('[' + attr + ']'); } catch (e) { return false; }
      });
      if (!on) return;
      importSeq(expandAll(sets[key])).then(function () { markCapability(key); });
    });
  }
  function whenDomReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  // Load chain. The first three steps run SYNCHRONOUSLY inside the loader's blocking
  // <head> script — fetch manifest(s), inject the importmap, install the broker —
  // so the map is registered before the parser yields and before any module load
  // starts (or Firefox rejects it). The dynamic imports then run async: the
  // `data-objects` consumers first, then `data-components`, then (at DOM-ready) the
  // `data-attributes` both named on the tag and present in the DOM.
  var auto = (ds.components || ds.load || '').trim();
  loadManifests();    // sync (XHR): merge manifests → imports
  ensureImportmap();  // sync: inject the map now, ahead of every module load
  installInterop();   // before load(): so listeners catch provider events that
                      // fire while a library's modules import
  loadObjects(ds.objects)             // consumer code first, before providers boot
    .then(function () { return load(auto); })
    .then(function () {
      announce();
      whenDomReady(autoLoadAttributes);
    });
})();
