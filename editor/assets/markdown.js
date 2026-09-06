// DOM → Markdown.
//
// The editor's source of truth is the live DOM, so saving means walking it and
// writing the Markdown back out. The document was produced by serif's own
// renderer (see render/editor.go), which is restricted to constructs this file
// knows how to serialize — headings, paragraphs, lists, task lists, quotes,
// code blocks, rules, tables, and the usual inline marks.
//
// Two rules keep the round trip honest:
//
//   1. Escape only what would otherwise change meaning on the way back in.
//     Over-escaping turns "2 * 3" into "2 \* 3" and makes the file unpleasant
//     to read outside the editor.
//   2. Never emit a construct the loader cannot parse back into the same DOM.

/** Zero-width spaces are used as caret parking spots by the input rules. */
const ZWSP = /\u200B/g;

const HEADINGS = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };

/** Marks a block of embedded HTML; see RawHTMLClass in render/editor.go. */
const RAW_CLASS = "serif-raw";

/** Marks the front matter block; see FrontClass in render/editor.go. */
const FRONT_CLASS = "serif-front";

const INLINE_TAGS = new Set([
  "A", "ABBR", "B", "BR", "CODE", "DEL", "EM", "I", "IMG", "INPUT", "KBD",
  "MARK", "S", "SMALL", "SPAN", "STRIKE", "STRONG", "SUB", "SUP", "U",
]);

/** Serialize the editing surface to a Markdown document. */
export function toMarkdown(root) {
  const body = blocks(root.childNodes).join("\n\n").replace(/\n{3,}/g, "\n\n");
  const trimmed = body.trim();
  return trimmed ? trimmed + "\n" : "";
}

/* ---- blocks -------------------------------------------------------------- */

/**
 * Serialize a list of sibling nodes into Markdown blocks. Loose inline nodes
 * (which contenteditable produces when text is typed directly into a
 * container) are gathered into an implicit paragraph.
 */
function blocks(nodes) {
  const out = [];
  let loose = [];

  const flushLoose = () => {
    if (!loose.length) return;
    const text = paragraph(loose);
    loose = [];
    if (text) out.push(text);
  };

  for (const node of nodes) {
    if (isInline(node)) {
      loose.push(node);
      continue;
    }
    flushLoose();
    const md = block(node);
    if (md) out.push(md);
  }
  flushLoose();
  return out;
}

function block(el) {
  if (el.nodeType !== Node.ELEMENT_NODE) return "";

  const tag = el.tagName;
  if (tag in HEADINGS) {
    const text = inline(el).trim();
    return text ? "#".repeat(HEADINGS[tag]) + " " + text : "";
  }

  switch (tag) {
    case "P":
      // A <p> should hold inline content, but contenteditable can nest a block
      // inside one; falling back to container handling keeps the text.
      return Array.from(el.childNodes).every(isInline)
        ? paragraph(el.childNodes)
        : blocks(el.childNodes).join("\n\n");
    case "UL":
    case "OL":
      return list(el);
    case "BLOCKQUOTE":
      return quote(el);
    case "PRE":
      return fence(el);
    case "HR":
      return "---";
    case "TABLE":
      return table(el);
    case "DIV":
      // Front matter and embedded HTML are shown as literal text, and written
      // back untouched — bar the indentation before an HTML block, which a
      // parser discards, so writing it would not survive a reload.
      if (el.classList.contains(FRONT_CLASS)) return front(el);
      if (el.classList.contains(RAW_CLASS)) return trimEdges(codeText(el));
    // contenteditable occasionally leaves a bare <div> wrapper behind; treat it
    // as transparent rather than dropping the text inside it.
    // falls through
    case "SECTION":
    case "ARTICLE":
      return blocks(el.childNodes).join("\n\n");
    default:
      return paragraph(el.childNodes);
  }
}

/** A paragraph: inline content, with anything that looks like block syntax escaped. */
function paragraph(nodes) {
  const text = inlineNodes(nodes).trim();
  if (!text) return "";
  return text.split("\n").map(escapeBlockStart).join("\n");
}

function quote(el) {
  const inner = blocks(el.childNodes).join("\n\n") || "";
  return inner
    .split("\n")
    .map((line) => (line ? "> " + line : ">"))
    .join("\n");
}

