// Loaded only if ci resolves the bare specifier "interop-widget" through the
// injected importmap. Setting the flag is how the browser tests confirm resolution.
window.__widgetLoaded = true;
customElements.define('interop-widget', class extends HTMLElement {
  connectedCallback() { this.textContent = 'interop-widget loaded'; }
});
