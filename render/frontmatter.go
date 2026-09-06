package render

import (
	"bytes"
	"regexp"
	"strings"
)

// Front matter is the metadata block some tools expect at the very top of a
// Markdown file, fenced by --- (YAML) or +++ (TOML).
//
// Markdown itself has no idea what it is: a leading "---" is a thematic break,
// and "title: Hello" followed by "---" is a setext heading. Left alone, a note
// with front matter renders its metadata as a headline. So it is split off
// before parsing and handled separately.

// Front is the metadata block at the top of a document.
type Front struct {
	// Fence is the delimiter used, "---" or "+++".
	Fence string
	// Text is what sits between the fences, with no trailing newline.
	Text string
	// Format names the fence's usual language, for labelling.
	Format string
}

// SplitFront separates front matter from the document body. It reports false
// and returns src unchanged when there is none.
func SplitFront(src []byte) (Front, []byte, bool) {
	body := bytes.TrimPrefix(src, []byte{0xEF, 0xBB, 0xBF}) // UTF-8 BOM

	fence, format := "", ""
	switch {
	case hasFence(body, "---"):
		fence, format = "---", "YAML"
	case hasFence(body, "+++"):
		fence, format = "+++", "TOML"
	default:
		return Front{}, src, false
	}

	lines := strings.Split(string(body), "\n")
	for i := 1; i < len(lines); i++ {
		if strings.TrimRight(lines[i], " \t\r") != fence {
			continue
		}
		inner := strings.Join(lines[1:i], "\n")
		if !isMetadataBlock(inner) {
			return Front{}, src, false
		}
		rest := ""
		if i+1 < len(lines) {
			rest = strings.Join(lines[i+1:], "\n")
		}
		// The blank line that usually follows the closing fence belongs to the
		// separation, not to the body.
		rest = strings.TrimLeft(rest, "\n")
		return Front{Fence: fence, Text: strings.TrimRight(inner, "\n"), Format: format},
			[]byte(rest), true
	}
	return Front{}, src, false
}

func hasFence(body []byte, fence string) bool {
	if !bytes.HasPrefix(body, []byte(fence)) {
		return false
	}
	line := body
	if i := bytes.IndexByte(body, '\n'); i >= 0 {
		line = body[:i]
	}
	return strings.TrimRight(string(line), " \t\r") == fence
}

// isMetadataBlock guards against treating a document that opens with a thematic
// break as front matter. The tell is structural rather than a matter of
// content: a rule is followed by a blank line, and metadata never is.
//
// Sniffing for a "key: value" first line would be stricter, but it breaks the
// moment you edit: split a key across two lines while typing and the block
// stops being front matter, so the fences turn into a rule and a heading and
// the metadata is gone on the next reload.
func isMetadataBlock(inner string) bool {
	if inner == "" {
		return true // an empty block is still front matter
	}
	first, _, _ := strings.Cut(inner, "\n")
	return strings.TrimSpace(first) != ""
}

var frontTitleRe = regexp.MustCompile(`(?m)^title\s*[:=]\s*(.+?)\s*$`)

// Title returns the front matter's title, if it declares one. It is a line
// scan, not a parser: enough to name a page, and no new dependency.
func (f Front) Title() string {
	m := frontTitleRe.FindStringSubmatch(f.Text)
	if m == nil {
		return ""
	}
	return strings.Trim(strings.TrimSpace(m[1]), `"'`)
}
