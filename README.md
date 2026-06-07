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

### Check out  the [demo](examples/index.html)!

### Visit the [documentation](help/index.md)!

### Transparency

Portions created using Claude Opus 4.8.

### License

MIT © Jeff Zucker, 2026
