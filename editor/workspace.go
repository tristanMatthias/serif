package editor

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"slices"
	"sort"
	"strings"
)

// maxListedFiles bounds a directory walk. A notes folder will never come close;
// a wrong path ("serif edit ~") should not hang the browser.
const maxListedFiles = 2000

// markdownExts is the set of files the editor will open. Everything else in the
// directory is invisible to it — which also means a request can never read or
// overwrite, say, a .env sitting next to your notes.
var markdownExts = map[string]bool{
	".md": true, ".mdx": true, ".markdown": true, ".mdown": true,
	".mkd": true, ".mkdn": true, ".text": true, ".txt": true,
}

// skipDirs are never walked. They hold no prose and can be enormous.
var skipDirs = map[string]bool{
	"node_modules": true, "vendor": true, "dist": true, "build": true,
	"target": true, "__pycache__": true,
}

// ErrExists is the refusal to write over a file that is already there. A new
// file, or a move that landed on one, would destroy a document the editor could
// not then bring back.
var ErrExists = errors.New("already exists")

// Workspace is what the editor was pointed at: one Markdown file, or a
// directory of them. Every path the browser asks for is resolved through it, so
// a request can never reach outside what was opened.
type Workspace struct {
	// root is the absolute directory the editor is confined to.
	root string
	// realRoot is root with symlinks resolved, used for containment checks.
	realRoot string
	// single is the file name when one file was opened, empty for a directory.
	single string
}

// File is one entry in the picker.
type File struct {
	Path     string `json:"path"` // slash-separated, relative to the workspace root
	Name     string `json:"name"`
	Dir      string `json:"dir"` // parent directory, "" at the top level
	Size     int64  `json:"size"`
	Modified int64  `json:"modified"` // Unix seconds
}

// Open prepares a workspace. A path that does not exist is created as an empty
// file, so `serif edit new-idea.md` just works.
func Open(target string) (*Workspace, error) {
	abs, err := filepath.Abs(target)
	if err != nil {
		return nil, err
	}

	fi, err := os.Stat(abs)
	if errors.Is(err, fs.ErrNotExist) {
		if !markdownExts[strings.ToLower(filepath.Ext(abs))] {
			return nil, fmt.Errorf("%s does not exist", target)
		}
		if err := os.WriteFile(abs, nil, 0o644); err != nil {
			return nil, fmt.Errorf("create %s: %w", target, err)
		}
		fi, err = os.Stat(abs)
	}
	if err != nil {
		return nil, err
	}

	w := &Workspace{root: abs}
	if !fi.IsDir() {
		w.root = filepath.Dir(abs)
		w.single = filepath.Base(abs)
	}
	if w.realRoot, err = filepath.EvalSymlinks(w.root); err != nil {
		return nil, err
	}
	return w, nil
}

// IsDir reports whether a whole directory was opened.
func (w *Workspace) IsDir() bool { return w.single == "" }

// Root is the directory the editor is confined to.
func (w *Workspace) Root() string { return w.root }

// Name labels the workspace: the directory name, or the file name.
func (w *Workspace) Name() string {
	if w.single != "" {
		return w.single
	}
	return filepath.Base(w.root)
}

// Default is the file to open first, or "" when a directory holds no Markdown
// at all. An empty folder is somewhere to write the first file rather than a
// mistake, so the editor opens on it and offers to make one.
func (w *Workspace) Default() (string, error) {
	if w.single != "" {
		return w.single, nil
	}
	files, err := w.List()
	if err != nil {
		return "", err
	}
	if len(files) == 0 {
		return "", nil
	}
	return files[0].Path, nil
}

// Resolve turns a path from the browser into an absolute one, or refuses.
//
// Three things have to hold: the path must stay inside the workspace even after
// symlinks are followed, it must name a Markdown file, and in single-file mode
// it must be *the* file.
func (w *Workspace) Resolve(rel string) (string, error) {
	return w.resolve(rel, true)
}

