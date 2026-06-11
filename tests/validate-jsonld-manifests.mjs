// Validates that ci manifests are valid JSON-LD 1.1 and convert to the
// expected RDF triples, using the repo's context.jsonld resolved locally
// (no network). Run from the project root:
//
//   node tests/validate-jsonld-manifests.mjs            # proofs + real manifests
//   node tests/validate-jsonld-manifests.mjs --proofs   # construct proofs only
//
// "Proofs" exercise the constructs the design leans on (property-based
// data indexing, @type:@id index values, @-prefixed index keys, @nest,
// @list order, customElements → rdfs:seeAlso) against synthetic data.
// The file pass then expands + converts every real manifest in safe mode
// (safe mode errors on any term a processor would silently drop).

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import jsonld from 'jsonld';

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
const SCHEMA_NAME = 'https://schema.org/name';
const SEE_ALSO = 'http://www.w3.org/2000/01/rdf-schema#seeAlso';

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
    '@pod-os/elements': 'https://example.org/elements.esm.js'
  },
  'shared-modules': {
    '@comunica/query-sparql': 'https://esm.sh/@comunica/query-sparql@5'
  },
  'attributes': {
    'data-edit-shape': { 'module': 'rdf-bundle' }
  },
  'bundles': {
    'rdf-bundle': { 'modules': ['solid-logic', 'solid-ui', 'sol-form'] }
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
  check('component map key → ci:tagName on the module node (@type:@id + property index)',
    nq.includes(`<https://example.org/web/sol-query.js> <${NS}tagName> "sol-query"`));
  check('@-prefixed component index key survives',
    nq.includes(`<https://example.org/elements.esm.js> <${NS}tagName> "@pod-os/elements"`));
  check('shared-module key → schema:name on the module node',
    nq.includes(`<https://esm.sh/@comunica/query-sparql@5> <${SCHEMA_NAME}> "@comunica/query-sparql"`));
  check('attribute wrapper: key → schema:name, value → ci:module literal',
    /_:\S+ <https:\/\/schema\.org\/name> "data-edit-shape"/.test(nq)
      && new RegExp(`_:\\S+ <${NS}module> "rdf-bundle"`).test(nq));
  check('bundle key → schema:name', new RegExp(`_:\\S+ <${SCHEMA_NAME.replace(/[/.]/g, '\\$&')}> "rdf-bundle"`).test(nq));
  check('bundle modules are an ordered @list',
    nq.includes('rdf-syntax-ns#first> "solid-logic"') && nq.includes('rdf-syntax-ns#rest>'));
  check('stage key → schema:name ("local")', nq.includes('"local"'));
  check('nested stage components get ci:tagName',
    nq.includes(`<https://example.org/lib/web/sol-basic.js> <${NS}tagName> "sol-basic"`));
  check('objects is @nest: provides hangs off the manifest node',
    nq.includes(`<${PROOF_BASE}> <${NS}provides> _:`));
  check('provides key → schema:name ("store") + ci:service',
    new RegExp(`_:\\S+ <${NS}service> "rdf"`).test(nq));
  check('accepts descriptor properties present',
    new RegExp(`_:\\S+ <${NS}onElement> "sol-query"`).test(nq)
      && new RegExp(`_:\\S+ <${NS}applyValueTo> "endpoint"`).test(nq));
}

// ── real manifest files ─────────────────────────────────────────────────────

const FILES = [
  { path: 'examples/sol-components.manifest.json',
    base: 'https://jeff-zucker.github.io/component-interop/examples/sol-components.manifest.json' },
  { path: 'examples/pod-os.manifest.json',
    base: 'https://jeff-zucker.github.io/component-interop/examples/pod-os.manifest.json' },
  { path: 'tests/fixtures/interop.manifest.json',
    base: 'https://jeff-zucker.github.io/component-interop/tests/fixtures/interop.manifest.json' },
  // the sc sibling — present in the dev tree, absent in a bare ci clone
  { path: '../sol-components/dist/sol-components.manifest.json',
    base: 'https://cdn.jsdelivr.net/npm/sol-components/dist/sol-components.manifest.json',
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
