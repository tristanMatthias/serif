// Writing lists.
//
// Every list bug so far has shown up as one of three things: the marker you
// typed is still sitting there, the caret is somewhere you did not put it, or
// the editor has lost focus altogether. Every case here checks all three,
// whatever else it is about.

export const files = { "n.md": "# x\n" };

/** Type a marker somewhere and say what should come of it. */
const rule = (name, { html, sel = "p", type, md, caretIn = "li" }) => ({
  name,
  html, sel,
  do: [`type:${type}`],
  md,
  caretIn,
  focused: true,
  // The marker must be consumed, not left in the item next to the bullet.
  check: async (page) => {
    const stray = await page.$$eval("#doc li, #doc h1, #doc h2, #doc h6, #doc blockquote p",
      (els) => els.map((e) => e.textContent).filter((t) => /^\s*(?:[-*+]|\d+[.)]|#{1,6}|>)\s/.test(t)));
    return stray.length ? `the marker was left behind: ${JSON.stringify(stray)}` : null;
  },
});

export const cases = [
  /* ---- every marker, from an empty paragraph ---- */
  rule("- starts a bullet list", { html: "<p><br></p>", type: "- one", md: "- one\n" }),
  rule("* starts a bullet list", { html: "<p><br></p>", type: "* one", md: "- one\n" }),
  rule("+ starts a bullet list", { html: "<p><br></p>", type: "+ one", md: "- one\n" }),
  rule("1. starts an ordered list", { html: "<p><br></p>", type: "1. one", md: "1. one\n" }),
  rule("1) starts an ordered list", { html: "<p><br></p>", type: "1) one", md: "1. one\n" }),
  rule("# starts a heading", { html: "<p><br></p>", type: "# Head", md: "# Head\n", caretIn: "h1" }),
  rule("###### starts a sixth-level heading",
    { html: "<p><br></p>", type: "###### Six", md: "###### Six\n", caretIn: "h6" }),
  rule("> starts a quote",
    { html: "<p><br></p>", type: "> quoted", md: "> quoted\n", caretIn: "blockquote" }),
  rule("[] starts a task item",
    { html: "<ul><li><br></li></ul>", sel: "li", type: "[] todo", md: "- [ ] todo\n" }),
  rule("[x] starts a ticked task item",
    { html: "<ul><li><br></li></ul>", sel: "li", type: "[x] done", md: "- [x] done\n" }),

  /* ---- the same marker, in every place you might type it ---- */
  rule("a list mid-document", {
    html: "<p>Intro:</p><p><br></p><p>After.</p>", sel: "p:nth-of-type(2)",
    type: "- one", md: "Intro:\n\n- one\n\nAfter.\n" }),
  rule("a list at the end of a document", {
    html: "<p>Intro:</p><p><br></p>", sel: "p:nth-of-type(2)",
    type: "- one", md: "Intro:\n\n- one\n" }),
  rule("a list after a heading", {
    html: "<h1>H</h1><p><br></p>", type: "- one", md: "# H\n\n- one\n" }),
  rule("a list after a code block", {
    html: "<pre><code>x</code></pre><p><br></p>", type: "- one", md: "```\nx\n```\n\n- one\n" }),
  rule("a list after a JSX block", {
    html: '<div class="serif-raw">&lt;C&gt;</div><p><br></p>', type: "- one",
    md: "<C>\n\n- one\n" }),
  rule("a list after front matter", {
    html: '<div class="serif-front" data-fence="---"><b>t</b>: x</div><p><br></p>',
    type: "- one", md: "---\nt: x\n---\n\n- one\n" }),
  rule("a list after a rule", {
    html: "<p>a</p><hr><p><br></p>", sel: "p:last-of-type", type: "- one",
    md: "a\n\n---\n\n- one\n" }),
  rule("a list after a table", {
    html: "<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table><p><br></p>",
    type: "- one", md: "| h   |\n| --- |\n| c   |\n\n- one\n" }),
  rule("a list inside a quote", {
    html: "<blockquote><p><br></p></blockquote>", sel: "blockquote p", type: "- one",
    md: "> - one\n" }),
  rule("a marker in front of text already there", {
    html: "<p>text</p>", type: "- ", md: "- text\n" }),

  /* ---- carrying on writing the list ---- */
  { name: "Enter continues the list and the caret stays in it",
    html: "<p><br></p>", sel: "p",
    do: ["type:- one", "press:Enter", "type:two", "press:Enter", "type:three"],
    md: "- one\n- two\n- three\n", caretIn: "li", focused: true },

  { name: "Tab nests, Shift-Tab unnests, and the caret keeps up",
    html: "<p><br></p>", sel: "p",
    do: ["type:- one", "press:Enter", "type:two", "press:Tab", "press:Enter", "type:three",
         "press:Shift+Tab", "type: back"],
    md: "- one\n  - two\n- three back\n", focused: true },

  { name: "an empty item ends the list and leaves you writing prose",
    html: "<p><br></p>", sel: "p",
    do: ["type:- one", "press:Enter", "press:Enter", "type:after"],
    md: "- one\n\nafter\n", caretIn: "p", focused: true },

  { name: "a numbered list keeps numbering",
    html: "<p><br></p>", sel: "p",
    do: ["type:1. one", "press:Enter", "type:two", "press:Enter", "type:three"],
    md: "1. one\n2. two\n3. three\n", focused: true },

  { name: "task items stay task items as you go",
    html: "<p><br></p>", sel: "p",
    do: ["type:- [] milk", "press:Enter", "type:eggs", "press:Enter", "type:bread"],
    md: "- [ ] milk\n- [ ] eggs\n- [ ] bread\n", focused: true },

  { name: "a list survives being written into an existing document",
    html: "<h1>Title</h1><p>Intro:</p><p>After.</p>", sel: "p:nth-of-type(1)", offset: "end",
    do: ["press:Enter", "type:- one", "press:Enter", "type:two"],
    md: "# Title\n\nIntro:\n\n- one\n- two\n\nAfter.\n", focused: true },

  { name: "typing a whole word into a new item does not split it up",
    html: "<p>Intro:</p><p>After.</p>", sel: "p:nth-of-type(1)", offset: "end",
    do: ["press:Enter", "type:- ", "type:s", "type:d", "type:f", "type:s"],
    md: "Intro:\n\n- sdfs\n\nAfter.\n", caretIn: "li", focused: true },
];
