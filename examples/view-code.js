// view-code.js — the "View code" affordance for the solpos demos.
//
// Loaded by BOTH the tab shell (index.html) and each demo page. Two roles:
//  • In any document it defines window.solposViewCode(sections) — builds and opens
//    a tall, light-theme <dialog> in THAT document.
//  • If the page includes its OWN button (<button class="view-code-btn">) it WIRES it
//    (it never injects one — put the button in your HTML where you want it). On click
//    it opens the modal in the TOP-LEVEL shell (so it fills almost the whole window
//    height), falling back to the local document when the page is opened on its own.

(function () {
  // A <template> lets a page author the snippet as PLAIN HTML (inert, never rendered
  // or executed); read it back via innerHTML. A <pre> holds pre-escaped text.
  function trim(el) {
    if (!el) return '';
    var raw = (el.tagName === 'TEMPLATE') ? el.innerHTML : el.textContent;
    return raw.replace(/^\n+|\s+$/g, '');
  }

  function ensureStyle(doc) {
    if (doc.getElementById('view-code-style')) return;
    var style = doc.createElement('style');
    style.id = 'view-code-style';
    style.textContent = `
      .view-code-btn { font: inherit; font-size: .85rem; padding: .35rem .75rem; cursor: pointer;
        border: 1px solid #b9ccea; border-radius: 6px; background: #eef4ff; color: #1a3a6b; }
      .view-code-btn:focus-visible { outline: 2px solid #2a5db0; outline-offset: 2px; }
      dialog.view-code-dialog { width: min(72rem, 95vw); height: 94vh; max-height: 94vh;
        padding: 0; border: 1px solid #d0d7de; border-radius: 10px; background: #fff; color: #1a1a1a;
        box-shadow: 0 14px 44px rgba(20,24,31,.30); overflow: hidden; }
      dialog.view-code-dialog::backdrop { background: rgba(20,24,31,.5); }
      .view-code-frame { display: flex; flex-direction: column; height: 100%; }
      .view-code-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
        gap: 1rem; padding: .75rem 1rem; border-bottom: 1px solid #e2e6ea; background: #f6f8fa; }
      .view-code-head strong { font-size: 1rem; font-weight: 600; }
      .view-code-close { font: inherit; cursor: pointer; color: #1a1a1a; background: #fff;
        border: 1px solid #d0d7de; border-radius: 6px; padding: .25rem .6rem; line-height: 1; }
      .view-code-close:focus-visible { outline: 2px solid #2a5db0; outline-offset: 1px; }
      .view-code-body { flex: 1 1 auto; overflow: auto; padding: .5rem 1rem 1rem; }
      .view-code-label { font-size: .82rem; font-weight: 600; color: #57606a; margin: 1.1rem 0 .4rem; }
      .view-code-label .note { font-weight: 400; color: #8a93a0; }
      .view-code-body pre { margin: 0; }
      .view-code-body code, .view-code-body xmp { display: block; background: #f6f8fa; color: #1a1a1a;
        border: 1px solid #e2e6ea; border-radius: 8px; padding: 1rem 1.1rem; margin: .5rem 0 1rem;
        font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        white-space: pre; overflow-x: auto; }
      .view-code-body h1, .view-code-body h2, .view-code-body h3 { font-size: 1rem; margin: 1.2rem 0 .4rem; }
      .view-code-body :is(h1,h2,h3):first-child { margin-top: .3rem; }
      .view-code-body p { margin: 0 0 .8rem; }`;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function openModal(doc, content) {
    ensureStyle(doc);
    var prev = doc.getElementById('view-code-dialog');
    if (prev) prev.remove();

    var dialog = doc.createElement('dialog');
    dialog.className = 'view-code-dialog';
    dialog.id = 'view-code-dialog';
    dialog.setAttribute('aria-labelledby', 'view-code-title');

    var frame = doc.createElement('div');
    frame.className = 'view-code-frame';

    var head = doc.createElement('div');
    head.className = 'view-code-head';
    var title = doc.createElement('strong');
    title.id = 'view-code-title';
    // No heading text baked in here — a page supplies its own (see below).
    var close = doc.createElement('button');
    close.type = 'button';
    close.className = 'view-code-close';
    close.textContent = 'Close';
    close.setAttribute('aria-label', 'Close code');
    head.append(title, close);

    var body = doc.createElement('div');
    body.className = 'view-code-body';
    if (typeof content === 'string') {
      body.innerHTML = content;   // the page's own modal file — its HTML, its <xmp> code blocks
    } else {
      content.forEach(function (s) {   // legacy: array of { code } shown as code blocks
        var pre = doc.createElement('pre');
        var code = doc.createElement('code');
        code.textContent = s.code;
        pre.appendChild(code);
        body.appendChild(pre);
      });
    }

    frame.append(head, body);
    dialog.appendChild(frame);
    doc.body.appendChild(dialog);

    close.addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', function () { dialog.remove(); });

    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    return dialog;
  }

  // Expose so an iframe can open the modal in THIS (top-level) document. `content`
  // is either an HTML string (rendered as the modal body) or an array of {code}.
  window.solposViewCode = function (content) { return openModal(document, content); };

  // A page declares its modal content as a separate file it fully controls:
  //   <link rel="view-code" href="interop.modal.html">
  // That file is plain HTML — write any text around <xmp> blocks (each shows its
  // contents verbatim as code). On click we fetch it and render it in the modal.
  // (Legacy: a page with #demo-code [+ #demo-manifests] is shown as plain code blocks.)
  // The page puts the button in its OWN HTML, wherever it wants it:
  //   <button class="view-code-btn">View code</button>
  // We only WIRE it — never inject one.
  var link = document.querySelector('link[rel="view-code"]');
  var codeEl = document.getElementById('demo-code');
  var btn = document.querySelector('.view-code-btn');
  if (btn && (link || codeEl)) {
    ensureStyle(document);
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.addEventListener('click', function () {
      var host = (window.parent && window.parent !== window && typeof window.parent.solposViewCode === 'function')
        ? window.parent : window;
      if (link) {
        fetch(link.getAttribute('href')).then(function (r) { return r.text(); })
          .then(function (html) { host.solposViewCode(html); });
      } else {
        var sections = [{ code: trim(codeEl) }];
        var man = document.getElementById('demo-manifests');
        if (man) sections.push({ code: trim(man) });
        host.solposViewCode(sections);
      }
    });
  }
})();
