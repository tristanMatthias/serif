// The generated matrix: every block type × caret position × keystroke.
//
// There is no expected answer for each of these — writing several hundred by
// hand is how you get several hundred wrong ones. Instead every case is judged
// against invariants that must hold whatever was typed:
//
//   structure  the editing surface stays valid HTML for a Markdown document
//   locality   a keystroke changes the caret's block and its neighbours, and
//              nothing further away
//   stability  what the serializer writes, the renderer can read back into the
//              same thing — the document is a fixed point of the round trip
//   caret      the caret is still somewhere you can type
//   text       keys that do not insert or delete do not lose text
//
// Between them these caught every bug the hand-written cases did, without
// knowing in advance what any single case was supposed to produce.

import { installHelpers, perform } from "./harness.mjs";

/**
 * The block under test. Each names the element the caret goes into, so the
 * matrix never has to guess which part of the fixture is the subject.
 */
const SUBJECTS = [
  ["paragraph", "<p>Alpha bravo</p>", "p.subject"],
  ["heading 1", "<h1>Alpha bravo</h1>", "h1"],
  ["heading 3", "<h3>Alpha bravo</h3>", "h3"],
  ["empty paragraph", "<p><br></p>", "p.subject"],
  ["bullet, only item", "<ul><li>Alpha bravo</li></ul>", "li"],
  ["bullet, second item", "<ul><li>First item</li><li>Alpha bravo</li></ul>", "li:nth-child(2)"],
  ["bullet, empty item", "<ul><li>First item</li><li><br></li></ul>", "li:nth-child(2)"],
  ["ordered item", "<ol><li>Alpha bravo</li></ol>", "ol li"],
  ["task, unchecked", '<ul><li><input type="checkbox">Alpha bravo</li></ul>', "li"],
  ["task, checked", '<ul><li><input type="checkbox" checked>Alpha bravo</li></ul>', "li"],
  ["nested item", "<ul><li>First item<ul><li>Alpha bravo</li></ul></li></ul>", "ul ul li"],
  ["nested empty item", "<ul><li>First item<ul><li><br></li></ul></li></ul>", "ul ul li"],
  ["quote", "<blockquote><p>Alpha bravo</p></blockquote>", "blockquote p"],
  ["quoted list", "<blockquote><ul><li>Alpha bravo</li></ul></blockquote>", "blockquote li"],
  ["code block", "<pre><code>Alpha bravo</code></pre>", "pre"],
  ["table cell", "<table><thead><tr><th>Header</th></tr></thead>" +
    "<tbody><tr><td>Alpha bravo</td></tr></tbody></table>", "td"],
  // Embedded HTML is preserved text, not a construct the editor models: edit a
  // tag into something that is no longer an HTML block and it stops being one,
  // exactly as it would in a text editor. Its round trip is recorded as a known
  // exemption rather than quietly passing.
  ["embedded html", '<div class="serif-raw">&lt;span&gt;Alpha bravo&lt;/span&gt;</div>', ".serif-raw", ["stability"]],
];

/** Where in the subject the caret sits. */
const POSITIONS = { start: 0, middle: 5, end: "end" };

/**
 * Whether anything follows the subject. A block at the end of the document has
 * nowhere to move on to, which is its own set of problems — that is where Enter
 * at the end of a code block used to trap the caret inside it.
 */
const PLACEMENTS = { "mid-document": true, "at the end": false };

/**
 * One keystroke each. Destructive keys may legitimately pull in a neighbour,
 * which is what `reaches` records; `keepsText` marks the ones that must not
 * change the document's text at all.
 */
const KEYS = [
  { name: "Enter", do: ["press:Enter"] },
  { name: "Shift-Enter", do: ["press:Shift+Enter"] },
  { name: "Backspace", do: ["press:Backspace"], reaches: "before" },
  { name: "Delete", do: ["press:Delete"], reaches: "after" },
  { name: "Tab", do: ["press:Tab"] },
  { name: "Shift-Tab", do: ["press:Shift+Tab"], keepsText: true },
  { name: "typing", do: ["type:zulu"] },
  { name: "Cmd-B", do: ["press:Meta+b"], keepsText: true },
  { name: "space", do: ["type: "] },
  { name: "Enter then typing", do: ["press:Enter", "type:zulu"] },
  { name: "Backspace twice", do: ["press:Backspace", "press:Backspace"], reaches: "before" },
];

// Guards sit far enough from the subject that no single keystroke has any
// business touching them; spacers absorb the one block a merge may legitimately
// reach. The front-matter subject has to be first in the document, so it is
// tested separately with only a trailing guard.
const LEAD_GUARD = "<h2>Guard heading</h2>";
const LEAD_SPACER = '<p class="lead">Lead spacer</p>';
const TRAIL_SPACER = '<p class="trail">Trail spacer</p>';
const TRAIL_GUARD = "<h2>Sentinel heading</h2><p>Sentinel tail</p>";

const GUARD_BEFORE = "## Guard heading";
const GUARD_AFTER = "## Sentinel heading\n\nSentinel tail";

