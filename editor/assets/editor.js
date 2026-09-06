// The editor application: load a file, keep it saved, keep it in sync.
//
// Structure lives in markdown.js (DOM → Markdown), editing.js (typing
// behaviour) and picker.js (the file list). This file is the wiring — network,
// autosave, and the title bar.

import { toMarkdown } from "./markdown.js";
import { install } from "./editing.js";
import { createPicker } from "./picker.js";
import { createTree } from "./tree.js";
import { createPrompt, extOf } from "./prompt.js";

/** How long to wait after the last keystroke before writing to disk. */
const SAVE_DEBOUNCE = 500;
/** Save at least this often while you are typing continuously. */
const SAVE_MAX_WAIT = 2500;

const doc = document.getElementById("doc");
const nameEl = document.getElementById("doc-name");
const linkEl = document.getElementById("link");
const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("status-text");
const countEl = document.getElementById("count");
const notice = document.getElementById("notice");
const noticeText = document.getElementById("notice-text");
const noticePrimary = document.getElementById("notice-primary");
const noticeSecondary = document.getElementById("notice-secondary");

/** Everything the editor knows about the file it is editing. */
const state = {
  path: "",      // workspace-relative path of the open file
  rev: "",       // revision last seen on disk
  saved: "",     // Markdown last known to be on disk
  dirty: false,
  saving: false,
  conflict: false,
  savedAt: 0,      // epoch ms of the last known save, for "Saved 2 min ago"
  workspace: null, // { root, name, isDir }
};

let timer = null;
let firstEditAt = 0;
let events = null;

const surface = install(doc, {
  changed: onChanged,
  save: () => flush(),
  paste: onPaste,
});

const picker = createPicker({
  list: listFiles,
  onChoose: switchTo,
  // The name was typed into the picker already, so there is nothing left to
  // ask: the row makes the file, and only a refusal needs somewhere to go.
  onCreate: async (name) => {
    const problem = await createFile(name);
    if (problem) showNotice(problem, { label: "Got it", run: () => {} });
  },
});
const tree = createTree({ onChoose: switchTo, onRename: renameFile, onNew: () => newFile() });
const prompt = createPrompt({ onClose: () => doc.focus() });
const treeToggle = document.getElementById("tree-toggle");

/* ---- title bar ----------------------------------------------------------- */

function setStatus(text, stateName) {
  statusTextEl.textContent = text;
  statusEl.dataset.state = stateName;
}

/** "Saved just now", "Saved 12 min ago" — the answer to "did that go through?". */
function showSaved() {
  setStatus(state.savedAt ? `Saved ${ago(state.savedAt)}` : "Saved", "saved");
}