function fence(el) {
  const code = el.querySelector("code");
  const lang = el.dataset.lang || languageOf(code) || "";
  const text = codeText(code || el).replace(/\n+$/, "");
  // Use a fence long enough to survive backticks inside the block.
  const longest = (text.match(/`+/g) || []).reduce((n, run) => Math.max(n, run.length), 0);
  const bar = "`".repeat(Math.max(3, longest + 1));
  return bar + lang + "\n" + text + "\n" + bar;
}

/** Indentation and trailing spaces around an HTML block are not part of it. */
function trimEdges(text) {
  return text.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
}

/** Front matter, put back between the fences it arrived in. */
function front(el) {
  const fence = el.dataset.fence || "---";
  // A blank first line is what tells a rule from metadata, so it must never be
  // written — an empty line at the top would stop the block being front matter
  // the next time the file is read.
  const text = codeText(el).replace(/^\n+/, "").replace(/\n+$/, "");
  return `${fence}\n${text}\n${fence}`;
}

function languageOf(code) {
  if (!code) return "";
  const m = /(?:^|\s)language-([\w+-]+)/.exec(code.className || "");
  return m ? m[1] : "";
}

/** Read a code block's text, turning <br> and block wrappers back into newlines. */
function codeText(el) {
  let out = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) out += node.data;
    else if (node.tagName === "BR") out += "\n";
    else if (isInline(node)) out += codeText(node);
    else out += (out && !out.endsWith("\n") ? "\n" : "") + codeText(node);
  }
  return out.replace(ZWSP, "");
}

/* ---- lists --------------------------------------------------------------- */

function list(el) {
  const ordered = el.tagName === "OL";
  const start = Number(el.getAttribute("start")) || 1;
  const lines = [];
  let n = 0;

  for (const li of el.children) {
    if (li.tagName === "UL" || li.tagName === "OL") {
      // A misplaced nested list: indent it under the item just written.
      const nested = list(li);
      if (nested) lines.push(...nested.split("\n").map((l) => (l ? "  " + l : "")));
      continue;
    }
    if (li.tagName !== "LI") continue;

    const box = checkboxOf(li);
    const body = listItem(li);
    if (!body.trim() && !box) continue;

    let marker = ordered ? `${start + n}. ` : "- ";
    if (box) marker += box.checked ? "[x] " : "[ ] ";
    n++;

    const pad = " ".repeat(marker.length);
    const [first = "", ...rest] = body.split("\n");
    lines.push((marker + first).trimEnd());
    for (const line of rest) lines.push(line ? pad + line : "");
  }
  return lines.join("\n");
}

/** Blocks that sit directly under the line above them inside a list item. */
const TIGHT_IN_ITEM = new Set(["UL", "OL", "PRE"]);

/**
 * A list item's body. Nested lists and code hug the line above them — a blank
 * line would make the parent list loose and change how it renders — while a
 * second paragraph gets the usual blank line.
 */
function listItem(li) {
  const parts = [];
  let loose = [];

  const flushLoose = () => {
    if (!loose.length) return;
    const text = paragraph(loose);
    loose = [];
    if (text) parts.push({ md: text, tight: false });
  };

  for (const node of li.childNodes) {
    if (isInline(node)) {
      loose.push(node);
      continue;
    }
    flushLoose();
    const md = block(node);
    if (md) parts.push({ md, tight: TIGHT_IN_ITEM.has(node.tagName) });
  }
  flushLoose();

  return parts.reduce((acc, part, i) => acc + (i ? (part.tight ? "\n" : "\n\n") : "") + part.md, "");
}

function checkboxOf(li) {
  return li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
}

/* ---- tables -------------------------------------------------------------- */

function table(el) {
  const rows = Array.from(el.querySelectorAll("tr"));
  if (!rows.length) return "";

  const cells = (tr) =>
    Array.from(tr.children).map((c) =>
      inline(c).replace(/\s*\n\s*/g, " ").trim().replace(/\|/g, "\\|"));
  const head = cells(rows[0]);
  const body = rows.slice(1).map(cells);
  const width = body.reduce((w, r) => Math.max(w, r.length), head.length);

  const pad = (row) => Array.from({ length: width }, (_, i) => row[i] || "");
  const aligns = pad(Array.from(rows[0].children).map(alignOf));
  const grid = [pad(head), ...body.map(pad)];

  // Column widths, so the delimiters line up the way a person would write them.
  const widths = aligns.map((align, i) =>
    Math.max(3, dashes(align, 3).length, ...grid.map((row) => row[i].length)));

  const line = (cells) =>
    "| " + cells.map((c, i) => padCell(c, widths[i], aligns[i])).join(" | ") + " |";

  return [
    line(grid[0]),
    "| " + aligns.map((a, i) => dashes(a, widths[i])).join(" | ") + " |",
    ...grid.slice(1).map(line),
  ].join("\n");
}

function alignOf(cell) {
  const style = (cell.getAttribute("style") || "").toLowerCase();
  const m = /text-align:\s*(left|center|right)/.exec(style);
  return m ? m[1] : (cell.getAttribute("align") || "").toLowerCase();
}

