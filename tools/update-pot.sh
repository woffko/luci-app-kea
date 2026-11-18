#!/bin/sh
# Regenerate luci-app-kea/po/templates/kea.pot with the LuCI string scanner.
#
# Usage: tools/update-pot.sh /path/to/luci-checkout
#
# The LuCI checkout provides build/i18n-scan.pl. An installed "luci" feed
# inside an OpenWrt build tree or SDK (feeds/luci) works as well.

set -eu

LUCI_DIR="${1:-${LUCI_DIR:-}}"

if [ -z "$LUCI_DIR" ] || [ ! -f "$LUCI_DIR/build/i18n-scan.pl" ]; then
	echo "Usage: $0 /path/to/luci-checkout" >&2
	exit 1
fi

LUCI_DIR="$(CDPATH='' cd -- "$LUCI_DIR" && pwd)"
PACKAGE_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")/../luci-app-kea" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The scanner records source paths relative to its working directory. Mirror
# the in-tree location so the template matches what openwrt/luci generates.
APP="$WORK/applications/luci-app-kea"
mkdir -p "$APP"
cp -R "$PACKAGE_DIR/htdocs" "$PACKAGE_DIR/root" "$PACKAGE_DIR/ucode" "$APP/"

mkdir -p "$PACKAGE_DIR/po/templates"
( cd "$WORK" && perl "$LUCI_DIR/build/i18n-scan.pl" applications/luci-app-kea ) \
	> "$PACKAGE_DIR/po/templates/kea.pot"

echo "Updated luci-app-kea/po/templates/kea.pot"
