// SPDX-License-Identifier: Apache-2.0

'use strict';

import * as fs from 'fs';
import * as config from 'luci.kea.config';
import * as jsonc from 'luci.kea.jsonc';
import * as net from 'luci.kea.net';

// What Kea is doing right now: its version, its messages in the system log
// and the leases it has given out.
//
// Leases are read from the files of the memfile backend, the only lease
// backend the OpenWrt Kea packages are built with. Reading the files needs
// no hook library and no control socket, and it works while the daemon is
// stopped. The format and the order of the files follow Kea 3.0.4
// (memfile_lease_mgr.cc, csv_file.cc).

const FAMILIES = {
	dhcp4: { root: 'Dhcp4', file: 'kea-leases4.csv', key: [ 'address' ] },
	dhcp6: { root: 'Dhcp6', file: 'kea-leases6.csv', key: [ 'address', 'lease_type' ] }
};

// Lease states as Kea numbers them. A lease that was reclaimed or released
// is not in use.
const STATES = { '0': 'active', '1': 'declined', '4': 'registered' };

const LEASE_TYPES = { '0': 'address', '1': 'temporary', '2': 'prefix' };

// A lease file larger than this is not read: it would block rpcd.
const MAX_FILE_SIZE = 8 * 1024 * 1024;

// At most this many leases are returned per protocol.
const MAX_LEASES = 2000;

const LOG_PATTERN = 'kea-(dhcp4|dhcp6|dhcp-ddns|ctrl-agent|lfc)';

function now(ctx) {
	return ctx.clock ? ctx.clock() : time();
}

// ---- version ----------------------------------------------------------------

// The version of the installed Kea, asked from the first daemon found.
export function version(ctx) {
	for (let name in config.CONFIG_ORDER) {
		let bin = config.binary(ctx, name);

		if (!fs.access(bin, 'x'))
			continue;

		let pipe = fs.popen(config.shellquote(bin) + ' -v 2>/dev/null', 'r');

		if (!pipe)
			continue;

		let output = trim(pipe.read('all') ?? '');

		if (pipe.close() == 0 && match(output, /^[0-9][0-9A-Za-z.+~-]*$/))
			return output;
	}

	return null;
};

// ---- system log -------------------------------------------------------------

// "Fri Nov 13 03:36:22 2026 local0.info kea-dhcp6: INFO  [kea-dhcp6.dhcp6.1405]
// DHCP6_STARTED ..." -> { time, daemon, severity, text }. A line of another
// shape is returned as text only.
export function parse_log_line(line) {
	let m = match(line, /^(\S+ +\S+ +[0-9]+ +[0-9:]+ +[0-9]+) +\S+ +(kea-[a-z0-9-]+)(\[[0-9]+\])?: +(.*)$/);

	if (!m)
		return { time: '', daemon: '', severity: '', text: line };

	let body = match(m[4], /^([A-Z]+) +\[[^\]]*\] +(.*)$/);

	return {
		time: m[1],
		daemon: m[2],
		severity: body ? body[1] : '',
		text: body ? body[2] : m[4]
	};
};

// The last Kea messages in the system log, oldest first.
export function log(ctx, count) {
	count = +count;

	if (!(count >= 1))
		count = 30;

	if (count > 200)
		count = 200;

	let text;

	if (ctx.log_reader) {
		text = ctx.log_reader();
	}
	else {
		// "logread -l" counts before it filters, so the tail is taken here.
		// Its "-e" takes a basic regular expression, without alternatives;
		// the exact pattern is applied below.
		let pipe = fs.popen('logread -e kea- 2>/dev/null', 'r');

		if (!pipe)
			return { result: false, error: 'failed to read the system log', lines: [] };

		text = pipe.read('all') ?? '';
		pipe.close();
	}

	let lines = filter(split(text, '\n'), line => line != '' && match(line, regexp(LOG_PATTERN)));

	return {
		result: true,
		lines: map(slice(lines, max(0, length(lines) - count)), parse_log_line)
	};
};

// ---- leases -----------------------------------------------------------------