/** Sit a cell's text where its column alignment says it belongs. */
function padCell(text, width, align) {
  if (align === "right") return text.padStart(width);
  if (align !== "center") return text.padEnd(width);
  const left = Math.floor((width - text.length) / 2);
  return " ".repeat(Math.max(0, left)) + text.padEnd(width - left);
}

/** The delimiter cell for a column, filled out to width. */
function dashes(align, width) {
  const bar = (n) => "-".repeat(Math.max(3, n));
  if (align === "center") return ":" + bar(width - 2) + ":";
  if (align === "right") return bar(width - 1) + ":";
  if (align === "left") return ":" + bar(width - 1);
  return bar(width);
}

/* ---- inline -------------------------------------------------------------- */

function inline(el) {
  return inlineNodes(el.childNodes);
}

function inlineNodes(nodes) {
  let out = "";
  for (const node of nodes) {
    let piece = inlineNode(node);
    // A hard break ends the line, and a parser drops leading whitespace on the
    // next one — so writing it would not survive being read back.
    if (out.endsWith("\n")) piece = piece.replace(/^\s+/, "");
    out += piece;
  }
  return out;
}

function inlineNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return escapeText(node.data);
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  switch (node.tagName) {
    case "BR":
      // Two trailing spaces is the hard-break spelling that survives a
      // round trip through any CommonMark parser.
      return "  \n";
    case "INPUT":
      return ""; // task-list checkbox; already encoded in the list marker
    case "STRONG":
    case "B":
      return wrap(node, "**");
    case "EM":
    case "I":
      return wrap(node, "*");
    case "DEL":
    case "S":
    case "STRIKE":
      return wrap(node, "~~");
    case "CODE":
      return codeSpan(node);
    case "A":
      return link(node);
    case "IMG":
      return image(node);
    default:
      return inline(node);
  }
}

/**
 * Wrap inline content in a delimiter, moving any surrounding whitespace
 * outside it — "** bold**" is not emphasis, but " **bold**" is.
 */
function wrap(node, mark) {
  const inner = inline(node);
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  const [, lead, body, tail] = m;
  return body ? lead + mark + body + tail + mark : inner;
}

function codeSpan(node) {
  const text = node.textContent.replace(ZWSP, "");
  if (!text) return "";
  const longest = (text.match(/`+/g) || []).reduce((n, run) => Math.max(n, run.length), 0);
  const bar = "`".repeat(longest + 1);
  // A space is needed when the content itself starts or ends with a backtick.
  const gap = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return bar + gap + text + gap + bar;
}

function link(node) {
  const href = node.getAttribute("href") || "";
  const text = inline(node);
  if (!href) return text;
  return "[" + text + "](" + encodeTarget(href) + ")";
}

function image(node) {
  const alt = escapeText(node.getAttribute("alt") || "");
  const src = node.getAttribute("src") || "";
  return "![" + alt + "](" + encodeTarget(src) + ")";
}

/** Wrap a URL in angle brackets when it contains characters that would end it early. */
function encodeTarget(url) {
  return /[\s()]/.test(url) ? "<" + url + ">" : url;
}

/* ---- escaping ------------------------------------------------------------ */

/**
 * Escape emphasis markers, but only where they could actually open or close a
 * span — a marker is only meaningful when it sits against a non-space
 * character. This keeps prose like "2 * 3" and "a_b" readable in the file.
 */
export function escapeText(s) {
  return s
    .replace(ZWSP, "")
    .replace(/\u00A0/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/[*_`~]/g, (mark, i, str) => {
      const before = str[i - 1];
      const after = str[i + 1];
      const opens = after && !/\s/.test(after);
      const closes = before && !/\s/.test(before);
      // Strikethrough needs a pair, so a lone "~" (as in "~68 characters")
      // carries no meaning and should stay readable.
      if (mark === "~" && before !== "~" && after !== "~") return mark;
      // "snake_case" is not emphasis in CommonMark, so leave it alone.
      if (mark === "_" && opens && closes) return mark;
      return opens || closes ? "\\" + mark : mark;
    });
}

/** Escape leading text that a parser would otherwise read as a block marker. */
function escapeBlockStart(line) {
  return line
    .replace(/^(\s*)(#{1,6}\s|>|[-+]\s|\d+[.)]\s)/, (_, ws, mark) => ws + "\\" + mark)
    .replace(/^(\s*)([-=_]{3,})\s*$/, (_, ws, rule) => ws + "\\" + rule);
}

/* ---- shared helpers ------------------------------------------------------ */

export function isInline(node) {
  if (node.nodeType === Node.TEXT_NODE) return true;
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  return INLINE_TAGS.has(node.tagName);
}

export { HEADINGS };