// ResolveNew is Resolve for a file that is not there yet — one about to be
// created, or the far end of a move. The checks are the same; containment is
// judged from the deepest directory above it that does exist.
func (w *Workspace) ResolveNew(rel string) (string, error) {
	return w.resolve(rel, false)
}

func (w *Workspace) resolve(rel string, mustExist bool) (string, error) {
	if w.single != "" {
		if rel != "" && rel != w.single {
			return "", fmt.Errorf("this editor is open on a single file")
		}
		return filepath.Join(w.root, w.single), nil
	}
	if rel == "" {
		return "", fmt.Errorf("no file given")
	}

	// Anchoring at "/" before cleaning collapses any leading "..", so the
	// result cannot climb above the root to begin with.
	clean := strings.TrimPrefix(path.Clean("/"+strings.ReplaceAll(rel, "\\", "/")), "/")
	if clean == "" || clean == "." {
		return "", fmt.Errorf("no file given")
	}
	if !markdownExts[strings.ToLower(path.Ext(clean))] {
		return "", fmt.Errorf("not a Markdown file: %s", rel)
	}

	abs := filepath.Join(w.root, filepath.FromSlash(clean))

	// A symlink inside the workspace could still point out of it, so the check
	// is made against the resolved path.
	real, err := realPath(abs, mustExist)
	if err != nil {
		return "", err
	}
	if !within(w.realRoot, real) {
		return "", fmt.Errorf("outside the workspace: %s", rel)
	}
	return abs, nil
}

