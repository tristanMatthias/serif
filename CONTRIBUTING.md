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

Requires Go 1.25 or newer.

## Making changes

1. Fork and create a branch off `main`.
2. Keep changes focused; one logical change per pull request.
3. Run `make lint test` before pushing. Code must be `gofmt`-clean.
4. If you change rendering or styling, regenerate the example and eyeball it:
   ```sh
   make example && open examples/showcase.html
   ```
5. Update `CHANGELOG.md` under `## [Unreleased]`.

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
