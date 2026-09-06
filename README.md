<h1 align="center">serif</h1>

<p align="center"><em>Turn Markdown into a beautifully typeset, self-contained HTML page.</em></p>

<p align="center">
  <a href="https://github.com/tristanMatthias/serif/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/tristanMatthias/serif/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/tristanMatthias/serif/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/tristanMatthias/serif?color=1a56c4"></a>
  <a href="https://pkg.go.dev/github.com/tristanMatthias/serif"><img alt="Go Reference" src="https://pkg.go.dev/badge/github.com/tristanMatthias/serif.svg"></a>
  <a href="https://goreportcard.com/report/github.com/tristanMatthias/serif"><img alt="Go Report Card" src="https://goreportcard.com/badge/github.com/tristanMatthias/serif"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/serif-dark-hero.png">
    <img alt="A Markdown document typeset by serif" src="assets/serif-light-hero.png" width="820">
  </picture>
</p>

`serif` reads a Markdown file and writes one `.html` file with the typography
already done for you — a serif reading face, a comfortable measure, calm color,
automatic light/dark, and syntax-highlighted code. No CSS to write, no assets to
host, no network at view time. Just:

```sh
serif essay.md          # writes essay.html
```

## Features

- **Readability first.** Serif body face, sans-serif headings, a ~68-character
  measure, generous line-height, ligatures, kerning, old-style figures, and
  `text-wrap: balance`/`pretty`.
- **Automatic light & dark.** Warm-paper light theme and a soft warm-dark theme,
  both at WCAG-AAA body contrast. Follows the OS setting, with a corner toggle
  (or press <kbd>T</kbd>) that remembers your choice.
- **Smart punctuation.** Straight quotes become curly, `--` becomes an em-dash,
  `...` becomes an ellipsis.
- **Real Markdown.** GitHub-flavored Markdown (tables, task lists, strikethrough,
  autolinks), footnotes, definition lists, and clickable heading anchors. YAML
  and TOML front matter is understood, not typeset.
- **Syntax highlighting per theme.** Fenced code blocks use a light or dark
  palette matched to the active theme.
- **Self-contained output.** All CSS is inlined; the `.html` needs no network and
  no external files. Print styles included.
- **A browser editor.** `serif edit notes.md` — or `serif edit ~/notes` for a
  whole folder — opens a WYSIWYG Markdown editor that saves to disk as you type,
  typeset with the very same stylesheet. Files can be made, renamed and filed
  away from inside it.

## Install

### Homebrew

```sh
brew install tristanMatthias/tap/serif
```

### Prebuilt binary (macOS / Linux)

```sh
curl -fsSL https://raw.githubusercontent.com/tristanMatthias/serif/main/install.sh | sh
```

Downloads the right binary for your OS/arch from the latest release into
`/usr/local/bin` (override with `PREFIX=$HOME/.local`).

### Go

```sh
go install github.com/tristanMatthias/serif@latest
```

Installs to `$(go env GOPATH)/bin` — make sure that's on your `PATH`.

### From source

```sh
git clone https://github.com/tristanMatthias/serif
cd serif
make install
```

## Usage

```
serif [options] <file.md>
serif edit [options] <file.md>

Options:
  -o <file>       output path (default: input name with .html)
  --title <text>  page title (default: first heading or file name)
  --lang <code>   html lang attribute (default: en)
  --version       print version and exit
```

Flags may appear before or after the file.

```sh
serif README.md                        # writes README.html
serif notes.md -o public/notes.html    # choose the output path
serif --title "Q3 Plan" plan.md        # override the <title>
serif edit notes.md                    # edit in the browser (see below)
```

The page title defaults to the document's first heading, falling back to the
file name.

## Edit in the browser

`serif edit` opens a small WYSIWYG Markdown editor and writes your changes
straight back to disk as you type. What you edit is typeset with serif's own
stylesheet, so the page in front of you is what the exported document looks
like.

```sh
serif edit notes.md              # one file, at http://127.0.0.1:8787
serif edit ~/notes               # a whole directory of them
serif edit notes.md --open       # …and open it in your browser
serif edit ~/notes --addr 0.0.0.0      # reachable over Tailscale or a LAN
```

A file that does not exist yet is created. Point it at a directory and the
Markdown inside becomes browsable — including a directory with nothing in it
yet, which opens on an offer to write the first file. Point it at a file and
that is the only file the editor can touch.

