# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`serif` turns a Markdown file into one self-contained, typeset HTML page — and
serves a WYSIWYG browser editor over the same renderer. Go 1.25+.

## Commands

```sh
make build                  # ./serif
make test                   # go test ./...
make lint                   # go vet + gofmt check (CI fails on either)
make test-ui                # the editor's browser tests (see below)
make example                # regenerate examples/showcase.html
make edit FILE=notes.md     # build, then open the browser editor on a file or directory
make serve                  # build the WASM bundle and serve ./web
make help                   # every target
```

One Go test: `go test ./editor -run TestMoveOverHTTP -v`.
One browser suite: `node editor/uitest/run.mjs workspace` (suites are `editing`,
`lists`, `document`, `workspace`, `matrix`).

The browser tests need Node and a Chromium, both optional — `make test-ui`
explains itself and exits 0 when they are missing:

```sh
npm install --no-save playwright-core && npx --yes playwright install chromium
```

## Architecture

**One renderer, one stylesheet.** `render/` is the only place Markdown becomes
HTML and the only place the typography lives. The exporter (`render.Page`), the
WASM bundle (`wasm/`) and the editor all go through it; the editor page pulls
`/serif.css` straight from `render.StyleCSS()` and gets the theme toggle, its
markup and its pre-paint script from `render.ThemeToggle*`/`ThemeInitJS`. Never
restate a colour, a type rule or the theme logic outside `render/` — a
divergence there means the page you edit stops matching the page you export.

**The editor round trip has to be lossless.** `render.EditorFragment` uses a
deliberately *narrower* goldmark configuration than `Page`: no Typographer, no
Linkify, no syntax highlighting, and embedded HTML rendered as literal editable
text. The browser serialises the DOM back to Markdown on every save, so anything
the parser "improves" would be written back into the user's file. Read the
comment at the top of `render/editor.go` before touching that config.

**`editor/`** is an HTTP server around one workspace:

- `workspace.go` — what the editor is allowed to touch. Every path the browser
  sends goes through `Resolve` (existing file) or `ResolveNew` (one about to
  exist): it must stay inside the workspace *after symlinks are resolved*, name
  a Markdown extension, and in single-file mode be that one file. Never join a
  request path onto the root yourself. `Create`/`Move` add the make-and-rename
  operations on top of the same checks.
- `server.go` — the routes. `GET/PUT/POST /api/doc`, `POST /api/move`,
  `GET /api/files`, `POST /api/render`, `GET /api/events` (SSE). Writes require
  `Content-Type: application/json`, which is what stops a cross-origin page from
  saving over a file, and they share one mutex. Saves are checked against a
  *content hash* (`revOf`), not an mtime, and written atomically via a temp file
  and rename.
- `assets/` — the browser app, plain ES modules, embedded with `//go:embed`.
  `editor.js` is the wiring (network, autosave, title bar); `editing.js` is
  typing behaviour; `markdown.js` is DOM → Markdown; `picker.js`, `tree.js` and
  `prompt.js` are the file UI.

**Editing goes through `document.execCommand`.** It is deprecated, and it is the
only API that writes to a contenteditable *through the browser's own undo
stack*. Hand-rolled DOM surgery breaks ⌘Z, which is worse than the deprecation.

## Gotchas

- **Assets are embedded.** Editing `editor/assets/*` has no effect until the
  binary is rebuilt. `make edit`, `make test-ui` and the uitest runner all
  rebuild; a server you left running does not.
- Embedded files carry no mtime, so the editor serves its own assets `no-store`.
  Without it a tab left open across a rebuild mixes old and new modules.
- `render/style.css` is scoped and inlined at build time by `scopeCSS`; the
  editor adds only *chrome* on top of it in `editor/assets/editor.css`.
- The editor models a subset of Markdown deliberately. Syntax it does not model
  (embedded HTML, footnote definitions) survives as visible literal text rather
  than being dropped; two things are rewritten into house style
  (reference-style links, table padding) and the editor warns before it does.

## Browser tests

`editor/uitest/` drives a real Chromium against a real `serif edit` server. A
case is **a row of data, not a script** — `{name, html, sel, do: [...], md, dom,
files, ...}`; the vocabulary lives in `harness.mjs` and is documented in
`editor/uitest/README.md`. Add a row rather than writing a new script.

`matrix.mjs` generates every block × caret position × keystroke (~1200) and
judges each against invariants rather than a hand-written expectation, which is
where the round-trip bugs get caught. Adding a block type or a key to its tables
multiplies out across every position automatically.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`) —
  the release changelog is generated from the prefixes.
- Update `CHANGELOG.md` under `## [Unreleased]`.
- Comments explain *why*, in prose, and the codebase leans hard on that. Match
  the surrounding density rather than stripping it.
- serif is opinionated by design: before adding a flag or an option, consider
  whether a better default would serve everyone instead.
