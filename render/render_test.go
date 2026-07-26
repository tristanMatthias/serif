package render

import (
	"strings"
	"testing"
)

func TestFirstHeading(t *testing.T) {
	cases := []struct {
		name string
		src  string
		want string
	}{
		{"simple", "# Hello World\n\ntext", "Hello World"},
		{"skips-non-heading", "intro\n\n## Second\n", "Second"},
		{"strips-inline", "# A `code` and **bold** title\n", "A code and bold title"},
		{"closed-atx", "# Title #\n", "Title"},
		{"ignores-fenced", "```\n# not a heading\n```\n\n# Real\n", "Real"},
		{"none", "just a paragraph\n", ""},
	}
	for _, c := range cases {
		if got := FirstHeading([]byte(c.src)); got != c.want {
			t.Errorf("%s: FirstHeading() = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestScopeCSS(t *testing.T) {
	in := "/* Background */ .chroma { color: #000 }\n.chroma .k { color: #f00 }\n"
	got := scopeCSS(in, "html[data-theme=\"dark\"] ")

	if strings.Contains(got, "/*") {
		t.Errorf("scopeCSS should strip comments, got:\n%s", got)
	}
	if !strings.Contains(got, `html[data-theme="dark"] .chroma {`) {
		t.Errorf("scopeCSS should prefix the wrapper selector, got:\n%s", got)
	}
	if !strings.Contains(got, `html[data-theme="dark"] .chroma .k {`) {
		t.Errorf("scopeCSS should prefix token selectors, got:\n%s", got)
	}
}

func TestScopeCSSMultiSelector(t *testing.T) {
	got := scopeCSS(".a, .b { x: 1 }", "P ")
	if !strings.Contains(got, "P .a, P .b {") {
		t.Errorf("scopeCSS should prefix each comma-separated selector, got: %q", got)
	}
}

func TestMarkdown(t *testing.T) {
	html, err := Markdown([]byte("# Title\n\nA \"quoted\" word and `code`.\n\n```go\nvar x = 1\n```\n"))
	if err != nil {
		t.Fatalf("Markdown returned error: %v", err)
	}
	checks := []string{
		`<h1 id="title">`, // auto heading id
		"&ldquo;",         // smart quotes via typographer
		"<code>",          // inline code
		`class="chroma"`,  // chroma highlighting wrapper
	}
	for _, want := range checks {
		if !strings.Contains(html, want) {
			t.Errorf("Markdown output missing %q\n---\n%s", want, html)
		}
	}
}

func TestSyntaxCSSCoversBothThemes(t *testing.T) {
	css := syntaxCSS()
	for _, want := range []string{
		`html[data-theme="light"] .chroma`,
		`html[data-theme="dark"] .chroma`,
		"prefers-color-scheme: dark",
	} {
		if !strings.Contains(css, want) {
			t.Errorf("syntaxCSS missing %q", want)
		}
	}
}

func TestPage(t *testing.T) {
	out, err := Page([]byte("# Hello\n\nBody text.\n"), Options{Source: "hello.md"})
	if err != nil {
		t.Fatalf("Page returned error: %v", err)
	}
	checks := []string{
		"<!DOCTYPE html>",
		"<title>Hello</title>", // title from first heading
		`<html lang="en">`,     // default lang
		"hello.md &middot;",    // footer source label
		"Body text.",
	}
	for _, want := range checks {
		if !strings.Contains(out, want) {
			t.Errorf("Page output missing %q", want)
		}
	}
}
