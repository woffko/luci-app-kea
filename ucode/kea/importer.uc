// SPDX-License-Identifier: Apache-2.0

'use strict';

import * as fs from 'fs';
import { parse, stringify, has_comments } from 'luci.kea.jsonc';
import * as config from 'luci.kea.config';
import * as net from 'luci.kea.net';

// Import of OpenWrt static leases into Kea reservations.
//
// The source is the "config host" sections of /etc/config/dhcp, as read by
// dnsmasq and odhcpd. One section can describe a host for both protocols:
// "mac" and "ip" for DHCPv4, "duid" and "hostid" (the IPv6 token) for
// DHCPv6. It therefore yields up to two entries here.
//
// Nothing is kept between runs. The preview is computed from the UCI
// sections and the current Kea configuration every time, so the UCI
// sections stay the only copy of what has not been imported yet.
//
// classify_all() is pure: it takes plain objects and can be tested without
// UCI or Kea. preview() and commit() tie it to the files.

// Where the LuCI editors keep reservations that are switched off.
const CONTEXT_KEY = 'luci-app-kea';
const DISABLED_KEY = 'disabled-reservations';

const FAMILIES = {
	dhcp4: { root: 'Dhcp4', subnets: 'subnet4', id: 'hw-address' },
	dhcp6: { root: 'Dhcp6', subnets: 'subnet6', id: 'duid' }
};

// dnsmasq settings of a host that a Kea reservation cannot express.
const NOT_CARRIED_OVER = {
	tag: 'the dnsmasq tag is not carried over',
	match_tag: 'the dnsmasq tag match is not carried over',
	networkid: 'the dnsmasq network ID is not carried over',
	leasetime: 'the per-host lease time is not carried over',
	instance: 'the dnsmasq instance is not carried over'
};

function text(value) {
	if (type(value) == 'array')
		return join(' ', value);

	return value == null ? '' : `${value}`;
}

