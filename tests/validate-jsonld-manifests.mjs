// Validates that ci manifests are valid JSON-LD 1.1 and convert to the
// expected RDF triples, using the repo's context.jsonld resolved locally
// (no network). Run from the project root:
//
//   node tests/validate-jsonld-manifests.mjs            # proofs + real manifests
//   node tests/validate-jsonld-manifests.mjs --proofs   # construct proofs only
//
// "Proofs" exercise the constructs the design leans on (property-based
// data indexing, @type:@id index values, @-prefixed index keys, @nest,
// @list order, customElements → rdfs:seeAlso, component metadata objects)
// against synthetic data. The file pass then expands + converts every real
// manifest in safe mode (safe mode errors on any term a processor would
// silently drop) and validates its triples against shapes/manifest.shacl.ttl.
//
// The shapes graph is COMPOSED: manifest.shacl.ttl carries only the manifest
// envelope; the shared item shapes (ui:Component / ui:Link) live in
// sol-components' shapes/menu.shacl and are loaded from the sibling checkout
// or node_modules when available (warn + envelope-only otherwise). An entry
// opts into item-level validation by carrying an explicit "@type":
// "ui:Component" or "ui:Link" — compact IRIs the existing context resolves;
// untyped entries (all real manifests today) see only the envelope shapes.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import jsonld from 'jsonld';
import { Parser, Store } from 'n3';
import SHACLValidator from 'rdf-validate-shacl';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTEXT_URL = 'https://jeff-zucker.github.io/component-interop/context.jsonld';
const localContext = JSON.parse(readFileSync(resolve(root, 'context.jsonld'), 'utf8'));

const documentLoader = async (url) => {
  if (url === CONTEXT_URL) {
    return { contextUrl: null, document: localContext, documentUrl: url };
  }
  throw new Error('offline harness refuses to fetch: ' + url);
};

const NS = 'https://jeff-zucker.github.io/component-interop/ns#';
const SCHEMA = 'http://schema.org/';            // ALWAYS http, never https
const SCHEMA_NAME = SCHEMA + 'name';
const UI = 'http://www.w3.org/ns/ui#';
const DCT = 'http://purl.org/dc/terms/';
const SEE_ALSO = 'http://www.w3.org/2000/01/rdf-schema#seeAlso';

const shapesStore = new Store(
  new Parser().parse(readFileSync(resolve(root, 'shapes/manifest.shacl.ttl'), 'utf8')));

// Compose the shared item shapes (menu.shacl has only local #fragments, so
// any absolute baseIRI serves).
const MENU_SHACL_CANDIDATES = [
  resolve(root, '../sol-components/shapes/menu.shacl'),
  resolve(root, 'node_modules/sol-components/shapes/menu.shacl'),
];
const menuShaclPath = MENU_SHACL_CANDIDATES.find(existsSync);
if (menuShaclPath) {
  shapesStore.addQuads(new Parser({
    baseIRI: 'https://jeff-zucker.github.io/component-interop/shapes/menu.shacl',
  }).parse(readFileSync(menuShaclPath, 'utf8')));
} else {
  console.warn('warn: sol-components shapes/menu.shacl not found — '
    + 'validating against the manifest envelope only');
}
const shaclValidator = new SHACLValidator(shapesStore);

async function shaclCheck(label, nq) {
  const data = new Store(new Parser({ format: 'application/n-quads' }).parse(nq));
  const report = await shaclValidator.validate(data);
  const detail = report.results.map(r =>
    `${r.path?.value || ''} ${r.message.map(m => m.value).join('; ')} (focus ${r.focusNode?.value})`
  ).slice(0, 5).join('\n       ');
  check(label + ' conforms to shapes/manifest.shacl.ttl', report.conforms, detail);
}

let failures = 0;
function check(label, ok, detail) {
  if (ok) { console.log('  ok  ' + label); }
  else { failures++; console.error('  FAIL ' + label + (detail ? '\n       ' + detail : '')); }
}

async function toNQuads(doc, base) {
  // safe mode: a term the context doesn't define is an error, not a silent drop
  await jsonld.expand(doc, { base, documentLoader, safe: true });
  return jsonld.toRDF(doc, { format: 'application/n-quads', base, documentLoader, safe: true });
}

// ── construct proofs (synthetic) ────────────────────────────────────────────

