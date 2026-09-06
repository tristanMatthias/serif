// Command serif converts a Markdown document into a self-contained HTML page
// with high-quality, readability-first typography and automatic light/dark mode.
//
// Usage:
//
//	serif thing.md            # writes thing.html
//	serif thing.md -o out.html
//	serif --title "My Doc" thing.md
//	serif edit thing.md       # edit it in the browser, saving as you type
//	serif edit ./notes        # …or a whole directory of them
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/tristanMatthias/serif/editor"
	"github.com/tristanMatthias/serif/render"
)

// version is set at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "serif: "+err.Error())
		os.Exit(1)
	}
}

func run() error {
	// `edit` is a subcommand with its own flags; everything else is the
	// original single-file conversion.
	if len(os.Args) > 1 && os.Args[1] == "edit" {
		return runEdit(os.Args[2:])
	}

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

	out, err := render.Page(src, render.Options{
		Title:  titleFlag,
		Lang:   langFlag,
		Source: filepath.Base(inPath),
	})
	if err != nil {
		return err
	}

	if err := os.WriteFile(outPath, []byte(out), 0o644); err != nil {
		return err
	}

	fmt.Printf("serif: wrote %s\n", outPath)
	return nil
}

// runEdit serves the browser editor for a Markdown file or a directory of them,
// saving to disk as you type.
func runEdit(args []string) error {
	fs := flag.NewFlagSet("serif edit", flag.ExitOnError)
	addr := fs.String("addr", editor.DefaultAddr,
		"address to listen on; a bare port or host is filled in (use 0.0.0.0 to allow Tailscale/LAN)")
	open := fs.Bool("open", false, "open the editor in your browser")
	fs.Usage = editUsage
	fs.Parse(reorderArgs(args))

	if fs.NArg() != 1 {
		editUsage()
		return fmt.Errorf("expected exactly one Markdown file or directory to edit")
	}

	srv, err := editor.New(fs.Arg(0))
	if err != nil {
		return err
	}
	return editor.Serve(srv, *addr, *open, os.Stdout)
}

// reorderArgs moves flags ahead of positional arguments so that Go's flag
// package (which stops at the first non-flag token) accepts flags placed after
// the file, e.g. `serif thing.md -o out.html`.
func reorderArgs(args []string) []string {
	valueFlags := map[string]bool{
		"-o": true, "-title": true, "--title": true, "-lang": true, "--lang": true,
		"-addr": true, "--addr": true,
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
	case ".md", ".mdx", ".markdown", ".mdown", ".mkd", ".mkdn", ".text", ".txt":
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
  serif edit [options] <file.md|dir>

Options:
  -o <file>       output path (default: input name with .html)
  --title <text>  page title (default: first heading or file name)
  --lang <code>   html lang attribute (default: en)
  --version       print version and exit

Examples:
  serif notes.md                 # writes notes.html
  serif README.md -o docs/index.html
  serif edit notes.md            # edit in the browser, saving as you type
  serif edit ./notes             # browse and edit a directory

Run "serif edit --help" for the editor's options.

Home: https://github.com/tristanMatthias/serif
`)
}

func editUsage() {
	fmt.Fprint(os.Stderr, `serif edit — edit Markdown in the browser, saving as you type

Usage:
  serif edit [options] <file.md|dir>

Given a file, that file is edited. Given a directory, its Markdown files are
browsable from the title bar (or press Ctrl-P / Cmd-P), and files can be made
and renamed from inside the editor.

Options:
  --addr <addr>   address to listen on (default: `+editor.DefaultAddr+`)
                  accepts "8080", "0.0.0.0", or "0.0.0.0:8080"
  --open          open the editor in your browser

Examples:
  serif edit notes.md
  serif edit ~/notes                    # browse a whole directory
  serif edit notes.md --addr 0.0.0.0    # reachable over Tailscale or a LAN
  serif edit new.md                     # creates the file if it does not exist
  serif edit ~/new-notebook             # an empty folder, ready for its first file

Home: https://github.com/tristanMatthias/serif
`)
}
