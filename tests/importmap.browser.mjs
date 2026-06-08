// Real-browser regression test for the importmap-timing bug, across all three
// Playwright engines (Chromium, Firefox, WebKit).
//
// component-interop builds an importmap from the manifests and must inject it
// SYNCHRONOUSLY, inside the loader's blocking <head> script, before any module
// load starts. Firefox rejects an importmap added after a module load has begun
// ("Import maps are not allowed after a module load or preload has started") — it is
// the only engine that does, so it is the regression tripwire. Chromium and WebKit
// are both lenient and would mask the bug; we run all three to prove the loader works
// everywhere, and rely on Firefox to fail if injection ever regresses to async.
//
// Kept out of the default `npm test` (the node suite stays zero-dep): the file name
// has no `.test.` segment, so it is only run via `npm run test:browsers`, which needs
// `npm i -D playwright && npx playwright install`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');   // repo root → serves /component-interop.js

let pw = null;
try { pw = await import('playwright'); } catch { /* not installed → tests skip */ }

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

async function withServer(fn) {
  const server = staticServer(ROOT);
  await new Promise((r) => server.listen(0, r));
  try { return await fn(`http://localhost:${server.address().port}`); }
  finally { await new Promise((r) => server.close(r)); }
}

async function checkEngine(t, launcher) {
  let browser;
  try { browser = await launcher.launch(); }
  catch (e) { t.skip('browser binary unavailable — run `npx playwright install`: ' + e.message); return; }
  try {
    await withServer(async (base) => {
      const page = await browser.newPage();
      const messages = [];
      page.on('console', (m) => messages.push(m.text()));
      page.on('pageerror', (e) => messages.push(String(e)));

      await page.goto(`${base}/tests/fixtures/importmap.html`, { waitUntil: 'load' });
      await page.waitForFunction(
        () => window.ComponentInterop && Array.isArray(window.ComponentInterop.loaded),
        { timeout: 5000 },
      ).catch(() => {});

      const state = await page.evaluate(() => ({
        widgetLoaded: window.__widgetLoaded === true,
        pageModuleRan: window.__pageModuleRan === true,
        hasMap: !!document.querySelector('script[type="importmap"]'),
      }));

      assert.ok(
        !messages.some((m) => /import maps are not allowed/i.test(m)),
        'engine emitted "import maps are not allowed" — the map was injected too late:\n' + messages.join('\n'),
      );
      assert.ok(
        !messages.some((m) => /was a bare specifier, but was not remapped/i.test(m)),
        'a bare specifier failed to resolve:\n' + messages.join('\n'),
      );
      assert.ok(state.hasMap, 'ci injected a <script type="importmap">');
      assert.ok(state.pageModuleRan, 'the page module script ran (it is what would have locked a late map)');
      assert.ok(state.widgetLoaded, 'the bare specifier "interop-widget" resolved and the module loaded');
    });
  } finally {
    await browser.close();
  }
}

for (const engine of ['chromium', 'firefox', 'webkit']) {
  test(`${engine}: ci injects the importmap before any module load; bare specifier resolves`, {
    skip: pw ? false : 'playwright not installed — run `npm i -D playwright && npx playwright install`',
  }, (t) => checkEngine(t, pw[engine]));
}
