#!/bin/sh

# Run the ucode tests of the backend library.
#
#   test/run-ucode-tests.sh              tests that need only ucode with "fs"
#   test/run-ucode-tests.sh --target     also the tests in test/ucode/target,
#                                        which need OpenWrt with Kea installed
#   test/run-ucode-tests.sh --installed  test the library installed in
#                                        /usr/share/ucode instead of ./ucode
#
# Set UCODE to the interpreter to use (default: ucode from PATH).

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
UCODE="${UCODE:-ucode}"
TARGET=0
INSTALLED=0

for arg in "$@"; do
	case "$arg" in
		--target) TARGET=1 ;;
		--installed) INSTALLED=1 ;;
		*) echo "Usage: $0 [--target] [--installed]" >&2; exit 2 ;;
	esac
done

command -v "$UCODE" >/dev/null 2>&1 || {
	echo "ucode interpreter not found: $UCODE" >&2
	exit 2
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The library is installed as the "luci.kea" modules. Give the repository
# copy the same name on a search path of its own.
if [ "$INSTALLED" = 0 ]; then
	ln -s "$ROOT_DIR/ucode" "$TMP/luci"
fi

run() {
	echo "# $1"

	if [ "$INSTALLED" = 0 ]; then
		"$UCODE" -L "$TMP/*.uc" "$ROOT_DIR/$1"
	else
		"$UCODE" "$ROOT_DIR/$1"
	fi
}

FILES="test/ucode/net.uc test/ucode/jsonc.uc test/ucode/config.uc test/ucode/importer.uc"

if [ "$TARGET" = 1 ]; then
	FILES="$FILES test/ucode/target/config.uc test/ucode/target/service.uc test/ucode/target/import.uc"
fi

FAILED=0

for file in $FILES; do
	run "$file" || FAILED=1
done

if [ "$FAILED" = 1 ]; then
	echo "ucode tests FAILED"
	exit 1
fi

echo "all ucode tests passed"
