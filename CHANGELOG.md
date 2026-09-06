# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `serif edit <file.md>` — a WYSIWYG Markdown editor served over HTTP that saves
  to disk as you type. Markdown shorthands (`# `, `- `, `1. `, `> `, `` ``` ``,
  `**bold**`, `` `code` ``, `[text](url)`) become formatting as you write them;
  Tab nests list items; ⌘/Ctrl-B/I/S, ⌘/Ctrl-Shift-K (link) and -X
  (strikethrough), and ⌘/Ctrl-Alt-1…6 are bound.
- The editor is typeset with serif's own stylesheet, so the page you edit is the
  page you export. The theme toggle and its pre-paint script are now shared
  between the exported page and the editor rather than duplicated.
- A browser test suite for the editor (`make test-ui`, `editor/uitest`), which
  drives a real Chromium and checks the Markdown, the DOM and where the caret
  ended up. Cases are declared as tables rather than scripts.
- Files can be made and moved from inside the editor. Typing a name the picker
  cannot find offers to create it; a ＋ at the top of the tree and
  ⌘/Ctrl-Alt-N start from the folder you are in. F2, and a pencil on any row in
  the tree, rename a file or file it under another folder — one gesture rather
  than two. A path is as good as a name (`notes/2026/plan` makes the folders it
  needs), a name without an extension gets `.md`, unsaved work is written before
  the file moves, and moving the file you are in carries the document on at its
  new path. Names that are already
  taken, that climb out of the workspace, or that the file list could never show
  again are refused rather than acted on.
- A directory with no Markdown in it now opens on an offer to write the first
  file, rather than refusing to open at all.
- A generated matrix (`editor/uitest/matrix.mjs`) covering every block type ×
  caret position × keystroke — around 600 combinations — judged against
  invariants rather than a hand-written answer per case: the markup stays valid,
  a keystroke does not reach blocks it has nothing to do with, the caret stays
  somewhere you can type, and what the editor writes the renderer reads back
  into the same thing. It found the round-trip bugs below.

### Fixed

- Enter at the start of a heading made a second empty heading instead of opening
  a paragraph above it, and Enter in the middle of one left two headings.
- Backspace on an empty list item turned the *next* block into a paragraph, and
  left the caret in it — so the following heading was silently demoted and the
  next thing typed went into the wrong block.
- Backspace at the start of a task item destroyed the item; it now clears the
  checkbox first, then the bullet.
- Backspace at the start of a nested item produced an `<li>` inside an `<li>`,
  which flattened the list on the next save.
- Pressing Enter on a task item gave a plain item; it now stays a task item.
- Text could be merged into a code block, embedded HTML, or front matter by
  pressing Backspace at the start of the paragraph after it.
- The browser's editing commands stamped a computed `font-size` onto anything
  they moved, which accumulated in the document.
- Shift-Enter inside a heading or a table cell wrote a hard break that Markdown
  cannot hold there, so the block split in two when the file was read back.
- A hard break was followed by the next line's leading whitespace, which a
  parser discards — so the file changed on its own after a reload.
- Tab on the first item of a list indented it under nothing, writing a bullet
  that read back as an ordinary one.
- An empty nested list item was written as `-` on its own line, which is a
  setext underline: it turned the item above it into a heading on reload.
- Splitting a front matter key across two lines, or opening a blank line at the
  top of the block, stopped it being front matter — the fences became a rule and
  the metadata became a heading.
- Indentation and trailing spaces around an embedded HTML block were written out
  even though a parser drops them.
- Enter at the end of a code block, an embedded HTML block or a table added a
  line *inside* it instead of leaving, so a document ending in one had no
  obvious way out and everything typed next went into the block. Down-arrow at
  the end and Ctrl-Enter / Cmd-Enter now leave it, Enter on a blank last line
  works whichever kind of block it is, and the click target below the document
  covers the whole sheet rather than the text column.
- Shift-Tab outdented the right list item but left the caret in the one above
  it, so the next thing typed went into the wrong item.
- Typing with the caret in the editor itself rather than in a block wrapped each
  character into a paragraph of its own, turning a word into one paragraph per
  letter.
- The editor's own scripts were served with no cache headers at all — embedded
  files carry no modification time, so net/http sent no validators either, and a
  browser was free to hold them indefinitely. A tab left open across a rebuild
  could run new modules against old ones.
- A rendered code block carried a trailing newline from its HTML, showing as a
  phantom blank last line and putting the block's end below the code's end.

### Added

- Front matter (`---` YAML or `+++` TOML at the top of a file) is understood
  rather than parsed as Markdown, which previously turned `title: Hello` into a
  heading. The exporter leaves it out of the page and uses a `title:` declared
  there when `--title` is not given; the editor shows it as a labelled card
  above the document, editable as plain text, with the Markdown shorthands off
  inside it and the block written back between its own fences byte for byte. A
  document that merely opens with a thematic break is not mistaken for it.
- `.mdx` is recognised everywhere the other Markdown extensions are: `serif
  post.mdx` writes `post.html`, and `.mdx` files are listed and editable in the
  browser editor. The editor treats them as Markdown — JSX and `{expression}`
  syntax is kept as literal text, and the reformat warning fires on open if a
  save would rewrite any of it.
- `serif edit <dir>` opens a directory, with two ways to move around it: a file
  tree in a sidebar (Ctrl-\ / Cmd-\, or the icon at the top left) that shows
  where the open file sits and expands the folders above it, and a picker on the
  file name in the title bar (Ctrl-K / Cmd-K, or Ctrl-P / Cmd-P). Filtering is
  by subsequence, so `rn` finds `release-notes.md`. The tree's open folders and
  whether the sidebar is shown are remembered per browser. Only Markdown inside the
  opened directory can be listed or written, and paths that climb out of it —
  including through symlinks — are refused.
- `--addr` on `serif edit` (default `127.0.0.1:8787`); pass `0.0.0.0` to reach
  the editor over Tailscale or a LAN. Local addresses are printed on startup.
- The editor notices changes made to the file by other programs, adopting them
  when you have nothing unsaved and asking which version to keep when you do.
  The dot in the title bar reports the connection to the server — green when
  connected — so a stopped or unreachable server is visible rather than silent.
  An idle editor costs one `stat` per document per interval; the file is only
  read when it has changed.
- The save status shows a spinner while writing and a check with the time since
  the last save ("Saved just now", "Saved 42 min ago"), taken from the file's
  own mtime so it is correct on the first paint.
- Ctrl-K / Cmd-K opens the file picker alongside Ctrl-P / Cmd-P, and Escape
  closes it from anywhere. Inserting a link moved to Ctrl-Shift-K / Cmd-Shift-K.

## [0.1.0] - 2026-07-16

### Added

- Convert a Markdown file to a single, self-contained HTML page:
  `serif file.md` writes `file.html`.
- Readability-first typography: serif reading face, sans-serif headings, a
  ~68-character measure, generous line-height, ligatures, kerning, and
  old-style figures.
- Automatic light and dark themes at WCAG-AAA body contrast, following the OS
  preference, with a persistent in-page toggle (or press <kbd>T</kbd>).
- Smart punctuation (curly quotes, em-dashes, ellipses) via the goldmark
  typographer.
- GitHub-flavored Markdown, footnotes, definition lists, and clickable heading
  anchors.
- Per-theme syntax highlighting for fenced code blocks via chroma, with a
  no-JavaScript `prefers-color-scheme` fallback.
- `-o`, `--title`, `--lang`, and `--version` flags; flags may appear before or
  after the file argument.
- Print stylesheet.

[Unreleased]: https://github.com/tristanMatthias/serif/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tristanMatthias/serif/releases/tag/v0.1.0
