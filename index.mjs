/**
 * astro-better-refs
 *
 * Sphinx-style named refs for Astro. Declare an anchor anywhere in your content
 * and link to it by name from anywhere else in the site. Links stay valid even
 * when content moves, because the name travels with the content.
 *
 * Three ways to declare a ref:
 *
 *   1. Component — place an invisible anchor anywhere in prose or before a heading:
 *        <Ref id="my-anchor" />
 *
 *   2. Frontmatter — point a name at the top of the page (no fragment):
 *        ---
 *        ref: my-page-name
 *        ---
 *      Multiple aliases:
 *        ---
 *        refs:
 *          - my-page-name
 *          - legacy-name
 *        ---
 *
 *   3. Section heading — add {ref-name} to the end of any heading:
 *        ## Potatoes {my-potato-section}
 *      The suffix is stripped from the rendered heading; an invisible anchor
 *      is inserted just before the heading element.
 *
 * Link to any ref from anywhere in the site using the ref: URL scheme:
 *
 *   [See the potato section](ref:my-potato-section)
 *
 * Usage (astro.config.ts):
 *
 *   import astroRef from 'astro-better-refs';
 *   export default defineConfig({
 *     integrations: [
 *       astroRef({
 *         collections: [{ src: 'src/content/docs', base: '/docs' }],
 *       }),
 *     ],
 *   });
 *
 * Options:
 *   collections          {Array<{src, base}>}  source dirs and their URL bases (required)
 *   extensions           {string[]}            file extensions to scan (default: ['.md', '.mdx', '.astro'])
 *   failOnBrokenRefs     {boolean}             exit 1 on unresolved ref: links (default: true)
 *   failOnDuplicateRefs  {boolean}             exit 1 on duplicate ref names (default: true)
 *
 * Scroll offset:
 *   Set --astro-refs-scroll-offset on :root to match your sticky header height.
 *   The default is 80px.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { anchorHtml, resolveRefUrl, splitHeadingRef } from './core.mjs';
import { refs as satteriRefs } from './satteri.mjs';

// Walk a directory tree, collecting files whose names end with one of `extensions`.
async function walkFiles(dir, extensions) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return []; }
  const parts = await Promise.all(
    entries.map(e => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return walkFiles(p, extensions);
      return extensions.some(ext => e.name.endsWith(ext)) ? [p] : [];
    })
  );
  return parts.flat();
}

// Derive a root-relative URL path from an absolute source file path.
// Returns null if the file doesn't fall under any configured collection.
function fileToUrl(filePath, collections, rootDir) {
  for (const { src, base } of collections) {
    const srcAbs = join(rootDir, src);
    const prefix = srcAbs.endsWith(sep) ? srcAbs : srcAbs + sep;
    if (!filePath.startsWith(prefix)) continue;

    let rel = relative(srcAbs, filePath).replace(/\\/g, '/');
    rel = rel.replace(/\.(mdx?|astro)$/, '');
    if (rel === 'index') rel = '';
    else rel = rel.replace(/\/index$/, '');

    const urlBase = base.replace(/\/$/, '');
    return urlBase + (rel ? '/' + rel : '');
  }
  return null;
}

// Extract all ref declarations from a source file's text.
// Returns [{name, anchor}]:
//   anchor === name  →  URL will be pageUrl#name  (component or heading)
//   anchor === null  →  URL will be pageUrl        (frontmatter, page-level)
function extractRefs(text, filePath) {
  const refs = [];
  const isMd = filePath.endsWith('.md') || filePath.endsWith('.mdx');
  let m;

  // <Ref id="name" /> or <Ref id='name' /> — all file types
  const reComponent = /<Ref\s+id=(["'])([^"']+)\1/g;
  while ((m = reComponent.exec(text)) !== null) {
    refs.push({ name: m[2], anchor: m[2] });
  }

  if (isMd) {
    // YAML frontmatter: ref: name  or  refs: [n1, n2]  or  refs:\n  - n
    const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fmMatch) {
      const fm = fmMatch[1];

      const single = fm.match(/^ref:\s*["']?([^"'\r\n]+?)["']?\s*$/m);
      if (single) refs.push({ name: single[1].trim(), anchor: null });

      // inline list: refs: [a, b, c]
      const inline = fm.match(/^refs:\s*\[([^\]]+)\]/m);
      if (inline) {
        for (const item of inline[1].split(',')) {
          const name = item.trim().replace(/^["']|["']$/g, '');
          if (name) refs.push({ name, anchor: null });
        }
      }

      // block list:
      // refs:
      //   - name
      if (!inline) {
        const block = fm.match(/^refs:\s*\r?\n((?:[ \t]*-[ \t]+[^\r\n]+\r?\n?)+)/m);
        if (block) {
          for (const item of block[1].matchAll(/^[ \t]*-[ \t]+([^\r\n]+)/gm)) {
            refs.push({ name: item[1].trim().replace(/^["']|["']$/g, ''), anchor: null });
          }
        }
      }
    }

    // ## Heading {ref-name}
    const reHeading = /^#{1,6}[^\n]+\{([^}\n]+)\}/gm;
    while ((m = reHeading.exec(text)) !== null) {
      const name = m[1].trim();
      refs.push({ name, anchor: name });
    }
  }

  return refs;
}

// Scan all source files and build the ref map.
// Returns { refMap: Map<name, {url, file}>, duplicates: [{name, file1, file2}] }
async function buildRefMap(collections, rootDir, extensions) {
  const refMap = new Map();
  const duplicates = [];

  for (const collection of collections) {
    const srcAbs = join(rootDir, collection.src);
    const files = await walkFiles(srcAbs, extensions);

    await Promise.all(files.map(async file => {
      const pageUrl = fileToUrl(file, collections, rootDir);
      if (!pageUrl) return;

      let text;
      try { text = await readFile(file, 'utf-8'); }
      catch { return; }

      for (const { name, anchor } of extractRefs(text, file)) {
        const url = anchor ? `${pageUrl}#${anchor}` : pageUrl;
        if (refMap.has(name)) {
          duplicates.push({ name, file1: refMap.get(name).file, file2: file });
        } else {
          refMap.set(name, { url, file });
        }
      }
    }));
  }

  return { refMap, duplicates };
}

// Remark plugin that transforms the Markdown/MDX AST:
//
//   [text](ref:name)            →  resolved URL from refMap, or '#' with broken-ref tracking
//   ## Heading {ref-name}       →  strip suffix, insert invisible <span> before heading
function remarkAstroRef({ state }) {
  return tree => {
    const inserts = []; // {parent, index, node} — applied after the walk

    function walk(node, parent, index) {
      // Heading with {ref-name} suffix on its last text child.
      if (node.type === 'heading') {
        const last = node.children?.[node.children.length - 1];
        if (last?.type === 'text') {
          const split = splitHeadingRef(last.value);
          if (split) {
            last.value = split.text;
            inserts.push({ parent, index, node: { type: 'html', value: anchorHtml(split.refName) } });
          }
        }
      }

      // ref: URL scheme on links.
      if (node.type === 'link') {
        const url = resolveRefUrl(state, node.url);
        if (url !== null) node.url = url;
      }

      if (Array.isArray(node.children)) {
        for (let i = 0; i < node.children.length; i++) {
          walk(node.children[i], node, i);
        }
      }
    }

    walk(tree, null, -1);

    // Insert heading anchors in reverse index order so earlier insertions
    // don't shift the indices of later ones.
    inserts.sort((a, b) => b.index - a.index);
    for (const { parent, index, node } of inserts) {
      if (parent?.children) parent.children.splice(index, 0, node);
    }
  };
}

export { remarkAstroRef };

export default function astroRef(opts = {}) {
  const {
    collections          = [],
    extensions           = ['.md', '.mdx', '.astro'],
    failOnBrokenRefs     = true,
    failOnDuplicateRefs  = true,
    _exit                = process.exit,
    state: externalState = null,
  } = opts;

  const state = externalState ?? {
    refMap:     null,
    brokenRefs: [],
    duplicates: [],
  };

  return {
    name: 'astro-better-refs',
    hooks: {
      'astro:config:setup': async ({ config, updateConfig, logger }) => {
        const rootDir = config.root instanceof URL
          ? fileURLToPath(config.root)
          : String(config.root ?? '.');

        if (!collections.length) {
          (logger ?? console).warn('[astro-better-refs] no collections configured — no refs will be scanned');
        }

        let scanned = false;
        const vitePlugin = {
          name: 'astro-better-refs-scanner',
          async buildStart() {
            if (scanned || !collections.length) return;
            scanned = true;
            const result = await buildRefMap(collections, rootDir, extensions);
            state.refMap     = result.refMap;
            state.duplicates = result.duplicates;
          },
        };

        // Astro 7 requires markdown.processor instead of markdown.remarkPlugins
        let unifiedFn, isUnifiedProcessor;
        try {
          const { createRequire } = await import('node:module');
          const req = createRequire(config.root);
          const modPath = req.resolve('@astrojs/markdown-remark');
          ({ unified: unifiedFn, isUnifiedProcessor } = await import(modPath));
        } catch {
          unifiedFn = null;
        }

        if (externalState) {
          // caller wires remarkAstroRef manually (e.g. to cover both markdown and mdx processors)
          updateConfig({ vite: { plugins: [vitePlugin] } });
        } else if (config.markdown?.processor?.name === 'satteri') {
          // Sätteri processors keep their options mutable for integrations to extend
          config.markdown.processor.options.mdastPlugins.push(satteriRefs({ state }));
          updateConfig({ vite: { plugins: [vitePlugin] } });
        } else if (unifiedFn) {
          const existing = config.markdown?.processor;
          const base = (existing && isUnifiedProcessor(existing)) ? existing.options : null;
          const processor = unifiedFn({
            remarkPlugins: [...(base?.remarkPlugins ?? []), [remarkAstroRef, { state }]],
            rehypePlugins: base?.rehypePlugins ?? [],
            remarkRehype: base?.remarkRehype ?? {},
            gfm: base?.gfm,
            smartypants: base?.smartypants,
          });
          updateConfig({
            markdown: { processor },
            vite: { plugins: [vitePlugin] },
          });
        } else {
          // fallback for older Astro versions
          updateConfig({
            markdown: { remarkPlugins: [[remarkAstroRef, { state }]] },
            vite: { plugins: [vitePlugin] },
          });
        }
      },

      'astro:build:done': ({ logger }) => {
        const log = msg => (logger ? logger.info(msg) : console.log(msg));
        let fail = false;

        if (state.duplicates.length > 0) {
          const lines = state.duplicates
            .map(({ name, file1, file2 }) => `  "${name}"\n    ${file1}\n    ${file2}`)
            .join('\n');
          log(`[astro-better-refs] ${state.duplicates.length} duplicate ref${state.duplicates.length === 1 ? '' : 's'}:\n${lines}`);
          if (failOnDuplicateRefs) fail = true;
        }

        const uniqueBroken = [...new Set(state.brokenRefs)].sort();
        if (uniqueBroken.length > 0) {
          const lines = uniqueBroken.map(n => `  "${n}"`).join('\n');
          log(`[astro-better-refs] ${uniqueBroken.length} unresolved ref${uniqueBroken.length === 1 ? '' : 's'}:\n${lines}`);
          if (failOnBrokenRefs) fail = true;
        }

        if (!state.duplicates.length && !uniqueBroken.length) {
          log(`[astro-better-refs] all refs ok (${state.refMap?.size ?? 0} declared)`);
        }

        if (fail) _exit(1);
      },
    },
  };
}
