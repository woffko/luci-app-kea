// SPDX-License-Identifier: Apache-2.0

'use strict';

import * as fs from 'fs';
import * as net from 'luci.kea.net';
import * as config from 'luci.kea.config';
import { stringify, parse } from 'luci.kea.jsonc';
import { text, uci_bool } from 'luci.kea.openwrt';

// A Kea DHCPv4 configuration made from what dnsmasq is set up to serve, for
// a router that moves from dnsmasq to Kea: by the command
// /usr/libexec/luci-app-kea/setup-from-dnsmasq, which ha-cluster runs when
// a cluster switches to Kea, and by the Setup page.
//
// plan() is pure: it takes the sections of /etc/config/dhcp and
// /etc/config/network, the reply of "ha-cluster nodes" if any, and which
// hooks are installed. run() looks at the file, and writes it only when it
// is missing or still the sample the Kea package installed. A file someone
// has changed is replaced only when the user of the Setup page asks for it
// after a confirmation ("replace"); the command never does that.

// dnsmasq's defaults on OpenWrt.
const DEFAULT_START = 100;
const DEFAULT_LIMIT = 150;
const DEFAULT_LEASETIME = '12h';

// What high availability gets, as on the bench of the ha-cluster project.
const HA_PORT = 8001;
const HA_TIMERS = {
	'heartbeat-delay': 3000,
	'max-response-delay': 10000,
	'max-ack-delay': 3000,
	'max-unacked-clients': 0
};

// The options of dnsmasq ("dhcp_option" of a pool) that have a Kea
// counterpart here, by number and by dnsmasq's name.
const OPTIONS = {
	'3': 'routers', 'router': 'routers',
	'6': 'domain-name-servers', 'dns-server': 'domain-name-servers',
	'15': 'domain-name', 'domain-name': 'domain-name',
	'42': 'ntp-servers', 'ntp-server': 'ntp-servers',
	'44': 'netbios-name-servers', 'netbios-ns': 'netbios-name-servers',
	'119': 'domain-search', 'domain-search': 'domain-search'
};

// Options whose values are IPv4 addresses. dnsmasq reads 0.0.0.0 there as
// "the address of this server".
const ADDRESS_OPTIONS = [ 'routers', 'domain-name-servers', 'ntp-servers', 'netbios-name-servers' ];

// The order the options are written in.
const OPTION_ORDER = [ 'routers', 'domain-name-servers', 'domain-name', 'domain-search', 'ntp-servers', 'netbios-name-servers' ];

// Where the package keeps the file; the database of apk names it so.
const PACKAGE_FILE = 'etc/kea/kea-dhcp4.conf';

// "12h" -> 43200. dnsmasq takes seconds, or m, h, d and w. null for
// anything else, "infinite" included.
export function lease_seconds(value) {
	let m = match(text(value) || DEFAULT_LEASETIME, /^([0-9]+)([smhdw]?)$/);

	if (!m || +m[1] <= 0)
		return null;

	return +m[1] * ({ '': 1, s: 1, m: 60, h: 3600, d: 86400, w: 604800 })[m[2]];
};

// The first static IPv4 address of an interface of /etc/config/network:
// { address, network } with the network as "192.168.1.0/24", or null.
function interface_ipv4(section) {
	if (text(section?.proto) != 'static')
		return null;

	for (let cidr in split(net.interface_addresses(section.ipaddr, section.netmask), ' ')) {
		let parts = split(cidr, '/');

		if (length(parts) != 2 || net.ipv4_to_int(parts[0]) == null || !match(parts[1], /^[0-9]+$/) ||
		    +parts[1] < 8 || +parts[1] > 30)
			continue;

		let range = net.parse_cidr(cidr);

		return { address: parts[0], network: net.int_to_ipv4(range.first) + '/' + parts[1], range };
	}

	return null;
}

// The address pool of a dnsmasq pool: start and limit count from the
// network address, and the pool ends before the broadcast address, as
// dnsmasq has it. { pool } with null for a pool that gives no dynamic
// addresses, or { why }.
function pool_of(section, ipv4) {
	if (text(section.dynamicdhcp) != '' && !uci_bool(section.dynamicdhcp, true))
		return { pool: null };

	let start = text(section.start) != '' ? text(section.start) : `${DEFAULT_START}`;
	let limit = text(section.limit) != '' ? text(section.limit) : `${DEFAULT_LIMIT}`;

	if (!match(start, /^[0-9]+$/) || !match(limit, /^[0-9]+$/) || +limit < 1)
		return { why: 'start or limit of the pool is not a number' };

	let first = ipv4.range.first + +start;
	let last = min(first + +limit - 1, ipv4.range.last - 1);

	if (+start < 1 || first > ipv4.range.last - 1)
		return { why: 'the pool lies outside the network of the interface' };

	return { pool: net.int_to_ipv4(first) + ' - ' + net.int_to_ipv4(last) };
}

