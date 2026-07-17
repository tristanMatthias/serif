#!/bin/sh
# serif installer — downloads a prebuilt binary from the latest GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/tristanMatthias/serif/main/install.sh | sh
#
# Environment overrides:
#   VERSION=v0.1.0   install a specific version (default: latest)
#   PREFIX=$HOME/.local   install under $PREFIX/bin (default: /usr/local)
set -eu

REPO="tristanMatthias/serif"
BIN="serif"
PREFIX="${PREFIX:-/usr/local}"
BINDIR="$PREFIX/bin"

err() { printf 'serif install: %s\n' "$*" >&2; exit 1; }
say() { printf '\033[36m==>\033[0m %s\n' "$*"; }

command -v uname >/dev/null 2>&1 || err "uname not found"
command -v tar   >/dev/null 2>&1 || err "tar not found"

if command -v curl >/dev/null 2>&1; then
	fetch()  { curl -fsSL "$1"; }
	fetchto() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
	fetch()  { wget -qO- "$1"; }
	fetchto() { wget -qO "$2" "$1"; }
else
	err "need either curl or wget"
fi

# Map uname to goreleaser's naming (lowercase OS, amd64/arm64).
os="$(uname -s)"
case "$os" in
	Linux)  os="linux" ;;
	Darwin) os="darwin" ;;
	*) err "unsupported OS: $os (use 'go install' instead)" ;;
esac

arch="$(uname -m)"
case "$arch" in
	x86_64|amd64) arch="amd64" ;;
	arm64|aarch64) arch="arm64" ;;
	*) err "unsupported architecture: $arch" ;;
esac

version="${VERSION:-}"
if [ -z "$version" ]; then
	say "resolving latest release"
	version="$(fetch "https://api.github.com/repos/$REPO/releases/latest" \
		| grep '"tag_name"' | head -n1 \
		| sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
	[ -n "$version" ] || err "could not resolve latest version; set VERSION=vX.Y.Z"
fi

nov="${version#v}"
asset="${BIN}_${nov}_${os}_${arch}.tar.gz"
url="https://github.com/$REPO/releases/download/$version/$asset"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

say "downloading $asset ($version)"
fetchto "$url" "$tmp/pkg.tar.gz" || err "download failed: $url"
tar -xzf "$tmp/pkg.tar.gz" -C "$tmp"
[ -f "$tmp/$BIN" ] || err "archive did not contain '$BIN'"

say "installing to $BINDIR"
if [ -w "$BINDIR" ] || { [ ! -e "$BINDIR" ] && [ -w "$PREFIX" ]; }; then
	mkdir -p "$BINDIR"
	install -m 0755 "$tmp/$BIN" "$BINDIR/$BIN"
elif command -v sudo >/dev/null 2>&1; then
	sudo mkdir -p "$BINDIR"
	sudo install -m 0755 "$tmp/$BIN" "$BINDIR/$BIN"
else
	err "cannot write to $BINDIR and sudo is unavailable; set PREFIX to a writable prefix"
fi

say "installed $("$BINDIR/$BIN" --version)"
case ":$PATH:" in
	*":$BINDIR:"*) ;;
	*) printf '\nNote: %s is not on your PATH. Add it:\n  export PATH="%s:$PATH"\n' "$BINDIR" "$BINDIR" ;;
esac
