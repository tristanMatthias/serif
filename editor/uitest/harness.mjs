// The test vocabulary.
//
// A case is a row of data, not a script: what document to start from, what to
// do, and what should then be true. Everything imperative lives here so the
// suites stay readable as tables.
//
//   { name:  "Enter at the start of a heading keeps it a heading",
//     html:  "<h1>Hello</h1><p>Body</p>", sel: "h1", offset: 0,
//     do:    ["press:Enter"],
//     md:    "# Hello\n\nBody\n",
//     dom:   "^<p><br></p><h1>Hello</h1>" }
//
// Set-up
//   html / sel / offset   load a document and put the caret in it
//                         (offset may be a number or "end"; omit to keep the
//                         document the group opened with)
// Actions — `do` is a list of steps
//   press:<Key>           a key, e.g. press:Enter, press:Meta+k
//   type:<text>           typed text
//   click:<selector>      a click
//   fill:<sel>=<value>    set an input's value
//   blur:<selector>       take focus off something
//   write:<path>=<text>   change a file on disk, behind the editor's back
//   reload                reload the page
//   settle                wait until the editor reports itself saved
//   wait:<ms>             a plain pause, for when nothing better will do
// Expectations — give whichever the case is about
//   md                    the whole document as Markdown
//   dom                   a regular expression over the editing surface
//   caret                 "TOP/INNER" tag pair for where the caret finished
//   focused               the editor still has focus and holds the caret
//   caretIn               a selector the caret must be inside
//   file / files          exact contents on disk
//   visible / hidden      selectors
//   text / matches        selector → exact text / regular expression
//   count                 selector → how many should match
//   attr                  "selector@attribute" → value

import fs from "node:fs";
import path from "node:path";

/* ---- page helpers -------------------------------------------------------- */

export async function installHelpers(page) {
  await page.evaluate(() => {
    // Record every save state the title bar passes through, so a case can
    // assert the sequence rather than catch it mid-flight.
    const status = document.getElementById("status");
    if (status && !window.__states) {
      window.__states = [status.dataset.state];
      new MutationObserver(() => window.__states.push(status.dataset.state))
        .observe(status, { attributes: true, attributeFilter: ["data-state"] });
    }

    window.__setup = (html, sel, offset) => {
      const doc = document.getElementById("doc");
      doc.innerHTML = html;
      for (const box of doc.querySelectorAll('input[type="checkbox"]')) {
        box.setAttribute("contenteditable", "false");
      }
      const el = sel === null ? doc : doc.querySelector(sel);
      if (!el) throw new Error(`no element matches ${sel}`);

      const want = offset === "end" ? el.textContent.length : offset;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let seen = 0;
      let node;
      let point = null;
      while ((node = walker.nextNode())) {
        if (seen + node.data.length >= want) {
          point = { node, offset: want - seen };
          break;
        }
        seen += node.data.length;
      }
      const r = document.createRange();
      if (point) r.setStart(point.node, point.offset);
      else r.selectNodeContents(el);
      r.collapse(true);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      doc.focus();
    };

    window.__inspect = () =>
      import("/assets/markdown.js").then(({ toMarkdown }) => {
        const doc = document.getElementById("doc");
        const s = getSelection();
        let caret = "none";
        let caretInside = false;
        if (s.rangeCount) {
          const n = s.getRangeAt(0).startContainer;
          caretInside = doc.contains(n);
          const el = n.nodeType === 1 ? n : n.parentElement;
          let top = el;
          while (top && top.parentElement && top.parentElement !== doc) top = top.parentElement;
          const inner = el?.closest("li, pre, blockquote, h1, h2, h3, h4, p, td, th") || top;
          caret = `${top ? top.tagName : "?"}/${inner ? inner.tagName : "?"}`;
        }
        return {
          md: toMarkdown(doc),
          html: doc.innerHTML.replace(/​/g, ""),
          text: doc.textContent.replace(/[\s ​]+/g, " ").trim(),
          caret,
          caretInside,
          focused: document.activeElement === doc || doc.contains(document.activeElement),
          faults: window.__faults(doc),
        };
      });

    /**
     * Rules the editing surface must satisfy whatever was typed. They are what
     * lets the generated matrix judge a case without an expected answer.
     */
    window.__faults = (doc) => {
      const faults = [];
      const BLOCKS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL",
        "BLOCKQUOTE", "PRE", "HR", "TABLE", "DIV"]);

      for (const child of doc.children) {
        if (!BLOCKS.has(child.tagName)) faults.push(`top-level <${child.tagName.toLowerCase()}>`);
      }
      for (const node of doc.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.data.trim()) faults.push("bare text at the top level");
      }
      if (doc.querySelector("li > li")) faults.push("<li> directly inside <li>");
      if (doc.querySelector("p p, p ul, p ol, p blockquote, p pre, p table")) {
        faults.push("block element inside <p>");
      }
      for (const list of doc.querySelectorAll("ul, ol")) {
        if (!list.children.length) faults.push("empty list");
        for (const child of list.children) {
          if (!["LI", "UL", "OL"].includes(child.tagName)) {
            faults.push(`<${child.tagName.toLowerCase()}> directly inside a list`);
          }
        }
      }
      // Column alignment is the only inline style the document owns.
      for (const styled of doc.querySelectorAll("[style]")) {
        if (styled.tagName !== "TH" && styled.tagName !== "TD") {
          faults.push(`inline style on <${styled.tagName.toLowerCase()}>`);
        }
      }
      if (!doc.firstChild) faults.push("no blocks at all");
      return [...new Set(faults)];
    };
  });
}

