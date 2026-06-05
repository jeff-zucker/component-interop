// A toy component the demo's links activate. It just shows the attributes it was
// handed — the point is that component-interop instantiated it and forwarded the
// link's data; the component reads its OWN attributes and knows nothing about ci.
class DemoViewer extends HTMLElement {
  connectedCallback() {
    const href = this.getAttribute('href') || '(none)';
    const mode = this.getAttribute('mode') || 'default';
    this.style.cssText = 'display:block;padding:.75rem;border:1px solid #8ab;border-radius:6px;background:#f3f8ff';
    this.textContent = `demo-viewer — href="${href}", mode="${mode}"`;
  }
}
customElements.define('demo-viewer', DemoViewer);
