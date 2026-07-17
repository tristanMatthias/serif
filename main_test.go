package main

import (
	"strings"
	"testing"
)

func TestDeriveOutPath(t *testing.T) {
	cases := map[string]string{
		"thing.md":        "thing.html",
		"a/b/notes.md":    "a/b/notes.html",
		"README.markdown": "README.html",
		"doc.mkd":         "doc.html",
		"UPPER.MD":        "UPPER.html",
		"noext":           "noext.html",
		"archive.tar.gz":  "archive.tar.gz.html",
	}
	for in, want := range cases {
		if got := deriveOutPath(in); got != want {
			t.Errorf("deriveOutPath(%q) = %q, want %q", in, got, want)
		}
	}
}

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
		if got := firstHeading([]byte(c.src)); got != c.want {
			t.Errorf("%s: firstHeading() = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestReorderArgs(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		want []string
	}{
		{"flags-after-file", []string{"a.md", "-o", "out.html"}, []string{"-o", "out.html", "a.md"}},
		{"flags-before-file", []string{"-o", "out.html", "a.md"}, []string{"-o", "out.html", "a.md"}},
		{"bool-flag", []string{"a.md", "--version"}, []string{"--version", "a.md"}},
		{"equals-form", []string{"a.md", "--title=Hi"}, []string{"--title=Hi", "a.md"}},
		{"double-dash", []string{"--", "-weird-name.md"}, []string{"-weird-name.md"}},
		{"just-file", []string{"a.md"}, []string{"a.md"}},
	}
	for _, c := range cases {
		got := reorderArgs(c.in)
		if strings.Join(got, " ") != strings.Join(c.want, " ") {
			t.Errorf("%s: reorderArgs(%v) = %v, want %v", c.name, c.in, got, c.want)
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

func TestRenderMarkdown(t *testing.T) {
	html, err := renderMarkdown([]byte("# Title\n\nA \"quoted\" word and `code`.\n\n```go\nvar x = 1\n```\n"))
	if err != nil {
		t.Fatalf("renderMarkdown returned error: %v", err)
	}
	checks := []string{
		`<h1 id="title">`, // auto heading id
		"&ldquo;",         // smart quotes via typographer
		"<code>",          // inline code
		`class="chroma"`,  // chroma highlighting wrapper
	}
	for _, want := range checks {
		if !strings.Contains(html, want) {
			t.Errorf("renderMarkdown output missing %q\n---\n%s", want, html)
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