// Kea writes a comma inside a value as "&#x2c".
function unescape(value) {
	if (index(value, '&#x') < 0)
		return value;

	return replace(value, /&#x([0-9a-fA-F]{2})/g, (m, digits) => chr(hex(digits)));
}

// The rows of a lease file as objects keyed by the names in its header.
export function parse_csv(text) {
	let lines = split(text ?? '', '\n');
	let header = split(trim(lines[0] ?? ''), ',');
	let rows = [];

	if (length(header) < 2 || header[0] != 'address')
		return rows;

	for (let i = 1; i < length(lines); i++) {
		let line = trim(lines[i]);

		if (line == '')
			continue;

		let cells = split(line, ',');

		// A row cut short by a write in progress is not a lease.
		if (length(cells) != length(header))
			continue;

		let row = {};

		for (let j = 0; j < length(header); j++)
			row[header[j]] = unescape(cells[j]);

		push(rows, row);
	}

	return rows;
};

function lease4(row, state) {
	return {
		address: row.address,
		hwaddr: row.hwaddr ?? '',
		client_id: row.client_id ?? '',
		hostname: row.hostname ?? '',
		subnet_id: +row.subnet_id,
		valid_lifetime: +row.valid_lifetime,
		expires: +row.expire,
		state
	};
}

function lease6(row, state) {
	return {
		address: row.address,
		prefix_len: +row.prefix_len,
		type: LEASE_TYPES[row.lease_type] ?? 'address',
		duid: row.duid ?? '',
		iaid: +row.iaid,
		hwaddr: row.hwaddr ?? '',
		// Kea stores the name with the dot of the DNS root.
		hostname: rtrim(row.hostname ?? '', '.'),
		subnet_id: +row.subnet_id,
		preferred_lifetime: +row.pref_lifetime,
		valid_lifetime: +row.valid_lifetime,
		expires: +row.expire,
		state
	};
}

function address_order(family, a, b) {
	if (a.subnet_id != b.subnet_id)
		return a.subnet_id - b.subnet_id;

	if (family == 'dhcp4')
		return (net.ipv4_to_int(a.address) ?? 0) - (net.ipv4_to_int(b.address) ?? 0);

	let x = net.ipv6_bytes(a.address) ?? [];
	let y = net.ipv6_bytes(b.address) ?? [];

	for (let i = 0; i < 16; i++)
		if (x[i] != y[i])
			return (x[i] ?? 0) - (y[i] ?? 0);

	return 0;
}

// The leases in use at the time "at", from the texts of the lease files in
// the order Kea reads them. A lease file is a journal: the last row for an
// address is the one that counts.
export function collect(family, texts, at) {
	let keys = FAMILIES[family].key;
	let latest = {};

	for (let text in texts)
		for (let row in parse_csv(text))
			latest[join('/', map(keys, name => row[name]))] = row;

	let leases = [];

	for (let key, row in latest) {
		let state = STATES[row.state];

		if (!state || !(+row.valid_lifetime > 0) || !(+row.expire > at))
			continue;

		push(leases, family == 'dhcp4' ? lease4(row, state) : lease6(row, state));
	}

	return sort(leases, (a, b) => address_order(family, a, b));
};

// Where the daemon keeps its leases, from its configuration.
function lease_database(ctx, family) {
	let parsed = jsonc.parse(fs.readfile(config.path(ctx, family)) ?? '');
	let root = type(parsed.config) == 'object' ? parsed.config[FAMILIES[family].root] : null;
	let database = type(root) == 'object' ? root['lease-database'] : null;

	return type(database) == 'object' ? database : {};
}

// The lease files of one protocol in the order Kea loads them: the result
// of the last cleanup, or its inputs if it did not finish, then the file
// the daemon is writing.
function lease_files(file) {
	let files = [];

	if (config.is_file(file + '.completed')) {
		push(files, file + '.completed');
	}
	else {
		for (let suffix in [ '.2', '.1' ])
			if (config.is_file(file + suffix))
				push(files, file + suffix);
	}

	if (config.is_file(file))
		push(files, file);

	return files;
}

function family_leases(ctx, family) {
	let database = lease_database(ctx, family);
	let dbtype = database.type ?? 'memfile';
	let name = type(database.name) == 'string' && database.name != '' ? database.name : FAMILIES[family].file;
	let file = index(name, '/') == 0 ? ctx.root + name : ctx.lease_dir + '/' + name;
	// "note" is set when there is nothing to read: "no-memfile",
	// "no-persist" or "too-large".
	let reply = { file, exists: false, count: 0, truncated: false, items: [] };

	if (dbtype != 'memfile') {
		reply.note = 'no-memfile';
		return reply;
	}

	if (database.persist === false) {
		reply.note = 'no-persist';
		return reply;
	}

	let files = lease_files(file);
	let texts = [];

	reply.exists = length(files) > 0;

	for (let path in files) {
		if ((fs.stat(path)?.size ?? 0) > MAX_FILE_SIZE) {
			reply.note = 'too-large';
			return reply;
		}

		push(texts, fs.readfile(path) ?? '');
	}

	let leases = collect(family, texts, now(ctx));

	reply.count = length(leases);
	reply.truncated = reply.count > MAX_LEASES;
	reply.items = reply.truncated ? slice(leases, 0, MAX_LEASES) : leases;

	return reply;
}

export function leases(ctx) {
	return {
		time: now(ctx),
		dhcp4: family_leases(ctx, 'dhcp4'),
		dhcp6: family_leases(ctx, 'dhcp6')
	};
};
