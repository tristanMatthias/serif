// The document: typing Markdown into an empty file and checking what lands on
// disk, then that a rich document survives being loaded and written back.

export const files = { "n.md": "" };

const EMPTY = "<p><br></p>";

/** Type into a fresh document and check the file. */
const typing = (name, keys, file, dom) => ({
  name: `typing: ${name}`,
  html: EMPTY, sel: "p",
  do: keys,
  pause: 700,
  file, dom,
});

export const cases = [
  typing("# makes a heading", ["type:# Hello", "press:Enter", "type:Body."],
    "# Hello\n\nBody.\n", "<h1>Hello</h1>.*<p>Body\\.</p>"),
  typing("### makes a third-level heading", ["type:### Deep"], "### Deep\n", "<h3>Deep</h3>"),
  typing("- makes a bullet list", ["type:- one", "press:Enter", "type:two", "press:Enter", "type:three"],
    "- one\n- two\n- three\n", "<ul>"),
  typing("1. makes an ordered list", ["type:1. first", "press:Enter", "type:second"],
    "1. first\n2. second\n", "<ol>"),
  typing("Tab nests an item", ["type:- a", "press:Enter", "type:b", "press:Tab", "press:Enter", "type:c"],
    "- a\n  - b\n  - c\n", "<ul>[\\s\\S]*<ul>"),
  typing("an empty item ends the list", ["type:- a", "press:Enter", "press:Enter", "type:after"],
    "- a\n\nafter\n"),
  typing("[] makes a task item", ["type:- [] milk", "press:Enter", "type:[x] eggs"],
    "- [ ] milk\n- [x] eggs\n", 'type="checkbox"'),
  typing("> makes a quote", ["type:> quoted"], "> quoted\n", "<blockquote>"),
  typing("**bold**", ["type:**bold** rest"], "**bold** rest\n", "<b>bold</b>|<strong>bold</strong>"),
  typing("*italic*", ["type:*soft* rest"], "*soft* rest\n", "<i>soft</i>|<em>soft</em>"),
  typing("`code`", ["type:`x = 1` rest"], "`x = 1` rest\n", "<code>x = 1</code>"),
  typing("~~struck~~", ["type:~~gone~~ rest"], "~~gone~~ rest\n", "<del>gone</del>|<strike>gone</strike>"),
  typing("[text](url)", ["type:[serif](https://example.com) rest"],
    "[serif](https://example.com) rest\n", 'href="https://example.com"'),
  typing("--- makes a rule", ["type:---", "press:Enter", "type:after"], "---\n\nafter\n", "<hr>"),
  typing("``` makes a code block", ["type:```go", "press:Enter", "type:x := 1", "press:Enter", "type:y := 2"],
    "```go\nx := 1\ny := 2\n```\n", "<pre"),
  typing("Backspace unmakes a heading", ["type:## Head", "press:Home", "press:Backspace"],
    "Head\n", "<p>Head</p>"),
  typing("prose is left alone", ["type:Just some prose."], "Just some prose.\n", "<p>"),
  typing("no smart quotes are written to disk", ['type:He said "hi" -- really.'],
    'He said "hi" -- really.\n'),
];

/* ---- round trip ---------------------------------------------------------- */

// Loading a document and writing it straight back out must not change a byte.
// Everything the editor models appears here.
const RICH = `---
title: Everything
tags:
  - serif
---

# Heading

A paragraph with **bold**, *italic*, \`inline code\`, ~~struck~~ text and a
[link](https://example.com).

## Lists

- first item
- second item
  - nested item
- third item

1. one
2. two

- [ ] unchecked task
- [x] checked task

> A quotation.
> Spanning two lines.

\`\`\`go
func main() {
\tfmt.Println("hi")
}
\`\`\`

Text with 2 * 3 and snake_case and a literal <div> tag.

| Name | Value |
| ---- | ----: |
| a    |     1 |
| b    |     2 |

---

Final paragraph.
`;

export const groups = [
  {
    name: "round trip",
    files: { "doc.md": RICH },
    cases: [{
      name: "a rich document round-trips byte for byte",
      do: ["wait:400"],
      md: RICH,
      file: RICH,
    }],
  },
  {
    name: "saving and syncing",
    files: { "n.md": "# Start\n" },
    cases: [
      { name: "edits reach the disk within a second",
        do: ["click:#doc", "press:End", "type:ed", "wait:900"],
        file: "# Started\n" },

      { name: "the bar says when it last saved",
        do: ["settle"], matches: { "#status-text": "^Saved" } },

      { name: "the dot reports the connection",
        do: [], attr: { "#link@data-link": "online" } },

      { name: "an external change is adopted when nothing is unsaved",
        do: ["write:n.md=# Replaced elsewhere\\n\\nNew body.\\n", "wait:2000"],
        text: { "#doc h1": "Replaced elsewhere" } },

      { name: "a conflicting change asks which to keep",
        do: ["click:#doc h1", "press:End", "type: MINE",
             "write:n.md=# Theirs\\n", "wait:2200"],
        visible: "#notice", file: "# Theirs\n" },

      { name: "keeping yours overwrites",
        do: ["click:#notice-primary", "wait:900"],
        fileMatches: { "n.md": "MINE" } },

      { name: "reformatting is announced before it happens",
        do: ["write:n.md=See [goldmark][gm].\\n\\n[gm]: https://x.dev\\n", "wait:1200", "reload"],
        matches: { "#notice-text": "reformat" },
        file: "See [goldmark][gm].\n\n[gm]: https://x.dev\n" },
    ],
  },
];
