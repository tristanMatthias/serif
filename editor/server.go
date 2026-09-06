// Package editor serves a small Markdown editor over HTTP.
//
// The editor is a WYSIWYG surface: a file is rendered to HTML with serif's own
// renderer, edited as a live DOM in the browser, converted back to Markdown
// there, and saved continuously as you type. The server's job is narrow — hand
// out documents, accept new versions of them, and write them to disk safely.
//
//	serif edit notes.md                      # one file
//	serif edit ~/notes                       # a directory of them
//	serif edit ~/notes --addr 0.0.0.0:8787   # reachable over Tailscale/LAN
package editor

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"text/template"
	"time"

	"github.com/tristanMatthias/serif/render"
)

//go:embed assets
var assets embed.FS

// indexTmpl is the editor shell. It is a template so the theme toggle, its
// script, and the stylesheet all come from the render package rather than being
// re-implemented here.
var indexTmpl = template.Must(template.ParseFS(assets, "assets/index.html"))

// maxDocBytes caps how large a document the server will accept in one save. The
// editor holds the whole file in memory anyway; this only stops a stray request
// from allocating without bound.
const maxDocBytes = 8 << 20 // 8 MiB

// pollInterval is how often an open document is checked for edits made by
// another program (a second browser tab, git checkout, $EDITOR).
const pollInterval = 750 * time.Millisecond

// Server edits the Markdown in one workspace.
type Server struct {
	ws *Workspace

	// writes serialises saves so two of them cannot interleave.
	writes sync.Mutex
}

// New opens a workspace for editing. target may be a file or a directory.
func New(target string) (*Server, error) {
	ws, err := Open(target)
	if err != nil {
		return nil, err
	}
	if _, err := ws.Default(); err != nil {
		return nil, err
	}
	return &Server{ws: ws}, nil
}

// Workspace is what this server was opened on.
func (s *Server) Workspace() *Workspace { return s.ws }

// Handler returns the editor's routes.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.handleIndex)
	mux.HandleFunc("GET /serif.css", s.handleStyle)
	mux.Handle("GET /assets/", noStore(http.FileServer(http.FS(assets))))
	mux.HandleFunc("GET /api/files", s.handleFiles)
	mux.HandleFunc("GET /api/doc", s.handleGetDoc)
	mux.HandleFunc("PUT /api/doc", s.handlePutDoc)
	mux.HandleFunc("POST /api/doc", s.handleNewDoc)
	mux.HandleFunc("POST /api/move", s.handleMoveDoc)
	mux.HandleFunc("POST /api/render", s.handleRender)
	mux.HandleFunc("GET /api/events", s.handleEvents)
	return mux
}

/* ---- document I/O -------------------------------------------------------- */

// read returns a file's contents and its revision. The revision is a content
// hash rather than a timestamp, so two saves within the same clock tick — or a
// save that restores earlier content — are still compared correctly.
func read(abs string) (string, string, error) {
	b, err := os.ReadFile(abs)
	if err != nil {
		return "", "", err
	}
	return string(b), revOf(b), nil
}

// write replaces a file's contents atomically: a temp file in the same
// directory is written, flushed, and renamed over the target, so a crash or a
// full disk mid-save cannot truncate the document.
func write(abs, text string) (string, error) {
	mode := fs.FileMode(0o644)
	if fi, err := os.Stat(abs); err == nil {
		mode = fi.Mode().Perm()
	}

	tmp, err := os.CreateTemp(filepath.Dir(abs), ".serif-edit-*")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op once the rename succeeds

	if _, err := tmp.WriteString(text); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Chmod(tmpName, mode); err != nil {
		return "", err
	}
	if err := os.Rename(tmpName, abs); err != nil {
		return "", err
	}
	return revOf([]byte(text)), nil
}

