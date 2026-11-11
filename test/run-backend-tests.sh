#!/bin/sh

# Backend tests for config saving, backups and service state. They run on
# OpenWrt with kea-dhcp-ddns installed (its config needs no network
# interface). The backend is pointed at a temporary root through
# IPKG_INSTROOT, so the real /etc/kea is not touched.

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
BACKEND="${BACKEND:-$ROOT_DIR/root/usr/libexec/rpcd/luci.kea}"
DDNS_BIN=/usr/sbin/kea-dhcp-ddns

TESTS=0

fail() {
	printf 'not ok - %s\n' "$*" >&2
	exit 1
}

ok() {
	TESTS=$((TESTS + 1))
	printf 'ok %s - %s\n' "$TESTS" "$*"
}

[ -x /usr/bin/jshn ] || fail "missing /usr/bin/jshn; run this test on OpenWrt"
[ -x /usr/bin/jsonfilter ] || fail "missing /usr/bin/jsonfilter"
[ -x "$DDNS_BIN" ] || fail "missing $DDNS_BIN; install kea-dhcp-ddns"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

CONF_DIR="$TMP/etc/kea"
CONF="$CONF_DIR/kea-dhcp-ddns.conf"
BACKUPS="$CONF_DIR/backups"

mkdir -p "$CONF_DIR" "$TMP/etc/init.d" "$TMP/uci" "$TMP/run"

# call <method> [json arguments]
call() {
	local method="$1"
	local args="${2:-}"

	if [ -n "$args" ]; then
		printf '%s\n' "$args" |
			IPKG_INSTROOT="$TMP" UCI_CONFIG_DIR="$TMP/uci" KEA_RUN_DIR="$TMP/run" \
			"$BACKEND" call "$method"
	else
		IPKG_INSTROOT="$TMP" UCI_CONFIG_DIR="$TMP/uci" KEA_RUN_DIR="$TMP/run" \
			"$BACKEND" call "$method" < /dev/null
	fi
}

field() {
	jsonfilter -s "$1" -e "@.$2" 2>/dev/null || true
}

# ddns_config <port>: a minimal valid kea-dhcp-ddns configuration
ddns_config() {
	printf '{\n\t"DhcpDdns": {\n\t\t"ip-address": "127.0.0.1",\n\t\t"port": %s\n\t}\n}\n' "$1"
}

# save <content>: call saveConfig with the content as a JSON string.
# jshn.sh reads unset variables, so it runs in a subshell without "set -u".
save() {
	local content="$1"
	local args

	args="$(
		set +u
		. /usr/share/libubox/jshn.sh
		json_init
		json_add_string name dhcp_ddns
		json_add_string content "$content"
		json_dump
	)"

	call saveConfig "$args"
}

# perms <path>: the permission string printed by ls, such as "-rw-------".
# BusyBox on OpenWrt has no stat applet by default.
perms() {
	ls -ld "$1" | cut -c1-10
}

backup_count() {
	ls -1 "$BACKUPS" 2>/dev/null | grep -c '^kea-dhcp-ddns\.' || true
}

# ---- saving ---------------------------------------------------------------

ddns_config 53001 > "$CONF"

OUT="$(call getConfig '{"name":"dhcp_ddns"}')"
[ "$(field "$OUT" result)" = "true" ] || fail "getConfig failed: $OUT"
[ "$(field "$OUT" valid)" = "true" ] || fail "the initial config did not validate: $OUT"
ok "getConfig reads and validates the config"

printf '%s\n' "$(field "$OUT" content)" > "$TMP/read-back"
cmp -s "$TMP/read-back" "$CONF" || fail "getConfig changed the file content (trailing newline?)"
ok "getConfig returns the file content unchanged, including the final newline"

OUT="$(save "$(ddns_config 53002)")"
[ "$(field "$OUT" result)" = "true" ] || fail "saveConfig refused a valid config: $OUT"
grep -q '"port": 53002' "$CONF" || fail "saveConfig did not write the new content"
FIRST_ID="$(field "$OUT" backup)"
[ -n "$FIRST_ID" ] && [ -f "$BACKUPS/kea-dhcp-ddns.$FIRST_ID.conf" ] || fail "saveConfig made no backup"
grep -q '"port": 53001' "$BACKUPS/kea-dhcp-ddns.$FIRST_ID.conf" || fail "the backup does not hold the previous content"
ok "saveConfig writes a valid config and backs up the previous one"

[ "$(perms "$BACKUPS")" = "drwx------" ] || fail "backup directory is not mode 700"
[ "$(perms "$BACKUPS/kea-dhcp-ddns.$FIRST_ID.conf")" = "-rw-------" ] || fail "backup file is not mode 600"
ok "backups are readable by root only"

OUT="$(save '{ "DhcpDdns": { "ip-address": "not-an-address" } }')"
[ "$(field "$OUT" result)" = "false" ] || fail "saveConfig accepted a config Kea rejects"
[ -n "$(field "$OUT" validation)" ] || fail "saveConfig did not return the Kea output"
grep -q '"port": 53002' "$CONF" || fail "a rejected save changed the config"
[ "$(backup_count)" = "1" ] || fail "a rejected save created a backup"
[ -z "$(ls -1 "$CONF_DIR" | grep '\.luci\.' || true)" ] || fail "a rejected save left a temporary file"
ok "saveConfig rejects an invalid config and leaves everything as it was"

# ---- listing and restoring ------------------------------------------------