function ago(at) {
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

// One timer keeps the relative time honest. It idles while the tab is hidden,
// and the label is refreshed on the way back so it is never stale on screen.
setInterval(() => {
  if (document.visibilityState === "visible" && statusEl.dataset.state === "saved") showSaved();
}, 15000);

/**
 * The dot reports the connection, not the save: it is the answer to "is this
 * page still talking to the server?", which is the thing you cannot infer from
 * anything else on screen.
 */
function setLink(linkState, hint) {
  linkEl.dataset.link = linkState;
  linkEl.title = hint;
}

function setName() {
  // With no file open — an empty workspace — the bar names the folder instead,
  // so the picker is still one click away.
  const label = state.path || (state.workspace?.isDir ? `${state.workspace.name}/` : "");
  nameEl.textContent = label;
  nameEl.hidden = !label;
  document.title = `${label || "serif"} — serif`;
  if (state.workspace?.isDir) {
    nameEl.disabled = false;
    nameEl.title = `Open another file in ${state.workspace.name} (${modKey()}K)`;
  } else {
    nameEl.disabled = true;
    nameEl.title = state.workspace?.root ?? "";
  }
}

const modKey = () => (navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl-");

// Front matter is metadata, not writing, so it does not count towards the
// word count. Walking the top-level blocks avoids cloning the document.
function updateCount() {
  let n = 0;
  for (const block of doc.children) {
    if (block.classList.contains("serif-front")) continue;
    const words = block.textContent.match(/\S+/g);
    if (words) n += words.length;
  }
  countEl.textContent = n === 1 ? "1 word" : `${n} words`;
}

/**
 * Show the notice bar. `primary` and `secondary` are optional
 * { label, run } actions; both buttons dismiss the bar after running.
 */
function showNotice(message, primary, secondary) {
  noticeText.textContent = message;
  for (const [btn, action] of [[noticePrimary, primary], [noticeSecondary, secondary]]) {
    btn.hidden = !action;
    if (action) {
      btn.textContent = action.label;
      btn.onclick = () => {
        hideNotice();
        action.run();
      };
    }
  }
  notice.hidden = false;
}

function hideNotice() {
  notice.hidden = true;
  state.conflict = false;
}

/* ---- network ------------------------------------------------------------- */

async function api(path, options) {
  try {
    const res = await fetch(path, options);
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch {
    // The stream reports connection state; a failed request only needs to not
    // be mistaken for a successful one.
    return { ok: false, status: 0, body: {} };
  }
}

async function listFiles() {
  const { ok, body } = await api("/api/files");
  if (!ok) return null;
  state.workspace = { root: body.root, name: body.name, isDir: body.isDir };
  if (body.isDir) tree.render(body.files);
  return body.files;
}

/* ---- loading ------------------------------------------------------------- */

async function start() {
  const files = await listFiles();
  if (files) picker.prime(files);
  if (state.workspace?.isDir) tree.enable(state.workspace.name);

  const { ok, body } = await api("/api/doc");
  if (!ok) {
    setStatus(body.error || "Could not open the file", "error");
    setLink("offline", "Not connected");
    return;
  }
  if (!body.path) return openEmpty();

  adopt(body);
  doc.focus();
  warnIfReformatting(body.text);
  watch();
}

/**
 * A directory with no Markdown in it yet. There is nothing to type into, so the
 * surface is put beyond reach rather than accepting words it would drop, and
 * the notice offers the one thing that can be done from here.
 */
function openEmpty() {
  state.path = "";
  state.rev = "";
  state.saved = "";
  state.dirty = false;
  doc.setAttribute("contenteditable", "false");
  surface.setHTML("");
  updateCount();
  setName();
  setStatus("No files yet", "");
  showNotice(`Nothing in ${state.workspace?.name ?? "here"} yet.`,
    { label: "New file", run: () => newFile() });
  watch();   // no document to follow, but the connection is still worth showing
}

/** Switch the editor to another file, saving the current one first. */
async function switchTo(path) {
  if (state.dirty) await flush();

  const { ok, body } = await api(`/api/doc?path=${encodeURIComponent(path)}`);
  if (!ok) {
    setStatus(body.error || "Could not open that file", "error");
    return;
  }
  adopt(body);
  doc.focus();
  warnIfReformatting(body.text);
  watch();   // re-point the stream at the new file
}

/** Adopt a document from the server as the new on-disk truth. */
function adopt(payload) {
  doc.setAttribute("contenteditable", "true");
  surface.setHTML(payload.html);
  state.path = payload.path;
  state.rev = payload.rev;
  state.saved = payload.text;
  state.savedAt = payload.modified ? payload.modified * 1000 : 0;
  state.dirty = false;
  updateCount();
  hideNotice();
  setName();
  showSaved();
  tree.select(state.path);
}

/**
 * The editor writes Markdown in its own house style, so a file using syntax it
 * does not model — reference-style links, hand-aligned tables — comes back
 * slightly rewritten. Nothing is written until you type, so say so first rather
 * than reformatting the file behind your back.
 */
function warnIfReformatting(original) {
  const rewritten = toMarkdown(doc);
  if (rewritten === original) return;

  const before = original.split("\n");
  const after = rewritten.split("\n");
  let changed = Math.abs(before.length - after.length);
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    if (before[i] !== after[i]) changed++;
  }
  showNotice(
    `Saving will reformat this file (${changed} ${changed === 1 ? "line" : "lines"}).`,
    { label: "Got it", run: () => {} },
  );
}

/* ---- making and moving files --------------------------------------------- */

/** The folder a path sits in, slash and all — "" at the top level. */
const folderOf = (path) => path.replace(/[^/]*$/, "");

/**
 * Make a file and open it. Returns the reason it could not be made, so the box
 * that asked for the name can say so where the name still is.
 */
async function createFile(name) {
  if (state.dirty) await flush();

  const { ok, body } = await api("/api/doc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: name }),
  });
  if (!ok) return body.error || "Could not create that file";

  await openDoc(body);
  return null;
}

/**
 * Ask for a name, then make the file. The box starts on the folder the open
 * file is in, because a new note usually belongs beside the one that prompted
 * it — and a path typed into it files the note as it names it.
 */
function newFile(seed) {
  picker.close();   // the two boxes ask different questions; only one at a time
  prompt.open({
    title: "New file",
    action: "Create",
    value: seed ?? folderOf(state.path),
    select: seed ? "stem" : "end",
    hint: "A name, or a path — folders are made as needed.",
    submit: createFile,
  });
}

/**
 * Rename a file, or move it under another folder. They are the same gesture:
 * where a note is filed is part of what it is called.
 */
function renameFile(path) {
  picker.close();
  prompt.open({
    title: "Rename or move",
    action: "Move",
    value: path,
    select: "stem",
    ext: extOf(path),
    hint: "A new name, or a path to file it under.",
    submit: async (to) => {
      // Moving the open file reloads it from its new path. With a conflict
      // still unanswered the save below would not go through, so that reload
      // would throw away the version on screen — the choice comes first.
      if (path === state.path && state.conflict) {
        return "Choose which version to keep before moving this file";
      }
      if (state.dirty) await flush();

      const { ok, body } = await api("/api/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: path, to }),
      });
      if (!ok) return body.error || "Could not move that file";

      // Moving the file you are in should not interrupt you: the same document
      // comes back at its new path and the editor carries on with it.
      if (path === state.path) await openDoc(body);
      else await refreshFiles();
      return null;
    },
  });
}

