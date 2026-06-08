// Real-Firefox regression test for the importmap-timing bug.
//
// component-interop builds an importmap from the manifests and must inject it
// SYNCHRONOUSLY, inside the loader's blocking <head> script, before any module
// load starts. Firefox strictly rejects an importmap added after a module load
// has begun ("Import maps are not allowed after a module load or preload has
// started"); Chromium is lenient and masks the bug — so this guard runs Firefox.
//
// Kept out of the default `npm test` (the node suite stays zero-dep): the file
// name has no `.test.` segment, so it is only run via `npm run test:firefox`,
// which needs `npm i -D playwright && npx playwright install firefox`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');   // repo root → serves /component-interop.js

let firefox = null;
try { ({ firefox } = await import('playwright')); } catch { /* not installed → test skips */ }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function staticServer(root) {
  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      const fp = path.join(root, decodeURIComponent(pathname));
      if (!fp.startsWith(root)) { res.writeHead(403).end(); return; }
      const body = await readFile(fp);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
}

test('Firefox: ci injects the importmap before any module load; bare specifier resolves', {
  skip: firefox ? false : 'playwright not installed — run `npm i -D playwright && npx playwright install firefox`',
}, async (t) => {
  const server = staticServer(ROOT);
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;

  let browser;
  try {
    try { browser = await firefox.launch(); }
    catch (e) { t.skip('Firefox binary unavailable — run `npx playwright install firefox`: ' + e.message); return; }

    const page = await browser.newPage();
    const messages = [];
    page.on('console', (m) => messages.push(m.text()));
    page.on('pageerror', (e) => messages.push(String(e)));

    await page.goto(`${base}/tests/fixtures/ff-importmap.html`, { waitUntil: 'load' });
    // Wait until ci finishes (or fails) loading the component.
    await page.waitForFunction(
      () => window.ComponentInterop && Array.isArray(window.ComponentInterop.loaded),
      { timeout: 5000 },
    ).catch(() => {});

    const state = await page.evaluate(() => ({
      widgetLoaded: window.__ffWidgetLoaded === true,
      pageModuleRan: window.__ffPageModuleRan === true,
      hasMap: !!document.querySelector('script[type="importmap"]'),
    }));

    // The smoking-gun Firefox warning the bug produced.
    assert.ok(
      !messages.some((m) => /import maps are not allowed/i.test(m)),
      'Firefox emitted "import maps are not allowed" — the map was injected too late:\n' + messages.join('\n'),
    );
    // No bare-specifier failure from the loader.
    assert.ok(
      !messages.some((m) => /was a bare specifier, but was not remapped/i.test(m)),
      'a bare specifier failed to resolve:\n' + messages.join('\n'),
    );
    assert.ok(state.hasMap, 'ci injected a <script type="importmap">');
    assert.ok(state.pageModuleRan, 'the page module script ran (it is what would have locked a late map)');
    assert.ok(state.widgetLoaded, 'the bare specifier "ff-widget" resolved and the module loaded in Firefox');
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
  }
});
