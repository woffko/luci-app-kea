// SPDX-License-Identifier: Apache-2.0

'use strict';

// What the backend needs to know of the ha-cluster package, which is not a
// dependency: whether it follows the Kea files, and whether its init
// script has a command. Pure: the caller reads the config and the script.
//
// The nodes of a cluster are asked for by the pages, not here; see
// service.uc for the reason.

import { uci_bool } from 'luci.kea.openwrt';

function text(value) {
	return type(value) == 'string' ? value : '';
}

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
