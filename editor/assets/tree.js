// The file tree: the workspace as a shape, with the open file located in it.
//
// It answers a different question from the picker. The picker is for "open the
// file I can name"; the tree is for "where does this one sit, and what is next
// to it?". Both are built from the same flat list the server already returns —
// the nesting is derived here rather than fetched.
//
// Folders are <details>, so opening and closing them, and reaching them from
// the keyboard, is the browser's job rather than ours.

const SHOWN_KEY = "serif-tree-shown";
const OPEN_KEY = "serif-tree-open";

export function createTree({ onChoose, onRename, onNew }) {
  const panel = document.getElementById("tree");
  const rootEl = document.getElementById("tree-root");
  const nameEl = document.getElementById("tree-name");
  const toggle = document.getElementById("tree-toggle");
  document.getElementById("tree-new").addEventListener("click", () => onNew());

  let current = "";
  /** Signature of the rendered list, so an unchanged tree is not rebuilt. */
  let rendered = "";
  /** Paths of the folders the reader has open. */
  let expanded = new Set(load(OPEN_KEY, []));

  /* ---- visibility ---- */

  function shown() {
    return !panel.hidden;
  }

  function setShown(on) {
    panel.hidden = !on;
    toggle.setAttribute("aria-expanded", String(on));
    save(SHOWN_KEY, on);
    if (on) revealCurrent();
  }

  /* ---- building ---- */

  /**
   * Group a flat list of paths into nested nodes. Folders sort before files,
   * alphabetically within each — the order you would write them down in.
   */
  function build(files) {
    const root = { dirs: new Map(), files: [] };

    for (const file of files) {
      let node = root;
      const parts = file.path.split("/");
      const name = parts.pop();
      let sofar = "";
      for (const part of parts) {
        sofar = sofar ? `${sofar}/${part}` : part;
        if (!node.dirs.has(part)) node.dirs.set(part, { path: sofar, dirs: new Map(), files: [] });
        node = node.dirs.get(part);
      }
      node.files.push({ name, path: file.path });
    }
    return root;
  }

  function listFor(node) {
    const ul = document.createElement("ul");
    ul.className = "tree-list";

    for (const [name, dir] of [...node.dirs].sort(byName)) {
      ul.append(folderItem(name, dir));
    }
    for (const file of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
      ul.append(fileItem(file));
    }
    return ul;
  }

  const byName = (a, b) => a[0].localeCompare(b[0]);

  function folderItem(name, dir) {
    const li = document.createElement("li");
    const details = document.createElement("details");
    details.className = "tree-folder";
    details.dataset.path = dir.path;
    details.open = expanded.has(dir.path);

    const summary = document.createElement("summary");
    summary.className = "tree-row";
    summary.append(chevron(), text(name));
    details.append(summary, listFor(dir));

    details.addEventListener("toggle", () => {
      details.open ? expanded.add(dir.path) : expanded.delete(dir.path);
      save(OPEN_KEY, [...expanded]);
    });

    li.append(details);
    return li;
  }

  function fileItem(file) {
    const li = document.createElement("li");
    li.className = "tree-item";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tree-row tree-file";
    btn.dataset.path = file.path;
    btn.append(text(file.name));
    btn.addEventListener("click", () => {
      if (file.path !== current) onChoose(file.path);
    });

    // A sibling rather than a child: a button inside a button is not markup a
    // browser will honour, and the row has to stay one click target.
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "tree-action";
    rename.dataset.path = file.path;
    rename.title = `Rename or move ${file.name}`;
    rename.setAttribute("aria-label", `Rename or move ${file.name}`);
    rename.append(pencil());
    rename.addEventListener("click", () => onRename(file.path));

    li.append(btn, rename);
    return li;
  }

  function icon(d) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    return svg;
  }

  function chevron() {
    const svg = icon("M6 3.5L10.5 8L6 12.5");
    svg.setAttribute("class", "tree-chevron");
    return svg;
  }

  function pencil() {
    const svg = icon("M11.4 2.9l1.7 1.7-7.3 7.3-2.3.6.6-2.3z");
    svg.setAttribute("class", "tree-pencil");
    return svg;
  }

  const text = (s) => {
    const span = document.createElement("span");
    span.className = "tree-label";
    span.textContent = s;
    return span;
  };

  /* ---- current file ---- */

  function mark() {
    for (const btn of rootEl.querySelectorAll(".tree-file")) {
      const isCurrent = btn.dataset.path === current;
      btn.classList.toggle("is-current", isCurrent);
      if (isCurrent) btn.setAttribute("aria-current", "true");
      else btn.removeAttribute("aria-current");
    }
  }

  /** Open the folders above the current file and scroll it into view. */
  function revealCurrent() {
    if (!current) return;
    const btn = rootEl.querySelector(`.tree-file[data-path="${cssEscape(current)}"]`);
    if (!btn) return;
    for (let el = btn.closest("details"); el; el = el.parentElement.closest("details")) {
      el.open = true;
    }
    if (shown()) btn.scrollIntoView({ block: "nearest" });
  }

  return {
    /** Rebuild from a file list, skipping the work when nothing has changed. */
    render(files) {
      if (!files) return;
      const signature = files.map((f) => f.path).join("\n");
      if (signature !== rendered) {
        rendered = signature;
        rootEl.replaceChildren(listFor(build(files)));
      }
      mark();
      revealCurrent();
    },

    /** Point the tree at a different file. */
    select(path) {
      current = path;
      mark();
      revealCurrent();
    },

    /** Show the toggle and restore the reader's last choice. */
    enable(name) {
      nameEl.textContent = name;
      toggle.hidden = false;
      setShown(load(SHOWN_KEY, false));
    },


    toggle: () => setShown(!shown()),
    shown,
  };
}

/* ---- helpers ------------------------------------------------------------- */

// Storage is a convenience, never a requirement: a private window or blocked
// site data must not stop the tree from working.
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* nothing to do */
  }
}

const cssEscape = (s) => (window.CSS?.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&"));
