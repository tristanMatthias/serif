package editor

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// newTestServer creates a Server over a temp file seeded with body.
func newTestServer(t *testing.T, body string) (*Server, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "notes.md")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := New(path)
	if err != nil {
		t.Fatal(err)
	}
	return s, path
}

func do(t *testing.T, s *Server, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}

func decode(t *testing.T, w *httptest.ResponseRecorder) docResponse {
	t.Helper()
	var d docResponse
	if err := json.Unmarshal(w.Body.Bytes(), &d); err != nil {
		t.Fatalf("decode %s: %v", w.Body.String(), err)
	}
	return d
}

func TestNewCreatesMissingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fresh.md")
	if _, err := New(path); err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("expected %s to be created: %v", path, err)
	}
}

func TestGetDocRendersWithSerif(t *testing.T) {
	s, _ := newTestServer(t, "# Title\n\n- one\n- two\n")
	w := do(t, s, "GET", "/api/doc", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	got := decode(t, w)
	if got.Name != "notes.md" {
		t.Errorf("name = %q", got.Name)
	}
	if !strings.Contains(got.HTML, "<h1>Title</h1>") {
		t.Errorf("html missing heading:\n%s", got.HTML)
	}
	if !strings.Contains(got.HTML, "<li>one</li>") {
		t.Errorf("html missing list item:\n%s", got.HTML)
	}
	if got.Rev == "" {
		t.Error("rev should not be empty")
	}
}

func TestPutDocWritesToDisk(t *testing.T) {
	s, path := newTestServer(t, "old\n")
	rev := decode(t, do(t, s, "GET", "/api/doc", "")).Rev

	body, _ := json.Marshal(saveRequest{Text: "# New\n", Rev: rev})
	w := do(t, s, "PUT", "/api/doc", string(body))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}

	onDisk, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(onDisk) != "# New\n" {
		t.Errorf("file = %q, want %q", onDisk, "# New\n")
	}
}

func TestPutDocPreservesFileMode(t *testing.T) {
	s, path := newTestServer(t, "x\n")
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(saveRequest{Text: "y\n"})
	if w := do(t, s, "PUT", "/api/doc", string(body)); w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Errorf("mode = %v, want 0600", fi.Mode().Perm())
	}
}

func TestPutDocRejectsStaleRevision(t *testing.T) {
	s, path := newTestServer(t, "original\n")
	stale := decode(t, do(t, s, "GET", "/api/doc", "")).Rev

	// Something else edits the file behind the editor's back.
	if err := os.WriteFile(path, []byte("changed elsewhere\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(saveRequest{Text: "mine\n", Rev: stale})
	w := do(t, s, "PUT", "/api/doc", string(body))
	if w.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", w.Code)
	}
	if got := decode(t, w); got.Text != "changed elsewhere\n" {
		t.Errorf("conflict should return the on-disk text, got %q", got.Text)
	}
	if onDisk, _ := os.ReadFile(path); string(onDisk) != "changed elsewhere\n" {
		t.Errorf("conflicting save must not write, file = %q", onDisk)
	}
}

func TestPutDocForceOverwrites(t *testing.T) {
	s, path := newTestServer(t, "original\n")
	body, _ := json.Marshal(saveRequest{Text: "mine\n", Rev: "stale", Force: true})
	if w := do(t, s, "PUT", "/api/doc", string(body)); w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	if onDisk, _ := os.ReadFile(path); string(onDisk) != "mine\n" {
		t.Errorf("file = %q", onDisk)
	}
}

// A cross-origin page cannot send application/json without a preflight, so
// requiring it on every route that writes keeps another site from saving over a
// file, making one, or moving one.
func TestWritesRequireJSONContentType(t *testing.T) {
	s, path := newTestServer(t, "safe\n")
	writes := []struct{ method, route, body string }{
		{"PUT", "/api/doc", `{"text":"evil"}`},
		{"POST", "/api/doc", `{"path":"evil.md"}`},
		{"POST", "/api/move", `{"from":"notes.md","to":"evil.md"}`},
	}
	for _, call := range writes {
		r := httptest.NewRequest(call.method, call.route, strings.NewReader(call.body))
		r.Header.Set("Content-Type", "text/plain")
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)

		if w.Code != http.StatusUnsupportedMediaType {
			t.Errorf("%s %s: status = %d, want 415", call.method, call.route, w.Code)
		}
	}
	if onDisk, _ := os.ReadFile(path); string(onDisk) != "safe\n" {
		t.Errorf("file was modified: %q", onDisk)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(path), "evil.md")); err == nil {
		t.Error("a text/plain request created a file")
	}
}

