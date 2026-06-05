// lib-b — a SEPARATE component library. It CONSUMES the "greeting" capability:
// it registers a consumer handler `showGreeting`, and its <greeting-box> displays
// whatever it receives. lib-b never imports lib-a; its manifest says it consumes
// "greeting" and the broker delivers lib-a's value to this handler.
class GreetingBox extends HTMLElement {
  connectedCallback() { if (!this.textContent) this.textContent = 'Hello, stranger (lib-b)'; }
}
customElements.define('greeting-box', GreetingBox);

window.ComponentInterop.registerConsumer('showGreeting', (name) => {
  const box = document.querySelector('greeting-box');
  if (box) box.textContent = name ? `Hello, ${name}! (lib-b)` : 'Hello, stranger (lib-b)';
});
