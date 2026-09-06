// Editor-facing rendering.
//
// The editor works on a live DOM: Markdown is converted to HTML once when the
// document loads, and the browser converts that DOM back to Markdown on every
// save. That round trip has to be lossless, so this file deliberately uses a
// narrower goldmark configuration than Page does:
//
//   - No Typographer. Smart quotes would be written back to disk as curly
//     characters, silently rewriting the author's file.
//   - No Linkify. A bare URL would come back as an explicit [url](url) link.
//   - No syntax highlighting. chroma wraps code in nested spans that carry no
//     Markdown meaning.
//   - No live raw HTML. Embedded HTML is shown as literal text instead, which
//     both keeps it visible while editing and lets it round trip byte for byte.
//     goldmark's own "unsafe: false" mode replaces it with a comment, which
//     would quietly delete it from the file on the next save.
//
// What is left — headings, paragraphs, lists, task lists, quotes, code blocks,
// rules, tables, and the usual inline marks — is exactly the set the browser
// serializer knows how to write back out.

package render

import (
	"bytes"
	"regexp"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/util"
)

// RawHTMLClass marks a block of embedded HTML in the editor. The browser
// serializer writes the element's text back out verbatim.
const RawHTMLClass = "serif-raw"

// FrontClass marks the front matter block. Like RawHTMLClass it round trips
// verbatim; the fence is carried on a data attribute so the serializer can
// rebuild it exactly as it was written.
const FrontClass = "serif-front"

// editorMD is the restricted parser described above, built once and reused.
var editorMD = goldmark.New(
	goldmark.WithExtensions(
		extension.Table,
		extension.Strikethrough,
		extension.TaskList,
	),
	goldmark.WithRendererOptions(
		// A lower priority number registers last and wins, so this overrides
		// the default renderer's handling of the two raw-HTML node kinds.
		renderer.WithNodeRenderers(util.Prioritized(literalHTML{}, 100)),
	),
)

// literalHTML renders embedded HTML as text you can see and edit, rather than
// as markup (which could not be serialized back) or as nothing (which would
// lose it).
type literalHTML struct{}

func (literalHTML) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(ast.KindRawHTML, renderRawHTML)
	reg.Register(ast.KindHTMLBlock, renderHTMLBlock)
}

// renderRawHTML handles HTML inside a paragraph, e.g. a stray <div> in a
// sentence. It becomes ordinary escaped text in the same paragraph.
func renderRawHTML(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkSkipChildren, nil
	}
	n := node.(*ast.RawHTML)
	for i := 0; i < n.Segments.Len(); i++ {
		seg := n.Segments.At(i)
		w.Write(util.EscapeHTML(seg.Value(source)))
	}
	return ast.WalkSkipChildren, nil
}

// renderHTMLBlock handles a standalone block of HTML. Its line breaks are
// significant — they are part of the file — so they are kept as <br>.
func renderHTMLBlock(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkSkipChildren, nil
	}
	n := node.(*ast.HTMLBlock)

	var raw []byte
	for i := 0; i < n.Lines().Len(); i++ {
		line := n.Lines().At(i)
		raw = append(raw, line.Value(source)...)
	}
	if n.HasClosure() {
		raw = append(raw, n.ClosureLine.Value(source)...)
	}

	w.WriteString(`<div class="` + RawHTMLClass + `">`)
	for i, line := range bytes.Split(bytes.TrimRight(raw, "\n"), []byte("\n")) {
		if i > 0 {
			w.WriteString("<br>")
		}
		w.Write(util.EscapeHTML(line))
	}
	w.WriteString("</div>\n")
	return ast.WalkSkipChildren, nil
}

// EditorFragment converts Markdown into the HTML fragment the editor loads into
// its editing surface. Unlike Page it returns a fragment, not a document, and
// only uses constructs that can be converted back to Markdown without loss.
func EditorFragment(src []byte) (string, error) {
	front, body, hasFront := SplitFront(src)

	var buf bytes.Buffer
	if hasFront {
		writeFrontHTML(&buf, front)
	}
	if err := editorMD.Convert(body, &buf); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// writeFrontHTML renders front matter as an editable verbatim block. Keys are
// wrapped so the editor can pick them out; because they are inline elements the
// serializer reads straight through them and the text comes back unchanged.
func writeFrontHTML(w *bytes.Buffer, front Front) {
	w.WriteString(`<div class="` + FrontClass + `" data-fence="` + front.Fence +
		`" data-label="Front matter" data-format="` + front.Format + `">`)
	for i, line := range strings.Split(front.Text, "\n") {
		if i > 0 {
			w.WriteString("<br>")
		}
		writeFrontLine(w, line)
	}
	w.WriteString("</div>\n")
}

// frontLineRe splits "  - key: value" into its indent, key, and the rest.
var frontLineRe = regexp.MustCompile(`^(\s*(?:-\s+)?)([A-Za-z_][\w.-]*)(\s*[:=].*)$`)

func writeFrontLine(w *bytes.Buffer, line string) {
	m := frontLineRe.FindStringSubmatch(line)
	if m == nil {
		w.Write(util.EscapeHTML([]byte(line)))
		return
	}
	w.Write(util.EscapeHTML([]byte(m[1])))
	w.WriteString("<b>")
	w.Write(util.EscapeHTML([]byte(m[2])))
	w.WriteString("</b>")
	w.Write(util.EscapeHTML([]byte(m[3])))
}

// StyleCSS returns the serif document stylesheet, so the editor can typeset the
// text you are editing with exactly the same rules as the exported page.
func StyleCSS() string { return styleCSS }
