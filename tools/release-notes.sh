#!/bin/sh

# Write the text of a GitHub release to standard output.
#
#   tools/release-notes.sh TAG [PACKAGE]   the text for the release TAG
#   tools/release-notes.sh --tag           the tag of the version in the
#                                          Makefile
#
# TAG must belong to the version in luci-app-kea/Makefile: v0.8.0 for
# 0.8.0-r1, v0.8.0-r2 for 0.8.0-r2. The changes are the section of that
# version in CHANGELOG.md. With PACKAGE, the file must have the name of that
# version, and its checksum is added to the text.
#
# The release workflow calls this script. Run it by hand to see the text
# before tagging.

set -eu

if [ $# -lt 1 ] || [ $# -gt 2 ]; then
	echo "Usage: $0 TAG [PACKAGE]" >&2
	echo "       $0 --tag" >&2
	exit 2
fi

TAG="$1"
PACKAGE="${2:-}"

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
MAKEFILE="$ROOT_DIR/luci-app-kea/Makefile"
CHANGELOG="$ROOT_DIR/CHANGELOG.md"
REPOSITORY="https://github.com/woffko/luci-app-kea"

VERSION="$(sed -n 's/^PKG_VERSION:=//p' "$MAKEFILE")"
RELEASE="$(sed -n 's/^PKG_RELEASE:=//p' "$MAKEFILE")"

if [ -z "$VERSION" ] || [ -z "$RELEASE" ]; then
	echo "cannot read PKG_VERSION and PKG_RELEASE from $MAKEFILE" >&2
	exit 1
fi

FULL="$VERSION-r$RELEASE"

# The release number is part of the tag only when it is above 1.
if [ "$RELEASE" = 1 ]; then
	EXPECTED="v$VERSION"
else
	EXPECTED="v$FULL"
fi

if [ "$TAG" = "--tag" ]; then
	echo "$EXPECTED"
	exit 0
fi

if [ "$TAG" != "$EXPECTED" ]; then
	echo "The tag $TAG does not fit the Makefile: version $FULL is tagged $EXPECTED." >&2
	exit 1
fi

# The section of the version: from its heading to the next heading of the
# same level, without the empty lines at its start.
CHANGES="$(awk -v heading="## $FULL " '
	index($0, heading) == 1 { found = 1; next }
	found && /^## / { exit }
	found && !started && /^[[:space:]]*$/ { next }
	found { started = 1; print }
' "$CHANGELOG")"

if [ -z "$CHANGES" ]; then
	echo "CHANGELOG.md has no section for $FULL." >&2
	exit 1
fi

SUM=""

if [ -n "$PACKAGE" ]; then
	NAME="luci-app-kea-$FULL.apk"

	if [ ! -f "$PACKAGE" ] || [ "$(basename -- "$PACKAGE")" != "$NAME" ]; then
		echo "The package of this version is $NAME, not $PACKAGE." >&2
		exit 1
	fi

	SUM="$(sha256sum "$PACKAGE" | cut -d' ' -f1)"
fi

echo "luci-app-kea is a LuCI application for the ISC Kea DHCP server on OpenWrt."
echo

case "$VERSION" in
	0.*)
		echo "**Alpha.** Usable for testing on a lab router. Not ready to replace a production dnsmasq/odhcpd setup yet; see [Known limitations]($REPOSITORY/blob/$TAG/README.md#known-limitations)."
		echo
		;;
esac

echo "## Changes in $FULL"
echo
echo "$CHANGES"
echo
echo "Earlier versions are in [CHANGELOG.md]($REPOSITORY/blob/$TAG/CHANGELOG.md)."
echo
echo "## Installation"
echo
echo "For OpenWrt 25.12 (\`apk\`). The package contains no compiled code, so the same file fits every router architecture. Download \`luci-app-kea-$FULL.apk\` below and install it as described in [Installation]($REPOSITORY/blob/$TAG/README.md#installation)."

if [ -n "$SUM" ]; then
	echo
	echo "SHA-256 of the package:"
	echo
	echo '```'
	echo "$SUM  luci-app-kea-$FULL.apk"
	echo '```'
fi
