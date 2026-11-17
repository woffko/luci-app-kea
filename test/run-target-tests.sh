#!/bin/sh

# Run every test that needs a real OpenWrt system with Kea and the
# luci-app-kea package installed: the backend tests against the installed
# library, then the browser tests.
#
#   test/run-target-tests.sh
#
# Environment:
#   TARGET_SSH   command that runs its arguments as root on the target, for
#                example "ssh root@192.168.1.1". Default: the machine of
#                test/qemu-target.sh.
#   BASE_URL     where LuCI of the target answers. Default:
#                http://127.0.0.1:8080, the machine of test/qemu-target.sh.
#   LUCI_USER, LUCI_PASSWORD, OUT_DIR
#                as in test/browser/lib.js.
#
# For the time of the run the script appends the static leases of
# test/fixtures/dhcp-static-leases.uci to /etc/config/dhcp of the target and
# writes lease files to /var/lib/kea. It takes both away again when it ends,
# also after a failure. dnsmasq is not reloaded, so the static leases never
# take effect. The browser tests rewrite the Kea configuration files and put
# the originals back. Use it on a test machine only.

set -eu

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
WORK=/tmp/luci-app-kea-test
BROWSER_TESTS="smoke editor ha leases import"

export BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"

target() {
	if [ -n "${TARGET_SSH:-}" ]; then
		# shellcheck disable=SC2086  # a command with its arguments
		$TARGET_SSH "$@"
	else
		"$ROOT_DIR/test/qemu-target.sh" ssh "$@"
	fi
}

FIXTURES=0

cleanup() {
	status=$?
	trap - EXIT

	if [ "$FIXTURES" = 1 ]; then
		echo "== Removing the fixtures from the target"
		target "
			[ -f $WORK/dhcp.before ] && cp $WORK/dhcp.before /etc/config/dhcp
			[ -f /var/lib/kea/kea-leases.test-fixture ] && sh $WORK/test/make-lease-fixture.sh --remove
			rm -rf $WORK
		" || {
			echo "WARNING: the target was not cleaned up." >&2
			echo "Its /etc/config/dhcp as it was is in $WORK/dhcp.before on the target." >&2
			status=1
		}
	fi

	exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT TERM

# A run that could not clean up left the original /etc/config/dhcp there.
# Do not delete the only copy.
if target "[ -f $WORK/dhcp.before ]"; then
	echo "An earlier run did not clean up the target." >&2
	echo "Put $WORK/dhcp.before back as /etc/config/dhcp there and remove $WORK." >&2
	exit 1
fi

echo "== Backend tests on the target"
tar -C "$ROOT_DIR" -cf - test/ucode test/fixtures test/run-ucode-tests.sh test/make-lease-fixture.sh |
	target "rm -rf $WORK && mkdir -p $WORK && tar -C $WORK -xf -"
target "cd $WORK && sh test/run-ucode-tests.sh --target --installed"

echo "== Fixtures for the browser tests"
FIXTURES=1
target "
	set -e
	cp /etc/config/dhcp $WORK/dhcp.before
	{ echo; cat $WORK/test/fixtures/dhcp-static-leases.uci; } >> /etc/config/dhcp
	sh $WORK/test/make-lease-fixture.sh
"

if [ -n "${OUT_DIR:-}" ]; then
	mkdir -p "$OUT_DIR"
fi

for name in $BROWSER_TESTS; do
	echo "== Browser test: $name"
	node "$ROOT_DIR/test/browser/$name.js"
done

echo "all target tests passed"
