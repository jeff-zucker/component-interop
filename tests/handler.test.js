// tests/handler.test.js — the `handler` capability (handler.js).
//
// handler.js is an ES module that, on import, wires document-level click/keydown
// delegation to whatever the global `document` is at import time. So we set up one
// jsdom realm on globalThis BEFORE importing it, and use that same document for the
// whole file. (node --test runs each test file in its own process, so these globals
// don't leak into the other suites.)

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, requireJsdom } from './helpers.js';

let activate, isComponentTag, collectData, win, doc;

before(async () => {
  if (!JSDOM) return;
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' });
  win = dom.window;
  doc = win.document;
  // handler.js reads these as globals.
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.customElements = win.customElements;
  globalThis.CustomEvent = win.CustomEvent;
  ({ activate, isComponentTag, collectData } = await import('../handler.js'));
});

// ── isComponentTag ─────────────────────────────────────────────────────────────
test('isComponentTag: a hyphenated name is a custom-element tag', requireJsdom(), () => {
  assert.equal(isComponentTag('my-viewer'), true);
  assert.equal(isComponentTag('sol-table'), true);
});

test('isComponentTag: a bare name (no hyphen, unregistered) is not a component', requireJsdom(), () => {
  assert.equal(isComponentTag('exportCsv'), false);
  assert.equal(isComponentTag('div'), false);
});

test('isComponentTag: empty / missing name is false', requireJsdom(), () => {
  assert.equal(isComponentTag(''), false);
  assert.equal(isComponentTag(undefined), false);
});

// ── collectData ─────────────────────────────────────────────────────────────────
test('collectData: gathers href + data-* (stripped), excluding data-handler', requireJsdom(), () => {
  const a = doc.createElement('a');
  a.setAttribute('href', 'report.ttl');
  a.setAttribute('data-handler', 'my-viewer');
  a.setAttribute('data-mode', 'compact');
  a.setAttribute('data-format', 'utf8');
  assert.deepEqual(collectData(a), { href: 'report.ttl', mode: 'compact', format: 'utf8' });
});

test('collectData: no href key when the element has no href', requireJsdom(), () => {
  const b = doc.createElement('button');
  b.setAttribute('data-handler', 'exportCsv');
  b.setAttribute('data-format', 'utf8');
  const data = collectData(b);
  assert.deepEqual(data, { format: 'utf8' });
  assert.ok(!('href' in data));
});

// ── activate ─────────────────────────────────────────────────────────────────────
test('activate: a component handler instantiates the element and forwards attrs', requireJsdom(), () => {
  const a = doc.createElement('a');
  a.setAttribute('href', 'report.ttl');
  a.setAttribute('data-handler', 'my-viewer');
  a.setAttribute('data-mode', 'compact');

  let detail = null;
  a.addEventListener('interop:activate', (e) => { detail = e.detail; }, { once: true });
  activate(a);

  assert.ok(detail, 'interop:activate fired');
  assert.equal(detail.handler, 'my-viewer');
  assert.equal(detail.source, a);
  assert.deepEqual(detail.data, { href: 'report.ttl', mode: 'compact' });
  assert.ok(detail.element, 'a component element was created');
  assert.equal(detail.element.tagName.toLowerCase(), 'my-viewer');
  assert.equal(detail.element.getAttribute('href'), 'report.ttl');
  assert.equal(detail.element.getAttribute('mode'), 'compact');
});

test('activate: a bare-name (script) handler fires with element === null', requireJsdom(), () => {
  const b = doc.createElement('button');
  b.setAttribute('data-handler', 'exportCsv');
  b.setAttribute('data-format', 'utf8');

  let detail = null;
  b.addEventListener('interop:activate', (e) => { detail = e.detail; }, { once: true });
  activate(b);

  assert.ok(detail);
  assert.equal(detail.handler, 'exportCsv');
  assert.equal(detail.element, null);
  assert.deepEqual(detail.data, { format: 'utf8' });
});

test('activate: an element without data-handler is a no-op', requireJsdom(), () => {
  const div = doc.createElement('div');
  let fired = false;
  doc.addEventListener('interop:activate', () => { fired = true; }, { once: true });
  activate(div);
  assert.equal(fired, false);
});

// ── document-delegated click / keydown ──────────────────────────────────────────
test('click delegation: a click on [data-handler] fires interop:activate and is prevented', requireJsdom(), () => {
  const btn = doc.createElement('button');
  btn.setAttribute('data-handler', 'my-viewer');
  doc.body.appendChild(btn);

  let detail = null;
  doc.addEventListener('interop:activate', (e) => { detail = e.detail; }, { once: true });
  const ev = new win.MouseEvent('click', { bubbles: true, cancelable: true });
  btn.dispatchEvent(ev);

  assert.ok(detail, 'interop:activate fired from a real click');
  assert.equal(detail.handler, 'my-viewer');
  assert.equal(ev.defaultPrevented, true, 'default navigation/submit was prevented');
  btn.remove();
});

test('click delegation: bubbles up from a descendant of [data-handler]', requireJsdom(), () => {
  const a = doc.createElement('a');
  a.setAttribute('data-handler', 'my-viewer');
  const span = doc.createElement('span');
  a.appendChild(span);
  doc.body.appendChild(a);

  let detail = null;
  doc.addEventListener('interop:activate', (e) => { detail = e.detail; }, { once: true });
  span.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));

  assert.ok(detail, 'a click on a child still resolves to the [data-handler] ancestor');
  assert.equal(detail.source, a);
  a.remove();
});

test('keydown delegation: Enter and Space activate, other keys do not', requireJsdom(), () => {
  const btn = doc.createElement('button');
  btn.setAttribute('data-handler', 'exportCsv');
  doc.body.appendChild(btn);

  for (const key of ['Enter', ' ']) {
    let detail = null;
    doc.addEventListener('interop:activate', (e) => { detail = e.detail; }, { once: true });
    const ev = new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    btn.dispatchEvent(ev);
    assert.ok(detail, `key "${key}" activated`);
    assert.equal(ev.defaultPrevented, true);
  }

  let fired = false;
  doc.addEventListener('interop:activate', () => { fired = true; }, { once: true });
  btn.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
  assert.equal(fired, false, 'an ordinary key does not activate');
  btn.remove();
});

test('click delegation: a click off any [data-handler] is ignored', requireJsdom(), () => {
  const plain = doc.createElement('div');
  doc.body.appendChild(plain);
  let fired = false;
  doc.addEventListener('interop:activate', () => { fired = true; }, { once: true });
  plain.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(fired, false);
  plain.remove();
});
