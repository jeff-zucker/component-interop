// provider-a — PROVIDES "greeting" via its own event.
class ProviderA extends HTMLElement {
  connectedCallback() {
    this.innerHTML = '<button>Send from A</button>';
    this.querySelector('button').onclick = () =>
      document.dispatchEvent(new CustomEvent('a:hello', { detail: { name: 'Alice (via A)' } }));
  }
}
customElements.define('provider-a', ProviderA);