/** Take on a document the server has just made or moved for us. */
async function openDoc(payload) {
  adopt(payload);
  doc.focus();
  watch();
  await refreshFiles();
}

async function refreshFiles() {
  const files = await listFiles();
  if (files) picker.prime(files);
}

/* ---- saving -------------------------------------------------------------- */

function onChanged() {
  state.dirty = true;
  updateCount();
  if (!state.conflict) setStatus("Unsaved", "dirty");

  if (!firstEditAt) firstEditAt = Date.now();
  clearTimeout(timer);

  // Debounce, but never let a continuous typing run go unsaved for long.
  if (Date.now() - firstEditAt >= SAVE_MAX_WAIT) return void flush();
  timer = setTimeout(flush, SAVE_DEBOUNCE);
}

async function flush({ force = false } = {}) {
  clearTimeout(timer);
  firstEditAt = 0;

  if (state.saving || !state.path) return;
  if (state.conflict && !force) return;

  const text = toMarkdown(doc);
  if (text === state.saved && !force) {
    state.dirty = false;
    showSaved();
    return;
  }

  state.saving = true;
  setStatus("Saving…", "saving");

  const { ok, status, body } = await api("/api/doc", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: state.path, text, rev: state.rev, force }),
  });
  state.saving = false;

  if (status === 409) {
    onConflict(`${body.name || "This file"} was changed by something else.`);
    return;
  }
  if (!ok) {
    setStatus(status === 0 ? "Offline — not saved" : body.error || "Could not save", "error");
    return;
  }

  state.rev = body.rev;
  state.saved = text;
  state.savedAt = Date.now();
  state.dirty = false;
  showSaved();
}

