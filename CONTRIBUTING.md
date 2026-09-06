# Contributing to serif

Thanks for your interest in improving **serif**! Contributions of all sizes are
welcome — bug reports, docs fixes, and features alike.

## Getting started

```sh
git clone https://github.com/tristanMatthias/serif
cd serif
make build      # build ./serif
make test       # run tests
make lint       # go vet + gofmt check
make help       # list all targets
```

Requires Go 1.25 or newer. Working on the browser editor needs a little more —
see below.

Coding agents: read [CLAUDE.md](CLAUDE.md) first. It carries the architecture
and the invariants that are easy to break without noticing.

## Making changes

1. Fork and create a branch off `main`.
2. Keep changes focused; one logical change per pull request.
3. Run `make lint test` before pushing. Code must be `gofmt`-clean.
4. If you change rendering or styling, regenerate the example and eyeball it:
   ```sh
   make example && open examples/showcase.html
   ```
5. Update `CHANGELOG.md` under `## [Unreleased]`.

## The browser editor

`serif edit` is a Go server (`editor/`) around a small browser app
(`editor/assets/`), and it shares one renderer and one stylesheet with the
exporter — so a change in `render/` shows up in both.

```sh
make edit FILE=notes.md   # or a directory
make test-ui              # the editor's browser tests
```

Two things catch most people out:

- The browser assets are embedded in the binary. Editing `editor/assets/*` has
  no effect until you rebuild; `make edit` and `make test-ui` do that for you.
- Behaviour that lives in the browser — where the caret lands, what a key does,
  whether a document survives a round trip — is checked by driving a real
  Chromium, not from Go. Add a case as a row of data in `editor/uitest/`; see
  its [README](editor/uitest/README.md). CI runs these, and they need Node:

  ```sh
  npm install --no-save playwright-core && npx --yes playwright install chromium
  ```

## Commit messages

We loosely follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`. The release changelog is
generated from these prefixes.

## Design principles

serif is intentionally opinionated. Before adding a configuration flag, consider
whether a better *default* would serve everyone instead. The goal is a tool that
produces an excellent result with zero tuning — fewer knobs, better defaults.

## Reporting bugs

Open an issue with the smallest Markdown snippet that reproduces the problem and,
if relevant, a screenshot of the rendered output. Include your OS and
`serif --version`.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