// Create makes a new, empty Markdown file and returns its workspace-relative
// path. Parent directories are made along the way, so "2026/plan.md" is a way
// of filing something as well as of naming it.
func (w *Workspace) Create(rel string) (string, error) {
	abs, err := w.newPath(rel, ".md")
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return "", err
	}
	// O_EXCL rather than a stat first: two tabs racing on the same name must
	// not both come away believing they created it.
	f, err := os.OpenFile(abs, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if errors.Is(err, fs.ErrExist) {
		return "", fmt.Errorf("%s %w", w.Rel(abs), ErrExists)
	}
	if err != nil {
		return "", err
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	return w.Rel(abs), nil
}

// Move renames a file — which is also how it is filed somewhere else, since the
// destination may name a directory that does not exist yet. It never writes
// over a file that is already there.
func (w *Workspace) Move(from, to string) (string, error) {
	src, err := w.Resolve(from)
	if err != nil {
		return "", err
	}
	// A destination typed without an extension keeps the one it has, so
	// renaming post.mdx to "draft" does not quietly turn it into Markdown.
	dst, err := w.newPath(to, filepath.Ext(src))
	if err != nil {
		return "", err
	}
	if dst == src {
		return w.Rel(src), nil
	}
	if dstInfo, err := os.Lstat(dst); err == nil {
		// On a case-insensitive filesystem the destination stats as the source
		// itself, and notes.md → Notes.md is a rename people do mean.
		if srcInfo, err := os.Lstat(src); err != nil || !os.SameFile(dstInfo, srcInfo) {
			return "", fmt.Errorf("%s %w", w.Rel(dst), ErrExists)
		}
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return "", err
	}
	if err := os.Rename(src, dst); err != nil {
		return "", err
	}
	return w.Rel(dst), nil
}

// newPath resolves a name for a file that is about to appear. It is checked
// like any other path, with two allowances for the fact that a person just
// typed it: a name given without a usable extension gets fallback, and a name
// the file list would then hide is refused rather than silently made.
func (w *Workspace) newPath(rel, fallback string) (string, error) {
	if w.single != "" {
		return "", fmt.Errorf("this editor is open on a single file")
	}
	rel = strings.TrimRight(strings.TrimSpace(strings.ReplaceAll(rel, "\\", "/")), "/")
	if rel == "" {
		return "", fmt.Errorf("no name given")
	}
	// Resolve would clamp a climbing path to the root, which for a path someone
	// typed means quietly making a different file from the one they asked for.
	// Refusing says so instead.
	if strings.HasPrefix(rel, "/") || slices.Contains(strings.Split(rel, "/"), "..") {
		return "", fmt.Errorf("the name has to stay inside %s", w.Name())
	}
	if !markdownExts[strings.ToLower(path.Ext(rel))] {
		rel += fallback
	}

	abs, err := w.ResolveNew(rel)
	if err != nil {
		return "", err
	}
	if hidden(w.Rel(abs)) {
		return "", fmt.Errorf("%s would be hidden from the editor", w.Rel(abs))
	}
	return abs, nil
}

// Rel is the workspace-relative, slash-separated form of an absolute path.
func (w *Workspace) Rel(abs string) string {
	rel, err := filepath.Rel(w.root, abs)
	if err != nil {
		return filepath.Base(abs)
	}
	return filepath.ToSlash(rel)
}

// List returns the Markdown files in the workspace, nearest the top first and
// alphabetical within a directory.
func (w *Workspace) List() ([]File, error) {
	if w.single != "" {
		fi, err := os.Stat(filepath.Join(w.root, w.single))
		if err != nil {
			return nil, err
		}
		return []File{fileEntry(w.single, fi)}, nil
	}

	var files []File
	err := filepath.WalkDir(w.root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // an unreadable corner of the tree is not fatal
		}
		name := d.Name()
		if d.IsDir() {
			if p == w.root {
				return nil
			}
			if strings.HasPrefix(name, ".") || skipDirs[name] {
				return fs.SkipDir
			}
			return nil
		}
		if strings.HasPrefix(name, ".") || !markdownExts[strings.ToLower(filepath.Ext(name))] {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		files = append(files, fileEntry(w.Rel(p), info))
		if len(files) >= maxListedFiles {
			return fs.SkipAll
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.Slice(files, func(i, j int) bool {
		a, b := files[i], files[j]
		if depth(a.Path) != depth(b.Path) {
			return depth(a.Path) < depth(b.Path)
		}
		if a.Dir != b.Dir {
			return a.Dir < b.Dir
		}
		return a.Name < b.Name
	})
	return files, nil
}

func fileEntry(rel string, fi fs.FileInfo) File {
	return File{
		Path:     rel,
		Name:     path.Base(rel),
		Dir:      strings.TrimSuffix(path.Dir(rel), "."),
		Size:     fi.Size(),
		Modified: fi.ModTime().Unix(),
	}
}

func depth(p string) int { return strings.Count(p, "/") }

// realPath resolves the symlinks in p. When p need not exist yet, the deepest
// part of it that does is resolved and the rest kept as written — only the
// directories a path already has can lead it somewhere else.
func realPath(p string, mustExist bool) (string, error) {
	if mustExist {
		return filepath.EvalSymlinks(p)
	}
	rest := ""
	for {
		real, err := filepath.EvalSymlinks(p)
		if err == nil {
			return filepath.Join(real, rest), nil
		}
		if !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(p)
		if parent == p {
			return "", err
		}
		rest = filepath.Join(filepath.Base(p), rest)
		p = parent
	}
}

// hidden reports paths List would skip: a dot-name anywhere along one, or a
// directory that is never walked. Making a file the editor cannot then show you
// is worse than refusing the name.
func hidden(rel string) bool {
	for _, part := range strings.Split(rel, "/") {
		if strings.HasPrefix(part, ".") || skipDirs[part] {
			return true
		}
	}
	return false
}

// within reports whether p is root or sits underneath it.
func within(root, p string) bool {
	if p == root {
		return true
	}
	return strings.HasPrefix(p, root+string(filepath.Separator))
}

// modKey is a cheap change stamp for a file: size and modification time. The
// watcher compares it before reading, so an unchanged file costs one stat.
func modKey(fi fs.FileInfo) string {
	return fmt.Sprintf("%d-%d", fi.Size(), fi.ModTime().UnixNano())
}

// revOf is a content hash: two saves in the same clock tick, or a save that
// restores earlier content, still compare correctly.
func revOf(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:12])
}