/* ---- steps --------------------------------------------------------------- */

const STEPS = {
  press: (page, arg) => page.keyboard.press(arg),
  type: (page, arg) => page.keyboard.type(arg, { delay: 6 }),
  click: (page, arg) => page.click(arg),
  blur: (page, arg) => page.$eval(arg, (el) => el.blur()),
  wait: (page, arg) => page.waitForTimeout(Number(arg)),
  fill: (page, arg) => {
    const [sel, value = ""] = splitOnce(arg, "=");
    return page.fill(sel, value);
  },
  reload: async (page) => {
    await page.reload();
    await page.waitForSelector("#doc");
    await page.waitForTimeout(400);
  },
  // Put the caret at the end of an element, for cases that start mid-document.
  caretEnd: (page, arg) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      document.getElementById("doc").focus();
    }, arg),
  // Strand the caret in the editor itself, between blocks rather than in one.
  caretInRoot: (page, arg) =>
    page.evaluate((offset) => {
      const doc = document.getElementById("doc");
      const r = document.createRange();
      r.setStart(doc, Number(offset));
      r.collapse(true);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      doc.focus();
    }, arg),
  // Click the empty space below the document.
  clickBelow: async (page) => {
    const at = await page.$eval("#doc", (d) => {
      const r = d.getBoundingClientRect();
      return { x: r.x + 20, y: r.bottom + 50 };
    });
    await page.mouse.click(at.x, at.y);
  },
  // Answer the prompt the link shortcut opens.
  link: async (page, arg) => {
    page.once("dialog", (d) => d.accept(arg));
    await page.keyboard.press("Meta+Shift+k");
  },
  settle: (page) =>
    page.waitForFunction(() => document.getElementById("status")?.dataset.state === "saved",
      null, { timeout: 4000 }).catch(() => {}),
};

export async function perform(page, dir, steps) {
  for (const step of steps) {
    const [verb, arg] = splitOnce(step, ":");
    if (verb === "write") {
      const [rel, body] = splitOnce(arg, "=");
      fs.writeFileSync(path.join(dir, rel), body.replace(/\\n/g, "\n"));
      continue;
    }
    const fn = STEPS[verb];
    if (!fn) throw new Error(`unknown step "${step}"`);
    await fn(page, arg);
  }
}

const splitOnce = (s, sep) => {
  const i = s.indexOf(sep);
  return i < 0 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)];
};

/* ---- expectations -------------------------------------------------------- */

