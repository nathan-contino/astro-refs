/**
 * remarkAstroRef behavior, and parity with the Sätteri plugin. Parity runs one
 * document through each pipeline and compares the parsed HTML, so serializer
 * differences don't count.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { fromHtml } from 'hast-util-from-html';
import { removePosition } from 'unist-util-remove-position';
import { markdownToHtml } from 'satteri';
import { remarkAstroRef } from '../index.mjs';
import { refs } from '../satteri.mjs';

const DOC = `# Guide

## Potatoes {potato-section}

See [the potato section](ref:potato-section), [the setup page](ref:setup), and
[a missing ref](ref:nope). A [normal link](/plain) is left alone.

- ### Nested heading {nested-ref}
- [ref in a list](ref:setup)

## No suffix here

## Escaped "quotes" & <stuff> {odd&"name}
`;

const newState = () => ({
  refMap: new Map([
    ['potato-section', { url: '/guide#potato-section' }],
    ['setup', { url: '/setup' }],
  ]),
  brokenRefs: [],
  duplicates: [],
});

async function viaUnified(state) {
  return String(await unified().use(remarkParse).use(remarkAstroRef, { state })
    .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeStringify, { allowDangerousHtml: true })
    .process(DOC));
}

async function viaSatteri(state) {
  const { html } = await markdownToHtml(DOC, { mdastPlugins: [refs({ state })], features: { smartPunctuation: false } });
  return html;
}

function tree(html) {
  const t = fromHtml(html, { fragment: true });
  removePosition(t, { force: true });
  const strip = (node) => {
    if (!node.children) return;
    node.children = node.children.filter(c => c.type !== 'text' || c.value.trim() !== '');
    node.children.forEach(strip);
  };
  strip(t);
  return t;
}

test('unified: resolves ref links, strips heading suffixes, inserts anchors', async () => {
  const state = newState();
  const html = await viaUnified(state);
  assert.ok(html.includes('href="/guide#potato-section"'));
  assert.ok(html.includes('href="/setup"'));
  assert.ok(html.includes('href="#"'), 'unknown ref falls back to #');
  assert.ok(html.includes('href="/plain"'));
  assert.ok(html.includes('<span id="potato-section" data-astro-refs="potato-section" aria-hidden="true" class="astro-refs"></span>\n<h2>Potatoes</h2>'));
  assert.ok(html.includes('<h3>Nested heading</h3>'));
  assert.ok(html.includes('id="odd&#x26;&#x22;name"') || html.includes('id="odd&amp;&quot;name"'));
  assert.deepEqual(state.brokenRefs, ['nope']);
});

test('satteri output matches unified output', async () => {
  const a = newState(), b = newState();
  assert.deepEqual(tree(await viaSatteri(b)), tree(await viaUnified(a)));
  assert.deepEqual(b.brokenRefs, a.brokenRefs);
});

test('integration: appends the satteri plugin to a satteri processor', async () => {
  const { default: astroRef } = await import('../index.mjs');
  const processor = { name: 'satteri', options: { mdastPlugins: [], hastPlugins: [], features: {} } };
  let updated;
  await astroRef({ collections: [{ src: 'src/content', base: '/' }] }).hooks['astro:config:setup']({
    config: { root: new URL('file:///tmp/'), markdown: { processor } },
    updateConfig: (c) => { updated = c; },
    logger: { warn() {} },
  });
  assert.equal(processor.options.mdastPlugins.length, 1);
  assert.equal(processor.options.mdastPlugins[0].name, 'astro-better-refs');
  assert.equal(updated.markdown, undefined, 'the satteri processor is kept, not replaced');
});

test('MDX: satteri output matches unified output', async () => {
  const { unifiedTree, satteriTree } = await import('./mdx-render.mjs');
  // MDX reads {braces} as expressions, so heading refs only apply to .md; links still resolve
  const source = DOC.replace(/ \{[^}]+\}$/gm, '').replace('<stuff>', '&lt;stuff&gt;');
  const a = newState(), b = newState();
  const ua = await unifiedTree(source, { remarkPlugins: [[remarkAstroRef, { state: a }]] });
  const sb = await satteriTree(source, { mdastPlugins: [refs({ state: b })] });
  assert.ok(JSON.stringify(ua).includes('"/setup"'));
  assert.deepEqual(sb, ua);
  assert.deepEqual(b.brokenRefs, a.brokenRefs);
});
