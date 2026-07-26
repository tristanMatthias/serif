// Command serif-wasm exposes the serif Markdown renderer to the browser.
//
// Built for the js/wasm target, it registers a global `serifRender` function
// that takes Markdown text (and an optional options object) and returns a
// complete, self-contained HTML document — the same output the CLI writes.
//
// Build:
//
//	GOOS=js GOARCH=wasm go build -o web/serif.wasm ./wasm
//
// From JavaScript (after loading wasm_exec.js and instantiating serif.wasm):
//
//	const result = serifRender(markdownString, { source: "notes.md" });
//	if (result.error) { ... } else { iframe.srcdoc = result.html; }

//go:build js && wasm

package main

import (
	"syscall/js"

	"github.com/tristanMatthias/serif/render"
)

func main() {
	js.Global().Set("serifRender", js.FuncOf(serifRender))
	// Block forever so the exported function stays callable.
	select {}
}

// serifRender is the JS-facing entry point.
//
//	serifRender(markdown, options?) -> { html: string } | { error: string }
//
// options may contain: title, lang, source (all strings, all optional).
func serifRender(this js.Value, args []js.Value) any {
	if len(args) == 0 || args[0].Type() != js.TypeString {
		return errResult("serifRender: expected Markdown text as the first argument")
	}

	src := []byte(args[0].String())
	opts := render.Options{}
	if len(args) > 1 && args[1].Type() == js.TypeObject {
		opts.Title = optString(args[1], "title")
		opts.Lang = optString(args[1], "lang")
		opts.Source = optString(args[1], "source")
	}

	out, err := render.Page(src, opts)
	if err != nil {
		return errResult(err.Error())
	}
	return map[string]any{"html": out}
}

// optString reads a string property from a JS object, returning "" if it is
// missing or not a string.
func optString(obj js.Value, key string) string {
	v := obj.Get(key)
	if v.Type() != js.TypeString {
		return ""
	}
	return v.String()
}

func errResult(msg string) map[string]any {
	return map[string]any{"error": msg}
}
