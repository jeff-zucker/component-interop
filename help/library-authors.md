# Making your library shareable

A guide for component-library authors who want their library maximally shareable in
all directions. Ship one manifest next to your library; everything below is a manifest
entry, plus at most one registered function.

```jsonc
{
  "name": "my-lib",
  "components": { "my-widget": "./my-widget.js" },
  "attributes": { "data-my-thing": "./my-thing.js" },
  "objects": {
    "provides": { "store": { "service": "store", "sendValue": "graph" } },
    "consumes": { "store": { "call": "myLib.adoptStore" } }
  }
}
```

**The four directions:**

1. **Your components, placeable by any page** — list each element under `components`
   (name → module URL).
2. **Your `data-*` attributes, usable by any page** — list each under `attributes`;
   it loads only when the page opts in *and* uses it.
3. **Your values (store, auth, navigation…), adoptable by other libraries** — a
   `provides` entry, no code: point at a service you register or an event you already
   fire (`respondTo` + `sendValue`).
4. **Other libraries' values, adopted by you** — a `consumes` entry plus one function:
   ```js
   ComponentInterop.registerConsumer('myLib.adoptStore', g => myStore.use(g));
   ```
   (or, codeless, an `accepts` entry that sets an attribute on your element).

**Three habits that keep it shareable:**

- **Use the shared capability names** (`store`, `auth`, `navigation`, `resource`) —
  pairing is by name, so matching names means zero adapter work for everyone else.
- **Prefix registered names** (`myLib.adoptStore`) — handler and service registries
  are page-global.
- **Don't privately bundle shared deps** (rdflib, …) — a second instance breaks
  single-store coherence; reference the shared one.

And serve the manifest and modules with CORS headers, so pages on any origin can use
your library directly.

That's the whole contract: one JSON file makes you offerable in three directions; one
registered function per foreign value makes you adoptive in the fourth.

## What a user gains — and what each gain costs

A value never crosses libraries automatically: one side must *provide* it and the
other must *adopt* it, and adopting store or auth always takes code (`consumes` plus
one registered function) in the adopting library. What a "maximally sharing" partner
brings is its offerings plus that adopting code, already written. Pairing your library
with such a partner, the user gets:

1. **Your library has no manifest at all** (none anywhere, by anyone): it is invisible
   to the broker. The user can still place the partner's components and `data-*`
   attributes on the same page as yours — but nothing crosses: separate stores,
   separate logins, no linked navigation.
2. **Sharing** — each channel is one manifest entry plus one hook, and your library
   may already have the hook:

   * **Others can share your store or auth** — fire an event (or register a service)
     carrying the value; a `provides` entry points at it.
     `"provides": { "store": { "respondTo": "my:loaded", "sendValue": "detail.store" } }`
   * **Your components can share others' store or auth** — write and register one
     function that swaps the foreign value in for your own; a `consumes` entry names it.
     `"consumes": { "store": { "call": "myLib.useStore" } }` +
     `ComponentInterop.registerConsumer('myLib.useStore', g => …)`
   * **Others can share your navigation** — fire an event carrying the URL when the
     user navigates; a `provides` entry points at it.
     `"provides": { "navigation": { "respondTo": "my:navigate", "sendValue": "detail.url" } }`
   * **Your components can share others' navigation** — give your viewer element an
     attribute that takes the resource URL; an `accepts` entry names element and
     attribute. No function needed.
     `"accepts": { "navigation": { "onElement": "my-viewer", "applyValueTo": "src" } }`


The live demos: PodOS already fired events carrying its store and authenticated fetch,
and its `pos-resource` element takes a `uri` attribute — so a ~14-line descriptor
(`examples/pod-os.manifest.json`) activated values-out and navigation-in with PodOS
unmodified. The values-in code lives on the sol-components side (`consumes` +
registered functions).

## Store, auth, navigation — the exact recipe

The shared values are: **store** = the one graph instance, **auth** = an authenticated
`fetch`, **navigation** = the current resource URL. (The page activates each with
`data-objects="store auth navigation"`.)

**To provide** — manifest only, no code if you already fire an event or register a
service:

```jsonc
"provides": {
  "store":      { "service": "rdf",        "sendValue": "store" },              // from a service you register
  "auth":       { "respondTo": "my:loaded", "sendValue": "detail.authedFetch" }, // or from an event you fire
  "navigation": { "respondTo": "my:navigate", "sendValue": "detail.url" }
}
```

For the `service` form, register it once at startup:
`ComponentInterop.services.register('rdf', myRdfService)`.

**To use** — store and auth take a `consumes` entry plus one registered function each;
`module` names the file that registers it (ci loads it when the key is opted in):

```jsonc
"consumes": {
  "store": { "call": "myLib.useStore",   "module": "./core/rdf.js" },
  "auth":  { "call": "myLib.adoptFetch", "module": "./core/services.js" }
}
```
```js
ComponentInterop.registerConsumer('myLib.useStore',   graph => /* swap in the shared graph */);
ComponentInterop.registerConsumer('myLib.adoptFetch', fetch => /* use it for all requests */);
```

**Navigation in** is codeless — declare which attribute on which element receives the
URL, and the broker sets it whenever another library navigates:

```jsonc
"accepts": {
  "navigation": { "onElement": "my-viewer", "applyValueTo": "src" }
}
```
