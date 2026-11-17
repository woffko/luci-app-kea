#!/bin/sh

# A disposable OpenWrt machine under QEMU, for the tests that need a real
# system: test/run-target-tests.sh.
#
#   test/qemu-target.sh start [VERSION]  boot the official x86-64 image of
#                                        that OpenWrt release (default 25.12.6)
#   test/qemu-target.sh setup PACKAGE    connect it to the internet, install
#                                        Kea from the OpenWrt repository and
#                                        the luci-app-kea package file
#   test/qemu-target.sh ssh [COMMAND]    run a command on it as root
#   test/qemu-target.sh stop             switch it off and delete its disk
#
# The machine is reachable from this host only:
#   SSH   127.0.0.1, port $KEA_VM_SSH_PORT (default 2222), root, no password
#   LuCI  http://127.0.0.1:$KEA_VM_HTTP_PORT (default 8080)
#
# Its files are kept in $KEA_VM_DIR (default: luci-app-kea-vm in $TMPDIR or
# /tmp). The downloaded image stays there after "stop" and is used again.
#
# Needs qemu-system-x86_64, qemu-img, curl, sha256sum and ssh. KVM is used
# when /dev/kvm is writable; without it the machine is several times slower.

set -eu

VM_DIR="${KEA_VM_DIR:-${TMPDIR:-/tmp}/luci-app-kea-vm}"
SSH_PORT="${KEA_VM_SSH_PORT:-2222}"
HTTP_PORT="${KEA_VM_HTTP_PORT:-8080}"
DOWNLOADS="https://downloads.openwrt.org/releases"

# The Kea packages the tests use. kea-dhcp-ddns is the daemon the backend
# tests start; the two hooks are needed for the high availability tab.
KEA_PACKAGES="kea-dhcp4 kea-dhcp6 kea-dhcp-ddns kea-ctrl kea-uci kea-lfc kea-hook-ha kea-hook-lease-cmds"

usage() {
	sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//' >&2
	exit 2
}

vm_ssh() {
	# The host key is new with every machine; it is not worth remembering.
	ssh -p "$SSH_PORT" -o BatchMode=yes -o ConnectTimeout=10 \
		-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
		-o LogLevel=ERROR root@127.0.0.1 "$@"
}

running() {
	[ -f "$VM_DIR/qemu.pid" ] && kill -0 "$(cat "$VM_DIR/qemu.pid")" 2>/dev/null
}

# Run a command until it succeeds: retry COUNT DELAY COMMAND...
retry() {
	count="$1"
	delay="$2"
	shift 2

	while ! "$@"; do
		count=$((count - 1))

		if [ "$count" -le 0 ]; then
			return 1
		fi

		sleep "$delay"
	done
}

# Download the image of an OpenWrt release and check it against the
# checksum list of that release. Prints nothing; the result is
# $VM_DIR/openwrt-VERSION.img.
fetch_image() {
	version="$1"
	base="$DOWNLOADS/$version/targets/x86/64"
	name="openwrt-$version-x86-64-generic-ext4-combined.img.gz"
	image="$VM_DIR/openwrt-$version.img"

	if [ -f "$image" ]; then
		return 0
	fi

	echo "Downloading $name"
	curl -fsSL --retry 3 -o "$VM_DIR/sha256sums" "$base/sha256sums"
	curl -fsSL --retry 3 -o "$VM_DIR/$name" "$base/$name"
	( cd "$VM_DIR" && grep -F "*$name" sha256sums | sha256sum -c - )

	# The file has padding after the compressed data. gzip unpacks it,
	# warns, and returns 2.
	status=0
	gzip -dc "$VM_DIR/$name" > "$image.part" || status=$?

	if [ "$status" != 0 ] && [ "$status" != 2 ]; then
		echo "cannot unpack $name" >&2
		exit 1
	fi

	mv "$image.part" "$image"
	rm -f "$VM_DIR/$name"
}

