// Command serve is a tiny static file server for local development of the
// serif web bundle. It serves ./web with the correct Content-Type for .wasm
// files (required by WebAssembly.instantiateStreaming) and disables caching so
// rebuilds show up on reload.
//
//	make serve          # or: go run ./cmd/serve
package main

import (
	"flag"
	"log"
	"mime"
	"net/http"
)

func main() {
	addr := flag.String("addr", ":8080", "address to listen on")
	dir := flag.String("dir", "web", "directory to serve")
	flag.Parse()

	// Some systems lack the .wasm mapping; set it explicitly.
	_ = mime.AddExtensionType(".wasm", "application/wasm")

	fs := http.FileServer(http.Dir(*dir))
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		fs.ServeHTTP(w, r)
	})

	log.Printf("serving %s on http://localhost%s", *dir, *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}
