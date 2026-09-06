// Naming a file: the one question behind both "new" and "move".
//
// A new file and a rename ask the same thing — what should this be called? —
// so they share one box, which is the picker's panel with a different question
// in it. Nothing here talks to the server: the caller says what to do with the
// name it gets, and hands back the reason if that did not work, which is shown
// in place of the hint rather than as an alert you have to dismiss.

/** The extensions the editor opens. A name given without one gets a default. */
const KNOWN_EXT = /\.(md|mdx|markdown|mdown|mkd|mkdn|te?xt)$/i;

/**
 * What a typed name will actually become. The server normalises the name it is
 * sent the same way; this copy exists only so the box can show you the answer
 * before you commit to it.
 */
export function fileName(value, fallback = ".md") {
  const name = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!name) return "";
  return KNOWN_EXT.test(name) ? name : name + fallback;
}

/** The extension of a path, ".md" if it has none the editor knows. */
export function extOf(path) {
  return KNOWN_EXT.exec(path)?.[0] ?? ".md";
}

export function createPrompt({ onClose } = {}) {
  const root = document.getElementById("prompt");
  const form = document.getElementById("prompt-form");
  const titleEl = document.getElementById("prompt-title");
  const input = document.getElementById("prompt-input");
  const hintEl = document.getElementById("prompt-hint");
  const okEl = document.getElementById("prompt-ok");
  const cancelEl = document.getElementById("prompt-cancel");

  /** The question currently on screen: { ext, hint, submit }, or null. */
  let asking = null;
  let busy = false;

  /* ---- the hint line ---- */

  // It has three jobs, in order of what you need to know: what went wrong, what
  // you are about to make, and — with the box still empty — what to type.
  function showHint(problem) {
    const name = problem ? "" : fileName(input.value, asking.ext);
    hintEl.textContent = problem || name || asking.hint;
    hintEl.classList.toggle("is-error", Boolean(problem));
    okEl.disabled = busy || !(problem || name);
  }

  /* ---- open / close ---- */

  function open({ title, action, value = "", select = "all", hint = "", ext = ".md", submit }) {
    asking = { ext, hint, submit };
    busy = false;
    titleEl.textContent = title;
    okEl.textContent = action;
    input.value = value;
    input.readOnly = false;
    root.hidden = false;
    showHint();
    input.focus();
    selectPart(input, select);
  }

  function close() {
    if (!asking) return;
    asking = null;
    busy = false;
    root.hidden = true;
    onClose?.();
  }

  async function run() {
    if (busy || !asking) return;
    const name = input.value.trim();
    if (!name) return;

    const { submit } = asking;
    busy = true;
    okEl.disabled = true;
    input.readOnly = true;
    const problem = await submit(name);

    // Escape during the request wins: the answer is no longer wanted.
    if (!asking) return;
    busy = false;
    input.readOnly = false;
    if (!problem) return close();

    showHint(problem);
    input.focus();
  }

  /* ---- events ---- */

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    run();
  });
  input.addEventListener("input", () => showHint());
  cancelEl.addEventListener("click", close);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });
  root.addEventListener("mousedown", (e) => {
    if (e.target === root) close();
  });

  return { open, close, isOpen: () => !root.hidden };
}

/**
 * Select the part you are most likely to retype. For a rename that is the name
 * without its folder or its extension — the two halves you usually want to
 * keep — so `notes/daily.md` opens with `daily` highlighted.
 */
function selectPart(input, how) {
  const value = input.value;
  if (how === "end") return input.setSelectionRange(value.length, value.length);
  if (how !== "stem") return input.select();

  const start = value.lastIndexOf("/") + 1;
  const dot = value.lastIndexOf(".");
  input.setSelectionRange(start, dot > start ? dot : value.length);
}
