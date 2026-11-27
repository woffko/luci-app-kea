// SPDX-License-Identifier: Apache-2.0

'use strict';

import * as fs from 'fs';
import * as config from 'luci.kea.config';
import * as jsonc from 'luci.kea.jsonc';
import * as net from 'luci.kea.net';

// What Kea is doing right now: its version, its messages in the system log,
// the leases it has given out, and what a running daemon says about itself.
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

// The ucode module for sockets is a package of its own. Without it the
// daemons cannot be asked, and their state is reported as unknown.
let socket = null;

try {
	socket = require('socket');
}
catch (e) {
}

// A daemon gets this long, in milliseconds, to accept a connection on its
// control socket and again to answer. The plugin runs inside rpcd, which
// must not wait for a daemon that hangs.
const CONTROL_TIMEOUT = 1500;

// More than any reply read here; a reply that long is cut off.
const CONTROL_MAX = 262144;

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

// A line of the system log -> { time, daemon, severity, text }. Kea's
// messages arrive there in two shapes. Written to syslog by Kea itself:
//
//   Fri Nov 13 03:36:22 2026 local0.info kea-dhcp6: INFO  [kea-dhcp6.dhcp6.1405]
//   DHCP6_STARTED ...
//
// Printed by the daemon and passed on by procd, which is how the lines
// before the loggers are set up arrive, and everything when a logger writes
// to the standard output. Kea then puts its own time in front:
//
//   Thu Nov 19 17:07:07 2026 daemon.info kea-dhcp4[4019]: 2026-11-19
//   17:07:07.396 INFO  [kea-dhcp4.dhcp4/4019.1403] DHCP4_STARTING ...
//
// The severity is Kea's, not the level procd logged the line with. A line
// of another shape is returned as text only.
export function parse_log_line(line) {
	let m = match(line, /^(\S+ +\S+ +[0-9]+ +[0-9:]+ +[0-9]+) +\S+ +(kea-[a-z0-9-]+)(\[[0-9]+\])?: +(.*)$/);

	if (!m)
		return { time: '', daemon: '', severity: '', text: line };

	let body = match(m[4], /^([0-9-]+ +[0-9:.]+ +)?([A-Z]+) +\[[^\]]*\] +(.*)$/);

	return {
		time: m[1],
		daemon: m[2],
		severity: body ? body[2] : '',
		text: body ? body[3] : m[4]
	};
};

// Where each installed daemon writes its log, from its configuration:
// { name: [ output, ... ] }, see config.log_outputs().
function log_outputs(ctx) {
	let outputs = {};

	for (let name in config.CONFIG_ORDER) {
		let file = config.path(ctx, name);

		if (fs.access(config.binary(ctx, name), 'x') && config.is_file(file))
			outputs[name] = config.log_outputs(ctx, name, fs.readfile(file));
	}

	return outputs;
}

// The last Kea messages in the system log, oldest first, and where the
// daemons are configured to write their log: not everything goes to the
// system log.
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
			return { result: false, error: 'failed to read the system log', lines: [], outputs: {} };

		text = pipe.read('all') ?? '';
		pipe.close();
	}

	// Kea logs what it could not read in its configuration, also a password.
	text = config.mask_known(ctx, text);

	let lines = filter(split(text, '\n'), line => line != '' && match(line, regexp(LOG_PATTERN)));

	return {
		result: true,
		lines: map(slice(lines, max(0, length(lines) - count)), parse_log_line),
		outputs: log_outputs(ctx)
	};
};

// ---- control socket ---------------------------------------------------------

// Send one command to a daemon over the control socket named in its
// configuration: a name, or { command, arguments }. Returns the reply of
// the daemon, an object with "result",
// or { error } with "no-socket-module", "no-control-socket",
// "connect-failed" or "no-reply".
export function control(ctx, name, command) {
	if (ctx.control)
		return ctx.control(name, command);

	if (!socket)
		return { error: 'no-socket-module' };

	let path = config.control_socket(ctx, name, fs.readfile(config.path(ctx, name)));

	if (!path)
		return { error: 'no-control-socket' };

	let conn = socket.connect({ path }, null, null, CONTROL_TIMEOUT);

	if (!conn)
		return { error: 'connect-failed' };

	conn.send(sprintf('%J', type(command) == 'object' ? command : { command }));

	// Kea closes the connection after its reply.
	let text = '';

	while (length(text) < CONTROL_MAX) {
		let events = socket.poll(CONTROL_TIMEOUT, conn);

		if (!(events?.[0]?.[1]))
			break;

		let chunk = conn.recv(65536);

		if (chunk == null || !length(chunk))
			break;

		text += chunk;
	}

	conn.close();

	let reply = null;

	try {
		reply = json(text);
	}
	catch (e) {
	}

	return type(reply) == 'object' ? reply : { error: 'no-reply' };
};

