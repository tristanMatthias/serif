# Editor UI tests

The editor's behaviour lives in the browser: where the caret lands, what Enter
does inside a heading, whether the browser's own editing commands leave valid
markup behind. None of that can be checked from Go, and it is exactly where the
bugs are — so it is checked by driving a real Chromium against a real
`serif edit` server.

```sh
make test-ui          # runs the suites, or explains what is missing
node editor/uitest/run.mjs editing    # just one suite
```

The suites need Node and `playwright-core` with a browser installed:

```sh
npm install --no-save playwright-core
npx --yes playwright install chromium
```

Both are optional. `make test` runs the Go tests alone, and nothing here is
required to build or ship serif.

## Layout

| File | What it covers |
| --------------- | ------------------------------------------------------- |
| `run.mjs`       | The runner: builds a server, opens a page, reports |
| `harness.mjs`   | The vocabulary every case is written in |
| `editing.mjs`   | Keys and the caret — Enter, Backspace, Tab, input rules |
| `lists.mjs`     | Writing lists: every marker, in every place, all the way through |
| `document.mjs`  | Typing Markdown, saving, syncing, round trips |
| `workspace.mjs` | Directory mode: the tree, the picker, the title bar, making and moving files |
| `matrix.mjs`    | Every block × caret position × keystroke, against invariants |

## Writing a case

A case is a row of data — what to start from, what to do, what should then be
true. No case contains control flow.

```js
{ name: "Enter at the start of a heading keeps it a heading",
  html: "<h1>Hello</h1><p>Body</p>", sel: "h1", offset: 0,
  do:   ["press:Enter"],
  md:   "# Hello\n\nBody\n",
  dom:  "^<p><br></p><h1>Hello</h1>" }
```

A suite exports `files` (the workspace to open) and `cases`, or a list of
`groups` when it needs more than one workspace.

### Set-up

| Field | Meaning |
| -------- | -------------------------------------------------------------- |
| `html`   | Document to load into the editing surface. Omit to keep what the group opened with |
| `sel`    | Element the caret goes into |
| `offset` | Character offset within it — a number, or `"end"` |

### Steps — the `do` list

| Step | Does |
| ---------------------- | ------------------------------------------------- |
| `press:<Key>`          | A key, e.g. `press:Enter`, `press:Meta+k` |
| `type:<text>`          | Typed text |
| `click:<selector>`     | A click |
| `fill:<sel>=<value>`   | Set an input's value |
| `blur:<selector>`      | Take focus off something |
| `caretEnd:<selector>`  | Put the caret at the end of an element |
| `link:<url>`           | Cmd-Shift-K, answering the prompt |
| `write:<path>=<text>`  | Change a file on disk behind the editor's back |
| `reload`               | Reload the page |
| `settle`               | Wait until the editor reports itself saved |
| `wait:<ms>`            | A plain pause, when nothing better will do |

`Meta+` is right for the editor's own shortcuts — its handlers accept either
modifier, so a case written with ⌘ runs on Linux CI too. A gesture the *browser*
owns is different: select-all is ⌘A on a Mac and Ctrl-A everywhere else, so it
needs `press:ControlOrMeta+a`, which Playwright resolves per platform. Getting
this wrong fails only on CI.

### Expectations

Give whichever the case is actually about; the rest are skipped.

| Field | Checks |
| ------------- | ------------------------------------------------------- |
| `md`          | The whole document, as Markdown |
| `dom`         | A regular expression over the editing surface's HTML |
| `caret`       | `TOP/INNER` tag pair for where the caret finished |
| `file`        | Exact contents of the group's single file |
| `files`       | Exact contents, by relative path |
| `fileMatches` | A regular expression over a file's contents |
| `visible` / `hidden` | Selectors |
| `text` / `matches`   | Selector → exact text / regular expression |
| `count`       | Selector → how many should match |
| `attr`        | `"selector@attribute"` → value |
| `focused`     | The editor still has focus and still holds the caret |
| `caretIn`     | A selector the caret must be inside |
| `check`       | An escape hatch: `async (page, dir) => problem \| null` |

## The matrix

`matrix.mjs` is the answer to "how do we find the ones nobody thought of". It
generates every block type × where it sits in the document × caret position ×
keystroke — around 1200 combinations — and runs them all.

There is no expected result for each: writing several hundred by hand is how you
get several hundred wrong ones. Instead each case is judged against invariants
that hold no matter what was typed.

| Invariant | What it catches |
| ---------- | ------------------------------------------------------- |
| structure  | Markup a Markdown document cannot have: `<li>` inside `<li>`, a block inside `<p>`, an empty list, stray inline styles |
| locality   | A keystroke reaching a block it has no business touching — the bug where Backspace demoted the heading below |
| stability  | Text the serializer can write but the parser reads back differently, so the file changes on its own across a reload |
| caret      | The caret ending up outside the document |
| text       | Keys that only reformat quietly losing text |

What it does not catch is a gesture that corrupts nothing but still does the
wrong thing — Enter leaving the caret somewhere useless breaks no invariant.
Those need a case that says what was expected, in `editing.mjs`.

Adding a block type or a key to the tables at the top of that file multiplies
out across every position automatically. Where a construct genuinely cannot
satisfy an invariant, the subject carries an `exempt` list saying which and why,
and the runner prints those exemptions rather than passing silently.
