# component-interop

**Quickest way to learn: try the [demo](examples/index.html).**

A **zero-dependency, manifest-driven capability broker for web components.** It lets
independently-authored component libraries share a store, a session, and capabilities — and
coordinate navigation — **without importing each other and without page glue code.**

Each library ships (or is described by) a small JSON **manifest** declaring what it *provides* and
*consumes*. One `<script>` tag loads the libraries and the broker pairs every consumer with a
provider in another library. The result is plain custom elements on a page that interoperate.

## Install / use

```html
<script src="component-interop.js"
        data-stage="local"
        data-components="my-widgets"
        data-manifest="other-lib.manifest.json"></script>
```

It is a classic script (no build step needed), exposes `window.ComponentInterop`, and has **no
runtime dependencies**.

## What it does

A manifest's **offerings** — what you read to use a library — are **components** (elements
to place), **attributes** (a `data-*` you use), and **objects** (a value shared
library→library):

1. **components** — injects an importmap from the manifests' `components` +
   `shared-modules`, then `import()`s the `data-components` (or `"*"` for all).
2. **attributes** — when a manifest-declared `data-*` appears on the page, ci **auto-loads**
   the module(s) (or `bundle`) that power it. Nothing to declare on the page.
3. **objects** — pairs a library's `consumes`/`accepts` with another library's
   `provides` of the same key (the "adopt the other library's value" rule).
4. **a shared registry** — `ComponentInterop.services` (register / whenReady / get / has)
   so libraries publish and discover shared objects without importing each other.

## The manifest

Offerings (read these to use the library) — `components`, `attributes`, `objects`; plumbing
(only a co-author wiring shared deps reads these) — `shared-modules`, `bundles`:

```jsonc
{
  "name": "my-lib",                                   // library identity (required for sharing)
  "components":     { "my-widget": "./my-widget.js" },// placeable elements → URL (data-components / "*")
  "shared-modules": { "rdflib": "./vendor/rdflib.js" },// deps externalized by name (importmap, deduped)
  "bundles":        { "editing": ["solid-ui", "my-form"] }, // a logical module group
  "stages": {                                         // optional: pick with data-stage
    "local": { "components": {…}, "shared-modules": { "dep": "./vendor/dep.js" } },
    "cdn":   { "components": {…}, "shared-modules": { "dep": "https://esm.sh/dep" } }
  },
  "attributes": {                                     // a data-* → its module(s) or a bundle name (auto-loaded)
    "data-login": "./my-login.js",
    "data-edit-shape data-subject": "editing"         // space-separated keys share modules
  },
  "objects": {
    "provides": {                                     // offer a value (from a service or an event)
      "store":      { "service": "store", "sendValue": "graph" },
      "navigation": { "respondTo": "my:navigate", "sendValue": "detail.url" }
    },
    "consumes": { "store":      { "call": "adoptStore" } },   // adopt by calling a registered handler
    "accepts":  { "navigation": { "onElement": "other-viewer", "applyValueTo": "src", "transform": "stripHash" } }  // adopt by setting an attr
  }
}
```

- A **provider** declares its source: `{ service, sendValue }` (a registered service) or
  `{ respondTo, sendValue }` (a DOM CustomEvent; `respondTo` may be a list). `sendValue`
  dot-walks into the value. An optional `priority` (default 0) ranks it when several
  libraries provide the same key.
- A **consumer** declares a **registered handler** name (`call`). The library registers it:
  ```js
  ComponentInterop.registerConsumer('adoptStore', (graph) => myStore.use(graph));
  ```
  The broker invokes the registered function — never an arbitrary string — so it stays ignorant of
  any library's actual API. An optional `from: "<lib>"` names a preferred provider.
- The **resource** channel keeps one current resource: any library's `emits` sets it; the broker
  applies it to every other library's `accepts`.

## Composing multiple libraries

The broker is N-library by design — list more manifests and bundles; it pairs every `consumes` with
a provider in **any** other library, and the `resource` channel + shared `services` registry are
page-wide, so all of them share one store/session/current-resource with no per-pair glue:

```html
<script src="component-interop.js"
        data-manifest="lib-a.manifest.json lib-b.manifest.json lib-c.manifest.json"
        data-components="lib-a lib-b lib-c"
        data-prefer='{"rdf":"lib-b"}'></script>
```

Conventions that make N libraries coherent:

1. **Externalize shared deps.** Common deps (rdflib, …) dedupe to one instance via the importmap's
   first-wins rule — but only if libraries resolve them through the importmap rather than inlining
   their own copy. A library that bundles its own copy gets a second instance and breaks single-store
   coherence.
2. **Agree on capability names.** Pairing is by capability *name* — `consumes.rdf` pairs with
   another library's `provides.rdf`. Across ecosystems either agree on names or ship a tiny
   **descriptor manifest** mapping a library's terms to the shared ones (see `examples/solpos/`,
   which describes PodOS in ~14 lines).
