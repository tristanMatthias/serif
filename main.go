// Command serif converts a Markdown document into a self-contained HTML page
// with high-quality, readability-first typography and automatic light/dark mode.
//
// Usage:
//
//	serif thing.md            # writes thing.html
//	serif thing.md -o out.html
//	serif --title "My Doc" thing.md
package main

import (
	"bytes"
	_ "embed"
	"flag"
	"fmt"
	"html"
	"os"
	"path/filepath"
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

// version is set at build time via -ldflags "-X main.version=...".
var version = "dev"

// repoURL is linked from the generated page footer.
const repoURL = "https://github.com/tristanMatthias/serif"

// Syntax-highlighting themes: a matched light/dark pair from chroma.
const (
	lightSyntaxStyle = "github"
	darkSyntaxStyle  = "github-dark"
)

type pageData struct {
	Title     string
	Lang      string
	Style     string
	ChromaCSS string
	Body      string
	Footer    string
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "serif: "+err.Error())
		os.Exit(1)
	}
}

func run() error {
	var (
		outPath     string
		titleFlag   string
		langFlag    string
		showVersion bool
	)
	flag.StringVar(&outPath, "o", "", "output file (default: input with a .html extension)")
	flag.StringVar(&titleFlag, "title", "", "page title (default: first heading, or the file name)")
	flag.StringVar(&langFlag, "lang", "en", "value for the html lang attribute")
	flag.BoolVar(&showVersion, "version", false, "print version and exit")
	flag.Usage = usage
	// Reorder so flags may appear before or after the file argument.
	flag.CommandLine.Parse(reorderArgs(os.Args[1:]))

	if showVersion {
		fmt.Println("serif " + version)
		return nil
	}

	if flag.NArg() != 1 {
		usage()
		return fmt.Errorf("expected exactly one Markdown file")
	}
	inPath := flag.Arg(0)

	src, err := os.ReadFile(inPath)
	if err != nil {
		return err
	}

	if outPath == "" {
		outPath = deriveOutPath(inPath)
	}
	if abs(outPath) == abs(inPath) {
		return fmt.Errorf("refusing to overwrite the input file (%s); use -o", inPath)
	}

	body, err := renderMarkdown(src)
	if err != nil {
		return err
	}

	title := titleFlag
	if title == "" {
		title = firstHeading(src)
	}
	if title == "" {
		title = strings.TrimSuffix(filepath.Base(inPath), filepath.Ext(inPath))
	}

	tmpl, err := template.New("page").Parse(pageTmplText)
	if err != nil {
		return err
	}

	var out bytes.Buffer
	data := pageData{
		Title:     html.EscapeString(title),
		Lang:      html.EscapeString(langFlag),
		Style:     styleCSS,
		ChromaCSS: syntaxCSS(),
		Body:      body,
		Footer:    footer(inPath),
	}
	if err := tmpl.Execute(&out, data); err != nil {
		return err
	}

	if err := os.WriteFile(outPath, out.Bytes(), 0o644); err != nil {
		return err
	}

	fmt.Printf("serif: wrote %s\n", outPath)
	return nil
}

// renderMarkdown converts Markdown to an HTML fragment.
func renderMarkdown(src []byte) (string, error) {
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

// firstHeading returns the text of the first ATX heading, skipping fenced code
// blocks. Basic inline Markdown markers are stripped for a clean title.
func firstHeading(src []byte) string {
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

func footer(inPath string) string {
	return fmt.Sprintf(
		`%s &middot; typeset with <a href="%s">serif</a>`,
		html.EscapeString(filepath.Base(inPath)), repoURL,
	)
}

// reorderArgs moves flags ahead of positional arguments so that Go's flag
// package (which stops at the first non-flag token) accepts flags placed after
// the file, e.g. `serif thing.md -o out.html`.
func reorderArgs(args []string) []string {
	valueFlags := map[string]bool{
		"-o": true, "-title": true, "--title": true, "-lang": true, "--lang": true,
	}
	var flags, positionals []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			positionals = append(positionals, args[i+1:]...)
			break
		}
		if len(a) > 1 && strings.HasPrefix(a, "-") {
			flags = append(flags, a)
			if !strings.Contains(a, "=") && valueFlags[a] && i+1 < len(args) {
				i++
				flags = append(flags, args[i])
			}
			continue
		}
		positionals = append(positionals, a)
	}
	return append(flags, positionals...)
}

func deriveOutPath(inPath string) string {
	ext := filepath.Ext(inPath)
	switch strings.ToLower(ext) {
	case ".md", ".markdown", ".mdown", ".mkd", ".mkdn", ".text", ".txt":
		return strings.TrimSuffix(inPath, ext) + ".html"
	default:
		return inPath + ".html"
	}
}

func abs(p string) string {
	if a, err := filepath.Abs(p); err == nil {
		return a
	}
	return p
}

func usage() {
	fmt.Fprint(os.Stderr, `serif — turn Markdown into a beautifully typeset HTML page

Usage:
  serif [options] <file.md>

Options:
  -o <file>       output path (default: input name with .html)
  --title <text>  page title (default: first heading or file name)
  --lang <code>   html lang attribute (default: en)
  --version       print version and exit

Examples:
  serif notes.md                 # writes notes.html
  serif README.md -o docs/index.html

Home: https://github.com/tristanMatthias/serif
`)
}