### Finding your way around

Directory mode has two ways to move, because they answer different questions.

The **tree** on the left is for "where does this sit, and what is next to it?".
Toggle it from the icon at the top left or with <kbd>⌘</kbd><kbd>\</kbd>
(<kbd>Ctrl</kbd> elsewhere). The open file is highlighted, the folders above it
are expanded for you when you arrive — including when you arrive via the picker
— and which folders you left open is remembered between visits.

The **picker** is for "open the file I can name". The file name in the title bar
opens it — or press
<kbd>⌘</kbd><kbd>K</kbd> or <kbd>⌘</kbd><kbd>P</kbd> (<kbd>Ctrl</kbd> elsewhere).
Type to filter: matching is by
subsequence, so `rn` finds `release-notes.md` and `nda` finds `notes/daily.md`.
Arrow keys move, <kbd>Enter</kbd> opens, <kbd>Esc</kbd> closes from anywhere. With an empty box the list is ordered by what you edited most recently.

Unsaved work is flushed before the editor moves to another file.

Both are built from one listing, and only Markdown files appear in either — and
only from inside the directory you opened — dotfiles, `node_modules` and friends are skipped, and a path that
climbs out of the workspace (or a symlink that points out of it) is refused.

### Making and moving files

Both are the same question — what should this be called? — so both are the same
box, and a path typed into it is as good as a name: `notes/2026/plan` makes the
folders it needs on the way.

New files come from wherever you already are. Type a name the **picker** cannot
find and the last row offers to create it, which is the shortest route from "I
should write that down" to writing it down. There is also a **＋** at the top of
the tree, and <kbd>⌘</kbd><kbd>⌥</kbd><kbd>N</kbd>
(<kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>N</kbd> elsewhere) — those two start from the
folder you are in, since a new note usually belongs beside the one that prompted
it. A name given without an extension gets `.md`.

Renaming and moving are one gesture, because where a note is filed is part of
what it is called. <kbd>F2</kbd> moves the open file; the pencil that appears on
a row in the tree moves that one. The box opens on the current path with just
the name selected — the folder and the extension are the parts you usually keep,
and a rename that drops the extension keeps the one the file had. Unsaved work
is written first, and moving the file you are in does not interrupt you: the
same document carries on at its new path.

A name that is already taken is refused rather than written over, and the reason
appears under the box with the name still in it.

### While you type

Markdown shorthands become real formatting as you write them:

