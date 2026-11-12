// SPDX-License-Identifier: Apache-2.0

'use strict';

import * as fs from 'fs';
import { parse } from 'luci.kea.jsonc';
import * as config from 'luci.kea.config';
import { ipv4_to_int, ip_in_subnet } from 'luci.kea.net';

// Import of dnsmasq static leases ("config host" sections of
// /etc/config/dhcp) into Kea reservations.
//
// classify() and merge() are pure and take plain objects, so they can be
// tested without UCI. commit() ties them to the configuration files.

function text(value) {
	if (type(value) == 'array')
		return join(' ', value);

	return value == null ? '' : `${value}`;
}

// Same reading of boolean options as config_get_bool in /lib/functions.sh.
function uci_bool(value, fallback) {
	value = text(value);

	if (value in [ '1', 'on', 'true', 'yes', 'enabled' ])
		return true;

	if (value in [ '0', 'off', 'false', 'no', 'disabled' ])
		return false;

	return fallback;
}

function valid_mac_list(value) {
	for (let mac in split(value, /\s+/))
		if (!match(mac, /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/))
			return false;

	return true;
}

// A DUID needs at least three colon-separated parts. This rejects the
// empty, "*" and truncated "00" values that dnsmasq configs can contain.
function valid_duid(value) {
	return value != '' && value != '*' && value != '00' && length(split(value, ':')) >= 3;
}

// Turn one UCI host section into an import entry. An entry with warnings
// is "disabled": it is shown and staged but not written to Kea.
export function classify(host) {
	let entry = {
		source: text(host['.name']),
		family: 'dhcp4',
		status: 'ready',
		enabled: true,
		name: text(host.name),
		mac: text(host.mac),
		ip: text(host.ip),
		duid: text(host.duid),
		hostid: text(host.hostid),
		tag: text(host.tag),
		networkid: text(host.networkid),
		warnings: []
	};
	let warn = message => push(entry.warnings, message);

	if (!uci_bool(host.enable, true))
		warn('source dnsmasq host entry is disabled');

	if (entry.duid != '' || entry.hostid != '')
		entry.family = 'dhcp6';

	if (entry.family == 'dhcp4') {
		if (entry.mac == '')
			warn('missing MAC address');

		if (entry.ip == '')
			warn('missing IPv4 address');
		else if (ipv4_to_int(entry.ip) == null)
			warn('invalid IPv4 address');

		if (entry.mac != '' && !valid_mac_list(entry.mac))
			warn('invalid MAC address');

		if (index(entry.mac, ' ') >= 0)
			warn('multiple MAC addresses need manual review');
	}
	else {
		if (!valid_duid(entry.duid))
			warn('missing, invalid, or truncated DHCPv6 DUID/client-id');

		if (entry.ip == '' && entry.hostid == '')
			warn('missing DHCPv6 address or hostid');

		if (entry.hostid != '')
			warn('DHCPv6 hostid requires subnet prefix resolution before import');
	}

	if (entry.tag != '')
		warn('dnsmasq tag import is not implemented yet');

	if (text(host.match_tag) != '')
		warn('dnsmasq match_tag import is not implemented yet');

	if (entry.networkid != '')
		warn('dnsmasq networkid import is not implemented yet');

	if (uci_bool(host.dns, false))
		warn('dns hostfile side effect is not represented in Kea reservation');

	if (length(entry.warnings)) {
		entry.status = 'disabled';
		entry.enabled = false;
	}

	return entry;
};

export function preview(hosts) {
	return map(hosts ?? [], classify);
};

function find_subnet4(subnets, addr) {
	for (let subnet in subnets)
		if (type(subnet) == 'object' && ip_in_subnet(addr, subnet.subnet))
			return subnet;

	return null;
}

// Add the entry to the subnet, or update the reservation that already has
// its MAC or IP address. Other fields of an existing reservation are kept.
function apply_reservation(subnet, entry) {
	if (type(subnet.reservations) != 'array')
		subnet.reservations = [];

	for (let reservation in subnet.reservations) {
		if (type(reservation) != 'object')
			continue;

		if (reservation['hw-address'] != entry.mac && reservation['ip-address'] != entry.ip)
			continue;

		reservation['hw-address'] = entry.mac;
		reservation['ip-address'] = entry.ip;

		if (entry.name != '')
			reservation.hostname = entry.name;
		else
			delete reservation.hostname;

		return 'updated';
	}

	let reservation = { 'hw-address': entry.mac, 'ip-address': entry.ip };

	if (entry.name != '')
		reservation.hostname = entry.name;

	push(subnet.reservations, reservation);

	return 'imported';
}

// Merge ready DHCPv4 entries into the configuration object in place.
// Returns the summary reported to the user.
export function merge(conf, entries) {
	if (type(conf.Dhcp4) != 'object')
		conf.Dhcp4 = {};

	if (type(conf.Dhcp4.subnet4) != 'array')
		conf.Dhcp4.subnet4 = [];

	let imported = 0;
	let updated = 0;
	let skipped_entries = [];
	let skip = (entry, reason) => push(skipped_entries, { source: entry.source, reason });

	for (let entry in entries) {
		if (entry.status != 'ready') {
			skip(entry, 'entry is disabled or has warnings');
			continue;
		}

		if (entry.family != 'dhcp4') {
			skip(entry, 'only DHCPv4 direct Kea import is implemented');
			continue;
		}

		let subnet = find_subnet4(conf.Dhcp4.subnet4, entry.ip);

		if (!subnet) {
			skip(entry, 'no matching Kea DHCPv4 subnet for ' + entry.ip);
			continue;
		}

		if (apply_reservation(subnet, entry) == 'updated')
			updated++;
		else
			imported++;
	}

	return {
		result: true,
		changed: imported + updated > 0,
		imported,
		updated,
		skipped: length(skipped_entries),
		staged: length(entries),
		skipped_entries
	};
};

// Import the given UCI host sections: write ready DHCPv4 entries to
// kea-dhcp4.conf (validated and backed up by config.save) and record every
// entry in the staging file.
export function commit(ctx, hosts) {
	let file = config.path(ctx, 'dhcp4');

	if (!config.is_file(file))
		return { result: false, error: 'DHCPv4 config file does not exist', path: file };

	let parsed = parse(fs.readfile(file));

	if (parsed.error || type(parsed.config) != 'object')
		return {
			result: false,
			error: 'DHCPv4 config cannot be parsed',
			detail: parsed.error ?? 'not a JSON object'
		};

	let entries = preview(hosts);
	let result = merge(parsed.config, entries);

	if (result.changed) {
		let saved = config.save(ctx, 'dhcp4', sprintf('%.J\n', parsed.config));

		if (!saved.result) {
			if (saved.error == 'validation failed')
				saved.error = 'imported DHCPv4 config failed validation';

			return saved;
		}
	}

	if (!config.write_private(ctx.staging_file, sprintf('%.J\n', {
		version: 1,
		entries,
		last_result: result
	})))
		return { result: false, error: 'failed to write the staging file' };

	return result;
};
