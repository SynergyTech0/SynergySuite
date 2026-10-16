const test = require('node:test');
const assert = require('node:assert');
const { renderPage } = require('../server/render');

const site = { name: 'Acme' };
const page = (...blocks) => ({ title: 'Home', blocks });

test('headings and text are escaped', () => {
  const html = renderPage(site, page(
    { type: 'heading', data: { text: '<script>alert(1)</script>' } },
    { type: 'text', data: { text: '<img src=x onerror=alert(1)>' } },
  ));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('a javascript: button URL is not emitted as-is', () => {
  const html = renderPage(site, page(
    { type: 'cta', data: { heading: 'Go', buttonText: 'Click', buttonUrl: 'javascript:alert(1)' } },
  ));
  assert.ok(!html.includes('href="javascript:'));
});

test('quotes in URLs cannot break out of the attribute', () => {
  const html = renderPage(site, page(
    { type: 'hero', data: { heading: 'Hi', buttonText: 'Go', buttonUrl: 'https://x.test/" onclick="alert(1)' } },
  ));
  assert.ok(!html.includes('" onclick="'));
});

test('**bold** becomes <strong> and _italic_ becomes <em>', () => {
  const html = renderPage(site, page({ type: 'text', data: { text: 'a **big** _deal_' } }));
  assert.ok(html.includes('a <strong>big</strong> <em>deal</em>'));
});

test('a page with no blocks still renders', () => {
  for (const p of [{ title: 'Empty', blocks: [] }, { title: 'No blocks' }]) {
    const html = renderPage(site, p);
    assert.match(html, /^<!doctype html>/);
    assert.ok(html.includes('</html>'));
  }
});

test('the page title falls back to the site name', () => {
  assert.ok(renderPage(site, { blocks: [] }).includes('<title>Acme</title>'));
});

test('the preview banner appears only with { preview: true }', () => {
  assert.ok(!renderPage(site, page()).includes('Preview — not published'));
  assert.ok(renderPage(site, page(), { preview: true }).includes('Preview — not published'));
});

test('form blocks embed the forms app', () => {
  const saved = process.env.SUITE_DOMAIN;
  try {
    delete process.env.SUITE_DOMAIN;
    assert.match(renderPage(site, page({ type: 'form', data: { slug: 'signup' } })), /src="http:\/\/localhost:\d+\/f\/signup"/);
    process.env.SUITE_DOMAIN = 'example.com';
    assert.ok(renderPage(site, page({ type: 'form', data: { slug: 'signup' } })).includes('src="https://forms.example.com/f/signup"'));
  } finally {
    if (saved === undefined) delete process.env.SUITE_DOMAIN; else process.env.SUITE_DOMAIN = saved;
  }
});
