# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-07-16

### Added

- Convert a Markdown file to a single, self-contained HTML page:
  `serif file.md` writes `file.html`.
- Readability-first typography: serif reading face, sans-serif headings, a
  ~68-character measure, generous line-height, ligatures, kerning, and
  old-style figures.
- Automatic light and dark themes at WCAG-AAA body contrast, following the OS
  preference, with a persistent in-page toggle (or press <kbd>T</kbd>).
- Smart punctuation (curly quotes, em-dashes, ellipses) via the goldmark
  typographer.
- GitHub-flavored Markdown, footnotes, definition lists, and clickable heading
  anchors.
- Per-theme syntax highlighting for fenced code blocks via chroma, with a
  no-JavaScript `prefers-color-scheme` fallback.
- `-o`, `--title`, `--lang`, and `--version` flags; flags may appear before or
  after the file argument.
- Print stylesheet.

[Unreleased]: https://github.com/tristanMatthias/serif/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tristanMatthias/serif/releases/tag/v0.1.0