// The options of a dnsmasq pool that translate: { name: data }. What does
// not translate is added to "left".
function translate_options(list, own, label, left) {
	let result = {};

	for (let entry in (type(list) == 'array' ? list : (text(list) != '' ? [ list ] : []))) {
		let fields = map(split(text(entry), ','), field => trim(field));
		let key = fields[0];

		if (match(key, /^(tag|encap|vendor|vi-encap|net|tag-if):/)) {
			push(left, { what: label + ': ' + entry, why: 'a tagged or vendor option of dnsmasq is not carried over' });
			continue;
		}

		if (index(key, 'option:') == 0)
			key = substr(key, 7);

		let name = OPTIONS[key];
		let values = slice(fields, 1);

		if (!name || !length(values) || values[0] == '') {
			push(left, { what: label + ': ' + entry, why: 'no Kea option is made from this one here' });
			continue;
		}

		if (name in ADDRESS_OPTIONS) {
			values = map(values, value => value == '0.0.0.0' ? own : value);

			if (length(filter(values, value => net.ipv4_to_int(value) == null))) {
				push(left, { what: label + ': ' + entry, why: 'not a list of IPv4 addresses' });
				continue;
			}
		}

		result[name] = join(', ', values);
	}

	return result;
}

// The URL of a peer, with an IPv6 address in brackets.
function peer_url(address) {
	return 'http://' + (index(address, ':') >= 0 ? '[' + address + ']' : address) + ':' + HA_PORT + '/';
}

// The relationship of high availability for the nodes of a cluster, or null.
function relationship(cluster, left) {
	let node = cluster?.node;
	let peers = filter(type(cluster?.peers) == 'array' ? cluster.peers : [],
		peer => type(peer) == 'object' && peer.vrrp_only != true && text(peer.name) != '' && text(peer.address) != '');

	if (type(node) != 'object' || text(node.name) == '' || text(node.address) == '' || !length(peers))
		return null;

	let members = [ node, ...peers ];
	let roles = map(members, member => text(member.kea_role));

	if (length(filter(roles, role => role == 'primary')) != 1 || length(filter(roles, role => role == 'standby')) != 1 ||
	    length(filter(roles, role => !(role in [ 'primary', 'standby', 'backup' ]))) > 0) {
		push(left, { what: 'high availability', why: 'ha-cluster names no primary and one standby for Kea (kea_role)' });
		return null;
	}

	return {
		'this-server-name': node.name,
		mode: 'hot-standby',
		...HA_TIMERS,
		peers: map(members, member => ({ name: member.name, url: peer_url(member.address), role: member.kea_role }))
	};
}

// The interfaces to serve: those ha-cluster names as the DHCP interfaces of
// the cluster, otherwise every pool of /etc/config/dhcp that dnsmasq or
// odhcpd serves DHCPv4 on. ha-cluster switches the pools off when it moves
// to Kea, so for its interfaces a pool counts whatever its "dhcpv4" says.
function chosen(input, left) {
	let pools = {};
	let networks = {};
	let result = [];

	for (let section in (input.dhcp ?? []))
		if (text(section.interface) != '' && !pools[section.interface])
			pools[section.interface] = section;

	for (let section in (input.network ?? []))
		networks[section['.name']] = section;

	let given = input.cluster?.dhcp_interfaces;

	if (type(given) == 'array' && length(given)) {
		for (let entry in given) {
			let name = text(entry?.interface);

			if (name == '')
				continue;

			push(result, {
				interface: name,
				device: text(entry.device),
				vip4: filter(type(entry.vip4) == 'array' ? entry.vip4 : [], address => net.ipv4_to_int(address) != null),
				pool: pools[name],
				network: networks[name]
			});
		}
	}
	else {
		for (let name, section in pools) {
			if (uci_bool(section.ignore, false) || text(section.dhcpv4) == 'disabled')
				continue;

			push(result, { interface: name, device: '', vip4: [], pool: section, network: networks[name] });
		}
	}

	return result;
}