// A UCI option that may be a list or a space-separated string.
function list(value) {
	if (type(value) == 'array')
		return filter(map(value, item => `${item}`), item => item != '');

	return filter(split(text(value), /\s+/), item => item != '');
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

function valid_mac(value) {
	return match(value, /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/) != null;
}

// OpenWrt writes a DUID as a hex string, optionally followed by "%" and an
// IAID. Returns { duid, iaid } with the DUID as lower-case octets separated
// by colons, or null. A DUID has a two-octet type and at least one more
// octet, and at most 130 octets in total.
export function parse_duid(value) {
	let parts = split(text(value), '%');
	let digits = replace(parts[0], ':', '');

	if (length(parts) > 2 || !match(digits, /^[0-9a-fA-F]+$/) || length(digits) % 2)
		return null;

	if (length(digits) < 6 || length(digits) > 260)
		return null;

	let octets = [];

	for (let i = 0; i < length(digits); i += 2)
		push(octets, lc(substr(digits, i, 2)));

	return { duid: join(':', octets), iaid: parts[1] ?? '' };
};

function same_duid(a, b) {
	return lc(replace(text(a), ':', '')) == lc(replace(text(b), ':', ''));
}

function subnets_of(conf, family) {
	let root = conf?.[FAMILIES[family].root];
	let subnets = type(root) == 'object' ? root[FAMILIES[family].subnets] : null;

	return filter(type(subnets) == 'array' ? subnets : [], subnet => type(subnet) == 'object');
}

function reservations_of(subnet) {
	return filter(type(subnet.reservations) == 'array' ? subnet.reservations : [],
		reservation => type(reservation) == 'object');
}

function disabled_of(subnet) {
	let stored = subnet['user-context']?.[CONTEXT_KEY]?.[DISABLED_KEY];

	return filter(type(stored) == 'array' ? stored : [], reservation => type(reservation) == 'object');
}

function same_identifier(family, reservation, identifier) {
	if (family == 'dhcp4')
		return lc(text(reservation['hw-address'])) == identifier;

	return reservation.duid != null && same_duid(reservation.duid, identifier);
}

function holds_address(family, reservation, address) {
	if (family == 'dhcp4')
		return text(reservation['ip-address']) == address;

	for (let candidate in (type(reservation['ip-addresses']) == 'array' ? reservation['ip-addresses'] : []))
		if (net.ipv6_canonical(candidate) == address)
			return true;

	return false;
}

// How a reservation is identified, for messages.
function identifier_of(reservation) {
	for (let key in [ 'hw-address', 'duid', 'client-id', 'circuit-id', 'flex-id' ])
		if (reservation[key] != null)
			return text(reservation[key]);

	return 'another client';
}

// The OpenWrt interface whose IPv4 network contains the address.
function interface_of(interfaces, address) {
	for (let item in (interfaces ?? []))
		for (let cidr in split(text(item.ipaddr), /\s+/))
			if (cidr != '' && index(cidr, '/') > 0 && net.ip_in_subnet(address, cidr))
				return item;

	return null;
}

function new_entry(host, family) {
	return {
		key: host['.name'] + ':' + family,
		source: text(host['.name']),
		family,
		name: text(host.name),
		identifier_type: FAMILIES[family].id,
		identifier: '',
		address: '',
		subnet: '',
		disabled: !uci_bool(host.enable, true),

		// working state, removed before the entry leaves this module
		blocked: [],
		review: [],
		state: 'new',
		change: null,
		target: null,
		existing: null
	};
}

// Compare the entry with what the target subnet already holds.
function compare_existing(entry) {
	let subnet = entry.target;

	for (let reservation in reservations_of(subnet)) {
		if (!same_identifier(entry.family, reservation, entry.identifier))
			continue;

		entry.existing = reservation;

		if (!holds_address(entry.family, reservation, entry.address)) {
			entry.state = 'update';
			entry.change = entry.family == 'dhcp4' ?
				'Kea reserves ' + text(reservation['ip-address']) + ' for this client; the import changes it to ' + entry.address :
				'Kea has a reservation for this client without this address; the import adds it';
		}
		else if (entry.name != '' && text(reservation.hostname) != entry.name) {
			entry.state = 'update';
			entry.change = 'the import sets the hostname of the existing reservation to ' + entry.name;
		}
		else {
			entry.state = 'present';
			entry.change = 'already reserved in Kea';
		}

		return;
	}

	for (let reservation in reservations_of(subnet)) {
		if (holds_address(entry.family, reservation, entry.address)) {
			push(entry.blocked, 'the address is already reserved in Kea for ' + identifier_of(reservation));
			return;
		}
	}

	for (let reservation in disabled_of(subnet)) {
		if (same_identifier(entry.family, reservation, entry.identifier)) {
			entry.state = 'present';
			entry.change = 'already stored in Kea as a disabled reservation';
			return;
		}
	}
}

function classify4(host, env) {
	let entry = new_entry(host, 'dhcp4');
	let macs = list(host.mac);
	let ip = text(host.ip);

	if (!length(macs)) {
		push(entry.blocked, entry.name != '' ?
			'no MAC address (dnsmasq matches this host by its name, Kea cannot)' :
			'no MAC address');
	}
	else if (length(macs) > 1) {
		entry.identifier = join(' ', macs);
		push(entry.blocked, 'several MAC addresses share one address; Kea reserves an address for one identifier');
	}
	else if (!valid_mac(macs[0])) {
		entry.identifier = macs[0];
		push(entry.blocked, 'invalid MAC address');
	}
	else {
		entry.identifier = lc(macs[0]);
	}

	if (ip == '') {
		push(entry.blocked, 'no IPv4 address');
	}
	else if (ip == 'ignore') {
		entry.address = ip;
		push(entry.blocked, 'dnsmasq ignores this host; a Kea reservation cannot express that');
	}
	else if (net.ipv4_to_int(ip) == null) {
		entry.address = ip;
		push(entry.blocked, 'invalid IPv4 address');
	}
	else {
		entry.address = ip;
	}

	if (length(entry.blocked))
		return entry;

	if (!env.dhcp4) {
		push(entry.blocked, 'the Kea DHCPv4 configuration is missing or cannot be parsed');
		return entry;
	}

	for (let subnet in subnets_of(env.dhcp4, 'dhcp4')) {
		if (net.ip_in_subnet(ip, subnet.subnet)) {
			entry.target = subnet;
			break;
		}
	}

	if (!entry.target) {
		let iface = interface_of(env.interfaces, ip);

		push(entry.blocked, 'the address is outside every Kea DHCPv4 subnet' + (iface ?
			'; create the subnet for interface ' + iface.name + ' on the DHCPv4 page first' : ''));
		return entry;
	}

	entry.subnet = text(entry.target.subnet);
	compare_existing(entry);

	return entry;
}

// Pick the DHCPv6 subnet for a host that is given by its IPv6 token only.
function token_subnet(host, env, entry) {
	let candidates = filter(subnets_of(env.dhcp6, 'dhcp6'), subnet => {
		let cidr = net.parse_cidr6(subnet.subnet);

		return cidr != null && cidr.prefix <= 64;
	});

	if (!length(candidates)) {
		push(entry.blocked, 'no Kea DHCPv6 subnet of /64 or shorter to place the IPv6 token in');
		return null;
	}

	if (length(candidates) == 1)
		return candidates[0];

	// Several subnets: follow the host's IPv4 address to its interface.
	let iface = interface_of(env.interfaces, text(host.ip));
	let bound = iface ? filter(candidates, subnet => text(subnet['interface']) == iface.device) : [];

	if (length(bound) == 1)
		return bound[0];

	push(entry.blocked, 'several Kea DHCPv6 subnets exist; cannot tell which one this host belongs to');
	return null;
}

function classify6(host, env) {
	let entry = new_entry(host, 'dhcp6');
	let duids = list(host.duid);
	let hostid = text(host.hostid);
	let explicit = net.ipv6_canonical(text(host.ip));

	if (!length(duids)) {
		push(entry.blocked, 'no DUID');
	}
	else if (length(duids) > 1) {
		entry.identifier = join(' ', duids);
		push(entry.blocked, 'several DUIDs share one address; Kea reserves an address for one identifier');
	}
	else {
		let parsed = parse_duid(duids[0]);

		if (!parsed) {
			entry.identifier = duids[0];
			push(entry.blocked, 'invalid or truncated DUID');
		}
		else {
			entry.identifier = parsed.duid;

			if (parsed.iaid != '')
				push(entry.review, 'the IAID is not carried over; Kea reserves by DUID only');
		}
	}

	if (!explicit && hostid == '')
		push(entry.blocked, 'no IPv6 token (hostid) or address');
	else if (!explicit && !match(hostid, /^[0-9a-fA-F]{1,16}$/))
		push(entry.blocked, 'invalid IPv6 token');

	if (!explicit)
		entry.address = hostid != '' ? '::' + hostid : '';
	else
		entry.address = explicit;

	if (length(entry.blocked))
		return entry;

	if (!env.dhcp6) {
		push(entry.blocked, 'the Kea DHCPv6 configuration is missing or cannot be parsed');
		return entry;
	}

	if (explicit) {
		for (let subnet in subnets_of(env.dhcp6, 'dhcp6')) {
			if (net.ip6_in_subnet(explicit, subnet.subnet)) {
				entry.target = subnet;
				break;
			}
		}

		if (!entry.target)
			push(entry.blocked, 'the address is outside every Kea DHCPv6 subnet');
	}
	else {
		entry.target = token_subnet(host, env, entry);

		if (entry.target)
			entry.address = net.token_address(entry.target.subnet, hostid);
	}

	if (!entry.target)
		return entry;

	entry.subnet = text(entry.target.subnet);
	compare_existing(entry);

	return entry;
}

function other_name(entry) {
	return entry.name != '' ? entry.name : entry.source;
}

// Two hosts cannot share an identifier or an address. Block both: nothing
// tells which of them is right.
function block_duplicates(entries) {
	for (let field in [ 'identifier', 'address' ]) {
		let seen = {};

		for (let entry in entries) {
			if (length(entry.blocked) || entry[field] == '' || !entry.target)
				continue;

			let key = entry.family + ' ' + text(entry.target.id) + ' ' + entry[field];

			seen[key] ??= [];
			push(seen[key], entry);
		}

		for (let key, group in seen) {
			if (length(group) < 2)
				continue;

			for (let entry in group) {
				let others = map(filter(group, other => other != entry), other_name);

				push(entry.blocked, (field == 'address' ? 'same address as host ' :
					entry.family == 'dhcp4' ? 'same MAC address as host ' : 'same DUID as host ') +
					join(', ', others));
			}
		}
	}
}

function finish(host, entry) {
	for (let option, message in NOT_CARRIED_OVER)
		if (length(list(host[option])))
			push(entry.review, message);

	if (uci_bool(host.dns, false))
		push(entry.review, 'the hosts file entry (dns) is not carried over');

	if (uci_bool(host.broadcast, false))
		push(entry.review, 'the broadcast flag is not carried over');

	if (entry.disabled)
		push(entry.review, 'the static lease is disabled; it is imported as a disabled reservation');

	if (length(entry.blocked)) {
		entry.status = 'blocked';
		entry.notes = entry.blocked;
	}
	else if (entry.state == 'present') {
		entry.status = 'present';
		entry.notes = [ entry.change ];
	}
	else if (entry.state == 'update') {
		entry.status = 'update';
		entry.notes = [ entry.change, ...entry.review ];
	}
	else if (length(entry.review)) {
		entry.status = 'review';
		entry.notes = entry.review;
	}
	else {
		entry.status = 'ready';
		entry.notes = [];
	}

	entry.selectable = entry.status in [ 'ready', 'review', 'update' ];
	entry.selected = entry.status == 'ready';
}

// Turn UCI host sections into import entries.
//
// env.dhcp4, env.dhcp6   parsed Kea configurations, or null
// env.interfaces         as returned by service.network_interfaces()
//
// The returned entries carry working fields (target, existing, ...) that
// commit() uses; to_public() strips them.
export function classify_all(hosts, env) {
	let entries = [];
	let pairs = [];

	for (let host in (hosts ?? [])) {
		let is_v6_address = net.ipv6_bytes(text(host.ip)) != null;
		let has4 = length(list(host.mac)) > 0 || (text(host.ip) != '' && !is_v6_address);
		let has6 = length(list(host.duid)) > 0 || text(host.hostid) != '' || is_v6_address;

		if (has4 || !has6)
			push(pairs, [ host, classify4(host, env) ]);

		if (has6)
			push(pairs, [ host, classify6(host, env) ]);
	}

	for (let pair in pairs)
		push(entries, pair[1]);

	block_duplicates(entries);

	for (let pair in pairs)
		finish(pair[0], pair[1]);

	return entries;
};

const PUBLIC_FIELDS = [
	'key', 'source', 'family', 'status', 'selectable', 'selected', 'disabled',
	'name', 'identifier_type', 'identifier', 'address', 'subnet', 'notes'
];

export function to_public(entry) {
	let result = {};

	for (let field in PUBLIC_FIELDS)
		result[field] = entry[field];

	return result;
};

// Read and parse one Kea configuration file for the import.
function load(ctx, name) {
	let file = config.path(ctx, name);
	let state = { path: file, exists: config.is_file(file), parsed: false, has_comments: false, error: null };

	if (!state.exists)
		return state;

	let content = fs.readfile(file);
	let parsed = parse(content);

	if (parsed.error || type(parsed.config) != 'object') {
		state.error = parsed.error ?? 'not a JSON object';
		return state;
	}

	state.parsed = true;
	state.has_comments = has_comments(content);
	state.config = parsed.config;

	return state;
}

function environment(ctx, interfaces) {
	let files = { dhcp4: load(ctx, 'dhcp4'), dhcp6: load(ctx, 'dhcp6') };

	return {
		files,
		dhcp4: files.dhcp4.config,
		dhcp6: files.dhcp6.config,
		interfaces
	};
}

function file_states(files) {
	let result = {};

	for (let name, state in files)
		result[name] = {
			path: state.path,
			exists: state.exists,
			parsed: state.parsed,
			has_comments: state.has_comments,
			error: state.error
		};

	return result;
}

// What the import would do, without writing anything.
export function preview(ctx, hosts, interfaces) {
	let env = environment(ctx, interfaces);

	return {
		mode: 'dry-run',
		files: file_states(env.files),
		entries: map(classify_all(hosts, env), to_public)
	};
};

function reservation_for(entry) {
	let reservation = {};

	reservation[entry.identifier_type] = entry.identifier;

	if (entry.family == 'dhcp4')
		reservation['ip-address'] = entry.address;
	else
		reservation['ip-addresses'] = [ entry.address ];

	if (entry.name != '')
		reservation.hostname = entry.name;

	return reservation;
}

// Write one entry into the parsed configuration it was classified against.
function apply(entry) {
	let subnet = entry.target;

	if (entry.status == 'update') {
		let reservation = entry.existing;

		if (entry.family == 'dhcp4') {
			reservation['ip-address'] = entry.address;
		}
		else if (!holds_address('dhcp6', reservation, entry.address)) {
			if (type(reservation['ip-addresses']) != 'array')
				reservation['ip-addresses'] = [];

			push(reservation['ip-addresses'], entry.address);
		}

		if (entry.name != '')
			reservation.hostname = entry.name;

		return 'updated';
	}

	if (entry.disabled) {
		if (type(subnet['user-context']) != 'object')
			subnet['user-context'] = {};

		if (type(subnet['user-context'][CONTEXT_KEY]) != 'object')
			subnet['user-context'][CONTEXT_KEY] = {};

		let own = subnet['user-context'][CONTEXT_KEY];

		if (type(own[DISABLED_KEY]) != 'array')
			own[DISABLED_KEY] = [];

		push(own[DISABLED_KEY], reservation_for(entry));
	}
	else {
		if (type(subnet.reservations) != 'array')
			subnet.reservations = [];

		push(subnet.reservations, reservation_for(entry));
	}

	return 'imported';
}

// Import entries by key ("<UCI section>:<family>"). Without keys, every
// entry that is ready is imported.
//
// Both configuration files are validated before either is replaced, and
// each replacement goes through config.save(), which keeps a backup.
export function commit(ctx, hosts, interfaces, keys) {
	let env = environment(ctx, interfaces);
	let entries = classify_all(hosts, env);
	let by_key = {};

	for (let entry in entries)
		by_key[entry.key] = entry;

	if (type(keys) != 'array' || !length(keys))
		keys = map(filter(entries, entry => entry.status == 'ready'), entry => entry.key);

	let imported = 0;
	let updated = 0;
	let skipped_entries = [];
	let changed = {};

	for (let key in uniq(keys)) {
		let entry = by_key[key];

		if (!entry) {
			push(skipped_entries, { key: `${key}`, reason: 'no such entry' });
		}
		else if (!entry.selectable) {
			push(skipped_entries, { key, reason: entry.status + ': ' + (entry.notes[0] ?? '') });
		}
		else {
			if (apply(entry) == 'updated')
				updated++;
			else
				imported++;

			changed[entry.family] = true;
		}
	}

	let contents = {};

	for (let name in changed) {
		contents[name] = stringify(env[name]);

		let check = config.check(ctx, name, contents[name]);

		if (!check.valid)
			return {
				result: false,
				error: 'the imported ' + (name == 'dhcp4' ? 'DHCPv4' : 'DHCPv6') + ' configuration failed validation',
				validation: check.output
			};
	}

	let backups = {};

	for (let name, content in contents) {
		let saved = config.save(ctx, name, content);

		if (!saved.result)
			return saved;

		backups[name] = saved.backup;
	}

	return {
		result: true,
		changed: length(contents) > 0,
		imported,
		updated,
		skipped: length(skipped_entries),
		skipped_entries,
		backups
	};
};
