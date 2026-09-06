// The file picker: a filter box over the workspace's Markdown files.
//
// It is opened often and glanced at briefly, so it is built to feel instant.
// The last file list is kept and rendered immediately on open, while a fresh
// one is fetched in the background; matching is a single pass per file; and the
// result list is capped, because nobody picks the 300th match.

import { fileName } from "./prompt.js";

/** Most rows to build. Beyond this the filter is the right tool, not scrolling. */
const MAX_ROWS = 60;

export function createPicker({ list, onChoose, onCreate }) {
  const root = document.getElementById("picker");
  const input = document.getElementById("picker-input");
  const listEl = document.getElementById("picker-list");
  const emptyEl = document.getElementById("picker-empty");

  let files = [];
  let shown = [];
  let active = 0;
  let current = "";

  /* ---- rendering ---- */

  function render() {
    const query = input.value.trim();
    const found = (query ? rank(files, query) : recentFirst(files)).slice(0, MAX_ROWS);

    // Typing the name of a file that is not there is how you say you want it:
    // the last row offers to make it. It sits below the matches and is never
    // preselected, so Enter still opens the file you were looking for.
    const wanted = query && fileName(query);
    shown = wanted && !files.some((f) => sameName(f.path, wanted))
      ? [...found, { create: wanted }]
      : found;
    active = 0;

    listEl.replaceChildren(...shown.map((file, i) => row(file, i, query)));
    emptyEl.hidden = shown.length > 0;
    highlight();
  }

  function row(file, i, query) {
    const li = document.createElement("li");
    li.className = "picker-row";
    li.setAttribute("role", "option");
    li.dataset.index = i;
    if (file.create) return createRow(li, file.create);
    if (file.path === current) li.classList.add("is-current");

    const name = document.createElement("span");
    name.className = "picker-row-name";
    name.append(...mark(file.name, query));
    li.append(name);

    if (file.dir) {
      const dir = document.createElement("span");
      dir.className = "picker-row-dir";
      dir.textContent = file.dir;
      li.append(dir);
    }
    return li;
  }

  function createRow(li, path) {
    li.classList.add("is-create");
    const name = document.createElement("span");
    name.className = "picker-row-name";
    const b = document.createElement("b");
    b.textContent = path;
    name.append("Create ", b);

    const label = document.createElement("span");
    label.className = "picker-row-dir";
    label.textContent = "New file";
    li.append(name, label);
    return li;
  }

  /** Bold the characters the query actually matched, so a hit is legible. */
  function mark(text, query) {
    if (!query) return [document.createTextNode(text)];
    const hits = subsequence(text.toLowerCase(), query.toLowerCase());
    if (!hits) return [document.createTextNode(text)];

    const out = [];
    let at = 0;
    for (const i of hits) {
      if (i > at) out.push(document.createTextNode(text.slice(at, i)));
      const b = document.createElement("b");
      b.textContent = text[i];
      out.push(b);
      at = i + 1;
    }
    if (at < text.length) out.push(document.createTextNode(text.slice(at)));
    return out;
  }

  function highlight() {
    for (const [i, li] of [...listEl.children].entries()) {
      li.classList.toggle("is-active", i === active);
      if (i === active) li.scrollIntoView({ block: "nearest" });
    }
  }

  function move(delta) {
    if (!shown.length) return;
    active = (active + delta + shown.length) % shown.length;
    highlight();
  }

  /* ---- open / close ---- */

  async function open(currentPath) {
    current = currentPath;
    input.value = "";
    root.hidden = false;
    render();               // paint whatever we already know, immediately
    input.focus();

    const fresh = await list();   // then reconcile with the server
    if (fresh) {
      files = fresh;
      if (!root.hidden) render();
    }
  }

  function close() {
    root.hidden = true;
  }

  function choose(i = active) {
    const file = shown[i];
    close();
    if (!file) return;
    if (file.create) return onCreate(file.create);
    if (file.path !== current) onChoose(file.path);
  }

  /* ---- events ---- */

  input.addEventListener("input", render);

  input.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); return move(1);
      case "ArrowUp": e.preventDefault(); return move(-1);
      case "Enter": e.preventDefault(); return choose();
      case "Escape": e.preventDefault(); return close();
    }
  });

  listEl.addEventListener("click", (e) => {
    const li = e.target.closest(".picker-row");
    if (li) choose(Number(li.dataset.index));
  });

  root.addEventListener("mousedown", (e) => {
    if (e.target === root) close();
  });

  return { open, close, isOpen: () => !root.hidden, prime: (f) => { files = f; } };
}

/* ---- matching ------------------------------------------------------------ */

// Whether a name is taken, judged the way the filesystems people use judge it:
// offering to create README.md next to Readme.md is offering a failure.
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

/** Newest first — with no query, the file you want is usually the last one you touched. */
function recentFirst(files) {
  return [...files].sort((a, b) => b.modified - a.modified);
}

/**
 * Rank files against a query. Scoring rewards matches that are contiguous and
 * that start a word, which is what makes "rn" find "release-notes.md".
 */
function rank(files, query) {
  const q = query.toLowerCase();
  const scored = [];
  for (const file of files) {
    const onName = score(file.name.toLowerCase(), q);
    const onPath = score(file.path.toLowerCase(), q);
    // A hit in the file name is worth more than one buried in a directory.
    const best = Math.max(onName * 2, onPath);
    if (best > 0) scored.push({ file, best });
  }
  scored.sort((a, b) => b.best - a.best || a.file.path.localeCompare(b.file.path));
  return scored.map((s) => s.file);
}

function score(text, query) {
  let at = 0;
  let total = 0;
  let streak = 0;
  for (const ch of query) {
    const i = text.indexOf(ch, at);
    if (i < 0) return 0;
    streak = i === at && at > 0 ? streak + 1 : 0;
    total += 1 + streak;                                  // contiguous runs
    if (i === 0 || /[^a-z0-9]/.test(text[i - 1])) total += 3; // word starts
    at = i + 1;
  }
  // Shorter targets are better matches for the same query.
  return total + Math.max(0, 20 - text.length) / 20;
}

/** The indices in text that match query as a subsequence, or null. */
function subsequence(text, query) {
  const hits = [];
  let at = 0;
  for (const ch of query) {
    const i = text.indexOf(ch, at);
    if (i < 0) return null;
    hits.push(i);
    at = i + 1;
  }
  return hits;
}