// Make the configuration. input: { dhcp: [sections], dnsmasq: [sections],
// network: [interface sections], cluster: reply of "ha-cluster nodes" or
// null, hooks: { dir, lease_cmds, ha, run_script, dns_hosts }, scripts_dir }.
//
// Returns { config, subnets: [ { subnet, interface, device, pool } ],
// ha: { this, peers } or null, left: [ { what, why } ] }; config is null
// when no interface can be served.
export function plan(input) {
	let left = [];
	let subnets = [];
	let served = [];
	let devices = [];
	let domain = '';

	for (let section in (input.dnsmasq ?? []))
		if (domain == '' && text(section.domain) != '')
			domain = text(section.domain);

	for (let item in chosen(input, left)) {
		let label = item.interface;

		if (!item.pool) {
			push(left, { what: label, why: 'no DHCP pool for this interface in /etc/config/dhcp' });
			continue;
		}

		if (uci_bool(item.pool.ignore, false)) {
			push(left, { what: label, why: 'dnsmasq is told to ignore this interface' });
			continue;
		}

		let ipv4 = interface_ipv4(item.network);

		if (!ipv4) {
			push(left, { what: label, why: 'the interface has no static IPv4 address with a prefix in /etc/config/network' });
			continue;
		}

		let device = item.device != '' ? item.device : (text(item.network.device) || text(item.network.ifname));

		if (device == '' || index(device, '@') == 0 || index(device, ' ') >= 0) {
			push(left, { what: label, why: 'the device of the interface is not known' });
			continue;
		}

		let pool = pool_of(item.pool, ipv4);

		if (pool.why) {
			push(left, { what: label, why: pool.why });
			continue;
		}

		let seconds = lease_seconds(item.pool.leasetime);

		if (seconds == null) {
			push(left, { what: label + ': leasetime ' + text(item.pool.leasetime), why: 'not a lease time Kea is given here; 12 hours are used' });
			seconds = lease_seconds(DEFAULT_LEASETIME);
		}

		let own = length(item.vip4) ? item.vip4[0] : ipv4.address;
		let options = translate_options(item.pool.dhcp_option, own, label, left);

		if (!options['routers'])
			options['routers'] = own;

		if (!options['domain-name-servers'])
			options['domain-name-servers'] = own;

		if (!options['domain-name'] && domain != '')
			options['domain-name'] = domain;

		if (length(item.pool.dhcp_option_force ?? []))
			push(left, { what: label + ': dhcp_option_force', why: 'options dnsmasq sends unasked are not carried over' });

		let subnet = {
			id: length(subnets) + 1,
			subnet: ipv4.network,
			interface: device,
			'valid-lifetime': seconds,
			'renew-timer': int(seconds / 2),
			'rebind-timer': int(seconds * 7 / 8),
			pools: pool.pool ? [ { pool: pool.pool } ] : [],
			'option-data': map(filter(OPTION_ORDER, name => options[name] != null), name => ({ name, data: options[name] }))
		};

		push(subnets, subnet);
		push(served, { subnet: ipv4.network, interface: label, device, pool: pool.pool });

		// Kea listens on the device with this address only. Named without an
		// address, it opens a socket for every IPv4 address of the device,
		// and on a node of a cluster the virtual addresses are among them:
		// measured with three addresses, each request of a client was taken
		// three times and the ACK sent three times. The address is the
		// node's own, from /etc/config/network, which stays on the node.
		let listen = device + '/' + ipv4.address;

		if (!(listen in devices))
			push(devices, listen);
	}

	let hooks = input.hooks ?? {};
	let dir = text(hooks.dir) || '/usr/lib/kea/hooks';
	let ha = input.cluster ? relationship(input.cluster, left) : null;
	let libraries = [];

	if (hooks.lease_cmds)
		push(libraries, { library: dir + '/libdhcp_lease_cmds.so' });
	else
		push(left, { what: 'kea-hook-lease-cmds', why: 'not installed: the leases of dnsmasq cannot be moved into Kea' });

	if (ha && !(hooks.ha && hooks.lease_cmds)) {
		push(left, { what: 'high availability', why: 'kea-hook-ha and kea-hook-lease-cmds are needed' });
		ha = null;
	}

	if (ha)
		push(libraries, { library: dir + '/libdhcp_ha.so', parameters: { 'high-availability': [ ha ] } });

	if (hooks.run_script && hooks.dns_hosts)
		push(libraries, {
			library: dir + '/libdhcp_run_script.so',
			parameters: { name: (input.scripts_dir ?? '/usr/share/kea/scripts') + '/kea-dnsmasq-hosts', sync: false }
		});

	let summary = {
		subnets: served,
		ha: ha ? { this: ha['this-server-name'], peers: map(ha.peers, peer => peer.name) } : null,
		left
	};

	if (!length(subnets))
		return { config: null, ...summary };

	let root = {
		'interfaces-config': {
			interfaces: devices,
			'service-sockets-max-retries': 60,
			'service-sockets-retry-wait-time': 2000
		},
		'control-socket': { 'socket-type': 'unix', 'socket-name': 'kea4-ctrl-socket' },
		'lease-database': { type: 'memfile', 'lfc-interval': 3600 },
		'subnet4': subnets
	};

	if (length(libraries))
		root['hooks-libraries'] = libraries;

	root.loggers = [ { name: 'kea-dhcp4', 'output-options': [ { output: 'syslog' } ], severity: 'INFO' } ];

	return { config: { Dhcp4: root }, ...summary };
};