const PROOF_BASE = 'https://example.org/lib/proof.manifest.json';
const proofManifest = {
  '@context': CONTEXT_URL,
  '@id': '',
  '@type': 'Manifest',
  'name': 'proof-lib',
  'customElements': 'custom-elements.json',
  'components': {
    'sol-query': '../web/sol-query.js',
    '@pod-os/elements': 'https://example.org/elements.esm.js',
    'sol-feed': {                       // object form: module + display metadata
      '@type': 'ui:Component',          // opt-in: binds the SHARED ComponentShape
      'module': '../web/sol-feed.js',   // ci loader plumbing (ci:module)
      // the generic payload IRI — REQUIRED by the shared ComponentShape (2026-07-19)
      'schema:url': { '@id': '../web/sol-feed.js' },
      'label': 'News (three-panel feeds)',
      'icon': '📰',
      'title': 'Three-panel feed reader',
      'description': 'Browse feeds by source.',
      'params': [{ 'name': 'view', 'value': 'threePanel' }],
      'shape': './shapes/feed.shacl',
      'data': ['./data/feeds.ttl', './data/more.ttl'],
      'help': './help/sol-feed.html'
    },
    'notepod': {                        // a LINK entry: nothing to load, just a URL
      '@type': 'ui:Link',               // binds the shared LinkShape (xone included)
      'label': 'NotePod',
      'schema:url': 'https://notepod.example/'
    },
    'sol-bare': { 'label': 'Bare' }     // metadata-only (stages would carry the URL)
  },
  'shared-modules': {
    '@comunica/query-sparql': 'https://esm.sh/@comunica/query-sparql@5'
  },
  'attributes': {
    'data-edit-shape': { 'module': 'sol-components/core/rdf-bundle.js' }
  },
  'stages': {
    'local': { 'components': { 'sol-basic': './web/sol-basic.js' } }
  },
  'objects': {
    'provides': { 'store': { 'service': 'rdf', 'sendValue': 'store' } },
    'consumes': { 'store': { 'call': 'rdf.useStore' } },
    'accepts':  { 'navigation': { 'onElement': 'sol-query', 'applyValueTo': 'endpoint' } }
  }
};

async function runProofs() {
  console.log('construct proofs (synthetic manifest):');
  const nq = await toNQuads(proofManifest, PROOF_BASE);

  check('manifest node typed ci:Manifest',
    nq.includes(`<${PROOF_BASE}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${NS}Manifest>`));
  check('library name via schema:name',
    nq.includes(`<${PROOF_BASE}> <${SCHEMA_NAME}> "proof-lib"`));
  check('customElements → rdfs:seeAlso, relative URL resolved',
    nq.includes(`<${PROOF_BASE}> <${SEE_ALSO}> <https://example.org/lib/custom-elements.json>`));
  // Component map keys are PLAIN JSON-LD indexes now (2026-07-19): the
  // retired ui:name predicate must not appear in any projection — the tag
  // derives from a module's filename wherever it's needed.
  check('component map keys project NO ui:name triples',
    !nq.includes(`<${UI}name>`));
  check('@-prefixed component index key still resolves its module IRI',
    nq.includes('<https://example.org/elements.esm.js>'));
  check('shared-module key → schema:name on the module node',
    nq.includes(`<https://esm.sh/@comunica/query-sparql@5> <${SCHEMA_NAME}> "@comunica/query-sparql"`));
  check('attribute wrapper: key → schema:name, value → ci:module literal',
    new RegExp(`_:\\S+ <${SCHEMA}name> "data-edit-shape"`).test(nq)
      && new RegExp(`_:\\S+ <${NS}module> "sol-components/core/rdf-bundle\\.js"`).test(nq));
  check('stage key → schema:name ("local")', nq.includes('"local"'));
  check('nested stage component key resolves its module IRI (no ui:name)',
    nq.includes('<https://example.org/lib/web/sol-basic.js>'));
  check('object-form component: scoped module → ci:module as resolved IRI',
    new RegExp(`_:\\S+ <${NS}module> <https://example\\.org/web/sol-feed\\.js>`).test(nq));
  check('label → ui:label', new RegExp(`_:\\S+ <${UI}label> "News \\(three-panel feeds\\)"`).test(nq));
  check('icon → ui:icon (literal, not URL-resolved)', new RegExp(`_:\\S+ <${UI}icon> "📰"`).test(nq));
  check('title → ui:hoverTitle', new RegExp(`_:\\S+ <${UI}hoverTitle> "Three-panel feed reader"`).test(nq));
  check('description → schema:description (http)',
    new RegExp(`_:\\S+ <${SCHEMA}description> "Browse feeds by source\\."`).test(nq));
  check('params → ui:attribute as schema:PropertyValue pairs',
    new RegExp(`_:\\S+ <${UI}attribute> _:`).test(nq)
      && new RegExp(`_:\\S+ <${SCHEMA}name> "view"`).test(nq)
      && new RegExp(`_:\\S+ <${SCHEMA}value> "threePanel"`).test(nq));
  check('shape → dct:conformsTo, relative IRI resolved',
    new RegExp(`_:\\S+ <${DCT}conformsTo> <https://example\\.org/lib/shapes/feed\\.shacl>`).test(nq));
  check('data → dct:references, both entries resolved',
    new RegExp(`_:\\S+ <${DCT}references> <https://example\\.org/lib/data/feeds\\.ttl>`).test(nq)
      && nq.includes('lib/data/more.ttl>'));
  check('help → schema:softwareHelp, resolved',
    new RegExp(`_:\\S+ <${SCHEMA}softwareHelp> <https://example\\.org/lib/help/sol-feed\\.html>`).test(nq));
  check('metadata-only component (no module) still gets its label',
    new RegExp(`_:\\S+ <${UI}label> "Bare"`).test(nq));
  check('objects is @nest: provides hangs off the manifest node',
    nq.includes(`<${PROOF_BASE}> <${NS}provides> _:`));
  check('provides key → schema:name ("store") + ci:service',
    new RegExp(`_:\\S+ <${NS}service> "rdf"`).test(nq));
  check('accepts descriptor properties present',
    new RegExp(`_:\\S+ <${NS}onElement> "sol-query"`).test(nq)
      && new RegExp(`_:\\S+ <${NS}applyValueTo> "endpoint"`).test(nq));
  check('typed entries carry rdf:type (opt-in to the shared item shapes)',
    new RegExp(`_:\\S+ <http://www\\.w3\\.org/1999/02/22-rdf-syntax-ns#type> <${UI}Component>`).test(nq)
      && new RegExp(`_:\\S+ <http://www\\.w3\\.org/1999/02/22-rdf-syntax-ns#type> <${UI}Link>`).test(nq));
  check('link entry: schema:url present, no ci:module',
    new RegExp(`_:\\S+ <${SCHEMA}url> "https://notepod\\.example/"`).test(nq));
  await shaclCheck('proof manifest', nq);

  // Negative proof — only meaningful when the shared shapes are composed in:
  // a typed ui:Link with neither schema:url nor ui:contents must NOT conform
  // (the LinkShape sh:xone).
  if (menuShaclPath) {
    const badLink = {
      ...proofManifest,
      'components': {
        'dangling': { '@type': 'ui:Link', 'label': 'Dangling' },
      },
    };
    const badNq = await toNQuads(badLink, PROOF_BASE);
    const report = await shaclValidator.validate(
      new Store(new Parser({ format: 'application/n-quads' }).parse(badNq)));
    check('typed ui:Link without schema:url/contents FAILS the composed shapes',
      report.conforms === false);
  } else {
    console.log('  (skipped negative link proof — menu.shacl not composed)');
  }
}

