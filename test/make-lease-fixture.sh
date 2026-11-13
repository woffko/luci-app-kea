#!/bin/sh

# Write Kea lease files for the browser test of the Leases page and for the
# screenshots. The leases expire within the hour, counted from now.
#
#   sh make-lease-fixture.sh [directory]            write the files
#   sh make-lease-fixture.sh --remove [directory]   remove them again
#
# The directory defaults to /var/lib/kea. The script refuses to work where
# a Kea DHCP daemon is running or has left leases: it would destroy them.

set -eu

REMOVE=0

if [ "${1:-}" = "--remove" ]; then
	REMOVE=1
	shift
fi

DIR="${1:-/var/lib/kea}"
MARK="$DIR/kea-leases.test-fixture"
V4="$DIR/kea-leases4.csv"
V6="$DIR/kea-leases6.csv"

if pidof kea-dhcp4 >/dev/null 2>&1 || pidof kea-dhcp6 >/dev/null 2>&1; then
	echo "a Kea DHCP daemon is running; not touching its lease files" >&2
	exit 1
fi

if [ "$REMOVE" = 1 ]; then
	if [ ! -f "$MARK" ]; then
		echo "no lease fixture in $DIR" >&2
		exit 1
	fi

	rm -f "$V4" "$V6" "$MARK"
	echo "removed the lease fixture from $DIR"
	exit 0
fi

if [ ! -f "$MARK" ]; then
	for file in "$V4" "$V4.1" "$V4.2" "$V4.completed" "$V6" "$V6.1" "$V6.2" "$V6.completed"; do
		if [ -f "$file" ] && [ "$(wc -l < "$file")" -gt 1 ]; then
			echo "$file holds leases; not overwriting it" >&2
			exit 1
		fi
	done
fi

NOW="$(date +%s)"
DUID="00:03:00:01:02:00:00:00:00:01"

mkdir -p "$DIR"
: > "$MARK"

# The first row of 192.168.1.100 is replaced by the second, as after a
# renewal. Then: a lease that ran out, one that was given back, an address
# a client declined, and a lease in a second subnet.
cat > "$V4" <<LEASES
address,hwaddr,client_id,valid_lifetime,expire,subnet_id,fqdn_fwd,fqdn_rev,hostname,state,user_context,pool_id
192.168.1.100,02:00:00:00:00:01,01:02:00:00:00:00:01,3600,$((NOW + 600)),3,0,0,old-name,0,,0
192.168.1.100,02:00:00:00:00:01,01:02:00:00:00:00:01,3600,$((NOW + 3000)),3,0,0,nas,0,,0
192.168.1.101,02:00:00:00:00:aa,,3600,$((NOW + 1200)),3,0,0,laptop,0,,0
192.168.1.102,02:00:00:00:00:02,,3600,$((NOW - 60)),3,0,0,gone,0,,0
192.168.1.103,02:00:00:00:00:03,,0,$((NOW - 600)),3,0,0,given-back,0,,0
192.168.1.120,,,86400,$((NOW + 80000)),3,0,0,,1,,0
10.20.0.15,02:00:00:00:00:15,,3600,$((NOW + 2400)),7,0,0,printer,0,,0
LEASES

# An address, a delegated prefix, and an address that was released.
cat > "$V6" <<LEASES
address,duid,valid_lifetime,expire,subnet_id,pref_lifetime,lease_type,iaid,prefix_len,fqdn_fwd,fqdn_rev,hostname,hwaddr,state,user_context,hwtype,hwaddr_source,pool_id
fd00:1::100,$DUID,4000,$((NOW + 3500)),2,3000,0,1,128,0,0,nas.,02:00:00:00:00:01,0,,1,2,0
fd00:1:0:400::,$DUID,4000,$((NOW + 3500)),2,3000,2,2,60,0,0,nas.,02:00:00:00:00:01,0,,1,2,0
fd00:1::101,00:03:00:01:02:00:00:00:00:aa,0,$((NOW - 600)),2,0,0,1,128,0,0,laptop.,02:00:00:00:00:aa,3,,1,2,0
LEASES

chmod 640 "$V4" "$V6"
echo "wrote the lease fixture to $DIR"
