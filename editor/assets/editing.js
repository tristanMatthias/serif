// Typing behaviour: the Markdown shorthands and keys you expect from an editor.
//
// Everything here goes through document.execCommand. It is a deprecated API,
// but it is the only one that writes to a contenteditable *through the
// browser's own undo stack* — so ⌘Z keeps working across every transformation
// below. Hand-rolled DOM surgery would break that, and an undo that loses your
// paragraph is worse than a deprecation warning.

import { HEADINGS, isInline } from "./markdown.js";

const ZWSP = "\u200B";

/**
 * contenteditable inserts a non-breaking space when you type a space at the end
 * of a line. Every rule below should treat it as an ordinary space, and the
 * substitution is length-preserving so offsets into the result stay valid.
 */
const plainSpaces = (s) => s.replace(/\u00A0/g, " ");

/* ---- selection helpers --------------------------------------------------- */

const selection = () => window.getSelection();

function caretRange() {
  const s = selection();
  return s && s.rangeCount ? s.getRangeAt(0) : null;
}

function caretElement() {
  const r = caretRange();
  if (!r) return null;
  const n = r.startContainer;
  return n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement;
}

/** The nearest ancestor matching a tag, stopping at the editor root. */
function closestTag(root, ...tags) {
  let el = caretElement();
  while (el && el !== root) {
    if (tags.includes(el.tagName)) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Blocks whose content is text, not Markdown: a code block, embedded HTML, or
 * front matter. Inside one, the shorthands are off and Enter is a line break.
 */
const VERBATIM = "pre, .serif-raw, .serif-front";

function closestVerbatim(root) {
  const el = caretElement();
  const box = el && el.closest(VERBATIM);
  return box && root.contains(box) ? box : null;
}

/** The block whose text the caret sits in — a list item, heading, or paragraph. */
function lineBox(root) {
  let el = caretElement();
  let last = null;
  while (el && el !== root) {
    if (el.tagName === "LI" || el.tagName === "PRE" || el.tagName in HEADINGS) return el;
    if (el.tagName === "P") return el;
    last = el;
    el = el.parentElement;
  }
  return last;
}

/** The editor's direct child that contains the caret. */
function topBlock(root) {
  let el = caretElement();
  while (el && el.parentElement && el.parentElement !== root) el = el.parentElement;
  return el && el.parentElement === root ? el : null;
}

function textBefore(container) {
  const r = caretRange();
  if (!r || !container) return "";
  const probe = r.cloneRange();
  probe.setStart(container, 0);
  return plainSpaces(probe.toString());
}

function select(range) {
  const s = selection();
  s.removeAllRanges();
  s.addRange(range);
}

/** Select characters [from, to) of a container's text. */
function selectSpan(container, from, to) {
  const start = pointAt(container, from);
  const end = pointAt(container, to);
  const r = document.createRange();
  r.setStart(start.node, start.offset);
  r.setEnd(end.node, end.offset);
  select(r);
}

const selectLeading = (container, count) => selectSpan(container, 0, count);

function pointAt(container, chars) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let node;
  while ((node = walker.nextNode())) {
    if (seen + node.data.length >= chars) return { node, offset: chars - seen };
    seen += node.data.length;
  }
  return { node: container, offset: container.childNodes.length };
}

function collapsedAtStart(container) {
  const r = caretRange();
  return !!r && r.collapsed && textBefore(container).replace(/\u200B/g, "") === "";
}

function caretAtEnd(container) {
  const r = caretRange();
  if (!r || !r.collapsed) return false;
  const after = r.cloneRange();
  after.selectNodeContents(container);
  after.setStart(r.endContainer, r.endOffset);
  return after.toString().trim() === "";
}

const exec = (cmd, value = null) => document.execCommand(cmd, false, value);

/** How many characters of the editor's text lie before the caret. */
function caretOffsetIn(root) {
  const r = caretRange();
  if (!r) return null;
  const probe = r.cloneRange();
  probe.setStart(root, 0);
  return probe.toString().length;
}

function placeCaretAtOffset(root, offset) {
  const at = pointAt(root, offset);
  placeCaret(at.node, at.offset);
}

function placeCaretAtEnd(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  select(r);
}

function placeCaret(node, offset = 0) {
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  select(r);
}

/* ---- block rules: "# ", "- ", "> " … ------------------------------------- */

const BLOCK_RULES = [
  {
    re: /^(#{1,6}) $/,
    in: (ctx) => !ctx.inList,
    command: (m) => ["formatBlock", `<h${m[1].length}>`],
  },
  {
    re: /^[-*+] $/,
    in: (ctx) => !ctx.inList,
    command: () => ["insertUnorderedList"],
  },
  {
    re: /^\d+[.)] $/,
    in: (ctx) => !ctx.inList,
    command: () => ["insertOrderedList"],
  },
  {
    re: /^> $/,
    in: (ctx) => !ctx.inQuote,
    command: () => ["formatBlock", "<blockquote>"],
  },
  {
    // Task items only make sense inside a list. Typing the marker on an item
    // that already has a box sets it rather than adding a second one.
    re: /^\[([ xX]?)\] $/,
    in: (ctx) => ctx.inList,
    run: (m, ctx) => setTask(ctx.checkbox, m[1].toLowerCase() === "x"),
  },
];

function insertCheckbox(checked) {
  exec("insertHTML", `<input type="checkbox" contenteditable="false"${checked ? " checked" : ""}> `);
}

function setTask(existing, checked) {
  if (!existing) return insertCheckbox(checked);
  existing.checked = checked;
  existing.toggleAttribute("checked", checked);
}

/** Try the block shorthands. Called after a space is typed. */
function runBlockRule(root) {
  if (closestVerbatim(root)) return false;

  const box = lineBox(root);
  if (!box) return false;

  const li = closestTag(root, "LI");
  const ctx = {
    inList: !!li,
    inQuote: !!closestTag(root, "BLOCKQUOTE"),
    checkbox: li && li.querySelector(':scope > input[type="checkbox"]'),
  };

  // A task item's text starts after its checkbox, so there is a space in front
  // of whatever was typed. Rules match from the first real character, and the
  // deletion is offset to match.
  const raw = textBefore(box);
  const lead = raw.length - raw.replace(/^\s+/, "").length;
  const text = raw.slice(lead);

  for (const rule of BLOCK_RULES) {
    const m = rule.re.exec(text);
    if (!m || (rule.in && !rule.in(ctx))) continue;

    // Take the marker out, then change the block. The other order — command
    // first — has to trust that the caret still points at the same block
    // afterwards, and when it does not the marker survives and characters are
    // deleted from a neighbouring block instead.
    selectSpan(box, lead, lead + m[0].length);
    exec("delete");
    if (rule.command) exec(...rule.command(m));
    else rule.run(m, ctx);
    return true;
  }
  return false;
}

/* ---- inline rules: **bold**, `code`, [text](url) … ----------------------- */

const INLINE_RULES = [
  { re: /\*\*([^\s*][^*]*?)\*\*$/, html: (m) => tag("strong", m[1]) },
  { re: /__([^\s_][^_]*?)__$/, html: (m) => tag("strong", m[1]) },
  { re: /(?<![*\\])\*([^\s*][^*]*?)\*$/, html: (m) => tag("em", m[1]) },
  { re: /(?<![\w_\\])_([^\s_][^_]*?)_$/, html: (m) => tag("em", m[1]) },
  { re: /~~([^\s~][^~]*?)~~$/, html: (m) => tag("del", m[1]) },
  { re: /(?<!`)`([^`]+)`$/, html: (m) => tag("code", m[1]) },
  {
    re: /\[([^\]\n]*)\]\(\s*(\S+?)\s*\)$/,
    html: (m) => `<a href="${escapeAttr(m[2])}">${escapeHTML(m[1] || m[2])}</a>`,
  },
];

const tag = (name, text) => `<${name}>${escapeHTML(text)}</${name}>`;

/**
 * Try the inline shorthands against the text just before the caret. Matching is
 * scoped to the caret's own text node: the closing delimiter was just typed, so
 * the whole match is necessarily there, and this keeps a rule from reaching
 * across an element boundary it cannot safely replace.
 */
function runInlineRule(root) {
  if (closestVerbatim(root) || closestTag(root, "CODE")) return false;

  const r = caretRange();
  if (!r || !r.collapsed || r.startContainer.nodeType !== Node.TEXT_NODE) return false;

  const node = r.startContainer;
  const upto = plainSpaces(node.data.slice(0, r.startOffset));

  for (const rule of INLINE_RULES) {
    const m = rule.re.exec(upto);
    if (!m) continue;
    const range = document.createRange();
    range.setStart(node, m.index);
    range.setEnd(node, r.startOffset);
    select(range);
    // The trailing zero-width space parks the caret *outside* the new element,
    // so what you type next is not swallowed by the formatting. The serializer
    // strips it back out.
    exec("insertHTML", rule.html(m) + ZWSP);
    return true;
  }
  return false;
}

/* ---- keys ---------------------------------------------------------------- */

function onEnter(root, e) {
  const verbatim = closestVerbatim(root);
  if (verbatim) {
    e.preventDefault();
    return enterInVerbatim(root, verbatim);
  }

  const box = lineBox(root);
  if (!box) return;
  const text = textBefore(box).trim();

  // ``` opens a code block; --- becomes a horizontal rule.
  if (/^```\S*$/.test(text) && !closestTag(root, "LI", "BLOCKQUOTE")) {
    e.preventDefault();
    return openCodeBlock(box, text.slice(3));
  }
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(text) && box === topBlock(root)) {
    e.preventDefault();
    return insertRule(box);
  }

  // An empty item ends the list; an empty line ends the quote.
  const li = closestTag(root, "LI");
  if (li && isBlank(li)) {
    e.preventDefault();
    exec("outdent");
    tidyEscapedBlock(root);
    return;
  }
  if (closestTag(root, "BLOCKQUOTE") && isBlank(box)) {
    e.preventDefault();
    exec("outdent");
    exec("formatBlock", "<p>");
    return;
  }

  // Splitting a task item gives another task item — a checklist you have to
  // re-tick every line is not a checklist.
  if (li && li.querySelector(':scope > input[type="checkbox"]')) {
    e.preventDefault();
    exec("insertParagraph");
    insertCheckbox(false);
    return;
  }

  // A heading is a title, not a paragraph style: pressing Enter anywhere in one
  // should leave exactly one heading behind.
  if (box.tagName in HEADINGS) {
    e.preventDefault();
    if (collapsedAtStart(box)) return openLineAbove(root);
    // Whatever ends up after the caret is body text.
    exec("insertParagraph");
    exec("formatBlock", "<p>");
  }
}

/**
 * Enter at the start of a block: open an empty paragraph above it and stay
 * where you are. Splitting leaves a copy of the block's own tag above, so that
 * copy is turned into a paragraph before the caret goes back.
 */
function openLineAbove(root) {
  exec("insertParagraph");
  const below = topBlock(root);
  const above = below && below.previousElementSibling;
  if (!above) return;

  placeCaret(above, 0);
  exec("formatBlock", "<p>");
  placeCaret(below, 0);
}

function enterInVerbatim(root, box) {
  // A blank line at the end of the block is the way out of it. Judging that on
  // the last line rather than on the raw text matters: a rendered code block
  // carries a trailing newline of its own, and matching against it made Enter
  // add a line inside the block when it looked like it had left.
  const before = verbatimText(box, "before");
  const lastLine = before.slice(before.lastIndexOf("\n") + 1);
  // A break inside a <pre> comes with a filler <br> after it, so that the empty
  // line has something to occupy it. The caret sits between the two, and that
  // filler is not content: one trailing newline still counts as the end.
  const after = verbatimText(box, "after");
  const atEnd = after === "" || after === "\n";

  if (atEnd && before.includes("\n") && lastLine.trim() === "") {
    trimTrailingBreak(box);
    placeCaret(paragraphAfter(box), 0);
    return;
  }
  exec("insertLineBreak");
}

/**
 * The text on one side of the caret within a block, counting <br> as the line
 * break it is. Range.toString() joins text nodes only, so to it a code block
 * full of <br>s looks like a single line.
 */
function verbatimText(box, side) {
  const r = caretRange();
  if (!r) return "";
  const probe = r.cloneRange();
  if (side === "before") probe.setStart(box, 0);
  else probe.setEnd(box, box.childNodes.length);
  return withBreaks(probe.cloneContents());
}

function withBreaks(node) {
  let out = "";
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) out += child.data;
    else if (child.tagName === "BR") out += "\n";
    else out += withBreaks(child);
  }
  return plainSpaces(out);
}

/** A fresh empty paragraph after a block, ready to be typed into. */
function paragraphAfter(block) {
  const p = document.createElement("p");
  p.appendChild(document.createElement("br"));
  block.after(p);
  return p;
}

/**
 * Down-arrow past the last block. Without this a document that ends in a code
 * block, a table or a rule has nothing after it to move to, and no obvious way
 * to start writing again.
 */
function onArrowDown(root, e) {
  const block = topBlock(root);
  if (!block || block.nextElementSibling) return;
  if (!block.matches(`${VERBATIM}, table, hr`)) return;
  if (!caretAtEnd(block)) return;
  e.preventDefault();
  placeCaret(paragraphAfter(block), 0);
}

/** Drop the blank line the caret was sitting on before leaving the block. */
function trimTrailingBreak(box) {
  const holder = box.querySelector("code") ?? box;
  for (let last = holder.lastChild; last; last = holder.lastChild) {
    if (last.nodeType === Node.TEXT_NODE) {
      const trimmed = last.data.replace(/\n+$/, "");
      if (trimmed === last.data) return;
      last.data = trimmed;
      if (last.data) return;
      last.remove();
    } else if (last.tagName === "BR") {
      last.remove();
    } else {
      return;
    }
  }
}

function openCodeBlock(box, lang) {
  selectLeading(box, box.textContent.length);
  exec("delete");
  exec("formatBlock", "<pre>");
  const pre = caretElement()?.closest("pre");
  if (pre && lang) pre.dataset.lang = lang;
}

function insertRule(box) {
  selectLeading(box, box.textContent.length);
  exec("delete");
  exec("insertHTML", "<hr><p><br></p>");
}

function onBackspace(root, e) {
  if (closestVerbatim(root)) return;
  const box = lineBox(root);
  if (!box || !collapsedAtStart(box)) return;

  if (box.tagName in HEADINGS) {
    e.preventDefault();
    exec("formatBlock", "<p>");
    return;
  }

  // A task item sheds its checkbox before it sheds its bullet.
  const li = closestTag(root, "LI");
  const check = li && li.querySelector(':scope > input[type="checkbox"]');
  if (check) {
    e.preventDefault();
    const r = document.createRange();
    r.selectNode(check);
    select(r);
    exec("delete");
    return;
  }

  if (li) {
    e.preventDefault();
    // Nested items only shed a level, and the browser handles that well.
    // Leaving the list altogether it does not: it drops the caret into the
    // block below. That one is done by hand so the caret lands where you can
    // carry on typing.
    if (li.parentElement.parentElement.closest("li")) {
      exec("outdent");
      tidyEscapedBlock(root);
    } else {
      liftItem(li);
    }
    return;
  }

  if (closestTag(root, "BLOCKQUOTE")) {
    e.preventDefault();
    exec("outdent");
    tidyEscapedBlock(root);
    return;
  }

  // Merging into a code block, embedded HTML, or front matter would pour the
  // paragraph's text into something that is not prose.
  const prev = topBlock(root)?.previousElementSibling;
  if (prev && prev.matches(VERBATIM)) e.preventDefault();
}

/**
 * Take an item out of its list: it becomes a paragraph where the list was, and
 * any items below it carry on in a list of their own.
 */
function liftItem(li) {
  const list = li.parentElement;
  const p = document.createElement("p");
  const nested = [];

  for (const node of [...li.childNodes]) {
    if (node.tagName === "UL" || node.tagName === "OL") nested.push(node);
    else p.appendChild(node);
  }
  if (!p.childNodes.length) p.appendChild(document.createElement("br"));

  let rest = null;
  if (li.nextElementSibling) {
    rest = document.createElement(list.tagName);
    while (li.nextSibling) rest.appendChild(li.nextSibling);
  }
  li.remove();

  list.after(p);
  let tail = p;
  for (const sub of nested) {
    tail.after(sub);
    tail = sub;
  }
  if (rest) tail.after(rest);
  if (!list.children.length) list.remove();

  placeCaret(p, 0);
}

/**
 * After outdenting out of a list or quote, the browser can leave a bare <div>
 * behind. Only that is worth fixing — reformatting whatever block the caret
 * happens to be in would rewrite the innocent heading below.
 */
function tidyEscapedBlock(root) {
  const block = topBlock(root);
  if (block && block.tagName === "DIV") exec("formatBlock", "<p>");
}

/** Whether a hard break can be written where the caret is. */
function canBreak(root) {
  const box = lineBox(root);
  if (box && box.tagName in HEADINGS) return false;
  return !closestTag(root, "TD", "TH");
}

function onTab(root, e) {
  e.preventDefault();
  if (closestVerbatim(root)) {
    if (!e.shiftKey) exec("insertText", "  ");
    return;
  }
  const li = closestTag(root, "LI");
  if (li) {
    // An item can only nest under the one above it; the first item in a list
    // has nothing to nest under, and indenting it anyway writes a bullet that
    // reads back as an ordinary one.
    if (e.shiftKey) {
      // outdent moves the right item but can leave the caret in the one above
      // it, so the next thing typed lands in the wrong place. Put it back where
      // it was, in the item that actually moved.
      // outdent rebuilds the item, so neither the element nor the text node
      // survives to put the caret back on — and left alone the caret stays in
      // the item above, where the next thing typed does not belong. The text
      // itself is only moved, never changed, so its offset within the document
      // is what to hold on to.
      const offset = caretOffsetIn(root);
      exec("outdent");
      if (offset !== null) placeCaretAtOffset(root, offset);
    } else if (li.previousElementSibling?.tagName === "LI") {
      exec("indent");
    }
    return;
  }
  if (!e.shiftKey) exec("insertText", "  ");
}

/** Toggle (or add) the checkbox on the current list item. */
function toggleTask(root) {
  const li = closestTag(root, "LI");
  if (!li) return false;
  const box = li.querySelector(':scope > input[type="checkbox"]');
  if (box) {
    box.checked = !box.checked;
    box.toggleAttribute("checked", box.checked);
  } else {
    const r = caretRange();
    placeCaret(li, 0);
    insertCheckbox(false);
    if (r) select(r);
  }
  return true;
}

function promptLink() {
  const url = window.prompt("Link to:");
  if (url) exec("createLink", url.trim());
}

const HEADING_KEYS = { 1: "<h1>", 2: "<h2>", 3: "<h3>", 4: "<h4>", 5: "<h5>", 6: "<h6>", 0: "<p>" };

function onKeyDown(root, e, hooks) {
  const mod = e.metaKey || e.ctrlKey;

  if (mod && e.altKey && e.key in HEADING_KEYS) {
    e.preventDefault();
    return exec("formatBlock", HEADING_KEYS[e.key]);
  }
  if (mod && !e.altKey) {
    switch (e.key.toLowerCase()) {
      case "s":
        e.preventDefault();
        return hooks.save();
      case "b":
        e.preventDefault();
        return exec("bold");
      case "i":
        e.preventDefault();
        return exec("italic");
      case "x":
        if (!e.shiftKey) return;
        e.preventDefault();
        return exec("strikeThrough");
      case "k":
        // Plain Cmd-K opens the file picker (handled in editor.js); adding
        // Shift keeps a shortcut for linking.
        if (!e.shiftKey) return;
        e.preventDefault();
        return promptLink();
      case "enter": {
        // Inside a code or HTML block this is the way straight out; in a list
        // it ticks the item. The two can never both apply.
        const box = closestVerbatim(root);
        if (box) {
          e.preventDefault();
          placeCaret(paragraphAfter(box), 0);
          return hooks.changed();
        }
        if (toggleTask(root)) {
          e.preventDefault();
          hooks.changed();
        }
        return;
      }
    }
  }

  switch (e.key) {
    case "Enter":
      // A hard break has no spelling inside a heading or a table cell, so
      // Shift-Enter there does what plain Enter does rather than writing
      // something the file cannot hold.
      if (!e.shiftKey || !canBreak(root)) onEnter(root, e);
      return;
    case "Backspace":
      return onBackspace(root, e);
    case "Tab":
      return onTab(root, e);
    case "ArrowDown":
      return onArrowDown(root, e);
  }
}

/* ---- structure ----------------------------------------------------------- */

/**
 * Repair the structures the browser's list commands leave behind. Both are
 * invalid HTML that renders wrong and serializes worse, and both are produced
 * by execCommand itself rather than by anything the user did.
 */
function repairStructure(root) {
  // insertUnorderedList run inside a paragraph wraps the list in it:
  //   <p><ul><li>…</li></ul></p>
  for (const p of root.querySelectorAll("p")) {
    if (Array.from(p.childNodes).some((n) => !isInline(n))) {
      p.replaceWith(...p.childNodes);
    }
  }
  // indent nests the new list beside the item it belongs to, not inside it:
  //   <ul><li>a</li><ul><li>b</li></ul></ul>
  for (const list of root.querySelectorAll("ul, ol")) {
    const parent = list.parentElement;
    if (!parent || (parent.tagName !== "UL" && parent.tagName !== "OL")) continue;
    const prev = list.previousElementSibling;
    if (prev && prev.tagName === "LI") prev.appendChild(list);
    // A nested list with no item above it is not nested under anything; its
    // items belong to the list that holds it.
    else list.replaceWith(...list.children);
  }
  // outdent can leave an item inside the item it came from:
  //   <ul><li>a<li>b</li></li></ul>
  // Only a *direct* child counts — an item inside a nested <ul> is meant to be
  // there, and lifting it out would flatten the list.
  for (const item of root.querySelectorAll("li > li")) {
    item.parentElement.after(item);
  }
  // Both commands like to stamp the computed font size onto what they move.
  // It carries no meaning, so the attribute goes — but the element stays: this
  // runs on every keystroke, and unwrapping a node the caret is inside moves
  // the caret out from under the typist.
  // Table cells are the exception: their text-align is the column's alignment,
  // which is part of the document.
  for (const styled of root.querySelectorAll("[style]:not(th):not(td)")) {
    styled.removeAttribute("style");
  }
}

/**
 * Keep the editor's children block-level. contenteditable will happily leave a
 * bare text node at the top when the document is emptied and retyped; wrapping
 * it keeps every later assumption (and the serializer) honest.
 */
function normalize(root) {
  repairStructure(root);

  const anchor = caretRange()?.startContainer ?? null;
  let stray = [];
  const wrap = () => {
    if (!stray.length) return;
    const p = document.createElement("p");
    stray[0].before(p);
    const moved = stray;
    stray = [];
    moved.forEach((n) => p.appendChild(n));

    // The caret has to come too. Left behind in the editor itself, the next
    // character lands outside a block again and gets a paragraph of its own —
    // which is how typing a word turns it into one paragraph per letter.
    if (anchor === root || moved.includes(anchor)) placeCaretAtEnd(p);
  };

  for (const node of Array.from(root.childNodes)) {
    if (isInline(node)) {
      if (node.nodeType === Node.TEXT_NODE && !node.data.trim()) node.remove();
      else stray.push(node);
    } else {
      wrap();
    }
  }
  wrap();

  if (!root.firstChild) {
    root.innerHTML = "<p><br></p>";
  }
}

/** Task checkboxes arrive disabled from the renderer; make them clickable. */
function enableCheckboxes(root) {
  for (const box of root.querySelectorAll('input[type="checkbox"]')) {
    box.removeAttribute("disabled");
    box.setAttribute("contenteditable", "false");
  }
}

/**
 * A rendered code block ends with a newline that belongs to the HTML, not to
 * the code. Left in, it shows as a blank last line and puts the end of the
 * block a line below the end of the code.
 */
function trimCodeBlocks(root) {
  for (const code of root.querySelectorAll("pre > code")) {
    const last = code.lastChild;
    if (last?.nodeType === Node.TEXT_NODE && last.data.endsWith("\n")) {
      last.data = last.data.replace(/\n$/, "");
      if (!last.data) last.remove();
    }
  }
}

/* ---- install ------------------------------------------------------------- */

/**
 * Wire the editing behaviour onto a contenteditable element.
 *
 * hooks.changed()  the document was edited
 * hooks.save()     the user asked for an explicit save
 * hooks.paste(md)  pasted plain text, to be turned into HTML by the caller
 */
export function install(root, hooks) {
  exec("defaultParagraphSeparator", "p");
  exec("styleWithCSS", "false");

  root.addEventListener("keydown", (e) => onKeyDown(root, e, hooks));

  root.addEventListener("input", (e) => {
    if (e.inputType === "insertText" && e.data) {
      if (e.data === " ") runBlockRule(root);
      else runInlineRule(root);
    }
    normalize(root);
    hooks.changed();
  });

  root.addEventListener("change", (e) => {
    if (e.target.type === "checkbox") {
      e.target.toggleAttribute("checked", e.target.checked);
      hooks.changed();
    }
  });

  root.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    hooks.paste(text);
  });

  // Clicking the empty space under the last block should start a new paragraph
  // there, rather than doing nothing. The whole sheet counts, not just the
  // column the text sits in.
  const sheet = root.closest(".sheet") ?? root.parentElement;
  sheet.addEventListener("mousedown", (e) => {
    const last = root.lastElementChild;
    if (!last || (e.target !== sheet && e.target !== root.parentElement)) return;
    if (e.clientY <= last.getBoundingClientRect().bottom) return;
    if (last.tagName === "P" && isBlank(last)) return;
    e.preventDefault();
    placeCaret(paragraphAfter(last), 0);
    hooks.changed();
  });

  return {
    /** Replace the document, e.g. after loading or reloading from disk. */
    setHTML(html) {
      root.innerHTML = html;
      enableCheckboxes(root);
      trimCodeBlocks(root);
      normalize(root);
    },
    /** Insert rendered HTML at the caret (used for paste). */
    insertHTML(html) {
      root.focus();
      exec("insertHTML", html);
      enableCheckboxes(root);
      trimCodeBlocks(root);
      normalize(root);
    },
  };
}

/* ---- small helpers ------------------------------------------------------- */

function isBlank(el) {
  return el.textContent.replace(/\u200B/g, "").trim() === "";
}

function escapeHTML(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

function escapeAttr(s) {
  return escapeHTML(s).replace(/"/g, "&quot;");
}
