# Component Interop

[![npm](https://img.shields.io/npm/v/component-interop)](https://www.npmjs.com/package/component-interop)

- resource sharing between web components from different authors

The goal is interoperable web-components which can share resources even if they come from different component libraries by different authors. 

This zero-dependency, tiny (17kb) library is component-agnostic - any web component can use it.

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

### Check out  the [demo](https://jeff-zucker.github.io/component-interop/examples/index.html)!

### Visit the [documentation](https://jeff-zucker.github.io/component-interop/help/index.html)!

### Tests

```sh
npm test            # node unit suite (jsdom + vm), zero deps
npm run test:firefox   # real-Firefox regression test (needs Playwright)
```

The Firefox test guards the import-map timing: ci must inject its importmap
synchronously, before any module load, or Firefox rejects it. It needs the
Playwright Firefox binary (a **dev**-only dependency — the library itself stays
zero-dependency):

```sh
npm i -D playwright && npx playwright install firefox
```

If Playwright isn't installed, the test skips rather than fails.

### Transparency

Portions created using Claude Opus 4.8.

### License

MIT © Jeff Zucker, 2026
