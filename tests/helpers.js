// tests/helpers.js — shared test harness for component-interop.
//
// component-interop is browser code (a classic-script IIFE that builds
// window.ComponentInterop) and handler.js is a DOM-driven ES module. To exercise
// them under `node --test` we need a DOM. We use jsdom, but we DO NOT add it as a
// repo dependency — it is resolved from the repo's node_modules if present, else
// from the GLOBAL npm root. If jsdom is found nowhere, JSDOM is null and the
// DOM-dependent suites skip themselves (see `requireJsdom`), so the package stays
// truly zero-dependency and `npm test` still runs (it just reports skips).

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── resolve jsdom: repo first, then the global install ─────────────────────────
function resolveJsdom() {
  try { return require('jsdom'); } catch (e) { /* not in repo — try global */ }
  try {
    const root = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return require(path.join(root, 'jsdom'));
  } catch (e) { return null; }
}
const jsdom = resolveJsdom();
export const JSDOM = jsdom ? jsdom.JSDOM : null;

// A skip option for node:test — `test('…', requireJsdom(), fn)` /
// `describe('…', requireJsdom(), fn)` becomes a no-op skip when jsdom is absent.
export function requireJsdom() {
  return { skip: JSDOM ? false : 'jsdom not available (install it in the repo or globally)' };
}

// ── component-interop source, with dynamic import() made interceptable ──────────
// We run the loader IIFE through vm.Script under its REAL filename so `node --test
// --experimental-test-coverage` attributes coverage to component-interop.js. The
// loader's only real module load is `import(spec)` in importModule(); we route it
// through an injected `_ciImp` so tests can stub module loading. The swap is
// length-preserving ("import(spec)" → "_ciImp(spec)", both 12 chars) so every byte
// offset still matches the on-disk file and coverage line mapping stays exact.
// Everything else the IIFE touches (document/window/location/fetch/CustomEvent/
// URL/console) is supplied via the vm context global so each load runs against a
// fresh jsdom realm.
const ciPath = path.join(__dirname, '..', 'component-interop.js');
const ciSource = readFileSync(ciPath, 'utf8').replace('import(spec)', '_ciImp(spec)');
const ciScript = new vm.Script(ciSource, { filename: ciPath });

const DEFAULT_HTML = '<!doctype html><html><head></head><body></body></html>';

/**
 * Load component-interop.js into a fresh jsdom realm and return its public surface.
 *
 * @param {object}   [opts]
 * @param {object}   [opts.dataset]     camelCase data-* attrs for the loader's <script>
 *                                      (e.g. {manifest:'a.json b.json', extendWith:'handler'})
 * @param {string}   [opts.src]         the loader script's .src (drives the sibling manifest URL)
 * @param {object}   [opts.fetchMap]    absolute URL -> manifest object (what fetch() returns)
 * @param {function} [opts.importImpl]  stub for dynamic import(spec); default records the spec
 * @param {function} [opts.domSetup]    (document, window) => void, run BEFORE the loader executes
 * @param {string}   [opts.url]         page URL / origin (default http://localhost/)
 * @param {string}   [opts.html]        initial document HTML
 * @returns {{dom, window, document, api, logs, importedSpecs}}
 */
export function loadCI(opts = {}) {
  if (!JSDOM) throw new Error('loadCI requires jsdom');
  const {
    dataset = {},
    src = 'http://localhost/component-interop.js',
    fetchMap = {},
    importImpl,
    domSetup,
    url = 'http://localhost/',
    html = DEFAULT_HTML,
  } = opts;

  const dom = new JSDOM(html, { url });
  const win = dom.window;
  const doc = win.document;

  // Fake the loader's own <script> so document.currentScript / .src / .dataset work.
  const script = doc.createElement('script');
  if (src) script.src = src;
  for (const k in dataset) script.dataset[k] = dataset[k];
  Object.defineProperty(doc, 'currentScript', { configurable: true, get: () => script });

  const logs = { warn: [], error: [], log: [] };
  const con = {
    warn:  (...a) => logs.warn.push(a.map(String).join(' ')),
    error: (...a) => logs.error.push(a.map(String).join(' ')),
    log:   (...a) => logs.log.push(a.map(String).join(' ')),
  };

  const importedSpecs = [];
  const imp = importImpl || ((spec) => { importedSpecs.push(spec); return Promise.resolve(); });

  const fetchImpl = (u) => {
    const m = fetchMap[u];
    if (m === undefined) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(typeof m === 'function' ? m() : m) });
  };

  if (domSetup) domSetup(doc, win);

  // Run the loader at top level in a fresh vm context (so coverage maps to the real
  // file). The IIFE's free identifiers resolve to these context globals; built-ins
  // (Promise, Object, …) come from the context itself.
  const sandbox = {
    window: win, document: doc, location: win.location,
    fetch: fetchImpl, CustomEvent: win.CustomEvent, URL: win.URL,
    console: con, _ciImp: imp,
  };
  vm.createContext(sandbox);
  ciScript.runInContext(sandbox);

  return { dom, window: win, document: doc, api: win.ComponentInterop, logs, importedSpecs };
}

// Build a fetchMap + a data-manifest list from {name -> manifest} entries.
// Each manifest is served at http://<host>/<name>.manifest.json and the returned
// `manifest` string preserves the given order (the loader's "first wins" order).
export function manifests(map, host = 'http://localhost') {
  const fetchMap = {};
  const names = Object.keys(map);
  names.forEach((name) => { fetchMap[`${host}/${name}.manifest.json`] = map[name]; });
  return { fetchMap, manifest: names.map((n) => `${n}.manifest.json`).join(' ') };
}

// loadCI runs the loader in its own vm context (for clean per-test isolation and
// correct file-attributed coverage), so the plain-data structures it returns carry
// that context's Array/Object prototypes. assert/strict's deepEqual compares
// prototypes, so normalize such values across the realm boundary before comparing.
export const plain = (v) => JSON.parse(JSON.stringify(v));

// Resolve when `name` event fires on the realm's document, or reject after `ms`.
export function onceEvent(win, name, ms = 1000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for ' + name)), ms);
    win.document.addEventListener(name, (e) => { clearTimeout(t); resolve(e); }, { once: true });
  });
}
