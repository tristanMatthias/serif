// Keys and the caret: what Enter, Backspace, Tab and the input rules do from
// every position they can be pressed from.
//
// Each row loads a document, puts the caret at a character offset, sends keys,
// and states what should be true afterwards. See harness.mjs for the vocabulary.

export const files = { "n.md": "# x\n" };

export const cases = [
  /* ---- Enter ---- */
  { name: "Enter at the start of a heading keeps it a heading",
    html: "<h1>Hello</h1><p>Body</p>", sel: "h1", do: ["press:Enter"],
    md: "# Hello\n\nBody\n", dom: "^<p><br></p><h1>Hello</h1>" },

  { name: "Enter mid-heading leaves the remainder as body text",
    html: "<h1>HelloWorld</h1>", sel: "h1", offset: 5, do: ["press:Enter"],
    md: "# Hello\n\nWorld\n", dom: "<h1>Hello</h1><p>World</p>" },

  { name: "Enter at the end of a heading starts a paragraph",
    html: "<h1>Hello</h1>", sel: "h1", offset: "end", do: ["press:Enter", "type:next"],
    md: "# Hello\n\nnext\n" },

  { name: "Enter at the start of a block takes the caret with the text",
    html: "<h1>Hello</h1>", sel: "h1", do: ["press:Enter", "type:X"], md: "# XHello\n" },

  { name: "Enter at the start of a paragraph pushes it down",
    html: "<p>only</p>", sel: "p", do: ["press:Enter", "type:new"],
    md: "newonly\n", dom: "^<p><br></p><p>newonly</p>$" },

  { name: "Enter at the start of an item keeps the list",
    html: "<ul><li>a</li></ul><h2>Head</h2>", sel: "li", do: ["press:Enter"],
    dom: "<ul>[\\s\\S]*a[\\s\\S]*</ul><h2>Head</h2>" },

  { name: "Enter on a task item makes another task item",
    html: '<ul><li><input type="checkbox" checked>done</li></ul>', sel: "li", offset: "end",
    do: ["press:Enter", "type:next"], md: "- [x] done\n- [ ] next\n" },

  { name: "Enter keeps a nested list nested",
    html: "<ul><li>a<ul><li>b</li></ul></li></ul>", sel: "ul ul li", offset: "end",
    do: ["press:Enter", "type:c"], md: "- a\n  - b\n  - c\n" },

  { name: "Enter continues an ordered list's numbering",
    html: "<ol><li>one</li></ol>", sel: "li", offset: "end", do: ["press:Enter", "type:two"],
    md: "1. one\n2. two\n" },

  { name: "Enter twice leaves a quote",
    html: "<blockquote><p>q</p></blockquote>", sel: "blockquote p", offset: "end",
    do: ["press:Enter", "press:Enter", "type:after"], md: "> q\n\nafter\n" },

  { name: "Enter in a quoted list keeps both",
    html: "<blockquote><ul><li>a</li></ul></blockquote>", sel: "li", offset: "end",
    do: ["press:Enter", "type:b"], md: "> - a\n> - b\n" },

  { name: "Enter in a table cell stays in the table",
    html: "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>",
    sel: "td", offset: "end", do: ["press:Enter"], dom: "<table" },

  { name: "Enter beside a code block does not disturb it",
    html: "<pre><code>x</code></pre><p>after</p>", sel: "p", do: ["press:Enter"], dom: "<pre" },

  { name: "a hard break is not written where Markdown cannot hold one",
    html: "<h1>Alpha bravo</h1>", sel: "h1", offset: 5, do: ["press:Shift+Enter"],
    md: "# Alpha\n\nbravo\n" },

  /* ---- Backspace ---- */
  { name: "Backspace on an empty item leaves the heading below alone",
    html: "<ul><li>a</li><li><br></li></ul><h2>Head</h2>", sel: "li:nth-child(2)",
    do: ["press:Backspace"], md: "- a\n\n## Head\n" },

  { name: "Backspace on an empty item leaves the caret where you can type",
    html: "<ul><li>a</li><li><br></li></ul><h2>Head</h2>", sel: "li:nth-child(2)",
    do: ["press:Backspace", "type:typed"], md: "- a\n\ntyped\n\n## Head\n" },

  { name: "Backspace at the start of a heading makes it a paragraph",
    html: "<h2>Head</h2><p>Body</p>", sel: "h2", do: ["press:Backspace"], md: "Head\n\nBody\n" },

  { name: "Backspace at the start of the document does nothing",
    html: "<p>Body</p>", sel: "p", do: ["press:Backspace"], md: "Body\n" },

  { name: "Backspace merges a paragraph into the heading above",
    html: "<h1>Head</h1><p>Body</p>", sel: "p", do: ["press:Backspace"], md: "# HeadBody\n" },

  { name: "Backspace after a rule removes the rule",
    html: "<p>a</p><hr><p>b</p>", sel: "p:last-child", do: ["press:Backspace"], md: "a\n\nb\n" },

  { name: "Backspace clears a task item's checkbox first",
    html: '<ul><li><input type="checkbox">todo</li></ul>', sel: "li",
    do: ["press:Backspace"], md: "- todo\n" },

  { name: "Backspace keeps the caret on the item it just cleared",
    html: '<ul><li><input type="checkbox">todo</li></ul>', sel: "li",
    do: ["press:Backspace", "type:X"], md: "- Xtodo\n" },

  { name: "Backspace sheds one level of nesting",
    html: "<ul><li>a<ul><li>b</li></ul></li></ul>", sel: "ul ul li",
    do: ["press:Backspace"], md: "- a\n- b\n" },

  { name: "Backspace sheds the bullet before joining",
    html: "<ul><li>a</li><li>b</li></ul>", sel: "li:nth-child(2)",
    do: ["press:Backspace"], md: "- a\n\nb\n" },

  { name: "a second Backspace then joins the item above",
    html: "<ul><li>a</li><li>b</li></ul>", sel: "li:nth-child(2)",
    do: ["press:Backspace", "press:Backspace"], md: "- ab\n" },

  { name: "Backspace leaves the first item's list",
    html: "<ol><li>one</li></ol><h2>Head</h2>", sel: "li",
    do: ["press:Backspace"], md: "one\n\n## Head\n" },

  { name: "Backspace unwraps only the quoted paragraph",
    html: "<blockquote><p>q</p></blockquote><h2>Head</h2>", sel: "blockquote p",
    do: ["press:Backspace"], md: "q\n\n## Head\n" },

  { name: "Backspace does not pour text into a code block",
    html: "<pre><code>x</code></pre><p>after</p>", sel: "p",
    do: ["press:Backspace"], md: "```\nx\n```\n\nafter\n" },

  { name: "Backspace does not pour text into front matter",
    html: '<div class="serif-front" data-fence="---"><b>title</b>: x</div><p>body</p>',
    sel: "p", do: ["press:Backspace"], md: "---\ntitle: x\n---\n\nbody\n" },

  /* ---- Tab, Delete, structure ---- */
  { name: "Tab nests under the item above",
    html: "<ul><li>a</li><li>b</li></ul>", sel: "li:nth-child(2)", offset: "end",
    do: ["press:Tab"], md: "- a\n  - b\n" },

  { name: "Tab on the first item has nothing to nest under",
    html: "<ul><li>a</li></ul>", sel: "li", offset: "end", do: ["press:Tab"], md: "- a\n" },

  { name: "Shift-Tab at the top level does not break the list",
    html: "<ul><li>a</li><li>b</li></ul>", sel: "li:nth-child(2)", offset: "end",
    do: ["press:Shift+Tab"], md: "- a\n\nb\n" },

  { name: "Delete pulls the next block up",
    html: "<p>a</p><p>b</p>", sel: "p", offset: "end", do: ["press:Delete"], md: "ab\n" },

  { name: "Delete pulls the next item up",
    html: "<ul><li>a</li><li>b</li></ul>", sel: "li", offset: "end",
    do: ["press:Delete"], md: "- ab\n" },

  { name: "replacing the whole document leaves one clean block",
    html: "<h1>a</h1><p>b</p><ul><li>c</li></ul>", sel: "h1",
    do: ["press:ControlOrMeta+a", "type:fresh"], dom: "^<(h1|p)>fresh</(h1|p)>$" },

  // Typing with the caret stranded in the editor itself rather than in a block:
  // each character used to be wrapped into a paragraph of its own, so a word
  // came out as one paragraph per letter.
  { name: "typing with the caret between blocks does not split every letter",
    html: "<p>It is used for:</p><p>Below.</p>", sel: null, offset: 0,
    do: ["caretInRoot:1", "type:sdfs"],
    check: async (page) => {
      const paras = await page.$$eval("#doc > p", (e) => e.map((x) => x.textContent));
      return paras.filter((t) => t.length === 1).length >= 2
        ? `one paragraph per letter: ${JSON.stringify(paras)}` : null;
    } },

  { name: "typing with the caret after the last block does not split every letter",
    html: "<p>It is used for:</p><p>Below.</p>", sel: null, offset: 0,
    do: ["caretInRoot:2", "type:sdfs"],
    check: async (page) => {
      const paras = await page.$$eval("#doc > p", (e) => e.map((x) => x.textContent));
      return paras.filter((t) => t.length === 1).length >= 2
        ? `one paragraph per letter: ${JSON.stringify(paras)}` : null;
    } },

  { name: "an emptied document is still a paragraph",
    html: "<p><br></p>", sel: "p", do: ["press:Backspace", "press:Backspace", "type:x"], md: "x\n" },

  { name: "editing leaves no inline styles behind",
    html: "<ul><li>a</li><li>b</li></ul>", sel: "li:nth-child(2)",
    do: ["press:Backspace", "type:c"], dom: "^(?:(?!style=)[\\s\\S])*$" },

  /* ---- getting out of a block whose content is text, not prose ---- */
  // A document ending in a code block used to have no obvious way out: Enter
  // added a line inside it, so everything typed next went into the code.
  ...["pre", ".serif-raw", "table"].flatMap((block) => {
    const doc = {
      pre: "<h1>Post</h1><pre><code>let x = 1</code></pre>",
      ".serif-raw": '<h1>Post</h1><div class="serif-raw">&lt;Callout&gt;<br>  hi<br>&lt;/Callout&gt;</div>',
      table: "<h1>Post</h1><table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>",
    }[block];
    const escapes = {
      "ArrowDown at its end": ["caretEnd:" + block, "press:ArrowDown"],
      "Cmd-Enter": ["caretEnd:" + block, "press:Meta+Enter"],
      "Enter on a blank line": ["caretEnd:" + block, "press:Enter", "press:Enter"],
      "a click below it": ["clickBelow"],
    };
    return Object.entries(escapes).map(([how, steps]) => ({
      name: `a list can be started after a ${block === "pre" ? "code block" : block} — ${how}`,
      html: doc,
      do: [...steps, "type:- item"],
      matches: { "#doc": "" },
      check: async (page) => {
        const md = await page.evaluate(() =>
          import("/assets/markdown.js").then(({ toMarkdown }) => toMarkdown(document.getElementById("doc"))));
        return /\n- item\n$/.test(md) ? null : `ended up with ${JSON.stringify(md)}`;
      },
    }));
  }),

  { name: "Enter still writes more than one line of code",
    html: "<h1>P</h1><pre><code>one</code></pre>", sel: "pre", offset: "end",
    do: ["press:Enter", "type:two", "press:Enter", "type:three"],
    md: "# P\n\n```\none\ntwo\nthree\n```\n" },

  { name: "a rendered code block has no phantom blank last line",
    html: "<p>x</p>", sel: "p",
    do: ["press:ControlOrMeta+a", "type:```go", "press:Enter", "type:code", "wait:200"],
    md: "```go\ncode\n```\n" },

  { name: "Cmd-Shift-X strikes text through",
    html: "<p>struck</p>", sel: "p", offset: 0,
    do: ["press:Shift+ArrowRight", "press:Shift+ArrowRight", "press:Shift+ArrowRight",
         "press:Shift+ArrowRight", "press:Shift+ArrowRight", "press:Shift+ArrowRight",
         "press:Meta+Shift+x"],
    md: "~~struck~~\n" },

  /* ---- input rules next to a block that is not prose ---- */
  { name: "a list can be started under a code block",
    html: "<pre><code>x := 1</code></pre><p><br></p>", sel: "p",
    do: ["type:- item"], md: "```\nx := 1\n```\n\n- item\n" },

  { name: "a heading can be started under a code block",
    html: "<pre><code>x := 1</code></pre><p><br></p>", sel: "p",
    do: ["type:# Head"], md: "```\nx := 1\n```\n\n# Head\n" },

  { name: "a quote can be started under a code block",
    html: "<pre><code>x := 1</code></pre><p><br></p>", sel: "p",
    do: ["type:> quoted"], md: "```\nx := 1\n```\n\n> quoted\n" },

  { name: "an ordered list can be started under a code block",
    html: "<pre><code>x := 1</code></pre><p><br></p>", sel: "p",
    do: ["type:1. one"], md: "```\nx := 1\n```\n\n1. one\n" },

  { name: "a list can be started under front matter",
    html: '<div class="serif-front" data-fence="---"><b>title</b>: x</div><p><br></p>',
    sel: "p", do: ["type:- item"], md: "---\ntitle: x\n---\n\n- item\n" },

  { name: "a list can be started under a rule",
    html: "<p>a</p><hr><p><br></p>", sel: "p:last-of-type",
    do: ["type:- item"], md: "a\n\n---\n\n- item\n" },

  { name: "a list can be started under a table",
    html: "<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table><p><br></p>",
    sel: "p", do: ["type:- item"],
    md: "| h   |\n| --- |\n| c   |\n\n- item\n" },

  /* ---- input rules fire only where they should ---- */
  { name: "a hash mid-paragraph is not a heading",
    html: "<p>see</p>", sel: "p", offset: "end", do: ["type: # notaheading"],
    md: "see # notaheading\n" },

  { name: "a dash inside an item is not a new list",
    html: "<ul><li>a</li></ul>", sel: "li", offset: "end", do: ["type: - b"], md: "- a - b\n" },

  { name: "the bold rule fires at the very start of a block",
    html: "<p><br></p>", sel: "p", do: ["type:**hi** there"], md: "**hi** there\n" },

  { name: "the quote rule does not fire inside a quote",
    html: "<blockquote><p>q</p></blockquote>", sel: "blockquote p", offset: "end",
    do: ["type: > x"], md: "> q > x\n" },

  { name: "the task marker ticks a box that is already there",
    html: '<ul><li><input type="checkbox">a</li></ul>', sel: "li", offset: 1, do: [],
    md: "- [ ] a\n" },

  { name: "undo takes back an input rule",
    html: "<p><br></p>", sel: "p", do: ["type:**hi**", "press:Meta+z"], dom: "hi" },
];
