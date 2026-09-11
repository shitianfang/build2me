# md.mjs — a minimal Markdown-to-HTML CLI

Zero-dependency Node (>= 20). `node md.mjs <file.md>` reads the file and
prints HTML to stdout, exit 0. Missing argument or unreadable file: message
on stderr, exit 1.

Blocks are separated by one or more blank lines. Each block renders as
exactly one of, checked in this order:

1. **Heading** — 1-3 `#` characters followed by ONE space: `<h1>`..`<h3>`.
   A `#` without the space is NOT a heading (the block is a paragraph).
2. **Fenced code block** — lines between ``` fences: `<pre><code>...`
   `</code></pre>`. Content verbatim (newlines preserved, fence lines
   excluded), with `&` `<` `>` escaped as `&amp;` `&lt;` `&gt;`. No inline
   rules inside.
3. **Unordered list** — every line of the block starts with `- `:
   `<ul><li>item</li>...</ul>`, one `<li>` per line, no nesting required.
4. **Paragraph** — anything else: `<p>text</p>`, internal newlines become
   single spaces.

Inline rules (apply inside headings, list items and paragraphs):

- `**text**` -> `<strong>text</strong>`; `*text*` -> `<em>text</em>`
  (a `**` pair is bold, never two italics)
- `` `text` `` -> `<code>text</code>` with `&` `<` `>` escaped; no other
  inline rules apply inside a code span
- `[text](url)` -> `<a href="url">text</a>`; inline rules apply to text,
  never to url; link text may contain bold/italic/code
- plain `&` `<` `>` are escaped everywhere outside raw markup

Output: rendered blocks joined by `\n`, one trailing newline.

Feature list (for tracking): 1 headings, 2 paragraphs, 3 unordered lists,
4 bold+italic, 5 code (inline + fenced), 6 links. Escaping belongs to each
feature it touches.

## Examples (normative)

| input | stdout |
|---|---|
| `# Title` | `<h1>Title</h1>` |
| `#NoSpace` | `<p>#NoSpace</p>` |
| `x < y & z` | `<p>x &lt; y &amp; z</p>` |
| `` `**x**` `` | `<p><code>**x**</code></p>` |
| `[see **docs**](u)` | `<p><a href="u">see <strong>docs</strong></a></p>` |