async function judge(page, dir, spec) {
  const failures = [];
  const say = (what, want, got) => failures.push(`${what}\n  want: ${want}\n  got : ${got}`);

  const needsDoc =
    spec.md !== undefined || spec.dom || spec.caret || spec.focused !== undefined || spec.caretIn;
  const got = needsDoc ? await page.evaluate(() => window.__inspect()) : null;

  if (spec.md !== undefined && got.md !== spec.md) {
    say("markdown", JSON.stringify(spec.md), JSON.stringify(got.md));
  }
  if (spec.dom && !new RegExp(spec.dom).test(got.html)) {
    say("dom", spec.dom, got.html.slice(0, 240));
  }
  if (spec.caret && got.caret !== spec.caret) say("caret", spec.caret, got.caret);

  // Losing focus, or leaving the caret outside the document, is a bug on its
  // own: whatever the markup says, you cannot carry on typing.
  if (spec.focused !== undefined && got.focused !== spec.focused) {
    say("focus", String(spec.focused), String(got.focused));
  }
  if (spec.focused && !got.caretInside) say("caret", "inside the document", "outside it");

  if (spec.caretIn) {
    const inside = await page.evaluate((sel) => {
      const s = getSelection();
      if (!s.rangeCount) return false;
      const n = s.getRangeAt(0).startContainer;
      const el = n.nodeType === 1 ? n : n.parentElement;
      return !!el?.closest(sel);
    }, spec.caretIn);
    if (!inside) say(`caret inside ${spec.caretIn}`, "yes", "no");
  }

  for (const [rel, want] of Object.entries(spec.files ?? {})) {
    const onDisk = read(dir, rel);
    if (onDisk !== want) say(`file ${rel}`, JSON.stringify(want), JSON.stringify(onDisk));
  }
  if (spec.file !== undefined) {
    const rel = fs.readdirSync(dir).find((f) => f.endsWith(".md"));
    const onDisk = read(dir, rel);
    if (onDisk !== spec.file) say(`file ${rel}`, JSON.stringify(spec.file), JSON.stringify(onDisk));
  }
  for (const [rel, pattern] of Object.entries(spec.fileMatches ?? {})) {
    const onDisk = read(dir, rel);
    if (!new RegExp(pattern).test(onDisk)) say(`file ${rel}`, pattern, JSON.stringify(onDisk));
  }

  for (const sel of list(spec.visible)) {
    if (!(await page.isVisible(sel))) say(`visible ${sel}`, "shown", "hidden");
  }
  for (const sel of list(spec.hidden)) {
    if (await page.isVisible(sel)) say(`hidden ${sel}`, "hidden", "shown");
  }
  for (const [sel, want] of Object.entries(spec.text ?? {})) {
    const got = await page.textContent(sel).catch(() => null);
    if (got !== want) say(`text ${sel}`, JSON.stringify(want), JSON.stringify(got));
  }
  for (const [sel, pattern] of Object.entries(spec.matches ?? {})) {
    const got = (await page.textContent(sel).catch(() => null)) ?? "";
    if (!new RegExp(pattern).test(got)) say(`text ${sel}`, pattern, JSON.stringify(got));
  }
  for (const [sel, want] of Object.entries(spec.count ?? {})) {
    const got = (await page.$$(sel)).length;
    if (got !== want) say(`count ${sel}`, String(want), String(got));
  }
  for (const [key, want] of Object.entries(spec.attr ?? {})) {
    const [sel, name] = splitOnce(key, "@");
    const got = await page.getAttribute(sel, name).catch(() => null);
    if (got !== want) say(`attribute ${key}`, JSON.stringify(want), JSON.stringify(got));
  }
  if (spec.check) {
    const problem = await spec.check(page, dir);
    if (problem) failures.push(problem);
  }
  return failures;
}

const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const read = (dir, rel) => {
  try {
    return fs.readFileSync(path.join(dir, rel), "utf8");
  } catch {
    return null;
  }
};

/* ---- the loop ------------------------------------------------------------ */

/** Run a table of cases against an open page. */
export async function runCases(ctx, { page, dir }, cases) {
  for (const spec of cases) {
    try {
      if (spec.html !== undefined) {
        await page.evaluate(([h, s, o]) => window.__setup(h, s, o),
          [spec.html, spec.sel ?? null, spec.offset ?? 0]);
      }
      await perform(page, dir, spec.do ?? []);
      await page.waitForTimeout(spec.pause ?? 80);
      const failures = await judge(page, dir, spec);
      ctx.record(spec.name, failures.length === 0, failures.join("\n"));
    } catch (err) {
      ctx.record(spec.name, false, String(err).split("\n").slice(0, 2).join("\n"));
    }
  }
}