function flag(value) {
	return value == true;
}

function word(value) {
	return type(value) == 'string' ? value : '';
}

// The reply of a DHCP daemon to "status-get", reduced to what the pages
// show: whether its sockets are open, and the state of high availability.
// Shapes as Kea 3.0.4 sends them.
//
// Returns { reachable: false, reason } or
// { reachable: true, uptime, serving,
//   sockets: { status, errors },          "ready", "retrying" or "failed"
//   ha: [ { mode, local: { name, role, state },
//           remote: { name, role, state, in_touch, interrupted, age } } ] }
export function daemon_state(reply) {
	if (type(reply) != 'object' || reply.result != 0 || type(reply.arguments) != 'object')
		return { reachable: false, reason: word(reply?.error) || 'refused' };

	let args = reply.arguments;
	let sockets = type(args.sockets) == 'object' ? args.sockets : {};
	let ha = [];

	for (let relation in (type(args['high-availability']) == 'array' ? args['high-availability'] : [])) {
		let servers = type(relation) == 'object' ? relation['ha-servers'] : null;
		let local = type(servers?.local) == 'object' ? servers.local : {};
		let remote = type(servers?.remote) == 'object' ? servers.remote : {};

		push(ha, {
			mode: word(relation?.['ha-mode']),
			local: {
				name: word(local['server-name']),
				role: word(local.role),
				state: word(local.state)
			},
			remote: {
				name: word(remote['server-name']),
				role: word(remote.role),
				state: word(remote['last-state']),
				in_touch: flag(remote['in-touch']),
				interrupted: flag(remote['communication-interrupted']),
				age: +remote.age || 0
			}
		});
	}

	return {
		reachable: true,
		uptime: +args.uptime || 0,
		// A daemon can be told to stop answering while it runs.
		serving: !flag(args['dhcp-state']?.['globally-disabled']),
		sockets: {
			status: word(sockets.status),
			errors: filter(type(sockets.errors) == 'array' ? sockets.errors : [], item => type(item) == 'string')
		},
		ha
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

// The top-level object of the daemon's configuration, or null.
function family_root(ctx, family) {
	let parsed = jsonc.parse(fs.readfile(config.path(ctx, family)) ?? '');
	let root = type(parsed.config) == 'object' ? parsed.config[FAMILIES[family].root] : null;

	return type(root) == 'object' ? root : null;
}

// Where the daemon keeps its leases, from its configuration.
function lease_database(root) {
	let database = root?.['lease-database'];

	return type(database) == 'object' ? database : {};
}

// The subnets of the configuration by their id: { "<id>": { subnet,
// interface } }, also those of a shared network, which may name the
// interface for all of its subnets. A lease names its subnet by the id.
export function subnet_index(family, root) {
	let key = family == 'dhcp4' ? 'subnet4' : 'subnet6';
	let index = {};
	let add = (subnets, network) => {
		for (let subnet in (type(subnets) == 'array' ? subnets : []))
			if (type(subnet) == 'object' && subnet.id != null)
				index[`${subnet.id}`] = {
					subnet: `${subnet.subnet ?? ''}`,
					interface: `${subnet.interface ?? network?.interface ?? ''}`
				};
	};

	if (type(root) != 'object')
		return index;

	add(root[key], null);

	for (let network in (type(root['shared-networks']) == 'array' ? root['shared-networks'] : []))
		if (type(network) == 'object')
			add(network[key], network);

	return index;
};

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
	let root = family_root(ctx, family);
	let database = lease_database(root);
	let dbtype = database.type ?? 'memfile';
	let name = type(database.name) == 'string' && database.name != '' ? database.name : FAMILIES[family].file;
	let file = index(name, '/') == 0 ? ctx.root + name : ctx.lease_dir + '/' + name;
	// "note" is set when there is nothing to read: "no-memfile",
	// "no-persist" or "too-large".
	let reply = { file, exists: false, count: 0, truncated: false, items: [], subnets: subnet_index(family, root) };

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
