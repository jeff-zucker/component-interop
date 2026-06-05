// consumer — CONSUMES "greeting"; the broker wires ONE provider to this handler.
class GreetingBox extends HTMLElement {
  connectedCallback() { if (!this.textContent) this.textContent = '(nothing yet)'; }
}
customElements.define('greeting-box', GreetingBox);
window.ComponentInterop.registerConsumer('showGreeting', (name) => {
  const b = document.querySelector('greeting-box'); if (b) b.textContent = 'Got: ' + name;
});
