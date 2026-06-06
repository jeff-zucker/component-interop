# tests

Run with:

```sh
npm test          # node --test, WITH coverage (tests/ excluded)
npm run test:plain # node --test, no coverage
```

`npm test` prints a coverage table. Because the loader is run through `vm.Script`
under its real filename (see `helpers.js`), `component-interop.js` is attributed
correctly — both source files report 100% line coverage. (Coverage uses Node's
built-in `--experimental-test-coverage`; no extra tooling.)

## Why these tests need a DOM, and how that stays zero-dependency

`component-interop.js` is browser code — a classic-script IIFE that builds
`window.ComponentInterop` from `document.currentScript`. Exercising it under Node
needs a DOM, which we get from **jsdom**.

But the package itself is **zero-dependency**, so jsdom is **not** a repo
dependency and is **not** in `package.json`. Instead `helpers.js` resolves jsdom
from the repo's `node_modules` if it happens to be there, otherwise from the
**global** npm install (`npm root -g`). If jsdom is found in neither place,
`JSDOM` is `null` and every DOM-dependent test **skips itself** (via
`requireJsdom()`), so `npm test` still passes — it just reports skips.

To run the full suite, have jsdom installed somewhere on the machine:

```sh
npm install -g jsdom      # global — keeps this repo clean
# or, just for a local run (do not commit): npm install --no-save jsdom
```

## Layout

- **`helpers.js`** — resolves jsdom (repo→global), and `loadCI()` runs the loader
  IIFE in a fresh jsdom realm with stubbed `fetch` (manifest map), an
  interceptable dynamic `import()`, and a captured `console`. Also `manifests()`,
  `onceEvent()`, and the `requireJsdom()` skip guard.
- **`interop.test.js`** — the broker/loader public surface: the host-services
  registry, the consumer registry, `registerCapability`, importmap injection
  (incl. page-owns-it and `data-importmap-extra`), manifest merging (first-wins),
  provide→consume wiring, `pickProvider` (prefer / `from` / priority / manifest
  order), the resource channel, `load()` + auto-load, the lifecycle
  events, and same-origin manifest security.