/* ---- handlers ------------------------------------------------------------ */

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	err := indexTmpl.Execute(w, map[string]any{
		"Name":        s.ws.Name(),
		"ThemeInit":   render.ThemeInitJS(),
		"ThemeToggle": render.ThemeToggleHTML(),
		"ThemeJS":     render.ThemeToggleJS(),
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// noStore keeps the browser from holding on to the editor's own scripts.
//
// Embedded files have no modification time, so net/http sends neither
// Last-Modified nor ETag with them — and a response with no validators and no
// Cache-Control is one a browser may cache for as long as it likes. A tab left
// open across a rebuild would then run a mix of old and new modules, which
// fails in ways that look nothing like the cause.
func noStore(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		h.ServeHTTP(w, r)
	})
}

func (s *Server) handleStyle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/css; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	io.WriteString(w, render.StyleCSS())
}

type filesResponse struct {
	Root  string `json:"root"`
	Name  string `json:"name"`
	IsDir bool   `json:"isDir"`
	Files []File `json:"files"`
}

func (s *Server) handleFiles(w http.ResponseWriter, r *http.Request) {
	files, err := s.ws.List()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, filesResponse{
		Root: s.ws.Root(), Name: s.ws.Name(), IsDir: s.ws.IsDir(), Files: files,
	})
}

type docResponse struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Text string `json:"text"`
	HTML string `json:"html"`
	Rev  string `json:"rev"`
	// Modified is the file's mtime in Unix seconds, so the editor can say when
	// it was last saved without having to have been the one that saved it.
	Modified int64 `json:"modified"`
}

// doc builds the payload for one file.
func (s *Server) doc(rel string) (docResponse, error) {
	abs, err := s.ws.Resolve(rel)
	if err != nil {
		return docResponse{}, err
	}
	text, rev, err := read(abs)
	if err != nil {
		return docResponse{}, err
	}
	html, err := render.EditorFragment([]byte(text))
	if err != nil {
		return docResponse{}, err
	}
	var modified int64
	if fi, err := os.Stat(abs); err == nil {
		modified = fi.ModTime().Unix()
	}
	return docResponse{
		Path: s.ws.Rel(abs), Name: filepath.Base(abs), Text: text, HTML: html,
		Rev: rev, Modified: modified,
	}, nil
}

func (s *Server) handleGetDoc(w http.ResponseWriter, r *http.Request) {
	rel := r.URL.Query().Get("path")
	if rel == "" {
		var err error
		if rel, err = s.ws.Default(); err != nil {
			httpError(w, http.StatusNotFound, err.Error())
			return
		}
		if rel == "" {
			// Nothing to open yet. An empty workspace is a state the editor
			// shows — with an offer to make the first file — not a failure.
			writeJSON(w, http.StatusOK, docResponse{})
			return
		}
	}
	doc, err := s.doc(rel)
	if err != nil {
		httpError(w, statusFor(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, doc)
}

type saveRequest struct {
	Path string `json:"path"`
	Text string `json:"text"`
	// Rev is the revision the editor last saw. A mismatch means the file
	// changed on disk since then, and the save is refused rather than silently
	// discarding the other change.
	Rev string `json:"rev"`
	// Force saves regardless of Rev, for when the user chooses to overwrite.
	Force bool `json:"force"`
}

func (s *Server) handlePutDoc(w http.ResponseWriter, r *http.Request) {
	var req saveRequest
	if !s.readJSON(w, r, &req) {
		return
	}
	abs, err := s.ws.Resolve(req.Path)
	if err != nil {
		httpError(w, statusFor(err), err.Error())
		return
	}

	s.writes.Lock()
	defer s.writes.Unlock()

	current, currentRev, err := read(abs)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !req.Force && req.Rev != "" && req.Rev != currentRev {
		doc, err := s.doc(s.ws.Rel(abs))
		if err != nil {
			httpError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusConflict, doc)
		return
	}
	if req.Text == current {
		// Nothing to do; still report the revision so the editor stays in sync.
		writeJSON(w, http.StatusOK, map[string]string{"rev": currentRev})
		return
	}

	rev, err := write(abs, req.Text)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"rev": rev})
}