// ---- the file on the router ----------------------------------------------

// Whether the package database of apk lists the file as one of the Kea
// DHCPv4 package. The text of /lib/apk/db/installed names a directory with
// "F:" and its files with "R:".
function owned_by_package(ctx) {
	let db = fs.readfile(ctx.apk_db);
	let dir = null;

	for (let line in split(db ?? '', '\n')) {
		if (index(line, 'F:') == 0)
			dir = substr(line, 2);
		else if (index(line, 'R:') == 0 && dir + '/' + substr(line, 2) == PACKAGE_FILE)
			return true;
		else if (line == '')
			dir = null;
	}

	return false;
}

// What "apk audit --backup" says about the configuration directory: a line
// "U etc/kea/kea-dhcp4.conf" for a file that differs from the one the
// package installed. Null when apk failed: it then prints nothing, which
// would read as "unchanged".
function audit(ctx) {
	if (ctx.apk_audit)
		return ctx.apk_audit();

	let handle = fs.popen('apk audit --backup ' + config.shellquote(ctx.conf_dir) + ' 2>/dev/null', 'r');

	if (!handle)
		return null;

	let output = handle.read('all');

	return handle.close() == 0 ? output : null;
}

// "missing", "sample" (the file the Kea package installed, unchanged) or
// "own" (anything else, also when that cannot be told).
export function file_state(ctx) {
	if (!config.is_file(config.path(ctx, 'dhcp4')))
		return 'missing';

	if (!owned_by_package(ctx))
		return 'own';

	let report = audit(ctx);

	if (report == null)
		return 'own';

	return ('U ' + PACKAGE_FILE) in split(report, '\n') ? 'own' : 'sample';
};

// Why the DHCPv4 server is not set up yet, as a list of codes, empty when
// it seems to be: "missing", "sample", "no-interfaces", "no-subnets".
export function unconfigured(ctx) {
	let state = file_state(ctx);

	if (state != 'own')
		return [ state ];

	let root = parse(fs.readfile(config.path(ctx, 'dhcp4')) ?? '').config?.Dhcp4;
	let reasons = [];

	if (type(root) != 'object')
		return reasons;

	let interfaces = root['interfaces-config']?.interfaces;

	if (type(interfaces) != 'array' || !length(interfaces))
		push(reasons, 'no-interfaces');

	let count = length(type(root.subnet4) == 'array' ? root.subnet4 : []);

	for (let network in (type(root['shared-networks']) == 'array' ? root['shared-networks'] : []))
		count += length(type(network?.subnet4) == 'array' ? network.subnet4 : []);

	if (!count)
		push(reasons, 'no-subnets');

	return reasons;
};

// Make the configuration and write it if the file may be written.
// options: { dry_run, replace }; "replace" lets a file of the user's own be
// replaced, which only the Setup page asks for, after a confirmation. The
// file it replaces is kept as a backup either way.
//
// The reply: { result, written, reason, file, state, backup, subnets, ha,
// left } and, for a dry run, "content" and "check" (what Kea says about
// it). reason: "written", "dry-run", "own-config", "nothing-to-set-up", or
// the error.
export function run(ctx, input, options) {
	let file = config.path(ctx, 'dhcp4');
	let made = plan(input);
	let reply = {
		result: true,
		written: false,
		reason: null,
		file,
		state: file_state(ctx),
		backup: null,
		subnets: made.subnets,
		ha: made.ha,
		left: made.left
	};

	if (!made.config) {
		reply.reason = 'nothing-to-set-up';
		return reply;
	}

	let content = stringify(made.config);

	if (options?.dry_run) {
		reply.reason = 'dry-run';
		reply.content = content;
		reply.check = config.check(ctx, 'dhcp4', content);
		return reply;
	}

	return config.locked(ctx, () => {
		reply.state = file_state(ctx);

		if (reply.state == 'own' && !options?.replace) {
			reply.reason = 'own-config';
			return reply;
		}

		let saved = config.save(ctx, 'dhcp4', content);

		if (!saved.result) {
			reply.result = false;
			reply.reason = saved.error ?? 'the file could not be written';
			reply.validation = saved.validation;
			return reply;
		}

		reply.written = true;
		reply.reason = 'written';
		reply.backup = saved.backup;

		return reply;
	});
};
