# solpos — component-interop letting PodOS use Solid Web Components

These pages show **component-interop** loading two separate web-component libraries —
**Solid Web Components** (swc) and **PodOS** — on one page, with no glue code.

## The whole model

A manifest's **offerings** — what you read to *use* a library:

- **components** — elements you place (a name → a URL). A page loads them with
  `data-components="…"` (or `"*"` for all of them).
- **attributes** — a `data-*` you use; ci loads its module(s) when the page **names it in
  `data-attributes`** and **uses it** in the DOM. Either alone loads nothing.
- **objects** — a value one library shares: it `provides` the value, and another
  `consumes` it (calls a handler) or `accepts` it (sets a DOM attribute). Matched by
  key, so **neither library imports the other** — and the page opts in per key with
  `data-objects="…"`, so nothing cross-wires unless the page names it.

Its **plumbing** — only a co-author wiring shared deps reads these:

- **shared-modules** — deps a library externalizes by name so peers dedupe (above all
  `rdflib` — the shared store). A group of modules that loads as one unit is a
  **barrel module** (a JS file importing its constituents, e.g. sol-components'
  `rdf-bundle`), named here like any other module.

```json
{
  "components": { "my-el": "./my-el.js" },                       // place an element
  "attributes": { "data-edit-shape": { "module": "sol-components/core/rdf-bundle.js" } },  // a data-* → its module(s)
  "objects": {                                                   // share a value
    "provides": { "store": { "service": "rdf", "sendValue": "store" } },
    "consumes": { "store": { "call": "useStore" } }
  }
}
```

From the page author's seat the script tag names everything the page draws from the libraries —
components (`data-components`), attributes (`data-attributes`), and shared objects (`data-objects`);
the rest is the libraries' manifests declaring what they offer. **Nothing ci activates that the tag
doesn't name**, so the tag is a full inventory of what loads and what cross-wires.

## The tabs

`index.html` is a tabbed shell (its tab bar is itself component-interop's `data-handler`
attribute, opted into with `data-attributes="data-handler"`). Each tab is one focused demo in an
iframe; every page's top-right
**"View code"** opens a full-page panel showing that page **plus the manifest slice** that
wires it. Each demo is some mix of the offerings:

| tab | what loads | objects (share a value) |
|-----|-----------|---------------|
| **Shared Navigation** | `data-objects="navigation"` + `sol-pod` + PodOS | the current resource URL — swc `provides` `navigation` (`sol-navigate`) → PodOS `accepts` it (`pos-resource@uri`) |
| **Shared Store** | `data-objects="store:pod-os"` + PodOS | the RDF store — PodOS `provides` `store` (`internalStore`) → swc `consumes` it (`rdf.useStore`); the `:pod-os` host names PodOS as the shared store. swc's `.store` **is** PodOS's, same object, read live with `data-from-query` |
| **Auto-generated Forms** | `data-attributes="data-edit-shape"` (loads `rdf-bundle`) | — (a plain `<div>` + `data-edit-shape` becomes a shape-driven editor) |
| **Shared SPARQL / live store** | `data-attributes="data-from-query"` | — (`data-from-query` on a plain `<ul>`: SPARQL with an `endpoint`, or a no-`endpoint` triple `pattern` that reads the shared store **live**) |
| **Shared Auth** | `data-objects="auth:pod-os"` + PodOS's `<pos-login>` | the authenticated `fetch` (the sign-in session) — **PodOS** owns the login; PodOS `provides` `auth` (`authenticatedFetch`) → swc `consumes` it (`adoptFetch`), so swc's `<sol-include>` reads `/private/` with PodOS's session and no `<sol-login>` is present |

So **Forms** and **SPARQL** are pure *attributes* — a PodOS page gains a swc behaviour by naming
the `data-*` in `data-attributes` and using it, and ci loads the code. **Navigation**, **Store**,
and **Auth** also share an *object*, so each names its key in `data-objects` to opt in.

## Run them

The pages reach into a sibling `sol-components/` checkout, so serve the folder
that contains **both** `component-interop/` and `sol-components/`:

```
python3 -m http.server 8080
```

Then open `http://localhost:8080/component-interop/examples/solpos/` (or any single
page directly, e.g. `…/solpos/query.html`).

## Two caveats

- **Shared Navigation is one-way** (swc drives → PodOS follows). The interop
  channel is actually two-way (both libraries declare `provides` + `accepts` for
  `navigation`, verified with synthetic events), but the *reverse* needs the host
  app's **router**: PodOS's `<pos-resource>` only reloads on a `uri` change and a
  full PodOS app supplies that via page-level routing. Embedded here without a
  router, a click in the PodOS panel never re-points `pos-resource` or emits
  `pod-os:resource-loaded`, so there's nothing to mirror back — a PodOS routing
  limitation, not an interop one. (Details:
  `../../claude/investigations/two-way-resource-channel.md`.)
- **Auth flows PodOS → swc, not the other way.** In **Shared Auth**, PodOS owns the
  login and *provides* its `authenticatedFetch`, which swc *adopts* via `adoptFetch` (its
  fetch resolver honors a foreign fetch) — so a swc component reads `/private/` on PodOS's
  session. The reverse (swc's `<sol-login>` sharing *to* PodOS) isn't possible: PodOS
  exposes no hook to adopt an outside fetch. component-interop wires what a library
  *declares* — it can't reach past an API a library doesn't offer.
