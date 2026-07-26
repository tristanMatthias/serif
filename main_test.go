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
