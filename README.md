# astro-better-refs

Sphinx-style named refs for Astro. Declare an anchor anywhere in your content and link to it by name from anywhere else in the site. Links stay valid even when content moves, because the name travels with the content.

## Installation

```sh
npm install astro-better-refs
```

## Setup

Add the integration to your Astro config. The `collections` option maps each source directory to its URL base.

```js
// astro.config.mjs
import { defineConfig } from 'astro';
import astroRef from 'astro-better-refs';

export default defineConfig({
  integrations: [
    astroRef({
      collections: [
        { src: 'src/content/docs', base: '/docs' },
      ],
    }),
  ],
});
```

If your sticky header pushes content down, set this CSS variable once in your global stylesheet:

```css
:root {
  --astro-refs-scroll-offset: 80px; /* match your header height */
}
```

## Declaring refs

There are three ways to declare a ref. In all cases, the name must be unique across the entire site.

### 1. Component

Place an invisible anchor anywhere -- before a heading, in the middle of prose, wherever you want the link to land.

```mdx
import Ref from 'astro-better-refs/Ref.astro';

<Ref id="my-anchor" />
```

### 2. Frontmatter

Declare a page-level ref in the frontmatter. Links to this ref resolve to the page URL with no fragment (scroll to top).

```yaml
---
title: My Page
ref: my-page
---
```

Multiple aliases for the same page:

```yaml
---
refs:
  - my-page
  - legacy-page-name
---
```

### 3. Section heading

Add `{ref-name}` to the end of any Markdown heading. The suffix is stripped from the rendered heading; an invisible anchor is inserted just before it.

```markdown
## Potato Varieties {potato-varieties}

### Russet {russet-potato}
```

This is the most convenient option for section-level refs, since the ref lives right next to the content it names.

## Linking to a ref

Use the `ref:` URL scheme in any Markdown link:

```markdown
See [potato varieties](ref:potato-varieties) for details.

The [Russet](ref:russet-potato) is the most common variety.

Visit [the overview page](ref:my-page).
```

Links are resolved to real URLs at build time. Moving a page or heading only requires updating the ref declaration -- not every link pointing to it.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `collections` | `{src, base}[]` | `[]` | Source directories and their URL bases. `src` is relative to the project root. |
| `extensions` | `string[]` | `['.md', '.mdx', '.astro']` | File extensions to scan for ref declarations. |
| `failOnBrokenRefs` | `boolean` | `true` | Exit with an error if any `ref:name` link has no matching declaration. |
| `failOnDuplicateRefs` | `boolean` | `true` | Exit with an error if the same ref name is declared more than once. |

## Build output

At the end of each build, astro-better-refs reports:

```
[astro-better-refs] all refs ok (42 declared)
```

Or, if there are problems:

```
[astro-better-refs] 1 duplicate ref:
  "potato-varieties"
    src/content/docs/vegetables/potatoes.mdx
    src/content/docs/vegetables/starchy.mdx

[astro-better-refs] 2 unresolved refs:
  "missing-anchor"
  "old-section-name"
```

Unresolved refs (links to names that were never declared) render as `href="#"` in the output so the page still builds. The build exits with code 1 if `failOnBrokenRefs` or `failOnDuplicateRefs` is set and violations are found.

## Scroll offset

When the user navigates to a ref, the browser scrolls the target element into view. If your site has a sticky header, the heading or anchor may be hidden underneath it. Fix this by setting `--astro-refs-scroll-offset` to the height of your header:

```css
:root {
  --astro-refs-scroll-offset: 64px;
}
```

The default is 80px.

## Works well with

- **astro-better-link-checker** -- once astro-better-refs resolves `ref:name` links to real URLs, astro-better-link-checker validates those URLs as regular links. If a ref points to a page that was deleted (but the declaration wasn't removed), astro-better-link-checker catches it.
- **astro-toc** -- refs declared with `{ref-name}` in headings do not appear in the table of contents. The heading itself renders normally; only the invisible anchor is added.
