package editor

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// tree builds a directory from a path -> contents map and returns its root.
func tree(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for rel, body := range files {
		abs := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(abs, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestOpenDirectoryListsMarkdownOnly(t *testing.T) {
	root := tree(t, map[string]string{
		"index.md":            "# Index",
		"post.mdx":            "# Post",
		"notes/daily.md":      "# Daily",
		"notes/deep/far.md":   "# Far",
		"README.markdown":     "# Readme",
		"secrets.env":         "TOKEN=hunter2",
		"main.go":             "package main",
		".hidden/private.md":  "# Hidden",
		"node_modules/pkg.md": "# Vendored",
		".dotfile.md":         "# Dotfile",
	})

	ws, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if !ws.IsDir() {
		t.Fatal("expected a directory workspace")
	}

	files, err := ws.List()
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, f := range files {
		got = append(got, f.Path)
	}
	listed := strings.Join(got, ",")

	for _, want := range []string{"index.md", "post.mdx", "README.markdown", "notes/daily.md", "notes/deep/far.md"} {
		if !strings.Contains(listed, want) {
			t.Errorf("expected %q in the listing, got %v", want, got)
		}
	}
	for _, deny := range []string{"secrets.env", "main.go", ".hidden", "node_modules", ".dotfile.md"} {
		if strings.Contains(listed, deny) {
			t.Errorf("%q should not be listed, got %v", deny, got)
		}
	}
	// Shallow files come first, so the picker opens on the obvious ones.
	if depth(files[0].Path) != 0 {
		t.Errorf("top-level files should sort first, got %v", got)
	}
}

// Anything the browser sends is untrusted; the workspace is the only thing
// standing between it and the rest of the disk.
func TestResolveRefusesEscapes(t *testing.T) {
	root := tree(t, map[string]string{
		"ok.md":         "# ok",
		"page.mdx":      "# page",
		"sub/deep.md":   "# deep",
		"config.json":   "{}",
		"../sibling.md": "", // written outside root by design
	})

	ws, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}

	good := []string{"ok.md", "page.mdx", "sub/deep.md", "./ok.md", "sub/../ok.md"}
	for _, rel := range good {
		if _, err := ws.Resolve(rel); err != nil {
			t.Errorf("Resolve(%q) = %v, want it allowed", rel, err)
		}
	}

	bad := []string{
		"",
		"../sibling.md",
		"../../etc/passwd",
		"sub/../../sibling.md",
		"/etc/passwd",
		"config.json", // not Markdown
		"sub/../config.json",
		"..%2Fsibling.md",
	}
	for _, rel := range bad {
		if abs, err := ws.Resolve(rel); err == nil {
			t.Errorf("Resolve(%q) = %q, want it refused", rel, abs)
		}
	}
}

// A symlink inside the workspace can still point outside it, so containment is
// checked against the resolved path, not the joined one.
func TestResolveRefusesSymlinkOut(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on Windows")
	}
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.md")
	if err := os.WriteFile(secret, []byte("# secret"), 0o644); err != nil {
		t.Fatal(err)
	}

	root := tree(t, map[string]string{"ok.md": "# ok"})
	if err := os.Symlink(secret, filepath.Join(root, "link.md")); err != nil {
		t.Fatal(err)
	}

	ws, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if abs, err := ws.Resolve("link.md"); err == nil {
		t.Errorf("Resolve through a symlink out of the workspace returned %q, want refused", abs)
	}
}

// Opening one file must not turn into access to its whole directory.
func TestSingleFileWorkspaceIsConfinedToThatFile(t *testing.T) {
	root := tree(t, map[string]string{"open.md": "# open", "other.md": "# other"})

	ws, err := Open(filepath.Join(root, "open.md"))
	if err != nil {
		t.Fatal(err)
	}
	if ws.IsDir() {
		t.Fatal("expected a single-file workspace")
	}
	if _, err := ws.Resolve("other.md"); err == nil {
		t.Error("a single-file workspace must not resolve its siblings")
	}
	if _, err := ws.Resolve("open.md"); err != nil {
		t.Errorf("Resolve of the opened file failed: %v", err)
	}

	files, err := ws.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || files[0].Path != "open.md" {
		t.Errorf("List() = %v, want just open.md", files)
	}
}

func TestOpenCreatesMissingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fresh.md")
	ws, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("expected %s to be created: %v", path, err)
	}
	if def, _ := ws.Default(); def != "fresh.md" {
		t.Errorf("Default() = %q, want fresh.md", def)
	}
}

func TestOpenRejectsMissingDirectory(t *testing.T) {
	if _, err := Open(filepath.Join(t.TempDir(), "nope")); err == nil {
		t.Error("expected an error for a path that is neither a file nor a directory")
	}
}

func TestDefaultPicksAFile(t *testing.T) {
	ws, err := Open(tree(t, map[string]string{"notes/b.md": "b", "a.md": "a"}))
	if err != nil {
		t.Fatal(err)
	}
	def, err := ws.Default()
	if err != nil {
		t.Fatal(err)
	}
	if def != "a.md" {
		t.Errorf("Default() = %q, want the shallowest file a.md", def)
	}
}

// A folder with nothing in it is where you start a notebook, not a mistake.
func TestEmptyDirectoryOpens(t *testing.T) {
	root := t.TempDir()
	s, err := New(root)
	if err != nil {
		t.Fatalf("New on an empty directory: %v", err)
	}
	def, err := s.Workspace().Default()
	if err != nil || def != "" {
		t.Errorf("Default() = %q, %v; want \"\", nil", def, err)
	}
	if _, err := s.Workspace().Create("first.md"); err != nil {
		t.Fatalf("Create in an empty workspace: %v", err)
	}
	if def, _ := s.Workspace().Default(); def != "first.md" {
		t.Errorf("Default() = %q after creating a file, want first.md", def)
	}
}

