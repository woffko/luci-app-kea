#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
BACKEND="${BACKEND:-$ROOT_DIR/root/usr/libexec/rpcd/luci.kea}"
FIXTURE="${FIXTURE:-$ROOT_DIR/test/fixtures/dhcp-static-leases.uci}"

fail() {
	printf 'not ok - %s\n' "$*" >&2
	exit 1
}

need_openwrt_tooling() {
	[ -x /sbin/uci ] || fail "missing /sbin/uci; run this test on OpenWrt or an OpenWrt rootfs"
	[ -x /usr/bin/jshn ] || fail "missing /usr/bin/jshn"
	[ -r /usr/share/libubox/jshn.sh ] || fail "missing jshn.sh"
	[ -r /lib/functions.sh ] || fail "missing /lib/functions.sh"
}

assert_contains() {
	local haystack="$1"
	local needle="$2"
	local label="$3"

	printf '%s' "$haystack" | grep -Fq -- "$needle" || fail "$label"
	printf 'ok - %s\n' "$label"
}

need_openwrt_tooling

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR"
cp "$FIXTURE" "$TMP_DIR/dhcp"

OUTPUT="$(UCI_CONFIG_DIR="$TMP_DIR" "$BACKEND" call importDnsmasqDryRun)"

assert_contains "$OUTPUT" '"source":"valid_ipv4"' "valid IPv4 host is present"
assert_contains "$OUTPUT" '"family":"dhcp4","status":"ready"' "valid IPv4 host is ready"
assert_contains "$OUTPUT" '"source":"missing_mac"' "missing MAC host is present"
assert_contains "$OUTPUT" 'missing MAC address' "missing MAC host is disabled with warning"
assert_contains "$OUTPUT" '"source":"dhcpv6_duid"' "DHCPv6 DUID host is present"
assert_contains "$OUTPUT" '00:04:e6:f8:c8:8f:a8:5f:d8:18:25:59:60:2d:e4:b5:fc:2e' "full DHCPv6 DUID is preserved"
assert_contains "$OUTPUT" '"source":"dhcpv6_truncated_duid"' "truncated DHCPv6 DUID host is present"
assert_contains "$OUTPUT" 'missing, invalid, or truncated DHCPv6 DUID/client-id' "truncated DHCPv6 DUID is disabled"
assert_contains "$OUTPUT" '"source":"tagged_dnsmasq_only"' "dnsmasq-only tagged host is present"
assert_contains "$OUTPUT" 'dnsmasq tag import is not implemented yet' "dnsmasq tag requires manual review"
assert_contains "$OUTPUT" 'dns hostfile side effect is not represented in Kea reservation' "dnsmasq dns flag requires manual review"
