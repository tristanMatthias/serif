package render

import (
	"strings"
	"testing"
)

// The editor round-trips Markdown through the DOM, so the fragment it loads
// must not contain anything the browser cannot write back out.
func TestEditorFragmentIsRoundTrippable(t *testing.T) {
	cases := []struct {
		name string
		src  string
		want []string
		deny []string
	}{
		{
			name: "no smart typography",
			src:  `He said "hi" -- really...`,
			// &quot; is ordinary HTML escaping and reads back as a straight
			// quote; the curly entities below would not.
			want: []string{"&quot;hi&quot;", "--", "..."},
			deny: []string{"&ldquo;", "&rdquo;", "&mdash;", "&hellip;"},
		},
		{
			name: "no autolinking of bare urls",
			src:  "Visit https://example.com today.",
			deny: []string{"<a href"},
		},
		{
			name: "no syntax highlighting spans",
			src:  "```go\nvar x = 1\n```\n",
			want: []string{`<code class="language-go">`, "var x = 1"},
			deny: []string{"chroma", "<span"},
		},
		{
			name: "no heading ids",
			src:  "# Title\n",
			want: []string{"<h1>Title</h1>"},
			deny: []string{"id="},
		},
		{
			name: "lists, tasks and tables survive",
			src:  "- [ ] todo\n- [x] done\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n",
			want: []string{`type="checkbox"`, "<table>", "<td>1</td>"},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := EditorFragment([]byte(c.src))
			if err != nil {
				t.Fatal(err)
			}
			for _, want := range c.want {
				if !strings.Contains(got, want) {
					t.Errorf("missing %q in:\n%s", want, got)
				}
			}
			for _, deny := range c.deny {
				if strings.Contains(got, deny) {
					t.Errorf("should not contain %q in:\n%s", deny, got)
				}
			}
		})
	}
}

// goldmark's safe mode replaces embedded HTML with a comment, which would
// delete it from the file on the next save. It must survive as visible text.
func TestEditorFragmentKeepsEmbeddedHTML(t *testing.T) {
	t.Run("inline", func(t *testing.T) {
		got, err := EditorFragment([]byte("Press <kbd>T</kbd> to toggle.\n"))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(got, "&lt;kbd&gt;T&lt;/kbd&gt;") {
			t.Errorf("inline HTML should become literal text, got:\n%s", got)
		}
		if strings.Contains(got, "omitted") {
			t.Errorf("inline HTML was dropped:\n%s", got)
		}
	})

	t.Run("block keeps its line breaks", func(t *testing.T) {
		got, err := EditorFragment([]byte("<p align=\"center\">\n  <img src=\"x.png\">\n</p>\n"))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(got, `class="`+RawHTMLClass+`"`) {
			t.Errorf("block HTML should be marked for verbatim round trip, got:\n%s", got)
		}
		if strings.Count(got, "<br>") != 2 {
			t.Errorf("block HTML should keep its 2 line breaks, got:\n%s", got)
		}
		if strings.Contains(got, "omitted") {
			t.Errorf("block HTML was dropped:\n%s", got)
		}
	})
}

func TestStyleCSSIsTheDocumentStylesheet(t *testing.T) {
	css := StyleCSS()
	for _, want := range []string{"--font-serif", ".prose h1", ".theme-toggle"} {
		if !strings.Contains(css, want) {
			t.Errorf("StyleCSS missing %q", want)
		}
	}
}

// The page and the editor must draw the theme from the same source.
func TestThemePartialsAreShared(t *testing.T) {
	page, err := Page([]byte("# Hi\n"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	for name, part := range map[string]string{
		"init":   ThemeInitJS(),
		"toggle": ThemeToggleHTML(),
		"script": ThemeToggleJS(),
	} {
		if strings.TrimSpace(part) == "" {
			t.Fatalf("theme %s partial is empty", name)
		}
		if !strings.Contains(page, strings.TrimSpace(part)) {
			t.Errorf("exported page does not use the shared theme %s partial", name)
		}
	}
}