OUT="$(save "$(ddns_config 53003)")"
SECOND_ID="$(field "$OUT" backup)"

OUT="$(call listBackups '{"name":"dhcp_ddns"}')"
[ "$(field "$OUT" 'items[0].id')" = "$SECOND_ID" ] || fail "listBackups does not list the newest backup first: $OUT"
[ "$(field "$OUT" 'items[1].id')" = "$FIRST_ID" ] || fail "listBackups lost the older backup: $OUT"
ok "listBackups lists backups newest first"

OUT="$(call restoreBackup "{\"name\":\"dhcp_ddns\",\"id\":\"$FIRST_ID\"}")"
[ "$(field "$OUT" result)" = "true" ] || fail "restoreBackup failed: $OUT"
ddns_config 53001 > "$TMP/expected"
cmp -s "$TMP/expected" "$CONF" || fail "restoreBackup did not restore the backup content"
ok "restoreBackup puts the backup content back byte for byte"

UNDO_ID="$(field "$OUT" backup)"
grep -q '"port": 53003' "$BACKUPS/kea-dhcp-ddns.$UNDO_ID.conf" || fail "restoreBackup did not back up the replaced file"
ok "restoreBackup backs up the file it replaces"

for bad in '' '../../etc/passwd' 'x' '20261111T000000Z/..' '20991231T235959Z'; do
	OUT="$(call restoreBackup "{\"name\":\"dhcp_ddns\",\"id\":\"$bad\"}")"
	[ "$(field "$OUT" result)" = "false" ] || fail "restoreBackup accepted the id '$bad'"
done
cmp -s "$TMP/expected" "$CONF" || fail "a refused restore changed the config"
ok "restoreBackup refuses malformed and unknown backup ids"

OUT="$(call restoreBackup '{"name":"../x","id":"20261111T000000Z"}')"
[ "$(field "$OUT" result)" = "false" ] || fail "restoreBackup accepted an invalid config name"
OUT="$(call listBackups '{"name":"nope"}')"
[ "$(field "$OUT" result)" = "false" ] || fail "listBackups accepted an invalid config name"
ok "backup methods refuse unknown config names"

printf 'not json\n' > "$BACKUPS/kea-dhcp-ddns.20000101T000000Z.conf"
OUT="$(call restoreBackup '{"name":"dhcp_ddns","id":"20000101T000000Z"}')"
[ "$(field "$OUT" result)" = "false" ] || fail "restoreBackup restored a backup Kea rejects"
cmp -s "$TMP/expected" "$CONF" || fail "restoring an invalid backup changed the config"
rm -f "$BACKUPS/kea-dhcp-ddns.20000101T000000Z.conf"
ok "restoreBackup validates a backup before restoring it"

# ---- retention ------------------------------------------------------------

port=53100
while [ "$port" -lt 53114 ]; do
	OUT="$(save "$(ddns_config "$port")")"
	[ "$(field "$OUT" result)" = "true" ] || fail "saveConfig failed during the retention test: $OUT"
	port=$((port + 1))
done

[ "$(backup_count)" = "10" ] || fail "expected 10 backups after many saves, found $(backup_count)"
OUT="$(call listBackups '{"name":"dhcp_ddns"}')"
NEWEST="$(field "$OUT" 'items[0].id')"
grep -q '"port": 53112' "$BACKUPS/kea-dhcp-ddns.$NEWEST.conf" || fail "the newest backup is not the last replaced config"
ok "only the ten newest backups are kept, including several made in the same second"

# ---- service state --------------------------------------------------------

cat > "$TMP/uci/kea" <<'EOF'
config service 'dhcp4'

config service 'dhcp6'
	option disabled '1'

config service 'dhcp_ddns'
	option disabled '0'
EOF

# config_load is a no-op while IPKG_INSTROOT is set, so this call uses only
# the UCI directory override. getServices reads nothing but UCI and the
# process list.
OUT="$(UCI_CONFIG_DIR="$TMP/uci" "$BACKEND" call getServices < /dev/null)"
[ "$(field "$OUT" services.dhcp4.enabled)" = "true" ] || fail "a service without the disabled option is not shown as enabled: $OUT"
[ "$(field "$OUT" services.dhcp6.enabled)" = "false" ] || fail "disabled '1' is not shown as disabled"
[ "$(field "$OUT" services.dhcp_ddns.enabled)" = "true" ] || fail "disabled '0' is not shown as enabled"
ok "getServices reads the disabled option like /etc/init.d/kea"

# ---- runtime state --------------------------------------------------------

printf '#!/bin/sh\nexit 0\n' > "$TMP/etc/init.d/kea"
chmod 755 "$TMP/etc/init.d/kea"

OUT="$(call setInitAction '{"action":"start"}')"
[ "$(field "$OUT" result)" = "true" ] || fail "setInitAction start failed: $OUT"
SECRET="$(cat "$CONF_DIR/kea-api-password")"
printf '%s' "$SECRET" | grep -Eq '^[0-9a-f]{48}$' || fail "the API password is not 48 hex digits"
[ "$(perms "$CONF_DIR/kea-api-password")" = "-rw-------" ] || fail "the API password file is not mode 600"
ok "starting Kea creates a random API password readable by root only"

call setInitAction '{"action":"restart"}' > /dev/null
[ "$(cat "$CONF_DIR/kea-api-password")" = "$SECRET" ] || fail "an existing API password was replaced"
ok "an existing API password is kept"

printf 'all %s backend checks passed\n' "$TESTS"
