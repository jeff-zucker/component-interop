// view-code.js — adds a top-right "View code" button to a solpos demo page that
// opens a centered, light-theme modal showing (1) the page a PodOS app author
// writes and (2) the manifests it points at — the declarations that actually wire
// the demo. Both live in the page as hidden <pre> blocks (HTML-escaped):
//   #demo-code       — required, the page markup
//   #demo-manifests  — optional, the manifest declarations behind it
// Native <dialog> (modal: focus-trapped, Esc, backdrop). Shared by all the demo
// pages so the button, behaviour and ARIA aren't duplicated.

const codeEl = document.getElementById('demo-code');
if (codeEl) {
  const trim = (el) => el ? el.textContent.replace(/^\n+|\s+$/g, '') : '';
  const manifestsEl = document.getElementById('demo-manifests');

  const style = document.createElement('style');
  style.textContent = `
    .view-code-btn { position: fixed; top: 1rem; right: 1rem; z-index: 20;
      font: inherit; font-size: .85rem; padding: .35rem .75rem; cursor: pointer;
      border: 1px solid #b9ccea; border-radius: 6px; background: #eef4ff; color: #1a3a6b; }
    .view-code-btn:focus-visible { outline: 2px solid #2a5db0; outline-offset: 2px; }

    dialog.view-code-dialog { width: min(64rem, 92vw); max-height: 86vh; padding: 0;
      border: 1px solid #d0d7de; border-radius: 10px; background: #ffffff; color: #1a1a1a;
      box-shadow: 0 14px 44px rgba(20,24,31,.30); overflow: hidden; }
    dialog.view-code-dialog::backdrop { background: rgba(20,24,31,.45); }
    .view-code-head { position: sticky; top: 0; display: flex; align-items: center;
      justify-content: space-between; gap: 1rem; padding: .75rem 1rem;
      border-bottom: 1px solid #e2e6ea; background: #f6f8fa; }
    .view-code-head strong { font-size: 1rem; font-weight: 600; }
    .view-code-close { font: inherit; cursor: pointer; color: #1a1a1a; background: #fff;
      border: 1px solid #d0d7de; border-radius: 6px; padding: .25rem .6rem; line-height: 1; }
    .view-code-close:focus-visible { outline: 2px solid #2a5db0; outline-offset: 1px; }
    .view-code-body { padding: .5rem 1rem 1rem; overflow: auto; max-height: calc(86vh - 3.4rem); }
    .view-code-label { font-size: .82rem; font-weight: 600; color: #57606a;
      margin: 1.1rem 0 .4rem; }
    .view-code-label .note { font-weight: 400; color: #8a93a0; }
    .view-code-body pre { margin: 0; }
    .view-code-body code { display: block; background: #f6f8fa; color: #1a1a1a;
      border: 1px solid #e2e6ea; border-radius: 8px; padding: 1rem 1.1rem;
      font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre; overflow-x: auto; }`;
  document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'view-code-btn';
  btn.id = 'view-code-btn';
  btn.textContent = 'View code';
  btn.setAttribute('aria-haspopup', 'dialog');

  const dialog = document.createElement('dialog');
  dialog.className = 'view-code-dialog';
  dialog.id = 'view-code-dialog';
  dialog.setAttribute('aria-labelledby', 'view-code-title');

  const head = document.createElement('div');
  head.className = 'view-code-head';
  const title = document.createElement('strong');
  title.id = 'view-code-title';
  title.textContent = manifestsEl ? 'How this demo is wired — page + manifests' : 'Code a PodOS app writes for this demo';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'view-code-close';
  close.textContent = 'Close';
  close.setAttribute('aria-label', 'Close code');
  head.append(title, close);

  const body = document.createElement('div');
  body.className = 'view-code-body';

  function section(labelHTML, text) {
    const label = document.createElement('p');
    label.className = 'view-code-label';
    label.innerHTML = labelHTML;
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = text;
    pre.appendChild(code);
    body.append(label, pre);
  }

  section('What the PodOS app writes <span class="note">— the page</span>', trim(codeEl));
  if (manifestsEl) {
    section('The manifests it points at <span class="note">— where the wiring lives, not your page</span>', trim(manifestsEl));
  }

  dialog.append(head, body);

  btn.addEventListener('click', () => { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  document.body.append(btn, dialog);
}
