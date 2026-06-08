// Loaded only if ci resolves the bare specifier "ff-widget" through the injected
// importmap. Setting the flag is how the Firefox browser test confirms resolution.
window.__ffWidgetLoaded = true;
customElements.define('ff-widget', class extends HTMLElement {
  connectedCallback() { this.textContent = 'ff-widget loaded'; }
});
