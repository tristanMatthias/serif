# On Reading Well

> "Typography exists to honour content." — Robert Bringhurst

Good typography is invisible. You notice a beautiful building, but you rarely
notice a beautiful paragraph — you simply read it, and the reading feels
effortless. That quiet ease is the whole point. This page is a single Markdown
file rendered by **serif**; nothing here is hand-styled.

## Why it matters

Text on a screen fights for your attention against everything else glowing
nearby. The typographer's job is to *reduce friction* — to set a comfortable
measure, a generous rhythm, and colors that don't strain the eye — so that the
words, not their arrangement, are what you remember.

Three principles guide the defaults here:

1. **A comfortable measure.** Lines cap at roughly 68 characters, the range
   the eye tracks without effort.
2. **Generous rhythm.** Line-height and spacing give each paragraph room to
   breathe.
3. **Calm color.** Warm paper and soft ink in the light; muted ink on a warm
   near-black in the dark — never pure black on pure white.

### A note on contrast

More contrast is not always better. Pure `#000` on pure `#fff` shimmers.
Softening both ends keeps text sharp while letting you read for a long time
without fatigue.

## It handles real documents

Everything you'd actually write survives the trip — and looks considered.

### Code, highlighted per theme

Inline code like `serif README.md` sits calmly in a line. Fenced blocks are
highlighted with a palette matched to the active theme:

```go
package main

import "fmt"

// greet prints a friendly, well-kerned hello.
func greet(name string) {
	fmt.Printf("hello, %s\n", name)
}
```

```javascript
const themes = ["light", "dark"];
const pick = () =>
  matchMedia("(prefers-color-scheme: dark)").matches ? themes[1] : themes[0];
```

```css
:root {
  --measure: 68ch;
  --leading: 1.72;
}
```

### Lists, including tasks

- Serif body for reading, sans headings for structure
- Old-style figures in prose, lining figures in tables
- Smart quotes, em-dashes, and ellipses, automatically
  - Nested items stay tidy
  - …and readable

What's shipped:

- [x] Automatic light &amp; dark mode
- [x] Per-theme syntax highlighting
- [ ] A pony

### Tables

| Element     | Light        | Dark          | Contrast |
| ----------- | ------------ | ------------- | -------: |
| Body text   | warm ink     | soft off-white |    AAA |
| Links       | muted blue   | soft sky blue |      AA+ |
| Code block  | paper tint   | warm charcoal |    AAA |

### Quotes and asides

> A well-set page carries the reader from the first line to the last without a
> single stumble. When that happens, the design has done its job — and
> disappeared.

You can ~~overthink~~ *refine* the details endlessly, but the defaults are meant
to be good enough to publish as-is.[^defaults]

---

That's the whole demo — one Markdown file, one command, one self-contained HTML
page. Toggle the theme in the corner (or press <kbd>T</kbd>) and read on.

[^defaults]: Override the title with `--title`, or the language with `--lang`.
    Everything else is intentionally not configurable — fewer knobs, better
    defaults.