/* ---- making and moving --------------------------------------------------- */

func TestCreateMakesFilesAndFolders(t *testing.T) {
	ws, err := Open(tree(t, map[string]string{"a.md": "# a"}))
	if err != nil {
		t.Fatal(err)
	}

	// A bare name gets an extension; a path brings its folders with it.
	for _, c := range []struct{ in, want string }{
		{"idea", "idea.md"},
		{"notes/2026/plan.md", "notes/2026/plan.md"},
		{"post.mdx", "post.mdx"},
		{"deep/thought", "deep/thought.md"},
	} {
		got, err := ws.Create(c.in)
		if err != nil {
			t.Errorf("Create(%q) = %v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("Create(%q) = %q, want %q", c.in, got, c.want)
		}
		if _, err := os.Stat(filepath.Join(ws.Root(), filepath.FromSlash(c.want))); err != nil {
			t.Errorf("Create(%q) left nothing on disk: %v", c.in, err)
		}
	}
}

func TestCreateRefusals(t *testing.T) {
	root := tree(t, map[string]string{"a.md": "# a", "notes/b.md": "# b"})
	ws, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}

	// A name that is taken must not be written over, whatever else happens.
	if _, err := ws.Create("a.md"); !errors.Is(err, ErrExists) {
		t.Errorf("Create over an existing file = %v, want ErrExists", err)
	}
	if got, _ := os.ReadFile(filepath.Join(root, "a.md")); string(got) != "# a" {
		t.Errorf("a.md was overwritten: %q", got)
	}

	bad := []string{
		"",
		"   ",
		"../outside",          // climbing out
		"/etc/passwd",         // absolute
		"notes/../../outside", // climbing out the long way
		".secret",             // the editor could never list it
		".config/notes",       // nor this
		"node_modules/readme", // nor this
	}
	for _, name := range bad {
		if got, err := ws.Create(name); err == nil {
			t.Errorf("Create(%q) = %q, want it refused", name, got)
		}
	}
}

func TestCreateIsRefusedInSingleFileMode(t *testing.T) {
	root := tree(t, map[string]string{"open.md": "# open"})
	ws, err := Open(filepath.Join(root, "open.md"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ws.Create("other.md"); err == nil {
		t.Error("a single-file workspace must not create its siblings")
	}
	if _, err := ws.Move("open.md", "renamed.md"); err == nil {
		t.Error("a single-file workspace must not rename the file it was given")
	}
}

func TestMoveRenamesAndFiles(t *testing.T) {
	root := tree(t, map[string]string{"draft.md": "# draft", "notes/b.md": "# b"})
	ws, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}

	got, err := ws.Move("draft.md", "notes/2026/final")
	if err != nil {
		t.Fatalf("Move: %v", err)
	}
	if got != "notes/2026/final.md" {
		t.Errorf("Move() = %q, want notes/2026/final.md", got)
	}
	if body, err := os.ReadFile(filepath.Join(root, "notes", "2026", "final.md")); err != nil {
		t.Errorf("moved file: %v", err)
	} else if string(body) != "# draft" {
		t.Errorf("contents changed in the move: %q", body)
	}
	if _, err := os.Stat(filepath.Join(root, "draft.md")); !errors.Is(err, fs.ErrNotExist) {
		t.Error("the file is still at its old path")
	}
}

// A name typed without an extension keeps the one the file already had.
func TestMoveKeepsTheExtension(t *testing.T) {
	ws, err := Open(tree(t, map[string]string{"post.mdx": "# post"}))
	if err != nil {
		t.Fatal(err)
	}
	got, err := ws.Move("post.mdx", "article")
	if err != nil {
		t.Fatal(err)
	}
	if got != "article.mdx" {
		t.Errorf("Move() = %q, want article.mdx", got)
	}
}

func TestMoveRefusals(t *testing.T) {
	root := tree(t, map[string]string{"a.md": "# a", "b.md": "# b"})
	ws, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := ws.Move("a.md", "b.md"); !errors.Is(err, ErrExists) {
		t.Errorf("Move onto an existing file = %v, want ErrExists", err)
	}
	for _, to := range []string{"../escaped.md", "", ".hidden.md"} {
		if _, err := ws.Move("a.md", to); err == nil {
			t.Errorf("Move to %q was allowed", to)
		}
	}
	if _, err := ws.Move("missing.md", "somewhere.md"); err == nil {
		t.Error("moving a file that is not there was allowed")
	}

	// Every refusal above must have left both files exactly where they were.
	for name, want := range map[string]string{"a.md": "# a", "b.md": "# b"} {
		if got, err := os.ReadFile(filepath.Join(root, name)); err != nil || string(got) != want {
			t.Errorf("%s = %q, %v; want %q", name, got, err, want)
		}
	}
}

// Renaming a file to itself is not a refusal, it is nothing to do — and on a
// case-insensitive filesystem a change of case is a real rename, not a clash.
func TestMoveToTheSameName(t *testing.T) {
	root := tree(t, map[string]string{"Notes.md": "# notes"})
	ws, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := ws.Move("Notes.md", "Notes.md"); err != nil || got != "Notes.md" {
		t.Errorf("Move to the same name = %q, %v", got, err)
	}
	got, err := ws.Move("Notes.md", "notes.md")
	if err != nil {
		t.Fatalf("Move to a different case: %v", err)
	}
	if got != "notes.md" {
		t.Errorf("Move() = %q, want notes.md", got)
	}
	if body, _ := os.ReadFile(filepath.Join(root, got)); string(body) != "# notes" {
		t.Errorf("contents changed in the rename: %q", body)
	}
}
