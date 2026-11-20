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
