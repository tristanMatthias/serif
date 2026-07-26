// Package render turns a Markdown document into a self-contained HTML page with
// high-quality, readability-first typography and automatic light/dark mode.
//
// It is the shared core behind both the serif command-line tool and the
// WebAssembly build: given Markdown bytes it returns one complete .html
// document with all CSS inlined and no external dependencies.
package render

import (
	"bytes"
	_ "embed"
	"html"
	"regexp"
	"strings"
	"text/template"

	chromahtml "github.com/alecthomas/chroma/v2/formatters/html"
	"github.com/alecthomas/chroma/v2/styles"
	"github.com/yuin/goldmark"
	highlighting "github.com/yuin/goldmark-highlighting/v2"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	ghtml "github.com/yuin/goldmark/renderer/html"
)

//go:embed style.css
var styleCSS string

//go:embed page.tmpl
var pageTmplText string

// RepoURL is linked from the generated page footer.
const RepoURL = "https://github.com/tristanMatthias/serif"

// Syntax-highlighting themes: a matched light/dark pair from chroma.
const (
	lightSyntaxStyle = "github"
	darkSyntaxStyle  = "github-dark"
)

// pageTmpl is parsed once at startup; the template text is trusted (embedded).
var pageTmpl = template.Must(template.New("page").Parse(pageTmplText))

// Options controls how a page is rendered.
type Options struct {
	// Title is the <title> and is shown to the browser. When empty, the first
	// Markdown heading is used, falling back to Source.
	Title string
	// Lang is the value of the html lang attribute. Defaults to "en".
	Lang string
	// Source is a short label for the document (typically a file name) shown in
	// the footer. When empty, no name is shown before the serif credit.
	Source string
}

type pageData struct {
	Title     string
	Lang      string
	Style     string
	ChromaCSS string
	Body      string
	Footer    string
}

// Page renders Markdown source into a complete, self-contained HTML document.
func Page(src []byte, opts Options) (string, error) {
	body, err := Markdown(src)
	if err != nil {
		return "", err
	}

	title := opts.Title
	if title == "" {
		title = FirstHeading(src)
	}
	if title == "" {
		title = opts.Source
	}

	lang := opts.Lang
	if lang == "" {
		lang = "en"
	}

	data := pageData{
		Title:     html.EscapeString(title),
		Lang:      html.EscapeString(lang),
		Style:     styleCSS,
		ChromaCSS: syntaxCSS(),
		Body:      body,
		Footer:    footer(opts.Source),
	}

	var out bytes.Buffer
	if err := pageTmpl.Execute(&out, data); err != nil {
		return "", err
	}
	return out.String(), nil
}

// Markdown converts Markdown to an HTML fragment (no surrounding document).
func Markdown(src []byte) (string, error) {
	md := goldmark.New(
		goldmark.WithExtensions(
			extension.GFM,            // tables, strikethrough, autolinks, task lists
			extension.Footnote,       // [^1] footnotes
			extension.DefinitionList, // definition lists
			extension.Typographer,    // smart quotes, dashes, ellipses
			highlighting.NewHighlighting(
				highlighting.WithFormatOptions(chromahtml.WithClasses(true)),
			),
		),
		goldmark.WithParserOptions(
			parser.WithAutoHeadingID(), // stable ids for heading anchors
		),
		goldmark.WithRendererOptions(
			ghtml.WithUnsafe(), // allow raw HTML embedded in the Markdown
		),
	)

	var buf bytes.Buffer
	if err := md.Convert(src, &buf); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// syntaxCSS builds class-based chroma CSS for both themes, scoped so that the
// right palette applies for the active theme (and for the OS preference when
// JavaScript is unavailable).
func syntaxCSS() string {
	light := chromaStyleCSS(lightSyntaxStyle)
	dark := chromaStyleCSS(darkSyntaxStyle)

	var b strings.Builder
	b.WriteString(scopeCSS(light, `html[data-theme="light"] `))
	b.WriteString(scopeCSS(dark, `html[data-theme="dark"] `))
	b.WriteString("@media (prefers-color-scheme: light) {\n")
	b.WriteString(scopeCSS(light, `html:not([data-theme]) `))
	b.WriteString("}\n@media (prefers-color-scheme: dark) {\n")
	b.WriteString(scopeCSS(dark, `html:not([data-theme]) `))
	b.WriteString("}\n")
	return b.String()
}

func chromaStyleCSS(name string) string {
	s := styles.Get(name)
	if s == nil {
		s = styles.Fallback
	}
	f := chromahtml.New(chromahtml.WithClasses(true))
	var buf bytes.Buffer
	_ = f.WriteCSS(&buf, s)
	return buf.String()
}

var cssCommentRe = regexp.MustCompile(`/\*.*?\*/`)

// scopeCSS prefixes every rule's selector(s) with the given prefix so the
// stylesheet only applies within a themed subtree. chroma emits one rule per
// line, e.g. `/* Keyword */ .chroma .k { color: #... }`.
func scopeCSS(css, prefix string) string {
	var b strings.Builder
	for _, rule := range strings.Split(css, "}") {
		rule = strings.TrimSpace(rule)
		if rule == "" {
			continue
		}
		open := strings.Index(rule, "{")
		if open < 0 {
			continue
		}
		selector := cssCommentRe.ReplaceAllString(rule[:open], "")
		body := strings.TrimSpace(rule[open:])

		var scoped []string
		for _, sel := range strings.Split(selector, ",") {
			sel = strings.TrimSpace(sel)
			if sel == "" {
				continue
			}
			scoped = append(scoped, prefix+sel)
		}
		if len(scoped) == 0 {
			continue
		}
		b.WriteString(strings.Join(scoped, ", "))
		b.WriteString(" ")
		b.WriteString(body)
		b.WriteString("}\n")
	}
	return b.String()
}

var atxHeadingRe = regexp.MustCompile(`^(#{1,6})\s+(.*?)\s*#*\s*$`)

// FirstHeading returns the text of the first ATX heading, skipping fenced code
// blocks. Basic inline Markdown markers are stripped for a clean title.
func FirstHeading(src []byte) string {
	inFence := false
	var fence string
	for _, line := range strings.Split(string(src), "\n") {
		trimmed := strings.TrimSpace(line)
		if inFence {
			if strings.HasPrefix(trimmed, fence) {
				inFence = false
			}
			continue
		}
		if strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~") {
			inFence = true
			fence = trimmed[:3]
			continue
		}
		if m := atxHeadingRe.FindStringSubmatch(line); m != nil {
			return stripInline(m[2])
		}
	}
	return ""
}

var inlineMarkRe = regexp.MustCompile("[`*_~]")

func stripInline(s string) string {
	s = inlineMarkRe.ReplaceAllString(s, "")
	return strings.TrimSpace(s)
}

// footer builds the footer HTML: an optional document name plus the serif
// credit. name is expected to be a short label such as a file name.
func footer(name string) string {
	credit := `typeset with <a href="` + RepoURL + `">serif</a>`
	name = strings.TrimSpace(name)
	if name == "" {
		return credit
	}
	return html.EscapeString(name) + " &middot; " + credit
}