// handleNewDoc creates an empty file and hands it back like any other
// document, so the editor can open what it just made without a second round
// trip.
func (s *Server) handleNewDoc(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}
	if !s.readJSON(w, r, &req) {
		return
	}

	s.writes.Lock()
	defer s.writes.Unlock()

	rel, err := s.ws.Create(req.Path)
	if err != nil {
		httpError(w, statusFor(err), err.Error())
		return
	}
	doc, err := s.doc(rel)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, doc)
}

// handleMoveDoc renames a file, or files it under another directory — the same
// gesture either way. The reply is the document at its new path, so an editor
// that had it open can carry on with it.
func (s *Server) handleMoveDoc(w http.ResponseWriter, r *http.Request) {
	var req struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if !s.readJSON(w, r, &req) {
		return
	}

	// A move takes the same lock as a save: the file must not be written to a
	// path that is about to stop existing.
	s.writes.Lock()
	defer s.writes.Unlock()

	rel, err := s.ws.Move(req.From, req.To)
	if err != nil {
		httpError(w, statusFor(err), err.Error())
		return
	}
	doc, err := s.doc(rel)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, doc)
}

// handleRender converts a Markdown snippet to HTML. The editor uses it when you
// paste Markdown, so pasted text arrives as real headings and lists rather than
// as a wall of literal syntax.
func (s *Server) handleRender(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Text string `json:"text"`
	}
	if !s.readJSON(w, r, &req) {
		return
	}
	html, err := render.EditorFragment([]byte(req.Text))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"html": html})
}

// handleEvents streams the open document's revision. The browser also treats
// this connection as its liveness signal: while the stream is up, the editor is
// talking to the server.
//
// Watching is per-connection and starts from a stat, so an idle editor costs
// one stat per interval and no read at all.
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	// With no path — an empty workspace, before the first file exists — there
	// is nothing to watch, but the stream is also the editor's connection
	// indicator, so it is still opened and kept alive.
	var abs string
	if rel := r.URL.Query().Get("path"); rel != "" || !s.ws.IsDir() {
		var err error
		if abs, err = s.ws.Resolve(rel); err != nil {
			httpError(w, statusFor(err), err.Error())
			return
		}
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	send := func(event, data string) {
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
		flusher.Flush()
	}
	var stamp, rev string
	if abs != "" {
		send("open", s.ws.Rel(abs))
		if fi, err := os.Stat(abs); err == nil {
			stamp = modKey(fi)
			_, rev, _ = read(abs)
		}
	}

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	keepalive := time.NewTicker(25 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return

		case <-ticker.C:
			if abs == "" {
				continue
			}
			fi, err := os.Stat(abs)
			if err != nil {
				continue
			}
			// Size and mtime are enough to know nothing happened, which is the
			// common case; only then is the file actually read.
			if key := modKey(fi); key == stamp {
				continue
			} else {
				stamp = key
			}
			_, next, err := read(abs)
			if err != nil || next == rev {
				continue
			}
			rev = next
			send("rev", rev)

		case <-keepalive.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

/* ---- helpers ------------------------------------------------------------- */

// readJSON decodes a write request, answering the client itself if it cannot.
// It reports whether the handler should carry on.
func (s *Server) readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if !isJSON(r) {
		httpError(w, http.StatusUnsupportedMediaType, "expected Content-Type: application/json")
		return false
	}
	if err := decodeJSON(r, v); err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return false
	}
	return true
}

// statusFor maps a workspace refusal to a status code. Anything the workspace
// rejects is the client asking for something it may not have.
func statusFor(err error) int {
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return http.StatusNotFound
	case errors.Is(err, ErrExists):
		return http.StatusConflict
	default:
		return http.StatusForbidden
	}
}

// isJSON requires an explicit JSON content type on writes. Besides catching
// malformed clients, it means a page on another origin cannot save over a file:
// a JSON body forces a CORS preflight, and no CORS headers are served.
func isJSON(r *http.Request) bool {
	ct := r.Header.Get("Content-Type")
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = ct[:i]
	}
	return strings.EqualFold(strings.TrimSpace(ct), "application/json")
}

func decodeJSON(r *http.Request, v any) error {
	return json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxDocBytes)).Decode(v)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func httpError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
