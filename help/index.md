
# component-interop

A **zero-dependency, manifest-driven capability broker for web components.** It lets
independently-authored component libraries share a store, a session, and capabilities — and
coordinate navigation — **without importing each other and without page glue code.**

Each library ships (or is described by) a small JSON **manifest** declaring what it *provides* and
*consumes*. One `<script>` tag names everything the page draws from those libraries — components
(`data-components`), shared objects (`data-objects`), and attributes (`data-attributes`) — and the
broker pairs each opted-in consumer with a provider in another library. The result is plain custom
elements that interoperate.

**The opt-in invariant:** nothing ci activates that the script tag doesn't name. Load as many
manifests as you like; until the page names a capability, it stays dormant — so the tag is the
complete inventory of what the page uses and what cross-wires.

## Install / use

```html
<script src="component-interop.js"
        data-stage="local"
        data-components="my-widgets"
        data-manifest="other-lib.manifest.json"></script>
```

It is a classic script (no build step needed), exposes `window.ComponentInterop`, and has **no
runtime dependencies**. Load it as a **plain blocking `<script>` in `<head>`** — not `async`,
`defer`, or `type="module"`. It reads the manifests and injects its importmap synchronously,
before the parser moves on, because an importmap added after any module load has started is
rejected (Firefox enforces this strictly; Chromium is lenient).

## What it does

A manifest's **offerings** — what you read to use a library — are **components** (elements
to place), **attributes** (a `data-*` you use), and **objects** (a value shared
library→library):

1. **components** — injects an importmap from the manifests' `components` +
   `shared-modules`, then `import()`s the `data-components` (or `"*"` for all).
2. **attributes** — a manifest-declared `data-*` loads its module(s) (or `bundle`) when the page
   **both** names it in `data-attributes` **and** uses it in the DOM. Named-but-unused loads
   nothing; used-but-unnamed loads nothing.
3. **objects** — pairs a library's `consumes`/`accepts` with another library's
   `provides` of the same key (the "adopt the other library's value" rule), but only for keys the
   page opts into with `data-objects="key …"`. No opt-in → no cross-wiring, even when both
   manifests declare the channel.
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
  "attributes": {                                     // a data-* → its module(s) or a bundle name (page opts in via data-attributes)
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
  applies it to every other library's `accepts` — for keys the page opted into via `data-objects`.

> **The dividing rule — exposing a value is data; adopting one is behavior.** A `provides` entry is
> just the broker reading a value and handing it out, so it lives entirely in the manifest (no code at
> all if you already fire the event). A `consumes` entry needs the one registered function, because
> integrating a foreign value into your own runtime is your logic. So a library makes a resource
> *offerable* with a manifest add, and *adoptable* with one function.

## Composing multiple libraries

The broker is N-library by design — list more manifests and bundles; it pairs every opted-in
`consumes` (the keys named in `data-objects`) with a provider in **any** other library, and the
`resource` channel + shared `services` registry are page-wide, so all of them share one
store/session/current-resource with no per-pair glue:

```html
<script src="component-interop.js"
        data-manifest="lib-a.manifest.json lib-b.manifest.json lib-c.manifest.json"
        data-components="lib-a lib-b lib-c"
        data-objects="rdf:lib-b navigation"></script>   <!-- rdf hosted by lib-b; navigation: no preference -->
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
   picks one in this order: the page's preference (**`data-prefer`**, a JSON map `capability →
   library`, or the **`key:provider`** inline host in `data-objects` like `store:pod-os` — an
   explicit `data-prefer` wins if both name a key) → the consumer's **`from`** → highest provider
   **`priority`** → earliest in manifest order.
   See `examples/multi-provider/`.
4. **Namespace global names.** `registerConsumer` handler names are
   page-global — prefix them (`libA.adoptStore`) so two libraries don't collide.
5. **Cross-origin libraries.** `data-manifest` URLs must be same-origin (they name modules the loader
   `import()`s), but the import *targets inside* a manifest may be cross-origin (a CDN). So for
   libraries on different origins, ship a small **local descriptor manifest** per library that maps
   its modules to its CDN — again, the `examples/solpos/` pattern.

## `data-*` attributes (`data-base`, `data-stage`, …)

- `data-components` — components/bundles to `import()` (or `*` for every component)
- `data-objects` — object-capability keys to opt into (wires `consumes`/`accepts`; also eager-loads a key's `module`). A token may name its host inline — `key:provider`, e.g. `store:pod-os` — which also sets the provider preference
- `data-attributes` — manifest `data-*` keys to opt into (a key loads only when named here **and** present in the DOM)
- `data-stage` — `local` (default) | `cdn` — picks `stages.<stage>` (`components` + `shared-modules`)
- `data-manifest` — extra **same-origin** manifest URLs (merged after the default; resolved against
  the page)
- `data-manifest-default="off"` — skip the default sibling `<basename>.manifest.json`
- `data-importmap-extra` — inline importmap JSON (manifest entries win on conflict)
- `data-base` — base URL for resolving `data-manifest` paths
- `data-prefer` — JSON map `key → preferred provider library`, for multi-library pages (wins over a `key:provider` inline host in `data-objects`)

(There is no `data-extend-with` — an attribute loads when it is named in `data-attributes` and used on the page.)

## API (`window.ComponentInterop`)

`ready` (Promise) · `load(bundles, {with})` · `manifest` · `loaded` · `version` ·
`registerCapability(name, {modules, attributes})` · `registerConsumer(name, fn)` ·
`services` (register / get / has / names / whenReady) · `has(name)` · `capabilities` ·
`on(name, fn)` · `emit(name, detail)`. Events: `interop:ready`, `interop:capability` (per
capability), `interop:wired` (per provide→consume binding).

## Security

`data-manifest` URLs must be **same-origin** (they name modules the loader will `import()`); the
default sibling manifest is trusted even cross-origin. Consumer handlers are invoked from a
library-provided **registry**, never `eval`'d from a manifest string.

## Examples

`examples/` is a live, runnable demo — a PodOS app gaining Solid Web Components capabilities, wired
entirely by the broker, no glue. Open **`examples/index.html`** (a tabbed shell): SPARQL on a plain
element, a shared store, shared navigation, auto-generated forms, and auth — each a swc capability
adopted by a PodOS page. It loads [sol-components](https://github.com/jeff-zucker/sol-components) and
[PodOS](https://github.com/pod-os/PodOS) from the CDN, so it runs from this repo alone.
