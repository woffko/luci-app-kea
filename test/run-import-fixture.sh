#!/bin/sh

# Import dry-run regression test. Runs on OpenWrt (or an OpenWrt root
# filesystem): it needs uci, jshn, jsonfilter and /lib/functions.sh.

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
	[ -x /usr/bin/jsonfilter ] || fail "missing /usr/bin/jsonfilter"
	[ -r /usr/share/libubox/jshn.sh ] || fail "missing jshn.sh"
	[ -r /lib/functions.sh ] || fail "missing /lib/functions.sh"
}

# entry_field <source> <field>: print one field of the entry imported from
# the UCI host section <source>. Arrays are printed one element per line.
entry_field() {
	jsonfilter -s "$OUTPUT" -e "@.import.entries[@.source=\"$1\"].$2" 2>/dev/null || true
}

assert_field() {
	local source="$1"
	local field="$2"
	local expected="$3"
	local label="$4"
	local actual

	actual="$(entry_field "$source" "$field")"
	[ "$actual" = "$expected" ] || fail "$label (expected '$expected', got '$actual')"
	printf 'ok - %s\n' "$label"
}

assert_warning() {
	local source="$1"
	local needle="$2"
	local label="$3"

	entry_field "$source" 'warnings[*]' | grep -Fq -- "$needle" || fail "$label"
	printf 'ok - %s\n' "$label"
}

assert_no_warnings() {
	local source="$1"
	local label="$2"

	[ -z "$(entry_field "$source" 'warnings[*]')" ] || fail "$label"
	printf 'ok - %s\n' "$label"
}

need_openwrt_tooling

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cp "$FIXTURE" "$TMP_DIR/dhcp"

OUTPUT="$(UCI_CONFIG_DIR="$TMP_DIR" "$BACKEND" call importDnsmasqDryRun)"

assert_field valid_ipv4 family dhcp4 "valid IPv4 host is a DHCPv4 entry"
assert_field valid_ipv4 status ready "valid IPv4 host is ready"
assert_field valid_ipv4 mac 12:00:78:59:29:8c "valid IPv4 host keeps its MAC address"
assert_field valid_ipv4 ip 10.0.77.118 "valid IPv4 host keeps its address"
assert_no_warnings valid_ipv4 "valid IPv4 host has no warnings"

assert_field missing_mac status disabled "missing MAC host is disabled"
assert_warning missing_mac 'missing MAC address' "missing MAC host has a warning"

assert_field dhcpv6_duid family dhcp6 "DUID host is a DHCPv6 entry"
assert_field dhcpv6_duid status ready "DUID host is ready"
assert_field dhcpv6_duid duid 00:04:e6:f8:c8:8f:a8:5f:d8:18:25:59:60:2d:e4:b5:fc:2e "full DHCPv6 DUID is preserved"

assert_field dhcpv6_truncated_duid status disabled "truncated DUID host is disabled"
assert_warning dhcpv6_truncated_duid 'missing, invalid, or truncated DHCPv6 DUID/client-id' "truncated DUID host has a warning"

assert_field tagged_dnsmasq_only status disabled "dnsmasq-only tagged host is disabled"
assert_warning tagged_dnsmasq_only 'dnsmasq tag import is not implemented yet' "dnsmasq tag requires manual review"
assert_warning tagged_dnsmasq_only 'dns hostfile side effect is not represented in Kea reservation' "dnsmasq dns flag requires manual review"

printf 'all import fixture checks passed\n'