// ── real manifest files ─────────────────────────────────────────────────────

const FILES = [
  { path: 'examples/sol-components.manifest.json',
    base: 'https://jeff-zucker.github.io/component-interop/examples/sol-components.manifest.json' },
  { path: 'examples/pod-os.manifest.json',
    base: 'https://jeff-zucker.github.io/component-interop/examples/pod-os.manifest.json' },
  { path: 'tests/fixtures/interop.manifest.json',
    base: 'https://jeff-zucker.github.io/component-interop/tests/fixtures/interop.manifest.json' },
  // the siblings — present in the dev tree, absent in a bare ci clone
  { path: '../sol-components/dist/sol-components.manifest.json',
    base: 'https://cdn.jsdelivr.net/npm/sol-components/dist/sol-components.manifest.json',
    optional: true },
  { path: '../data-kitchen/dk.manifest.json',
    base: 'https://example.org/data-kitchen/dk.manifest.json',
    optional: true }
];

async function runFiles() {
  let sampleNQuads = '';
  for (const f of FILES) {
    if (f.optional && !existsSync(resolve(root, f.path))) {
      console.log('manifest: ' + f.path + ' — skipped (not present)');
      continue;
    }
    console.log('manifest: ' + f.path);
    const doc = JSON.parse(readFileSync(resolve(root, f.path), 'utf8'));
    try {
      const nq = await toNQuads(doc, f.base);
      const count = nq.trim() ? nq.trim().split('\n').length : 0;
      check('expands + converts in safe mode (' + count + ' triples)', count > 0);
      await shaclCheck(f.path, nq);
      if (f.path.endsWith('dist/sol-components.manifest.json')) sampleNQuads = nq;
    } catch (err) {
      check('expands + converts in safe mode', false, err.message);
    }
  }
  if (sampleNQuads) {
    console.log('\n── N-Quads spot-check (sol-components dist manifest, first 25) ──');
    console.log(sampleNQuads.trim().split('\n').slice(0, 25).join('\n'));
  }
}

await runProofs();
if (!process.argv.includes('--proofs')) await runFiles();

if (failures) { console.error('\n' + failures + ' check(s) FAILED'); process.exit(1); }
console.log('\nall JSON-LD checks passed');