function onConflict(message) {
  state.conflict = true;
  setStatus("Changed on disk", "error");
  showNotice(
    message,
    { label: "Keep mine", run: () => flush({ force: true }) },
    { label: "Load theirs", run: reload },
  );
}

async function reload() {
  const { ok, body } = await api(`/api/doc?path=${encodeURIComponent(state.path)}`);
  if (ok) adopt(body);
}

/* ---- pasting ------------------------------------------------------------- */

// Pasted text is Markdown as far as the editor is concerned, so it goes through
// the same renderer the document was loaded with — paste a list and you get a
// list, not a paragraph full of hyphens.
async function onPaste(text) {
  const { ok, body } = await api("/api/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  surface.insertHTML(ok && body.html ? body.html : escapeHTML(text));
  onChanged();
}

function escapeHTML(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

/* ---- staying in sync ----------------------------------------------------- */

// One EventSource does two jobs: it reports edits made to the file by anything
// else, and its own state is the connection indicator. EventSource reconnects
// on its own, so a dropped server comes back without a reload.
function watch() {
  events?.close();
  events = new EventSource(`/api/events?path=${encodeURIComponent(state.path)}`);

  events.onopen = () => setLink("online", "Connected");
  events.onerror = () => setLink("offline", "Not connected — reconnecting");

  events.addEventListener("rev", async (e) => {
    const rev = e.data;
    if (!rev || rev === state.rev || state.saving) return;

    // The file changed underneath us. Clean editors just take the new version.
    if (!state.dirty) return void reload();
    onConflict("This file was changed by something else while you were editing.");
  });
}

/* ---- lifecycle ----------------------------------------------------------- */

nameEl.addEventListener("click", () => {
  if (state.workspace?.isDir) picker.open(state.path);
});

treeToggle.addEventListener("click", () => tree.toggle());

// Files can appear or vanish while the window is in the background — another
// editor, a git pull. Coming back is the natural moment to re-read the list,
// and it costs one directory walk.
window.addEventListener("focus", () => {
  if (state.workspace?.isDir) listFiles().then((files) => files && picker.prime(files));
});

document.addEventListener("keydown", (e) => {
  // Escape closes the picker wherever focus happens to be — the input handles
  // it too, but not if you clicked the backdrop first.
  if (e.key === "Escape" && picker.isOpen()) {
    e.preventDefault();
    return picker.close();
  }
  if (prompt.isOpen()) return;   // the naming box answers its own keys

  // F2 renames, as it does in a file manager.
  if (e.key === "F2" && state.workspace?.isDir && state.path) {
    e.preventDefault();
    return renameFile(state.path);
  }
  // Cmd/Ctrl-Alt-N makes a file: plain Cmd-N belongs to the browser. The key
  // is read from its position, because Alt-N on a Mac types a dead key.
  if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === "KeyN" && state.workspace?.isDir) {
    e.preventDefault();
    return newFile();
  }

  // Cmd/Ctrl-K and Cmd/Ctrl-P both open it. Shift-K is left to the editor for
  // inserting a link.
  const mod = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
  if (!mod || !state.workspace?.isDir) return;

  const key = e.key.toLowerCase();
  if (key === "k" || key === "p") {
    e.preventDefault();
    picker.isOpen() ? picker.close() : picker.open(state.path);
    return;
  }
  // Backslash, not B: B is bold, and the editor keeps it.
  if (e.key === "\\") {
    e.preventDefault();
    tree.toggle();
  }
});

// Coming back to the tab: the relative time on screen is probably stale.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && statusEl.dataset.state === "saved") showSaved();
});

// Leaving the tab is a natural save point, and the last chance to catch an
// edit that the debounce has not written yet.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && state.dirty) flush();
});
window.addEventListener("blur", () => {
  if (state.dirty) flush();
});
window.addEventListener("beforeunload", (e) => {
  if (!state.dirty) return;
  flush();
  e.preventDefault();
  e.returnValue = "";
});

start();
