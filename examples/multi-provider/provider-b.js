// provider-b — ALSO provides "greeting", via a different event.
class ProviderB extends HTMLElement {
  connectedCallback() {
    this.innerHTML = '<button>Send from B</button>';
    this.querySelector('button').onclick = () =>
      document.dispatchEvent(new CustomEvent('b:hello', { detail: { name: 'Bob (via B)' } }));
  }
}
customElements.define('provider-b', ProviderB);
