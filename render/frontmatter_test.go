package render

import (
	"strings"
	"testing"
)

func TestSplitFront(t *testing.T) {
	cases := []struct {
		name      string
		src       string
		wantFound bool
		wantFence string
		wantText  string
		wantRest  string
	}{
		{
			name: "yaml", src: "---\ntitle: Hello\ndraft: true\n---\n\n# Body\n",
			wantFound: true, wantFence: "---", wantText: "title: Hello\ndraft: true", wantRest: "# Body\n",
		},
		{
			name: "toml", src: "+++\ntitle = \"Hi\"\n+++\n\n# Body\n",
			wantFound: true, wantFence: "+++", wantText: "title = \"Hi\"", wantRest: "# Body\n",
		},
		{
			name: "nested values", src: "---\ntags:\n  - a\n  - b\n---\ntext\n",
			wantFound: true, wantFence: "---", wantText: "tags:\n  - a\n  - b", wantRest: "text\n",
		},
		{
			name: "empty block", src: "---\n---\n\n# Body\n",
			wantFound: true, wantFence: "---", wantText: "", wantRest: "# Body\n",
		},
		{
			name: "leading comment then key", src: "---\n# a note\ntitle: Hi\n---\nx\n",
			wantFound: true, wantFence: "---", wantText: "# a note\ntitle: Hi", wantRest: "x\n",
		},
		{
			// Mid-edit a key can be split across lines. The block must stay
			// front matter, or saving turns the metadata into a heading.
			name: "a key split while typing", src: "---\ntitle\n: Hi\n---\nx\n",
			wantFound: true, wantFence: "---", wantText: "title\n: Hi", wantRest: "x\n",
		},
		{
			name: "no front matter", src: "# Body\n\nText.\n",
			wantFound: false, wantRest: "# Body\n\nText.\n",
		},
		{
			// A document that merely opens with a thematic break is not
			// metadata, and must not be swallowed as if it were.
			name: "thematic break", src: "---\n\nJust a rule.\n\n---\n",
			wantFound: false, wantRest: "---\n\nJust a rule.\n\n---\n",
		},
		{
			name: "unclosed fence", src: "---\ntitle: Hello\n\n# Body\n",
			wantFound: false, wantRest: "---\ntitle: Hello\n\n# Body\n",
		},
		{
			name: "fence must be the first line", src: "\n---\ntitle: Hi\n---\n",
			wantFound: false, wantRest: "\n---\ntitle: Hi\n---\n",
		},
		{
			name: "no body after", src: "---\ntitle: Only\n---\n",
			wantFound: true, wantFence: "---", wantText: "title: Only", wantRest: "",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			front, rest, found := SplitFront([]byte(c.src))
			if found != c.wantFound {
				t.Fatalf("found = %v, want %v", found, c.wantFound)
			}
			if string(rest) != c.wantRest {
				t.Errorf("rest = %q, want %q", rest, c.wantRest)
			}
			if !found {
				return
			}
			if front.Fence != c.wantFence {
				t.Errorf("fence = %q, want %q", front.Fence, c.wantFence)
			}
			if front.Text != c.wantText {
				t.Errorf("text = %q, want %q", front.Text, c.wantText)
			}
		})
	}
}

func TestFrontTitle(t *testing.T) {
	cases := map[string]string{
		"title: Hello World":  "Hello World",
		`title: "Quoted"`:     "Quoted",
		"title: 'Single'":     "Single",
		`title = "TOML"`:      "TOML",
		"date: 2026-01-01":    "",
		"subtitle: Not this":  "",
		"a: 1\ntitle: Second": "Second",
	}
	for text, want := range cases {
		if got := (Front{Text: text}).Title(); got != want {
			t.Errorf("Title(%q) = %q, want %q", text, got, want)
		}
	}
}

// The editor shows front matter as an editable verbatim card rather than
// letting Markdown mistake it for a rule and a setext heading.
func TestEditorFragmentFrontMatter(t *testing.T) {
	got, err := EditorFragment([]byte("---\ntitle: Hello\ntags:\n  - a\n---\n\n# Body\n"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`class="` + FrontClass + `"`,
		`data-fence="---"`,
		"<b>title</b>: Hello",
		"<b>tags</b>:<br>  - a",
		"<h1>Body</h1>",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
	// The tell-tale of front matter parsed as Markdown.
	if strings.Contains(got, "<hr>") || strings.Contains(got, "<h2>") {
		t.Errorf("front matter was parsed as Markdown:\n%s", got)
	}
}

// Front matter is metadata, so the exported page uses it rather than typesets it.
func TestPageUsesFrontMatter(t *testing.T) {
	out, err := Page([]byte("---\ntitle: From metadata\ndraft: true\n---\n\n# A heading\n\nBody.\n"), Options{Source: "p.md"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "<title>From metadata</title>") {
		t.Error("a title in front matter should name the page")
	}
	if strings.Contains(out, "draft") {
		t.Error("front matter should not be typeset into the page")
	}
	if !strings.Contains(out, "A heading") || !strings.Contains(out, "Body.") {
		t.Error("the body should still render")
	}

	// An explicit --title still wins.
	out, _ = Page([]byte("---\ntitle: From metadata\n---\n\n# H\n"), Options{Title: "Explicit"})
	if !strings.Contains(out, "<title>Explicit</title>") {
		t.Error("--title should override front matter")
	}
}
