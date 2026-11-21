'use strict';

import { test, equal, done } from './lib.uc';
import { nodes, follows_kea, declares_command } from 'luci.kea.cluster';

// The reply of "ubus call ha-cluster nodes" as the ha-cluster project
// defined it on 2026-11-20.

const REPLY = {
	dhcp_backend: 'kea',
	node: { name: 'ha-192-168-50-2', label: 'node1', address: '192.168.50.2', priority: 100, kea_role: 'primary' },
	peers: [
		{ name: 'ha-192-168-50-3', label: 'node2', address: '192.168.50.3', vrrp_only: false, kea_role: 'standby' }
	]
};

test('a pair is offered with names, addresses and the suggested roles', () => {
	equal(nodes(REPLY), {
		available: true,
		dhcp_backend: 'kea',
		node: { name: 'ha-192-168-50-2', label: 'node1', address: '192.168.50.2', role: 'primary' },
		peers: [ { name: 'ha-192-168-50-3', label: 'node2', address: '192.168.50.3', role: 'standby' } ]
	});
});

test('a peer that only takes part in VRRP is not a DHCP server', () => {
	let reply = { ...REPLY, peers: [
		...REPLY.peers,
		{ name: 'ha-192-168-50-4', label: 'node3', address: '192.168.50.4', vrrp_only: true },
		{ name: 'ha-192-168-50-5', label: 'node4', address: '192.168.50.5', vrrp_only: false, kea_role: 'backup' }
	] };

	equal(map(nodes(reply).peers, peer => [ peer.name, peer.role ]),
		[ [ 'ha-192-168-50-3', 'standby' ], [ 'ha-192-168-50-5', 'backup' ] ]);
});

test('nothing is offered without a partner, a name or an address', () => {
	// A node without peers: ha-cluster sends empty strings and no role.
	let alone = nodes({ dhcp_backend: 'kea', node: { name: '', label: 'node1', address: '', priority: 100 }, peers: [] });

	equal(alone, { available: false, dhcp_backend: 'kea', node: null, peers: [] });
	equal(nodes({ ...REPLY, peers: [] }).available, false);
	equal(nodes({ ...REPLY, peers: [ { name: 'x', label: 'x', address: '' } ] }).available, false);
	equal(nodes({ ...REPLY, node: { name: 'ha-1', address: '' } }).available, false);
});

test('ha-cluster is not there, or answers something else', () => {
	const nothing = { available: false, dhcp_backend: '', node: null, peers: [] };

	equal(nodes(null), nothing, 'no such ubus object');
	equal(nodes({}), nothing);
	equal(nodes('error'), nothing);
	equal(nodes({ dhcp_backend: 'dnsmasq', node: REPLY.node, peers: REPLY.peers }).dhcp_backend, 'dnsmasq',
		'the pair is offered whatever the backend; the page says which it is');
	equal(nodes({ node: 5, peers: 'x' }), nothing);
});

/* ---- ha-cluster follows the Kea files -------------------------------------- */

test('ha-cluster follows the Kea files when it is enabled and has Kea as its DHCP server', () => {
	equal(follows_kea({ enabled: '1', dhcp_backend: 'kea' }), true);
	equal(follows_kea({ enabled: 'on', dhcp_backend: 'kea', firewall: '0' }), true,
		'whether it keeps rules at all is its own matter');
});

test('a disabled cluster keeps no rules', () => {
	equal(follows_kea({ enabled: '0', dhcp_backend: 'kea' }), false);
	equal(follows_kea({ dhcp_backend: 'kea' }), false, 'disabled is the default of ha-cluster');
});

test('a cluster with dnsmasq has no rule for the ports of Kea', () => {
	equal(follows_kea({ enabled: '1', dhcp_backend: 'dnsmasq' }), false);
	equal(follows_kea({ enabled: '1' }), false, 'dnsmasq is the default of ha-cluster');
	equal(follows_kea(null), false, 'no config of ha-cluster');
});

test('an extra command of an init script is found in both ways of declaring it', () => {
	const head = '#!/bin/sh /etc/rc.common\nSTART=25\nUSE_PROCD=1\n';

	equal(declares_command(head + 'EXTRA_COMMANDS="firewall"\n', 'firewall'), true);
	equal(declares_command(head + "\tEXTRA_COMMANDS='status firewall  check'\n", 'firewall'), true);
	equal(declares_command(head + 'EXTRA_COMMANDS=firewall\n', 'firewall'), true);
	equal(declares_command(head + 'extra_command "firewall" "Bring the rules up to date"\n', 'firewall'), true);

	equal(declares_command(head, 'firewall'), false, 'a script without extra commands');
	equal(declares_command(head + 'EXTRA_COMMANDS="status"\nfirewall() { :; }\n', 'firewall'), false,
		'a function alone is no command');
	equal(declares_command(head + 'EXTRA_COMMANDS="firewall_check"\n', 'firewall'), false);
	equal(declares_command(head + '# EXTRA_COMMANDS="firewall"\n', 'firewall'), false, 'a comment');
	equal(declares_command(head + 'extra_command "firewalls"\n', 'firewall'), false);
	equal(declares_command(null, 'firewall'), false, 'no script');
});

done();
