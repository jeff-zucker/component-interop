# solpos — component-interop letting PodOS use Solid Web Components

These pages show **component-interop** loading two separate web-component libraries —
**Solid Web Components** (swc) and **PodOS** — and letting a PodOS page *use* swc's
capabilities, with no glue code.

`index.html` is a **tabbed shell**. Its tab bar is itself component-interop's
`handler` capability (each tab is a `<button data-handler="…">`; one
`interop:activate` listener swaps the panel). Each tab loads one focused demo in an
iframe. Every demo page has a **"View code"** button (top-right) that reveals the
markup a PodOS app writes for that capability — a shared `view-code.js` renders each
page's hidden `#demo-code` snippet into an accessible panel. The five tabs:

- **Shared Navigation** (`navigation.html`) — swc's `<sol-pod>` browser drives;
  PodOS's `<pos-*>` follows the same current resource via the broker's *resource*
  channel (`sol-navigate` → `pos-resource@uri`). One-way today — the reverse
  (navigate in PodOS → swc follows) is a deferred investigation
  (`../../claude/investigations/two-way-resource-channel.md`).
- **Shared Store** (`store.html`) — the broker's *store* pairing: PodOS *provides*
  its rdflib graph (`pod-os:loaded` → `internalStore`) and swc *consumes* it
  (`rdf.useStore`), so swc's `rdf` service `.store` **is** PodOS's `internalStore`
  (one object, same triples). The page reports the live graph as swc sees it.
- **Auto-generated Forms** (`forms.html`) — `data-extend-with="rdf"`: a plain
  `<div>` next to a PodOS panel becomes an editor generated from a SHACL shape
  (`data-edit-shape` / `data-subject` / `data-edit-mode`) + `<sol-settings>`.
- **Query** (`query.html`) — `data-extend-with="sparql"`: a plain
  `<ul data-from-query …>` lists a folder with SPARQL on a PodOS page.
- **Shared Auth** (`auth.html`) — `data-extend-with="auth"`: sign in with swc's
  `<sol-login>` (pick an issuer), and the page reads your pod's `/private/` — swc's
  `<sol-include>` with the session (the reliable proof the login is shared) beside a
  PodOS `<pos-resource>` pointed at the same URL.

## Run them

The pages reach into a sibling `solid-web-components/` checkout, so serve the folder
that contains **both** `component-interop/` and `solid-web-components/`:

```
python3 -m http.server 8080
```

Then open `http://localhost:8080/component-interop/examples/solpos/` (or any single
page directly, e.g. `…/solpos/query.html`).

## A note on the Auth tab

PodOS's `<pos-app>` manages its own session and exposes no hook to adopt an outside
fetch, and swc's `<sol-login>` patches rdflib's `Fetcher` (not the global `fetch`).
So the swc `<sol-include>` is the dependable demonstration that the session is
shared; the PodOS side may still use its own login. component-interop wires what a
library *declares* — it can't reach past an API a library doesn't offer.
