// SPDX-License-Identifier: Apache-2.0

'use strict';

import * as fs from 'fs';
import { parse, stringify, has_comments } from 'luci.kea.jsonc';
import * as config from 'luci.kea.config';
import * as net from 'luci.kea.net';
import * as runtime from 'luci.kea.runtime';

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

// A host name Kea can hand out and DNS can carry: labels of letters,
// digits, "-" and "_" (which dnsmasq takes too) of up to 63 characters,
// joined by dots, 253 characters at most. Kea writes a reserved name to
// the clients and to DNS as it is, so nothing else goes into a
// reservation.
export function valid_hostname(name) {
	return type(name) == 'string' && length(name) <= 253 &&
		match(name, /^[A-Za-z0-9_-]{1,63}(\.[A-Za-z0-9_-]{1,63})*\.?$/) != null;
};

function new_entry(host, family) {
	let entry = {
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

	if (entry.name != '' && !valid_hostname(entry.name))
		push(entry.blocked, 'the hostname is not a valid host name: letters, digits, "-" and "_", joined by dots');

	return entry;
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

function commit_unlocked(ctx, hosts, interfaces, keys) {
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
}

// Import entries by key ("<UCI section>:<family>"). Without keys, every
// entry that is ready is imported.
//
// Both configuration files are validated before either is replaced, and
// each replacement goes through config.save(), which keeps a backup. The
// files are read, changed and written under the lock of config.locked().
export function commit(ctx, hosts, interfaces, keys) {
	return config.locked(ctx, () => commit_unlocked(ctx, hosts, interfaces, keys));
};

/* ---- the import command --------------------------------------------------- */

// /usr/libexec/luci-app-kea/import-dnsmasq runs the import from a shell, for
// another package such as ha-cluster that switches a router from dnsmasq to
// Kea. It does what the Import page does with its default selection, and
// reports what it left, so that the caller can name it.

const STATUSES = [ 'ready', 'review', 'update', 'present', 'blocked' ];
const LEFT_FIELDS = [ 'key', 'source', 'family', 'status', 'name', 'identifier', 'address', 'subnet', 'notes' ];

// The arguments of the command: { dry_run, include_review, leases,
// leases_file, help }, or { error } for one it does not know.
// "--leases-file FILE" names a copy of dnsmasq's lease file, for a caller
// that saved it before dnsmasq was restarted without DHCP.
export function command_options(args) {
	let options = { dry_run: false, include_review: false, leases: false, leases_file: null, help: false };
	let list = type(args) == 'array' ? args : [];

	for (let i = 0; i < length(list); i++) {
		let arg = list[i];

		if (arg == '--dry-run')
			options.dry_run = true;
		else if (arg == '--include-review')
			options.include_review = true;
		else if (arg == '--leases')
			options.leases = true;
		else if (arg == '--leases-file' && i + 1 < length(list))
			options.leases_file = list[++i];
		else if (arg in [ '-h', '--help' ])
			options.help = true;
		else
			return { error: 'unknown argument: ' + arg };
	}

	if (options.leases_file != null && !options.leases)
		return { error: '--leases-file is used with --leases' };

	return options;
};

// How many entries have each status, and those that are neither present in
// Kea nor among "chosen", with what the caller needs to name them.
function left_over(entries, chosen) {
	let counts = {};
	let left = [];

	for (let status in STATUSES)
		counts[status] = 0;

	for (let entry in entries) {
		counts[entry.status]++;

		if (entry.status != 'present' && !(entry.key in chosen)) {
			let item = {};

			for (let field in LEFT_FIELDS)
				item[field] = entry[field];

			push(left, item);
		}
	}

	return { counts, left };
}

// Import the entries that are ready, and with options.include_review those
// that need review as well; never those that would change a reservation Kea
// already has. With options.dry_run nothing is written.
//
// The reply has "result", "mode" ("commit" or "dry-run"), "selected" (the
// keys imported, or that would be), "files", "counts" (entries by status)
// and "left" (the entries not imported and not already in Kea). "counts"
// and "left" describe the files as they are after the run. A commit adds
// what commit() returns. With "result" false nothing was written.
export function run(ctx, hosts, interfaces, options) {
	let mode = options?.dry_run ? 'dry-run' : 'commit';
	let wanted = options?.include_review ? [ 'ready', 'review' ] : [ 'ready' ];
	let before = preview(ctx, hosts, interfaces);

	if (!before.files.dhcp4.parsed && !before.files.dhcp6.parsed)
		return {
			result: false,
			mode,
			error: 'no Kea DHCP configuration to import into',
			selected: [],
			files: before.files,
			...left_over(before.entries, [])
		};

	let selected = map(filter(before.entries, entry => entry.status in wanted), entry => entry.key);

	if (mode == 'dry-run')
		return {
			result: true,
			mode,
			changed: false,
			selected,
			files: before.files,
			...left_over(before.entries, selected)
		};

	// commit() takes an empty selection for "everything ready".
	let reply = length(selected) ?
		commit(ctx, hosts, interfaces, selected) :
		{ result: true, changed: false, imported: 0, updated: 0, skipped: 0, skipped_entries: [], backups: {} };
	let after = preview(ctx, hosts, interfaces);

	return {
		...reply,
		mode,
		selected,
		files: after.files,
		...left_over(after.entries, [])
	};
};

/* ---- leases and reservations ----------------------------------------------- */

// Mark each lease of a runtime.leases() reply that Kea already reserves:
// "reserved" is true when a reservation, also a disabled one, has the
// identifier of the lease or its address. A lease marked so cannot be
// reserved from the lease lists.
export function mark_reserved(ctx, leases) {
	let env = environment(ctx, []);

	for (let family in [ 'dhcp4', 'dhcp6' ]) {
		let reservations = [];

		for (let subnet in subnets_of(env[family], family))
			push(reservations, ...reservations_of(subnet), ...disabled_of(subnet));

		for (let lease in (leases?.[family]?.items ?? [])) {
			let identifier = family == 'dhcp4' ? lc(text(lease.hwaddr)) : text(lease.duid);
			let address = family == 'dhcp4' ? lease.address : net.ipv6_canonical(text(lease.address));

			lease.reserved = length(filter(reservations, reservation =>
				(identifier != '' && same_identifier(family, reservation, identifier)) ||
				(address != null && holds_address(family, reservation, address)))) > 0;
		}
	}

	return leases;
};

// Reserve the address of a lease for its client: the "Reserve IP" button of
// the lease lists. request: { family, identifier (MAC address or DUID),
// address, hostname }. It goes the way of a static lease through the
// import, with its checks: the address has to be in a Kea subnet, and
// neither the client nor the address may be reserved already.
//
// Returns { result, family, warnings, backups }, or { result: false,
// error }. Kea is not reloaded.
export function reserve(ctx, interfaces, request) {
	let family = request?.family;

	if (!(family in [ 'dhcp4', 'dhcp6' ]))
		return { result: false, error: 'invalid family' };

	if (type(request.identifier) != 'string' || type(request.address) != 'string')
		return { result: false, error: 'an identifier and an address are needed' };

	let host = { '.name': 'lease', name: text(request.hostname), ip: request.address };

	if (family == 'dhcp4')
		host.mac = [ request.identifier ];
	else
		host.duid = [ request.identifier ];

	return config.locked(ctx, () => {
		let entries = classify_all([ host ], environment(ctx, interfaces));
		let entry = filter(entries, candidate => candidate.family == family)[0];

		if (!entry)
			return { result: false, error: 'not an address of this protocol' };

		if (entry.status != 'ready')
			return { result: false, error: entry.notes[0] ?? entry.status };

		let reply = commit_unlocked(ctx, [ host ], interfaces, [ entry.key ]);

		if (!reply.result)
			return reply;

		return {
			result: true,
			family,
			backups: reply.backups,
			warnings: config.warnings(ctx, family, fs.readfile(config.path(ctx, family)) ?? '')
		};
	});
};

/* ---- the leases of dnsmasq ------------------------------------------------- */

// A lease file of dnsmasq larger than this is not read: it would hold
// rpcd for long. dnsmasq writes well under 1 KiB per lease.
const MAX_LEASE_FILE = 4 * 1024 * 1024;

// The text of a lease file of dnsmasq: { content }, null when there is no
// such file, or { error } for one that is not a plain file (a pipe would
// block the reader) or is too large.
export function read_lease_file(path) {
	let stat = fs.stat(path);

	if (!stat)
		return { content: null };

	if (stat.type != 'file')
		return { error: path + ' is not a plain file' };

	let too_large = sprintf('%s is larger than %d bytes', path, MAX_LEASE_FILE);

	if (stat.size > MAX_LEASE_FILE)
		return { error: too_large };

	// Read one byte more than allowed: the file may have grown meanwhile.
	let content = fs.readfile(path, MAX_LEASE_FILE + 1);

	if (content == null)
		return { error: 'cannot read ' + path };

	return length(content) > MAX_LEASE_FILE ? { error: too_large } : { content };
};

// Hand the leases dnsmasq has given out to a running kea-dhcp4, so that its
// clients keep their addresses when Kea takes over. "content" is the text
// of dnsmasq's lease file: one lease per line, "expiry mac ip hostname
// client-id", "*" for an unknown name or client ID, expiry 0 for a lease
// without end. "now" is the time to count from.
//
// Each lease that has not run out and whose address is in a DHCPv4 subnet
// of Kea goes in with lease4-add, which needs the lease commands hook. Kea
// refuses an address it has leased already; that lease is skipped with its
// answer.
//
// Returns { result, added, skipped: [ { address, reason } ] } or, when Kea
// does not answer, { result: false, reason: "kea-not-running" }.
export function move_leases(ctx, content, now) {
	let status = runtime.control(ctx, 'dhcp4', 'status-get');

	if (status.error || status.result != 0)
		return { result: false, reason: 'kea-not-running', added: 0, skipped: [] };

	let root = parse(fs.readfile(config.path(ctx, 'dhcp4')) ?? '').config?.Dhcp4;
	let subnets = [ ...subnets_of({ Dhcp4: root }, 'dhcp4') ];

	for (let network in (type(root?.['shared-networks']) == 'array' ? root['shared-networks'] : []))
		for (let subnet in (type(network?.subnet4) == 'array' ? network.subnet4 : []))
			if (type(subnet) == 'object')
				push(subnets, subnet);

	let reply = { result: true, added: 0, skipped: [] };

	for (let line in split(content ?? '', '\n')) {
		let fields = split(trim(line), /[ \t]+/);

		if (length(fields) < 3 || trim(line) == '' || net.ipv4_to_int(fields[2]) == null)
			continue;

		let expiry = +fields[0];
		let address = fields[2];
		let subnet = filter(subnets, candidate => net.ip_in_subnet(address, text(candidate.subnet)))[0];

		if (!(expiry > now)) {
			push(reply.skipped, { address, reason: expiry == 0 ? 'the lease has no end; Kea is given none such' : 'the lease has run out' });
			continue;
		}

		if (!subnet || subnet.id == null) {
			push(reply.skipped, { address, reason: 'the address is in no DHCPv4 subnet of Kea' });
			continue;
		}

		let lease = {
			'ip-address': address,
			'hw-address': lc(fields[1]),
			'subnet-id': subnet.id,
			'valid-lft': expiry - now,
			expire: expiry
		};

		if (fields[3] != null && fields[3] != '*' && valid_hostname(fields[3]))
			lease.hostname = fields[3];

		if (fields[4] != null && fields[4] != '*')
			lease['client-id'] = lc(fields[4]);

		let answer = runtime.control(ctx, 'dhcp4', { command: 'lease4-add', arguments: lease });

		if (answer.result == 0) {
			reply.added++;
		}
		else if (answer.result == 2) {
			reply.result = false;
			reply.reason = 'the lease commands hook of Kea is not loaded';
			break;
		}
		else {
			push(reply.skipped, { address, reason: text(answer.text) || text(answer.error) || 'refused by Kea' });
		}
	}

	return reply;
};
