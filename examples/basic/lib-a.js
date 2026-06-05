// lib-a — an independent component library. It PROVIDES a "greeting" capability:
// its <name-input> emits a `liba:hello` event carrying a name. lib-a knows
// nothing about any consumer; its manifest declares the provide channel.
class NameInput extends HTMLElement {
  connectedCallback() {
    this.innerHTML = '<label>Your name (lib-a): <input placeholder="type here…"></label>';
    this.querySelector('input').addEventListener('input', (e) => {
      document.dispatchEvent(new CustomEvent('liba:hello', { detail: { name: e.target.value } }));
    });
  }
}
customElements.define('name-input', NameInput);
