BINARY  := serif
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: help build install test race vet fmt fmt-check lint example wasm serve clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

build: ## Build the ./serif binary
	go build -ldflags "$(LDFLAGS)" -o $(BINARY) .

wasm: ## Build the browser bundle into ./web (serif.wasm + wasm_exec.js)
	GOOS=js GOARCH=wasm go build -ldflags "$(LDFLAGS)" -o web/serif.wasm ./wasm
	cp "$$(go env GOROOT)/lib/wasm/wasm_exec.js" web/wasm_exec.js

serve: wasm ## Build the bundle and serve ./web at http://localhost:8080
	@echo "serving ./web on http://localhost:8080 (Ctrl-C to stop)"
	go run ./cmd/serve

install: ## Install to $(GOPATH)/bin
	go install -ldflags "$(LDFLAGS)" .

test: ## Run tests
	go test ./...

race: ## Run tests with the race detector
	go test -race ./...

vet: ## Run go vet
	go vet ./...

fmt: ## Format all Go files
	gofmt -w .

fmt-check: ## Fail if any Go file is not gofmt-clean
	@out="$$(gofmt -l .)"; if [ -n "$$out" ]; then echo "not gofmt-clean:"; echo "$$out"; exit 1; fi

lint: vet fmt-check ## Run all static checks

example: build ## Regenerate examples/showcase.html
	./$(BINARY) examples/showcase.md

clean: ## Remove build artifacts
	rm -f $(BINARY) examples/*.html
	rm -rf dist