start() {
	version="${1:-25.12.6}"

	if running; then
		echo "the machine is already running (pid $(cat "$VM_DIR/qemu.pid"))"
		return 0
	fi

	mkdir -p "$VM_DIR"
	fetch_image "$version"

	# The image itself stays untouched; the machine writes to a disk
	# layered over it.
	rm -f "$VM_DIR/disk.qcow2"
	qemu-img create -q -f qcow2 -F raw -b "$VM_DIR/openwrt-$version.img" "$VM_DIR/disk.qcow2"

	if [ -w /dev/kvm ]; then
		accel="kvm"
	else
		accel="tcg,thread=multi"
	fi

	echo "Starting OpenWrt $version (accelerator: ${accel%%,*})"
	: > "$VM_DIR/serial.log"

	# The first network card is the LAN of the image (192.168.1.1). It is
	# cut off from the outside and only forwards two ports from this host.
	# The second card becomes the WAN in "setup".
	qemu-system-x86_64 \
		-accel "$accel" -smp 2 -m 512 \
		-drive "file=$VM_DIR/disk.qcow2,format=qcow2,if=ide" \
		-netdev "user,id=lan,net=192.168.1.0/24,host=192.168.1.2,dhcpstart=192.168.1.200,restrict=on,hostfwd=tcp:127.0.0.1:$SSH_PORT-192.168.1.1:22,hostfwd=tcp:127.0.0.1:$HTTP_PORT-192.168.1.1:80" \
		-device e1000,netdev=lan \
		-netdev user,id=wan \
		-device e1000,netdev=wan \
		-display none -serial "file:$VM_DIR/serial.log" \
		-daemonize -pidfile "$VM_DIR/qemu.pid"

	# Refused and timed out connections are expected while it boots.
	if ! retry 90 2 vm_ssh true 2>/dev/null; then
		echo "the machine did not answer on SSH; the end of its console:" >&2
		tail -n 40 "$VM_DIR/serial.log" >&2
		exit 1
	fi

	echo "The machine is up: ssh port $SSH_PORT, LuCI http://127.0.0.1:$HTTP_PORT"
}

setup() {
	package="${1:-}"

	if [ -z "$package" ] || [ ! -f "$package" ]; then
		echo "setup needs the luci-app-kea package file" >&2
		exit 2
	fi

	# The image has no WAN. Its second network card gets one.
	vm_ssh '
		uci set network.wan=interface
		uci set network.wan.device=eth1
		uci set network.wan.proto=dhcp
		uci commit network
		/etc/init.d/network reload
	'

	# The address and the name server arrive a moment later.
	if ! retry 12 5 vm_ssh 'apk update >/dev/null 2>&1'; then
		echo "the machine cannot reach the OpenWrt package repository" >&2
		vm_ssh 'apk update' >&2 || true
		exit 1
	fi

	# shellcheck disable=SC2029  # the package list is meant to expand here
	retry 3 10 vm_ssh "apk add $KEA_PACKAGES"

	vm_ssh 'cat > /tmp/luci-app-kea.apk' < "$package"
	vm_ssh 'apk add --allow-untrusted /tmp/luci-app-kea.apk && rm /tmp/luci-app-kea.apk'

	echo "Installed:"
	vm_ssh 'apk list --installed 2>/dev/null | grep -E "^(kea|luci-app-kea)-" | cut -d" " -f1 | sort'
}

stop() {
	if running; then
		kill "$(cat "$VM_DIR/qemu.pid")"
		echo "the machine is switched off"
	else
		echo "the machine is not running"
	fi

	rm -f "$VM_DIR/qemu.pid" "$VM_DIR/disk.qcow2"
}

command="${1:-}"
[ $# -gt 0 ] && shift

case "$command" in
	start) start "$@" ;;
	setup) setup "$@" ;;
	ssh) vm_ssh "$@" ;;
	stop) stop ;;
	*) usage ;;
esac
