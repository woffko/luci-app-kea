// SPDX-License-Identifier: Apache-2.0

'use strict';

// What the ha-cluster package says about the nodes of a cluster, in the
// shape the high availability tab needs. Pure: the caller makes the call.
//
// ha-cluster is not a dependency. Its read-only call "ubus call ha-cluster
// nodes" answers with
//
//   { "dhcp_backend": "kea",
//     "node":  { "name", "label", "address", "priority", "kea_role" },
//     "peers": [ { "name", "label", "address", "vrrp_only", "kea_role" } ] }
//
// "name" is the same string for a node on every node of the cluster, so it
// serves as the server name of Kea's high availability. "address" is the
// node's own address that its partners reach, never a virtual address.
// "kea_role" is a suggestion for hot standby. A peer that only takes part
// in VRRP is not a DHCP server and is left out.

import { uci_bool } from 'luci.kea.openwrt';

function text(value) {
	return type(value) == 'string' ? value : '';
}

function entry(item) {
	if (type(item) != 'object' || text(item.name) == '' || text(item.address) == '')
		return null;

	return {
		name: item.name,
		label: text(item.label),
		address: item.address,
		role: text(item.kea_role)
	};
}

// Returns { available, dhcp_backend, node, peers }. "available" says that
// there is a pair to fill in: this node and at least one partner, each
// with a name and an address.
export function nodes(reply) {
	let result = {
		available: false,
		dhcp_backend: text(reply?.dhcp_backend),
		node: entry(reply?.node),
		peers: []
	};

	for (let peer in (type(reply?.peers) == 'array' ? reply.peers : [])) {
		let item = type(peer) == 'object' && peer.vrrp_only != true ? entry(peer) : null;

		if (item)
			push(result.peers, item);
	}

	result.available = result.node != null && length(result.peers) > 0;

	return result;
};

// Whether ha-cluster is to look at its firewall rules again after Kea took
// a configuration.
//
// With Kea as the DHCP server of the cluster, ha-cluster keeps a firewall
// rule for the ports of Kea's high availability. It takes them from the
// peer URLs in the Kea files, so a changed port is let through only after
// it read the files again.
//
// A disabled cluster keeps no rules, and one with dnsmasq has none for
// these ports: there is nothing to follow, and nothing to tell the user.
//
// "section" is the section "config" of /etc/config/ha-cluster.
export function follows_kea(section) {
	return type(section) == 'object' && uci_bool(section.enabled, false) && text(section.dhcp_backend) == 'kea';
};

// Whether the text of an init script declares an extra command, in either
// of the two ways rc.common knows:
//
//   EXTRA_COMMANDS="one two"        extra_command "one" "what it does"
//
// rc.common answers a command a script does not have with its help text,
// which cannot be told from a command that worked.
export function declares_command(script, command) {
	for (let line in split(text(script), '\n')) {
		let list = match(line, /^[ \t]*EXTRA_COMMANDS=["']?([^"'#]*)/);

		if (list && command in split(trim(list[1]), /[ \t]+/))
			return true;

		let single = match(line, /^[ \t]*extra_command[ \t]+["']?([A-Za-z0-9_-]+)/);

		if (single && single[1] == command)
			return true;
	}

	return false;
};