3. **Choose among multiple providers** when two libraries provide the same capability. The broker
   picks one in this order: **`data-prefer`** (a JSON map `capability → library`, the page/app's
   call) → the consumer's **`from`** → highest provider **`priority`** → earliest in manifest order.
   See `examples/multi-provider/`.
4. **Namespace global names.** `registerConsumer` handler names and `data-handler` values are
   page-global — prefix them (`libA.adoptStore`) so two libraries don't collide.
5. **Cross-origin libraries.** `data-manifest` URLs must be same-origin (they name modules the loader
   `import()`s), but the import *targets inside* a manifest may be cross-origin (a CDN). So for
   libraries on different origins, ship a small **local descriptor manifest** per library that maps
   its modules to its CDN — again, the `examples/solpos/` pattern.

## `data-*` attributes (`data-base`, `data-stage`, …)

- `data-components` — components/bundles to `import()` (or `*` for every component)
- `data-stage` — `local` (default) | `cdn` — picks `stages.<stage>` (`components` + `shared-modules`)
- `data-manifest` — extra **same-origin** manifest URLs (merged after the default; resolved against
  the page)
- `data-manifest-default="off"` — skip the default sibling `<basename>.manifest.json`
- `data-importmap-extra` — inline importmap JSON (manifest entries win on conflict)
- `data-base` — base URL for resolving `data-manifest` paths
- `data-prefer` — JSON map `key → preferred provider library`, for multi-library pages

(There is no `data-extend-with` — attributes auto-load when their `data-*` appears on the page.)

## The `data-handler` attribute (any element calls a component or script)

A built-in attribute that lets **any** element — a library's own button/menu, a plain link —
activate a component or a script. ci does the **wiring only**; it never decides placement. ci's own
manifest maps `data-handler` → `./handler.js`, so it **auto-loads** the moment a `data-handler`
appears — nothing to opt into:

```html
<script src="component-interop.js"></script>
```

Mark any element with `data-handler` (no JS on the element — ci delegates the click/Enter):

```html
<a data-handler="my-viewer" href="report.ttl" data-mode="compact">Open</a>   <!-- a component -->
<button data-handler="exportCsv" data-format="utf8">Export</button>          <!-- a script -->
```

On activation ci collects the element's payload (`href` + `data-*`, prefix stripped), and **if the
handler names a custom-element tag** (`includes('-')` or registered) instantiates it with the
payload forwarded as attributes. Then it fires **one** event from the source element:

```js
e.detail = {
  handler: "my-viewer",       // the data-handler value
  element: <my-viewer …>,     // the instance ci built — or null for a bare-name (script) handler
  data:    { href:"report.ttl", mode:"compact" },
  source:  <a data-handler…>  // the element activated
}
```

The **entire** consumer burden is one listener that decides what/where:

```js
document.addEventListener('interop:activate', (e) => {
  const { handler, element, data, source } = e.detail;
  if (element) source.closest('.pane').querySelector('.output').replaceChildren(element); // place it
  else if (handler === 'exportCsv') exportTheTable(data);                                 // run it
});
```

ci makes no placement decisions and adds no modal/region machinery — `interop:activate` is the
single path. See `examples/handler/`.

## API (`window.ComponentInterop`)

`ready` (Promise) · `load(bundles, {with})` · `manifest` · `loaded` · `version` ·
`registerCapability(name, {modules, attributes})` · `registerConsumer(name, fn)` ·
`services` (register / get / has / names / whenReady) · `has(name)` · `capabilities` ·
`on(name, fn)` · `emit(name, detail)`. Events: `interop:ready`, `interop:capability` (per
capability), `interop:wired` (per provide→consume binding), `interop:activate` (per `data-handler`
activation).

## Security

`data-manifest` URLs must be **same-origin** (they name modules the loader will `import()`); the
default sibling manifest is trusted even cross-origin. Consumer handlers are invoked from a
library-provided **registry**, never `eval`'d from a manifest string.

## Examples

- `examples/basic/` — two toy libraries (`lib-a` provides a greeting, `lib-b` consumes it) wired by
  the broker. Zero dependencies, no glue. Serve the folder and open `examples/basic/index.html`.
- `examples/handler/` — the `handler` capability: a plain link/button with `data-handler` activates
  a component (ci instantiates it) or a script, and one `interop:activate` listener places the result.
- `examples/multi-provider/` — two libraries provide the same capability; `data-prefer` chooses which
  one the consumer adopts (the multi-provider preference rule).
- `examples/solpos/` — two real libraries, [Solid Web Components](https://github.com/jeff-zucker/solid-web-components)
  and [PodOS](https://github.com/pod-os/PodOS), working together on one page: browse a pod in one and
  the other follows, and a PodOS page gaining SPARQL from an swc capability. (Needs the swc working
  tree served alongside; see that folder's README.)
  
## Transparency

Portions created using Claude Opus 4.8.

## License

MIT © Jeff Zucker, 2026
