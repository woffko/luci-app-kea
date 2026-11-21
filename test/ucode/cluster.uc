'use strict';

import { test, equal, done } from './lib.uc';
import { follows_kea, declares_command } from 'luci.kea.cluster';

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