export async function run(ctx) {
  const { page, stop } = await ctx.open({ "n.md": "# x\n" });
  await page.waitForTimeout(300);
  await installHelpers(page);

  const violations = [];
  const exemptions = [];
  let cases = 0;

  const subjects = SUBJECTS.map(([name, html, sel, exempt = []]) => ({
    name,
    html: html.replace("<p>", '<p class="subject">'),
    sel,
    exempt,
    lead: LEAD_GUARD + LEAD_SPACER,
    trail: TRAIL_SPACER + TRAIL_GUARD,
  }));
  // Front matter only exists at the top of a document, so it has no lead.
  subjects.push({
    name: "front matter",
    html: '<div class="serif-front" data-fence="---"><b>title</b>: Alpha bravo</div>',
    sel: ".serif-front",
    exempt: [],
    lead: "",
    trail: TRAIL_SPACER + TRAIL_GUARD,
  });

  for (const subject of subjects) {
    for (const [placeName, trailing] of Object.entries(PLACEMENTS)) {
    for (const [posName, offset] of Object.entries(POSITIONS)) {
      for (const key of KEYS) {
        cases++;
        const label = `${subject.name} · ${placeName} · caret at ${posName} · ${key.name}`;
        const doc = subject.lead + subject.html + (trailing ? subject.trail : "");

        let got;
        try {
          await page.evaluate(([h, s, o]) => window.__setup(h, s, o), [doc, subject.sel, offset]);
          await perform(page, null, key.do);
          await page.waitForTimeout(35);
          got = await page.evaluate(() => window.__inspect());
        } catch (err) {
          violations.push({ rule: "crash", label, detail: String(err).split("\n")[0] });
          continue;
        }

        for (const fault of got.faults) {
          violations.push({ rule: "structure", label, detail: fault, md: got.md });
        }
        if (!got.caretInside) {
          violations.push({ rule: "caret", label, detail: "caret left the document", md: got.md });
        }
        if (subject.lead && key.reaches !== "before" && !got.md.startsWith(GUARD_BEFORE)) {
          violations.push({ rule: "locality", label, detail: "the block above changed", md: got.md });
        }
        if (trailing && key.reaches !== "after" && !got.md.trimEnd().endsWith(GUARD_AFTER)) {
          violations.push({ rule: "locality", label, detail: "the block below changed", md: got.md });
        }
        if (key.keepsText && got.text !== (await baselineText(page, doc))) {
          violations.push({ rule: "text", label, detail: "text changed under a key that only reformats", md: got.md });
        }

        // The document must be a fixed point: what came out, put back in,
        // comes out the same. Anything the serializer cannot express shows up
        // here even when the DOM looks fine.
        const again = subject.exempt.includes("stability") ? null : await reparse(page, got.md);
        if (again !== null && again !== got.md) {
          violations.push({
            rule: "stability", label,
            detail: `re-reading the saved file gives something else`,
            md: got.md, extra: again,
          });
        }
      }
    }
    }
  }

  for (const s of subjects) {
    for (const rule of s.exempt) exemptions.push(`${s.name}: ${rule}`);
  }
  report(ctx, cases, violations, exemptions);
  await stop();
}

let baselineCache = null;
/** The document's text before the keystroke, for the keys that must not change it. */
async function baselineText(page, doc) {
  const cacheKey = doc;
  if (baselineCache?.key === cacheKey) return baselineCache.text;
  const text = await page.evaluate((html) => {
    const probe = document.createElement("div");
    probe.innerHTML = html;
    return probe.textContent.replace(/[\s ​]+/g, " ").trim();
  }, doc);
  baselineCache = { key: cacheKey, text };
  return text;
}

/** Render Markdown back to HTML and serialize it again. */
async function reparse(page, md) {
  return page.evaluate(async (text) => {
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    const { html } = await res.json();
    const { toMarkdown } = await import("/assets/markdown.js");
    const probe = document.createElement("div");
    probe.innerHTML = html;
    return toMarkdown(probe);
  }, md);
}

function report(ctx, cases, violations, exemptions) {
  if (exemptions.length) {
    console.log("  matrix exemptions: " + exemptions.join(", "));
  }
  const byRule = new Map();
  for (const v of violations) {
    const key = `${v.rule}: ${v.detail}`;
    if (!byRule.has(key)) byRule.set(key, []);
    byRule.get(key).push(v);
  }

  ctx.record(`matrix: ${cases} combinations hold all invariants`, violations.length === 0,
    [...byRule.entries()].map(([rule, hits]) => {
      const shown = hits.slice(0, 4).map((h) => `    ${h.label}\n      md: ${JSON.stringify(h.md)}` +
        (h.extra ? `\n      re-read as: ${JSON.stringify(h.extra)}` : "")).join("\n");
      return `${rule}  (${hits.length})\n${shown}${hits.length > 4 ? `\n    …and ${hits.length - 4} more` : ""}`;
    }).join("\n\n"));
}