func TestRenderEndpoint(t *testing.T) {
	s, _ := newTestServer(t, "")
	w := do(t, s, "POST", "/api/render", `{"text":"- a\n- b\n"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	var got map[string]string
	json.Unmarshal(w.Body.Bytes(), &got)
	if !strings.Contains(got["html"], "<ul>") {
		t.Errorf("html = %q", got["html"])
	}
}

// The editor page must pull its typography from the render package rather than
// carrying its own copy.
func TestServesSerifStylesheet(t *testing.T) {
	s, _ := newTestServer(t, "")
	w := do(t, s, "GET", "/serif.css", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "--font-serif") {
		t.Error("stylesheet should be serif's own")
	}

	page := do(t, s, "GET", "/", "").Body.String()
	for _, want := range []string{`href="/serif.css"`, `id="theme-toggle"`, "serif-theme", "notes.md"} {
		if !strings.Contains(page, want) {
			t.Errorf("editor page missing %q", want)
		}
	}
}

func TestNormalizeAddr(t *testing.T) {
	cases := map[string]string{
		"":              DefaultAddr,
		"8080":          "127.0.0.1:8080",
		"0.0.0.0":       "0.0.0.0:8787",
		"0.0.0.0:8080":  "0.0.0.0:8080",
		"localhost:123": "localhost:123",
	}
	for in, want := range cases {
		if got := NormalizeAddr(in); got != want {
			t.Errorf("NormalizeAddr(%q) = %q, want %q", in, got, want)
		}
	}
}

/* ---- directory mode ------------------------------------------------------ */

func newDirServer(t *testing.T, files map[string]string) (*Server, string) {
	t.Helper()
	root := tree(t, files)
	s, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	return s, root
}

func TestFilesEndpointListsWorkspace(t *testing.T) {
	s, root := newDirServer(t, map[string]string{
		"a.md": "# a", "notes/b.md": "# b", "keys.env": "secret",
	})
	w := do(t, s, "GET", "/api/files", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	var got filesResponse
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.IsDir {
		t.Error("isDir should be true for a directory workspace")
	}
	if got.Root != root {
		t.Errorf("root = %q, want %q", got.Root, root)
	}
	if len(got.Files) != 2 {
		t.Fatalf("expected 2 Markdown files, got %v", got.Files)
	}
	if strings.Contains(w.Body.String(), "keys.env") {
		t.Error("non-Markdown files must not be listed")
	}
}

func TestGetDocByPath(t *testing.T) {
	s, _ := newDirServer(t, map[string]string{"a.md": "# a", "notes/b.md": "# bee"})
	got := decode(t, do(t, s, "GET", "/api/doc?path=notes%2Fb.md", ""))
	if got.Path != "notes/b.md" || !strings.Contains(got.HTML, "bee") {
		t.Errorf("got %+v", got)
	}
}

func TestSingleFileModeReportsNotADirectory(t *testing.T) {
	s, _ := newTestServer(t, "# only\n")
	var got filesResponse
	json.Unmarshal(do(t, s, "GET", "/api/files", "").Body.Bytes(), &got)
	if got.IsDir {
		t.Error("isDir should be false when a single file was opened")
	}
	if len(got.Files) != 1 {
		t.Errorf("expected exactly the opened file, got %v", got.Files)
	}
}

// The HTTP surface must refuse the same things the workspace does.
func TestTraversalIsRefusedOverHTTP(t *testing.T) {
	s, root := newDirServer(t, map[string]string{"a.md": "# a"})
	outside := filepath.Join(filepath.Dir(root), "outside.md")
	if err := os.WriteFile(outside, []byte("# outside\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(outside) })

	for _, rel := range []string{"../outside.md", "..%2Foutside.md", "/etc/hosts", "a.md/../../outside.md"} {
		w := do(t, s, "GET", "/api/doc?path="+url.QueryEscape(rel), "")
		if w.Code == http.StatusOK {
			t.Errorf("GET %q returned 200, want a refusal", rel)
		}

		body, _ := json.Marshal(saveRequest{Path: rel, Text: "pwned\n", Force: true})
		if w := do(t, s, "PUT", "/api/doc", string(body)); w.Code == http.StatusOK {
			t.Errorf("PUT %q returned 200, want a refusal", rel)
		}
	}
	if got, _ := os.ReadFile(outside); string(got) != "# outside\n" {
		t.Errorf("a file outside the workspace was modified: %q", got)
	}
}

func TestPutDocWritesTheRequestedFile(t *testing.T) {
	s, root := newDirServer(t, map[string]string{"a.md": "# a", "notes/b.md": "# b"})
	body, _ := json.Marshal(saveRequest{Path: "notes/b.md", Text: "# changed\n"})
	if w := do(t, s, "PUT", "/api/doc", string(body)); w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	if got, _ := os.ReadFile(filepath.Join(root, "notes", "b.md")); string(got) != "# changed\n" {
		t.Errorf("b.md = %q", got)
	}
	if got, _ := os.ReadFile(filepath.Join(root, "a.md")); string(got) != "# a" {
		t.Errorf("a.md should be untouched, got %q", got)
	}
}

// A tab left open across a rebuild must not keep running the old scripts.
// Embedded files carry no modification time, so net/http sends no validators
// with them; without an explicit Cache-Control a browser may hold them for as
// long as it likes and end up mixing old modules with new ones.
func TestEditorAssetsAreNeverCached(t *testing.T) {
	s, _ := newTestServer(t, "# x\n")
	for _, path := range []string{"/", "/serif.css", "/assets/editor.js", "/assets/editing.js",
		"/assets/markdown.js", "/assets/picker.js", "/assets/tree.js", "/assets/prompt.js",
		"/assets/editor.css"} {
		w := do(t, s, "GET", path, "")
		if w.Code != http.StatusOK {
			t.Errorf("GET %s = %d", path, w.Code)
			continue
		}
		if got := w.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("GET %s: Cache-Control = %q, want %q", path, got, "no-store")
		}
	}
}

/* ---- making and moving files --------------------------------------------- */

func TestNewDocCreatesAndOpensIt(t *testing.T) {
	s, root := newDirServer(t, map[string]string{"a.md": "# a"})

	w := do(t, s, "POST", "/api/doc", `{"path":"notes/idea"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	// The new document comes back whole, so the editor can open what it just
	// made without asking for it again.
	got := decode(t, w)
	if got.Path != "notes/idea.md" || got.Name != "idea.md" || got.Text != "" {
		t.Errorf("got %+v", got)
	}
	if _, err := os.Stat(filepath.Join(root, "notes", "idea.md")); err != nil {
		t.Errorf("nothing on disk: %v", err)
	}

	// And it is in the listing the picker and the tree are built from.
	var files filesResponse
	json.Unmarshal(do(t, s, "GET", "/api/files", "").Body.Bytes(), &files)
	if !strings.Contains(w.Body.String(), "idea.md") || len(files.Files) != 2 {
		t.Errorf("new file missing from the listing: %v", files.Files)
	}
}

func TestNewDocRefusesATakenName(t *testing.T) {
	s, root := newDirServer(t, map[string]string{"a.md": "# a"})
	w := do(t, s, "POST", "/api/doc", `{"path":"a.md"}`)
	if w.Code != http.StatusConflict {
		t.Errorf("status = %d, want 409", w.Code)
	}
	if got, _ := os.ReadFile(filepath.Join(root, "a.md")); string(got) != "# a" {
		t.Errorf("the existing file was written over: %q", got)
	}
}

func TestMoveOverHTTP(t *testing.T) {
	s, root := newDirServer(t, map[string]string{"draft.md": "# draft", "keep.md": "# keep"})

	w := do(t, s, "POST", "/api/move", `{"from":"draft.md","to":"notes/final"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	if got := decode(t, w); got.Path != "notes/final.md" || !strings.Contains(got.HTML, "draft") {
		t.Errorf("got %+v", got)
	}
	if body, err := os.ReadFile(filepath.Join(root, "notes", "final.md")); err != nil {
		t.Errorf("moved file: %v", err)
	} else if string(body) != "# draft" {
		t.Errorf("contents changed in the move: %q", body)
	}

	if w := do(t, s, "POST", "/api/move", `{"from":"notes/final.md","to":"keep.md"}`); w.Code != http.StatusConflict {
		t.Errorf("moving onto an existing file = %d, want 409", w.Code)
	}
	if got, _ := os.ReadFile(filepath.Join(root, "keep.md")); string(got) != "# keep" {
		t.Errorf("keep.md was written over: %q", got)
	}
}

// Making and moving reach the filesystem, so they get the same scrutiny as
// saving does: nothing may be created or landed outside the workspace.
func TestCreateAndMoveCannotEscapeTheWorkspace(t *testing.T) {
	s, root := newDirServer(t, map[string]string{"a.md": "# a"})
	outside := filepath.Dir(root)

	for _, rel := range []string{"../escaped", "../../escaped", "/tmp/escaped", "..%2Fescaped"} {
		body, _ := json.Marshal(map[string]string{"path": rel})
		if w := do(t, s, "POST", "/api/doc", string(body)); w.Code == http.StatusCreated {
			t.Errorf("POST /api/doc %q was allowed", rel)
		}
		body, _ = json.Marshal(map[string]string{"from": "a.md", "to": rel})
		if w := do(t, s, "POST", "/api/move", string(body)); w.Code == http.StatusOK {
			t.Errorf("POST /api/move to %q was allowed", rel)
		}
	}
	for _, name := range []string{"escaped.md", "escaped"} {
		if _, err := os.Stat(filepath.Join(outside, name)); err == nil {
			os.Remove(filepath.Join(outside, name))
			t.Errorf("%s was written outside the workspace", name)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "a.md")); err != nil {
		t.Errorf("a.md was moved away by a refused request: %v", err)
	}
}

func TestSingleFileModeMakesAndMovesNothing(t *testing.T) {
	s, path := newTestServer(t, "# only\n")
	if w := do(t, s, "POST", "/api/doc", `{"path":"other.md"}`); w.Code == http.StatusCreated {
		t.Error("a single-file editor created a second file")
	}
	if w := do(t, s, "POST", "/api/move", `{"from":"notes.md","to":"renamed.md"}`); w.Code == http.StatusOK {
		t.Error("a single-file editor renamed the file it was opened on")
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("the opened file is gone: %v", err)
	}
}

// An empty folder is a workspace waiting for its first file, and the editor
// needs to be told that rather than handed an error.
func TestEmptyWorkspaceOpensWithNothing(t *testing.T) {
	root := t.TempDir()
	s, err := New(root)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	w := do(t, s, "GET", "/api/doc", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	if got := decode(t, w); got.Path != "" {
		t.Errorf("path = %q, want empty", got.Path)
	}

	if w := do(t, s, "POST", "/api/doc", `{"path":"first"}`); w.Code != http.StatusCreated {
		t.Fatalf("creating the first file: %d %s", w.Code, w.Body)
	}
	if got := decode(t, do(t, s, "GET", "/api/doc", "")); got.Path != "first.md" {
		t.Errorf("path = %q, want first.md once a file exists", got.Path)
	}
}