| Type             | Get                 |
| ---------------- | ------------------- |
| `# ` … `###### ` | headings one to six |
| `- ` `* ` `+ `   | a bullet list       |
| `1. `            | a numbered list     |
| `[] ` `[x] `     | a task item         |
| `> `             | a block quote       |
| ` ``` ` + Enter  | a code block        |
| `---` + Enter    | a horizontal rule   |
| `**bold**`       | **bold**            |
| `*italic*`       | *italic*            |
| `` `code` ``     | `code`              |
| `~~struck~~`     | ~~struck~~          |
| `[text](url)`    | a link              |

Tab and Shift-Tab nest and unnest list items. Enter on an empty item leaves the
list; Backspace at the start of a heading turns it back into a paragraph.
⌘/Ctrl with <kbd>B</kbd>, <kbd>I</kbd> and <kbd>S</kbd> do bold, italic and
save; add <kbd>⇧</kbd> for <kbd>K</kbd> to insert a link and <kbd>X</kbd> to
strike through (plain <kbd>K</kbd> belongs to the file picker); add <kbd>Alt</kbd>
and a digit to set a heading level, or <kbd>N</kbd> for a new file.
Pasted text is treated as Markdown, so a pasted list arrives as a list.

Inside a code block, an embedded HTML block or a table, Enter adds a line rather
than leaving — so there are four ways out, and all of them work from the last
block in a document: <kbd>↓</kbd> at the end, <kbd>⌘</kbd><kbd>Enter</kbd>,
Enter again on a blank last line, or a click in the space below.

Undo and redo work throughout — every transformation goes through the browser's
own undo stack.

### Saving and syncing

Edits are written about half a second after you stop typing, and at least every
couple of seconds while you keep going.

The title bar answers the two questions worth asking. The dot is the connection
to the server: green while the editor is talking to it, and unmistakable when it
is not. The words are the save — a spinner while writing, then a check and how
long ago it landed ("Saved just now", "Saved 42 min ago"), read from the file's
own timestamp so it is right the moment you open it. Files are replaced
atomically, so an interrupted save cannot truncate the document.

If the file changes underneath you — another tab, `git checkout`, your terminal
editor — the editor notices. When you have no unsaved changes it just picks the
new version up; when you do, it asks which one to keep.

### Front matter

A `---` (or `+++`) metadata block at the top of a file is not Markdown — left to
a Markdown parser, `title: Hello` followed by `---` becomes a *heading*. serif
takes it off the top and handles it separately.

In the editor it appears above the document as its own labelled card: mono type,
keys picked out, quiet enough that the first real heading is still the first
thing you read. It stays editable as plain text, the Markdown shorthands are off
inside it, and it is written back between the fences it arrived in — byte for
byte. It does not count towards the word count.

When exporting, front matter is metadata rather than reading matter, so it is
left out of the page — and a `title:` declared there names the document when you
have not passed `--title`.

A file that merely *opens* with a thematic break is not mistaken for metadata:
the first line inside the fences has to read like a key.

### What it does and does not do

The editor deliberately models a subset of Markdown: front matter, headings,
paragraphs, lists, task lists, quotes, code blocks, rules, tables, and the
inline marks above. That subset round-trips exactly — text you did not touch comes back
byte for byte.

Syntax it does not model is kept as visible, editable text rather than dropped:
embedded HTML, footnote definitions, and the like all survive a save. Two things
are rewritten into the editor's own house style, though — reference-style links
(`[text][ref]`) become inline links, and table columns are re-padded. When
opening a file would change it in any such way, the editor says so before you
start, and writes nothing until you actually edit.

`.mdx` files open too, but the editor reads them as plain Markdown: JSX blocks
and `{expressions}` survive as literal text rather than being understood, and an
expression containing Markdown punctuation (`{count*2}`) will be escaped on
save. The warning above fires when that would happen.

For a document you want to keep exactly as written, use the exporter rather than
the editor.

## Light & dark

The same document, both themes — light on warm paper, dark on warm charcoal:

<table>
  <tr>
    <td width="50%"><img alt="Light theme" src="assets/serif-light-full.png"></td>
    <td width="50%"><img alt="Dark theme" src="assets/serif-dark-full.png"></td>
  </tr>
</table>

Try it yourself:

```sh
serif examples/showcase.md && open examples/showcase.html
```

## How it works

Markdown is parsed with [goldmark][goldmark] (CommonMark + GitHub extensions +
smart typography), code is highlighted with [chroma][chroma], and the result is
wrapped in a hand-tuned stylesheet. The theme is chosen before first paint by a
tiny inline script (so there's no flash), with a `prefers-color-scheme` fallback
for the no-JavaScript case. Everything — CSS and syntax palettes for both
themes — is inlined into the single output file.

`serif edit` reuses that same renderer. It converts the file to HTML once, hands
it to a `contenteditable` styled with the very same stylesheet, and converts the
edited DOM back to Markdown on every save — so there is one renderer and one set
of typographic rules behind the exporter, the browser bundle, and the editor.

## Development

```sh
make build      # build ./serif
make test       # run tests
make lint       # go vet
make test-ui    # run the editor's browser tests
make example    # regenerate examples/showcase.html
make edit FILE=notes.md   # open the browser editor (a file or a directory)
make help       # list all targets
```

Requires Go 1.25+. The editor's behaviour — what Enter does inside a heading,
where the caret lands, whether a document survives a round trip — is checked by
driving a real browser; see [`editor/uitest`](editor/uitest) for how to run it.
Those tests need Node and are not needed to build or ship serif.

[CONTRIBUTING.md](CONTRIBUTING.md) has the workflow; [CLAUDE.md](CLAUDE.md) has
the architecture and the invariants worth knowing before changing anything —
written for coding agents, and the fastest way in for anyone else.

## Acknowledgements

Built on the excellent [goldmark][goldmark] and [chroma][chroma]. Typographic
defaults owe a debt to Robert Bringhurst's *The Elements of Typographic Style*.

## License

[MIT](LICENSE) © Tristan Matthias

[goldmark]: https://github.com/yuin/goldmark
[chroma]: https://github.com/alecthomas/chroma
