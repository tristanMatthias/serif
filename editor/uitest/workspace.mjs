// A directory of files: the tree, the picker, the title bar, and front matter.

const NOTES = {
  "index.md": "# Index\n\nTop level.\n",
  "release-notes.md": "# Release notes\n",
  "reading-list.md": "# Reading list\n",
  "notes/daily.md": "# Daily\n",
  "notes/standup.md": "# Standup\n",
  "notes/deep/archive.md": "# Archive\n\nOld.\n",
  "projects/serif.md": "# serif\n",
  "keys.env": "TOKEN=hunter2\n",
};

const POST = `---
title: Shipping the editor
date: 2026-09-02
tags:
  - serif
draft: true
---

# Shipping the editor

Body text.
`;

export const groups = [
  {
    name: "browsing",
    files: NOTES,
    viewport: { width: 1200, height: 800 },
    cases: [
      { name: "a directory opens its shallowest file",
        do: ["wait:400"], text: { "#doc h1": "Index", "#doc-name": "index.md" } },

      /* ---- picker ---- */
      { name: "clicking the name opens the picker",
        do: ["click:#doc-name", "wait:300"], visible: "#picker" },

      { name: "every Markdown file is listed, and nothing else",
        do: [], count: { ".picker-row": 7 },
        check: async (page) => {
          const rows = await page.$$eval(".picker-row-name", (e) => e.map((x) => x.textContent));
          return rows.some((r) => r.includes("keys")) ? `keys.env was listed: ${rows}` : null;
        } },

      { name: "filtering matches by subsequence",
        do: ["fill:#picker-input=rn", "wait:200"],
        text: { ".picker-row:first-child .picker-row-name": "release-notes.md" },
        check: async (page) =>
          (await page.$$(".picker-row-name b")).length ? null : "matched characters were not marked" },

      { name: "Enter opens the highlighted file",
        do: ["press:Enter", "wait:600"],
        text: { "#doc h1": "Release notes", "#doc-name": "release-notes.md" }, hidden: "#picker" },

      { name: "Cmd-K opens the picker",
        do: ["press:Meta+k", "wait:250"], visible: "#picker" },

      { name: "Escape closes it from anywhere",
        do: ["blur:#picker-input", "press:Escape", "wait:200"], hidden: "#picker" },

      { name: "Cmd-P finds a nested file",
        do: ["press:Meta+p", "wait:250", "fill:#picker-input=archive", "wait:200",
             "press:Enter", "wait:600"],
        text: { "#doc h1": "Archive", "#doc-name": "notes/deep/archive.md" } },

      /* ---- tree ---- */
      { name: "the tree is hidden until asked for", do: [], hidden: "#tree" },

      { name: "the toggle opens the tree",
        do: ["click:#tree-toggle", "wait:300"],
        visible: "#tree", attr: { "#tree-toggle@aria-expanded": "true" } },

      { name: "folders are listed, and sort before files",
        do: [],
        check: async (page) => {
          const folders = (await page.$$eval(".tree-folder > .tree-row .tree-label",
            (e) => e.map((x) => x.textContent))).sort();
          if (String(folders) !== "deep,notes,projects") return `folders were ${folders}`;
          const top = await page.$$eval("#tree-root > .tree-list > li",
            (e) => e.map((li) => li.querySelector(".tree-label").textContent));
          return top.slice(0, 2).join() === "notes,projects" ? null : `top level was ${top}`;
        } },

      { name: "the open file is highlighted where it sits, with its folders opened",
        do: [], text: { ".tree-file.is-current .tree-label": "archive.md" },
        check: async (page) =>
          (await page.$eval(".tree-folder[data-path='notes/deep']", (e) => e.open))
            ? null : "the folders above the open file were left closed" },

      { name: "clicking a file in the tree opens it",
        do: ["click:.tree-file[data-path='notes/standup.md']", "wait:700"],
        text: { "#doc h1": "Standup" } },

      { name: "Cmd-backslash toggles the tree",
        do: ["press:Meta+\\", "wait:250"], hidden: "#tree" },

      /* ---- editing across files ---- */
      { name: "edits go to the open file and leave the others alone",
        do: ["press:Meta+\\", "click:#doc", "press:End", "type: edited", "settle"],
        fileMatches: { "notes/standup.md": "edited" },
        files: { "index.md": NOTES["index.md"] } },

      { name: "unsaved work is flushed before switching",
        do: ["type: more", "press:Meta+k", "wait:250", "fill:#picker-input=index", "wait:200",
             "press:Enter", "wait:900"],
        fileMatches: { "notes/standup.md": "edited more" } },

      { name: "the tree remembers whether it was open",
        do: ["reload"], visible: "#tree" },
    ],
  },

  {
    name: "making and moving files",
    files: {
      "index.md": "# Index\n\nTop level.\n",
      "notes/daily.md": "# Daily\n",
    },
    viewport: { width: 1200, height: 800 },
    cases: [
      /* ---- making ---- */
      { name: "the picker offers to make a file it cannot find",
        do: ["press:Meta+k", "wait:250", "fill:#picker-input=ideas", "wait:200"],
        visible: ".picker-row.is-create",
        text: { ".picker-row.is-create .picker-row-name b": "ideas.md" } },

      { name: "a name that is already taken is not offered again",
        do: ["fill:#picker-input=index.md", "wait:200"],
        count: { ".picker-row.is-create": 0, ".picker-row": 1 } },

      { name: "Enter on the offer makes the file and opens it",
        do: ["fill:#picker-input=ideas", "wait:200", "press:Enter", "wait:700"],
        hidden: "#picker", text: { "#doc-name": "ideas.md" }, files: { "ideas.md": "" } },

      { name: "and what you type next goes into it",
        do: ["click:#doc", "type:# Ideas", "settle"],
        files: { "ideas.md": "# Ideas\n", "index.md": "# Index\n\nTop level.\n" } },

      { name: "the new file joins the listing",
        do: ["press:Meta+k", "wait:350"], count: { ".picker-row": 3 } },

      { name: "Cmd-Alt-N asks for a name",
        do: ["press:Escape", "wait:150", "press:Meta+Alt+n", "wait:250"],
        visible: "#prompt", text: { "#prompt-ok": "Create" } },

      { name: "a path in the name files it, making the folders",
        do: ["fill:#prompt-input=notes/2026/plan", "wait:120", "press:Enter", "wait:800"],
        hidden: "#prompt", text: { "#doc-name": "notes/2026/plan.md" },
        files: { "notes/2026/plan.md": "" } },

      { name: "Escape leaves nothing behind",
        do: ["press:Meta+Alt+n", "wait:250", "fill:#prompt-input=never", "wait:120",
             "press:Escape", "wait:250"],
        hidden: "#prompt", files: { "never.md": null } },

      /* ---- moving ---- */
      { name: "F2 offers to move the open file, starting from where it is",
        do: ["press:F2", "wait:250"],
        visible: "#prompt", text: { "#prompt-ok": "Move" },
        check: async (page) => {
          const value = await page.inputValue("#prompt-input");
          if (value !== "notes/2026/plan.md") return `the box held ${JSON.stringify(value)}`;
          // The name is selected and the folder and extension are not, because
          // those are the parts you usually keep.
          const [from, to] = await page.$eval("#prompt-input", (el) => [el.selectionStart, el.selectionEnd]);
          return value.slice(from, to) === "plan" ? null : `selected ${value.slice(from, to)}`;
        } },

      { name: "moving it takes the document with it",
        do: ["fill:#prompt-input=notes/2026/roadmap", "wait:120", "press:Enter", "wait:800"],
        hidden: "#prompt", text: { "#doc-name": "notes/2026/roadmap.md" },
        files: { "notes/2026/roadmap.md": "", "notes/2026/plan.md": null } },

      { name: "unsaved work is written before the file moves",
        do: ["click:#doc", "type:Nearly there", "press:F2", "wait:250",
             "fill:#prompt-input=notes/2026/final", "wait:120", "press:Enter", "wait:900"],
        text: { "#doc-name": "notes/2026/final.md" },
        files: { "notes/2026/final.md": "Nearly there\n", "notes/2026/roadmap.md": null } },

      { name: "a name already taken is refused, in the box, with the name still in it",
        do: ["press:F2", "wait:250", "fill:#prompt-input=index", "wait:120",
             "press:Enter", "wait:700"],
        visible: ["#prompt", ".prompt-hint.is-error"],
        files: { "index.md": "# Index\n\nTop level.\n",
                 "notes/2026/final.md": "Nearly there\n" } },

      { name: "the tree moves a file you are not in, and stays where you are",
        do: ["press:Escape", "wait:200", "click:#tree-toggle", "wait:300",
             "click:.tree-action[data-path='notes/daily.md']", "wait:250",
             "fill:#prompt-input=notes/journal", "wait:120", "press:Enter", "wait:800"],
        text: { "#doc-name": "notes/2026/final.md" },
        files: { "notes/journal.md": "# Daily\n", "notes/daily.md": null } },

      { name: "the tree's own button makes one too",
        do: ["click:#tree-new", "wait:250"],
        visible: "#prompt", text: { "#prompt-ok": "Create" } },

      // Moving the open file reloads it from its new path, so with a conflict
      // unanswered that would quietly drop the version on screen.
      { name: "a file changed underneath you is not moved until you have chosen",
        do: ["press:Escape", "wait:150", "click:#doc", "press:End", "type: MINE",
             "write:notes/2026/final.md=# Theirs\\n", "wait:2200",
             "press:F2", "wait:250", "fill:#prompt-input=notes/2026/elsewhere", "wait:120",
             "press:Enter", "wait:700"],
        visible: ["#prompt", ".prompt-hint.is-error", "#notice"],
        files: { "notes/2026/elsewhere.md": null, "notes/2026/final.md": "# Theirs\n" } },
    ],
  },

  {
    name: "an empty folder",
    files: {},
    cases: [
      { name: "opens with an offer rather than an error",
        do: ["wait:500"], visible: "#notice",
        text: { "#notice-primary": "New file", "#status-text": "No files yet" } },

      { name: "and nothing to type into, so nothing can be lost",
        do: [], attr: { "#doc@contenteditable": "false" } },

      { name: "the offer makes the first file",
        do: ["click:#notice-primary", "wait:250", "fill:#prompt-input=first", "wait:120",
             "press:Enter", "wait:800"],
        hidden: ["#prompt", "#notice"], text: { "#doc-name": "first.md" },
        files: { "first.md": "" }, attr: { "#doc@contenteditable": "true" } },

      { name: "and then it is an editor again",
        do: ["click:#doc", "type:Hello", "settle"], files: { "first.md": "Hello\n" } },
    ],
  },

  {
    name: "title bar",
    files: { "n.md": "# Index\n\nBody.\n" },
    cases: [
      { name: "a check marks a saved document",
        do: ["settle"], visible: ".status-check", hidden: ".status-spinner",
        matches: { "#status-text": "^Saved" } },

      { name: "the connection dot is green",
        do: [],
        check: async (page) => {
          const [r, g, b] = (await page.$eval("#link", (el) => getComputedStyle(el).backgroundColor))
            .match(/\d+/g).map(Number);
          return g > r + 25 && g > b + 25 ? null : `dot was rgb(${r}, ${g}, ${b})`;
        } },

      { name: "typing shows unsaved, then a spinner, then saved",
        do: ["click:#doc", "type:x", "wait:1500"],
        text: { "#status-text": "Saved just now" },
        check: async (page) => {
          const seen = await page.evaluate(() => window.__states ?? []);
          for (const want of ["dirty", "saving", "saved"]) {
            if (!seen.includes(want)) return `never showed "${want}": ${JSON.stringify(seen)}`;
          }
          return seen.at(-1) === "saved" ? null : `settled on ${seen.at(-1)}`;
        } },

      { name: "Cmd-Shift-K still inserts a link",
        do: ["press:End", "type:linkme",
             "press:Shift+ArrowLeft", "press:Shift+ArrowLeft", "press:Shift+ArrowLeft",
             "press:Shift+ArrowLeft", "press:Shift+ArrowLeft", "press:Shift+ArrowLeft",
             "link:https://example.com", "wait:500"],
        count: { "#doc a[href='https://example.com']": 1 } },
    ],
  },

  {
    name: "front matter",
    files: { "post.md": POST },
    cases: [
      { name: "front matter becomes a labelled card, not a heading",
        do: ["wait:400"], visible: ".serif-front", count: { "#doc h2": 0, ".serif-front b": 4 },
        text: { "#doc h1": "Shipping the editor" },
        check: async (page) =>
          (await page.$eval(".serif-front", (e) => getComputedStyle(e, "::before").content))
            .includes("Front matter") ? null : "the card had no label" },

      { name: "it does not count as writing",
        do: [], text: { "#count": "5 words" } },

      { name: "it round-trips byte for byte, and opening it writes nothing",
        do: [], md: POST, file: POST },

      { name: "Markdown shorthands stay off inside it",
        do: ["caretEnd:.serif-front", "press:Enter", "type:# a comment",
             "press:Enter", "type:- item", "wait:900"],
        count: { ".serif-front": 1, ".serif-front ul": 0 },
        file: POST.replace("draft: true\n---", "draft: true\n# a comment\n- item\n---") },
    ],
  },
];
