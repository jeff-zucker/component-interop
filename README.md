# Component Interop

[![npm](https://img.shields.io/npm/v/component-interop)](https://www.npmjs.com/package/component-interop)

- resource sharing between web components from different authors

The goal is interoperable web-components which can share resources even if they come from different component libraries by different authors. 

This zero-dependency, tiny (~30kb source) library is component-agnostic - any web component can use it.

**Component Interop**
* does nothing on its own - it just brokers btwn component libraries
  * does not touch CSS, decide light/shadow DOM, provide methods or components
* supports sharing
  * components
    * load from multiple libraries without a tangled web of imports
  * objects
    * share authenticatedFetch or store objects
  * attributes
    * an app can apply the abilities of a foregin component to its own elements
* prevents duplication & greedy loading
  * apps can tree shake component libraries, pulling only what they need
  * externalized prereqs (e.g. rdflib) and components are guaranteed to only load once
  * in some cases, one can use attributes from a foreign library without importing the full component
* is explicit - what a page draws from each library is named in its script tag (data-components, data-objects, data-attributes); nothing wires implicitly
* manifests are valid JSON-LD 1.1 - RDF consumers (registries, SPARQL) can process them via the shared [context](context.jsonld) and [vocabulary](https://jeff-zucker.github.io/component-interop/ns/), and validate them against the [manifest SHACL shape](shapes/manifest.shaclc); the broker itself reads them as plain JSON, zero dependencies as ever
* manifests can carry per-component display metadata (label, icon, hover title, description, default attributes, SHACL shape + data files, user help) - hosts like data-kitchen build drag-and-drop component palettes from it (`ComponentInterop.manifest.meta`)

### Check out  the [demo](https://jeff-zucker.github.io/component-interop/examples/index.html)!

### Visit the [documentation](https://jeff-zucker.github.io/component-interop/help/index.html)!

### Tests

```sh
npm test             # node unit suite (jsdom + vm) + JSON-LD manifest validation
npm run test:browsers   # real-browser regression test in Chromium, Firefox & WebKit (needs Playwright)
npm run test:jsonld     # JSON-LD only: expand + toRDF every manifest in safe mode
```

The browser test guards the import-map timing: ci must inject its importmap
synchronously, before any module load, or the browser rejects it. Of the three
engines only **Firefox** is strict enough to fail on a regression (Chromium and
WebKit are lenient), so it's the tripwire — but all three run to prove the loader
works everywhere. It needs Playwright + its browser binaries (a **dev**-only
dependency — the library itself stays zero-dependency):

```sh
npm i -D playwright && npx playwright install
```

If Playwright isn't installed, the tests skip rather than fail.

### Security / trust model

Component Interop shares capabilities **within a single document**. When a component
provides a value — e.g. an `authenticatedFetch` — it is dispatched on a same-document
`CustomEvent` and passed as a live JavaScript reference; nothing is serialized or sent
to another frame (there is no `postMessage` / iframe channel here). Two consequences
follow, and they are by design:

- **Trust is at the origin, per page.** Any script the page author loads can listen for
  a provided capability and receive it. There is no per-consumer token or scoping: the
  broker trusts every component on the page. **A hostile component you load is a full
  compromise** — it can read the shared authenticated fetch and act as the user. Only
  load components you trust, from sources you trust.
- **Manifests are configuration you control.** A `data-manifest` URL decides which module
  URLs the page executes, so treat a manifest like any other script you include. Keys
  from a manifest that would poison a prototype (`__proto__`, `constructor`, `prototype`)
  are skipped during merge.

Nothing crosses an iframe boundary, so a capability is never leaked to a frame; the
boundary that matters is *which components the page author chooses to load*.

### Transparency

Portions created using Claude Opus 4.8.

### License

MIT © Jeff Zucker, 2026
