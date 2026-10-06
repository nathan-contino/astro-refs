/**
 * Sätteri mdast plugin for astro-better-refs. Same transforms as the unified
 * `remarkAstroRef`:
 *
 *   [text](ref:name)            →  resolved URL from refMap, or '#' with broken-ref tracking
 *   ## Heading {ref-name}       →  strip suffix, insert invisible <span> before heading
 *
 * The astroRef integration adds this automatically when `markdown.processor`
 * is a Sätteri processor. Wire it yourself (with a shared `state`) to cover an
 * MDX processor as well:
 *
 *   import { refs } from 'astro-better-refs/satteri';
 *   satteri({ mdastPlugins: [refs({ state })] });
 */

import { anchorHtml, resolveRefUrl, splitHeadingRef } from './core.mjs';

// MDX can't hold html nodes, so parse into JSX there; braces in the HTML stay literal
const htmlContent = (ctx, html) => ctx.sourceFormat === 'mdx'
  ? { raw: html, mdxExpressions: false }
  : { type: 'html', value: html };

export function refs({ state }) {
  return {
    name: 'astro-better-refs',
    heading(node, ctx) {
      const last = node.children?.[node.children.length - 1];
      if (last?.type !== 'text') return;
      const split = splitHeadingRef(last.value);
      if (!split) return;
      ctx.setProperty(last, 'value', split.text);
      ctx.insertBefore(node, htmlContent(ctx, anchorHtml(split.refName)));
    },
    link(node, ctx) {
      const url = resolveRefUrl(state, node.url);
      if (url !== null) ctx.setProperty(node, 'url', url);
    },
  };
}
