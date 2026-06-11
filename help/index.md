
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

> Library author? See [Making your library shareable](library-authors.md) — the
> manifest entries and one-function recipes for sharing in every direction.

## Install / use

```html
<script src="component-interop.js"
        data-manifest="my-lib.manifest.json other-lib.manifest.json"
        data-components="my-widget"
        data-objects="store"></script>
```

It is a classic script (no build step needed), exposes `window.ComponentInterop`, and has **no
runtime dependencies**. Load it as a **plain blocking `<script>` in `<head>`** — not `async`,
`defer`, or `type="module"`. It reads the manifests and brokers the libraries. (If a manifest also
supplies an import map, ci injects it synchronously before the parser moves on — see
[Using the manifest for import maps](#using-the-manifest-for-import-maps-optional) — because a map
added after any module load has started is rejected.)

## What it does

A manifest's **offerings** — what you read to use a library — are **components** (elements
to place), **attributes** (a `data-*` you use), and **objects** (a value shared
library→library):

1. **components** — `import()`s the modules named in `data-components` (or `"*"` for all). Each
   resolves against its manifest's URL if relative/absolute, or via an import map if a bare specifier.
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

Offerings (read these to use the library) — `components`, `attributes`, `objects`; `bundles` is a
logical module-grouping helper. (A manifest can ALSO carry an import map — `shared-modules`/`stages` —
but that's optional; see [Using the manifest for import maps](#using-the-manifest-for-import-maps-optional).)

```jsonc
{
  "name": "my-lib",                                   // library identity (required for sharing)
  "components":     { "my-widget": "./my-widget.js" },// placeable elements → module (URL or bare specifier)
  "bundles":        { "editing": ["solid-ui", "my-form"] }, // a logical module group
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

1. **Externalize shared deps.** Common deps (rdflib, …) must resolve to one instance — share a single
   resolved URL (via one import map; see [Using the manifest for import maps](#using-the-manifest-for-import-maps-optional))
   rather than each library inlining its own copy. A library that bundles its own copy gets a second
   instance and breaks single-store coherence.
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
5. **Cross-origin libraries.** `data-manifest` may point at a cross-origin manifest (it loads when
   that server sends CORS headers), and the modules a manifest names can be cross-origin too (a CDN).
   A small **local descriptor manifest** per library that maps its terms/modules is still handy for
   adapting a foreign library — the `examples/solpos/` pattern — but it's no longer required just to
   cross an origin.

## `data-*` attributes (`data-base`, `data-stage`, …)

- `data-components` — components/bundles to `import()` (or `*` for every component)
- `data-objects` — object-capability keys to opt into (wires `consumes`/`accepts`; also eager-loads a key's `module`). A token may name its host inline — `key:provider`, e.g. `store:pod-os` — which also sets the provider preference
- `data-attributes` — manifest `data-*` keys to opt into (a key loads only when named here **and** present in the DOM)
- `data-stage` — `local` | `cdn` | `auto` — picks `stages.<stage>` for the optional import map (see below)
- `data-manifest` — manifest URLs to merge (after the default; resolved against the page; cross-origin
  allowed when the server sends CORS)
- `data-manifest-default="off"` — skip the default sibling `<basename>.manifest.json`
- `data-importmap-extra` — inline importmap JSON (manifest entries win on conflict)
- `data-base` — base URL for resolving `data-manifest` paths
- `data-prefer` — JSON map `key → preferred provider library`, for multi-library pages (wins over a `key:provider` inline host in `data-objects`)

(There is no `data-extend-with` — an attribute loads when it is named in `data-attributes` and used on the page.)

## Using the manifest for import maps (optional)

Everything above works whether or not ci builds an import map: if a manifest references its modules by
**relative/absolute URL**, ci `import()`s them directly. A manifest can ALSO carry an import map, so
libraries reference their deps by **bare specifier** instead of hard-coding URLs:

```jsonc
{
  "name": "my-lib",
  "shared-modules": { "rdflib": "./vendor/rdflib.js" },   // externalized deps → URL
  "components":     { "my-widget": "./my-widget.js" },    // component URLs also feed the map
  "stages": {                                             // optional per-env URL sets, chosen by data-stage
    "local": { "shared-modules": { "rdflib": "./vendor/rdflib.js" } },
    "cdn":   { "shared-modules": { "rdflib": "https://esm.sh/rdflib" } }
  }
}
```

ci merges every manifest's entries **first-wins** into one `<script type="importmap">` and injects it
**synchronously, before any module loads** (a map added after a module load is rejected — Firefox
strict, Chromium lenient). `data-stage` (`local`|`cdn`|`auto` — `auto` = local on localhost/`file:`,
else cdn) picks the stage; `data-importmap-extra` adds inline entries. **If the page already owns an
`<script type="importmap">`, ci yields to it** and uses that instead.

**Why you'd want it:** bare specifiers stay location-flexible — swap dev↔CDN by editing only the
map/stage, not every manifest — and the union of every library's externalized deps is collected and
**deduped to one instance** automatically (one rdflib), instead of each app hand-authoring and
reconciling a map.

**When you don't need it:** reference modules by relative/absolute URL in the manifest and ci imports
them directly — no import map at all. (Bare *runtime* deps a library imports **internally** — its own
`import 'rdflib'` — still need *an* import map, ci's or a page-owned one, regardless; that part isn't
ci-specific.)

## API (`window.ComponentInterop`)

`ready` (Promise) · `load(bundles, {with})` · `manifest` · `loaded` · `version` ·
`registerCapability(name, {modules, attributes})` · `registerConsumer(name, fn)` ·
`services` (register / get / has / names / whenReady) · `has(name)` · `capabilities` ·
`on(name, fn)` · `emit(name, detail)`. Events: `interop:ready`, `interop:capability` (per
capability), `interop:wired` (per provide→consume binding).

## Security

A manifest names modules ci `import()`s, so point `data-manifest` only at manifests you trust — the
page author chooses them, and a cross-origin one loads only if that server sends CORS headers.
Consumer handlers are invoked from a library-provided **registry**, never `eval`'d from a manifest
string, so a manifest can name a handler but never supply code.

## Examples

`examples/` is a live, runnable demo — a PodOS app gaining Solid Web Components capabilities, wired
entirely by the broker, no glue. Open **`examples/index.html`** (a tabbed shell): SPARQL on a plain
element, a shared store, shared navigation, auto-generated forms, and auth — each a swc capability
adopted by a PodOS page. It loads [sol-components](https://github.com/jeff-zucker/sol-components) and
[PodOS](https://github.com/pod-os/PodOS) from the CDN, so it runs from this repo alone.
