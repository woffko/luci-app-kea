'use strict';

import * as fs from 'fs';
import { test, equal, ok, tmpdir, rm_rf, done } from './lib.uc';
import * as config from 'luci.kea.config';
import * as runtime from 'luci.kea.runtime';

// The lease rows below were written by Kea 3.0.4 for a test client; only
// the times were changed.

const NOW = 1794541100;
const HEAD4 = 'address,hwaddr,client_id,valid_lifetime,expire,subnet_id,fqdn_fwd,fqdn_rev,hostname,state,user_context,pool_id';
const HEAD6 = 'address,duid,valid_lifetime,expire,subnet_id,pref_lifetime,lease_type,iaid,prefix_len,fqdn_fwd,fqdn_rev,hostname,hwaddr,state,user_context,hwtype,hwaddr_source,pool_id';
const DUID = '00:03:00:01:32:3f:2f:89:b2:19';

const file4 = rows => join('\n', [ HEAD4, ...rows ]) + '\n';
const file6 = rows => join('\n', [ HEAD6, ...rows ]) + '\n';

// ---- lease files ------------------------------------------------------------

test('a lease file is read by the names in its header', () => {
	let rows = runtime.parse_csv(file4([
		'10.99.0.100,32:3f:2f:89:b2:19,01:32:3f:2f:89:b2:19,600,1794541576,99,0,0,testclient,0,,0'
	]));

	equal(length(rows), 1);
	equal(rows[0].address, '10.99.0.100');
	equal(rows[0].client_id, '01:32:3f:2f:89:b2:19');
	equal(rows[0].hostname, 'testclient');
	equal(rows[0].state, '0');
	equal(rows[0].user_context, '');
});

test('escaped commas are restored, cut rows and other files are ignored', () => {
	let rows = runtime.parse_csv(file4([
		'10.99.0.7,02:00:00:00:00:07,,600,1794541576,99,0,0,a&#x2cb,0,{ "note": "x&#x2cy" },0',
		'10.99.0.8,02:00:00:00:00:08,,600,17945'
	]));

	equal(length(rows), 1);
	equal(rows[0].hostname, 'a,b');
	equal(rows[0].user_context, '{ "note": "x,y" }');
	equal(runtime.parse_csv('not a lease file\n1,2,3\n'), []);
	equal(runtime.parse_csv(''), []);
	equal(runtime.parse_csv(null), []);
});

test('the last row for an address counts; leases not in use are left out', () => {
	let leases = runtime.collect('dhcp4', [ file4([
		// renewed later in the journal
		'10.99.0.100,32:3f:2f:89:b2:19,01:32:3f:2f:89:b2:19,600,1794541000,99,0,0,old-name,0,,0',
		'10.99.0.100,32:3f:2f:89:b2:19,01:32:3f:2f:89:b2:19,600,1794541576,99,0,0,testclient,0,,0',
		// ran out
		'10.99.0.101,02:00:00:00:00:01,,600,1794541099,99,0,0,gone,0,,0',
		// given back: lifetime 0
		'10.99.0.102,02:00:00:00:00:02,,0,1794541006,99,0,0,released,0,,0',
		// reclaimed and released states
		'10.99.0.103,02:00:00:00:00:03,,600,1794541576,99,0,0,reclaimed,2,,0',
		'10.99.0.104,02:00:00:00:00:04,,600,1794541576,99,0,0,released,3,,0',
		// declined by a client: the address is blocked for a while
		'10.99.0.9,,,86400,1794627500,99,0,0,,1,,0',
		// another subnet sorts by its ID first
		'10.20.0.5,02:00:00:00:00:05,,600,1794541576,7,0,0,relayed,0,,0'
	]) ], NOW);

	equal(map(leases, lease => [ lease.address, lease.state, lease.hostname ]), [
		[ '10.20.0.5', 'active', 'relayed' ],
		[ '10.99.0.9', 'declined', '' ],
		[ '10.99.0.100', 'active', 'testclient' ]
	]);
	equal(leases[2], {
		address: '10.99.0.100',
		hwaddr: '32:3f:2f:89:b2:19',
		client_id: '01:32:3f:2f:89:b2:19',
		hostname: 'testclient',
		subnet_id: 99,
		valid_lifetime: 600,
		expires: 1794541576,
		state: 'active'
	});
});

test('DHCPv6 addresses and delegated prefixes, released and taken again', () => {
	let leases = runtime.collect('dhcp6', [ file6([
		`fd00:99::100,${DUID},600,1794541606,99,300,0,1277299601,128,0,0,openwrt.,32:3f:2f:89:b2:19,0,,1,2,0`,
		`fd00:99:0:100::,${DUID},600,1794541606,99,300,2,1,60,0,0,openwrt.,32:3f:2f:89:b2:19,0,,1,2,0`,
		`fd00:99::100,${DUID},0,1794541006,99,0,0,1277299601,128,0,0,openwrt.,32:3f:2f:89:b2:19,3,,1,2,0`,
		`fd00:99:0:100::,${DUID},0,1794541006,99,0,2,1,60,0,0,openwrt.,32:3f:2f:89:b2:19,3,,1,2,0`,
		`fd00:99::100,${DUID},0,1794541006,99,0,0,1277299601,128,0,0,,32:3f:2f:89:b2:19,2,,1,2,0`,
		`fd00:99:0:100::,${DUID},0,1794541006,99,0,2,1,60,0,0,,32:3f:2f:89:b2:19,2,,1,2,0`
	]) ], NOW);

	equal(leases, [], 'both were released');

	leases = runtime.collect('dhcp6', [ file6([
		`fd00:99::100,${DUID},0,1794541006,99,0,0,1277299601,128,0,0,,32:3f:2f:89:b2:19,2,,1,2,0`,
		`fd00:99:0:100::,${DUID},600,1794541629,99,300,2,1,60,0,0,openwrt.,32:3f:2f:89:b2:19,0,,1,2,0`,
		`fd00:99::100,${DUID},600,1794541629,99,300,0,1277299601,128,0,0,openwrt.,32:3f:2f:89:b2:19,0,,1,2,0`,
		`fd00:99::20,${DUID},600,1794541629,99,300,0,7,128,0,0,,,0,,1,2,0`
	]) ], NOW);

	equal(map(leases, lease => [ lease.address, lease.prefix_len, lease.type ]), [
		[ 'fd00:99::20', 128, 'address' ],
		[ 'fd00:99::100', 128, 'address' ],
		[ 'fd00:99:0:100::', 60, 'prefix' ]
	]);
	equal(leases[1], {
		address: 'fd00:99::100',
		prefix_len: 128,
		type: 'address',
		duid: DUID,
		iaid: 1277299601,
		hwaddr: '32:3f:2f:89:b2:19',
		hostname: 'openwrt',
		subnet_id: 99,
		preferred_lifetime: 300,
		valid_lifetime: 600,
		expires: 1794541629,
		state: 'active'
	});
});

test('later files override earlier ones', () => {
	let leases = runtime.collect('dhcp4', [
		file4([ '10.99.0.100,02:00:00:00:00:0a,,600,1794541576,99,0,0,first,0,,0',
			'10.99.0.101,02:00:00:00:00:0b,,600,1794541576,99,0,0,kept,0,,0' ]),
		file4([ '10.99.0.100,02:00:00:00:00:0a,,600,1794541900,99,0,0,second,0,,0' ])
	], NOW);

	equal(map(leases, lease => lease.hostname), [ 'second', 'kept' ]);
});

// ---- where the files are ----------------------------------------------------

const root = tmpdir();
const ctx = config.context({ root, clock: () => NOW });
const lease = (address, name) => `${address},02:00:00:00:00:01,,600,1794541576,99,0,0,${name},0,,0`;

config.mkdir_p(ctx.conf_dir, 0o755);
config.mkdir_p(ctx.lease_dir, 0o750);

function names(reply) {
	return map(reply.items, item => item.hostname);
}

test('without lease files there is nothing to show, and no error', () => {
	let reply = runtime.leases(ctx);

	equal(reply.time, NOW);
	equal(reply.dhcp4, { file: root + '/var/lib/kea/kea-leases4.csv', exists: false, count: 0, truncated: false, items: [], subnets: {} });
	equal(reply.dhcp6.file, root + '/var/lib/kea/kea-leases6.csv');
});

test('the subnets of a configuration are indexed by their id, with their interface', () => {
	let root4 = {
		subnet4: [
			{ id: 3, subnet: '192.168.1.0/24', interface: 'br-lan' },
			{ id: 4, subnet: '192.168.9.0/24' },
			{ subnet: '192.168.8.0/24' }
		],
		'shared-networks': [
			{ name: 'floor', interface: 'br-floor', subnet4: [ { id: 7, subnet: '10.20.0.0/24' }, { id: 8, subnet: '10.21.0.0/24', interface: 'br-x' } ] }
		]
	};

	equal(runtime.subnet_index('dhcp4', root4), {
		'3': { subnet: '192.168.1.0/24', interface: 'br-lan' },
		'4': { subnet: '192.168.9.0/24', interface: '' },
		'7': { subnet: '10.20.0.0/24', interface: 'br-floor' },
		'8': { subnet: '10.21.0.0/24', interface: 'br-x' }
	});
	equal(runtime.subnet_index('dhcp6', { subnet6: [ { id: 2, subnet: 'fd00:1::/64', interface: 'br-lan' } ], subnet4: [ { id: 9 } ] }),
		{ '2': { subnet: 'fd00:1::/64', interface: 'br-lan' } });
	equal(runtime.subnet_index('dhcp4', null), {});
});

test('the files are read in the order Kea loads them', () => {
	let file = ctx.lease_dir + '/kea-leases4.csv';

	fs.writefile(file + '.2', file4([ lease('10.99.0.1', 'previous'), lease('10.99.0.2', 'previous') ]));
	fs.writefile(file + '.1', file4([ lease('10.99.0.2', 'input'), lease('10.99.0.3', 'input') ]));
	fs.writefile(file, file4([ lease('10.99.0.3', 'current') ]));
	equal(names(runtime.leases(ctx).dhcp4), [ 'previous', 'input', 'current' ]);

	// A finished cleanup replaces its two inputs.
	fs.writefile(file + '.completed', file4([ lease('10.99.0.1', 'completed') ]));
	equal(names(runtime.leases(ctx).dhcp4), [ 'completed', 'current' ]);
	equal(runtime.leases(ctx).dhcp4.count, 2);
	equal(runtime.leases(ctx).dhcp4.exists, true);
});

test('the lease database settings of the configuration are followed', () => {
	fs.writefile(config.path(ctx, 'dhcp4'),
		'// a comment\n{ "Dhcp4": { "lease-database": { "type": "memfile", "name": "other4.csv" } } }\n');
	equal(runtime.leases(ctx).dhcp4.file, root + '/var/lib/kea/other4.csv');
	equal(runtime.leases(ctx).dhcp4.exists, false);

	fs.writefile(ctx.lease_dir + '/other4.csv', file4([ lease('10.99.0.9', 'elsewhere') ]));
	equal(names(runtime.leases(ctx).dhcp4), [ 'elsewhere' ]);

	fs.writefile(config.path(ctx, 'dhcp4'),
		'{ "Dhcp4": { "lease-database": { "name": "/var/lib/kea/other4.csv" } } }');
	equal(names(runtime.leases(ctx).dhcp4), [ 'elsewhere' ]);

	fs.writefile(config.path(ctx, 'dhcp4'), '{ "Dhcp4": { "lease-database": { "type": "memfile", "persist": false } } }');
	equal(runtime.leases(ctx).dhcp4.note, 'no-persist');
	equal(runtime.leases(ctx).dhcp4.items, []);

	fs.writefile(config.path(ctx, 'dhcp4'), '{ "Dhcp4": { "lease-database": { "type": "mysql" } } }');
	equal(runtime.leases(ctx).dhcp4.note, 'no-memfile');

	// A file that cannot be parsed falls back to the default name.
	fs.writefile(config.path(ctx, 'dhcp4'), '{ broken');
	equal(names(runtime.leases(ctx).dhcp4), [ 'completed', 'current' ]);
});

// ---- system log -------------------------------------------------------------

const LOG = [
	'Fri Nov 13 03:36:20 2026 daemon.info dnsmasq[1234]: read /etc/hosts - 12 names',
	'Fri Nov 13 03:36:22 2026 local0.info kea-dhcp6: INFO  [kea-dhcp6.dhcp6.140593078367760] DHCP6_STARTED Kea DHCPv6 server version 3.0.4 started',
	'Fri Nov 13 03:36:23 2026 daemon.notice luci-app-kea: not a daemon of Kea',
	'Fri Nov 13 03:36:59 2026 local0.err kea-dhcp4[2201]: ERROR [kea-dhcp4.ha-hooks/9166.1406] HA_CONFIGURATION_FAILED unsupported value',
	'Fri Nov 13 03:37:01 2026 local0.info kea-lfc: something without a logger prefix',
	''
];

test('a log line is split into time, daemon, severity and text', () => {
	equal(runtime.parse_log_line(LOG[1]), {
		time: 'Fri Nov 13 03:36:22 2026',
		daemon: 'kea-dhcp6',
		severity: 'INFO',
		text: 'DHCP6_STARTED Kea DHCPv6 server version 3.0.4 started'
	});
	equal(runtime.parse_log_line(LOG[3]).severity, 'ERROR');
	equal(runtime.parse_log_line(LOG[3]).daemon, 'kea-dhcp4');
	equal(runtime.parse_log_line(LOG[4]),
		{ time: 'Fri Nov 13 03:37:01 2026', daemon: 'kea-lfc', severity: '', text: 'something without a logger prefix' });
	equal(runtime.parse_log_line('free text'), { time: '', daemon: '', severity: '', text: 'free text' });
});

test('a line that procd passed on is split as well', () => {
	// What a daemon prints before its loggers are set up, and everything a
	// logger writes to the standard output. Lines as logged on OpenWrt 25.12.6.
	equal(runtime.parse_log_line(
		'Thu Nov 19 17:07:53 2026 daemon.info kea-dhcp4[4019]: 2026-11-19 17:07:53.198 INFO  ' +
		'[kea-dhcp4.dhcp4/4019.140353631573520] DHCP4_STARTING Kea DHCPv4 server version 3.0.4 (stable) starting'), {
		time: 'Thu Nov 19 17:07:53 2026',
		daemon: 'kea-dhcp4',
		severity: 'INFO',
		text: 'DHCP4_STARTING Kea DHCPv4 server version 3.0.4 (stable) starting'
	});

	let failed = runtime.parse_log_line(
		'Thu Nov 19 17:07:53 2026 daemon.err kea-dhcp4[4019]: 2026-11-19 17:07:53.202 ERROR ' +
		'[kea-dhcp4.dhcp4/4019.140353631573520] DHCP4_INIT_FAIL failed to initialize Kea server');

	equal(failed.severity, 'ERROR');
	equal(failed.text, 'DHCP4_INIT_FAIL failed to initialize Kea server');

	// procd logs the standard error as "err"; the severity is the one Kea gave.
	equal(runtime.parse_log_line(
		'Thu Nov 19 19:54:19 2026 daemon.err kea-dhcp4[4262]: 2026-11-19 19:54:19.811 INFO  ' +
		'[kea-dhcp4.dhcp4/4262.140602355344912] DHCP4_STARTED Kea DHCPv4 server version 3.0.4 started').severity,
		'INFO');
});

test('the last Kea messages are returned, oldest first, and nothing else', () => {
	let logctx = config.context({ root, log_reader: () => join('\n', LOG) });
	let reply = runtime.log(logctx, 30);

	equal(reply.result, true);
	equal(map(reply.lines, line => line.daemon), [ 'kea-dhcp6', 'kea-dhcp4', 'kea-lfc' ]);
	equal(map(runtime.log(logctx, 2).lines, line => line.daemon), [ 'kea-dhcp4', 'kea-lfc' ]);
	equal(length(runtime.log(logctx, 'many').lines), 3, 'a wrong count falls back to the default');
	// No daemon is installed in this context, whatever the machine has.
	equal(runtime.log(config.context({ root, sbin_dir: root + '/no-sbin', log_reader: () => '' }), 30),
		{ result: true, lines: [], outputs: {} });
});

test('the log reply says where each installed daemon writes its log', () => {
	let sbin = root + '/log-sbin';
	let logctx = config.context({ root, sbin_dir: sbin, log_reader: () => '' });

	config.mkdir_p(sbin, 0o755);
	config.mkdir_p(logctx.conf_dir, 0o755);

	for (let name in [ 'kea-dhcp4', 'kea-dhcp6' ]) {
		fs.writefile(sbin + '/' + name, '#!/bin/sh\n');
		fs.chmod(sbin + '/' + name, 0o755);
	}

	// kea-dhcp6 is installed but has no configuration file; kea-dhcp-ddns
	// has a file but is not installed.
	fs.writefile(config.path(logctx, 'dhcp4'),
		'{ "Dhcp4": { "loggers": [ { "name": "kea-dhcp4", "output-options": [ { "output": "kea-dhcp4.log" } ] } ] } }');
	fs.writefile(config.path(logctx, 'dhcp_ddns'), '{ "DhcpDdns": { } }');

	equal(runtime.log(logctx, 30).outputs, {
		dhcp4: [ { output: 'kea-dhcp4.log', kind: 'file', path: '/var/log/kea/kea-dhcp4.log', lost: true } ]
	});

	fs.unlink(config.path(logctx, 'dhcp4'));
	fs.unlink(config.path(logctx, 'dhcp_ddns'));
});

// ---- control socket ---------------------------------------------------------

// The reply of kea-dhcp4 3.0.4 to "status-get": one of two servers paired
// on a test machine, a moment after both were up.
const STATUS = {
	result: 0,
	arguments: {
		'dhcp-state': { 'disabled-by-user': false, 'globally-disabled': false },
		'high-availability': [ {
			'ha-mode': 'hot-standby',
			'ha-servers': {
				local: { role: 'primary', scopes: [ 'a' ], 'server-name': 'a', state: 'hot-standby',
					'system-time': '2026-11-20 18:38:25' },
				remote: { age: 0, 'analyzed-packets': 0, 'clock-skew': 0, 'communication-interrupted': false,
					'connecting-clients': 0, 'in-touch': true, 'last-scopes': [], 'last-state': 'hot-standby',
					role: 'standby', 'server-name': 'b', 'system-time': '2026-11-20 18:38:25',
					'unacked-clients': 0, 'unacked-clients-left': 0 }
			}
		} ],
		'multi-threading-enabled': true,
		pid: 3677,
		reload: 15,
		sockets: { status: 'ready' },
		uptime: 15
	}
};

test('the status of a daemon is reduced to its sockets and high availability', () => {
	equal(runtime.daemon_state(STATUS), {
		reachable: true,
		uptime: 15,
		serving: true,
		sockets: { status: 'ready', errors: [] },
		ha: [ {
			mode: 'hot-standby',
			local: { name: 'a', role: 'primary', state: 'hot-standby' },
			remote: { name: 'b', role: 'standby', state: 'hot-standby', in_touch: true, interrupted: false, age: 0 }
		} ]
	});
});

test('a daemon that runs without listening says so', () => {
	// As after a boot in which Kea was started before its interface was up.
	let state = runtime.daemon_state({ result: 0, arguments: {
		sockets: { status: 'failed', errors: [ 'the interface br-lan is not running' ] },
		uptime: 21
	} });

	equal(state.sockets, { status: 'failed', errors: [ 'the interface br-lan is not running' ] });
	equal(state.ha, [], 'no high availability configured');
	equal(state.serving, true);
});

test('a lost partner, a stopped service and a daemon that does not answer', () => {
	let alone = runtime.daemon_state({ result: 0, arguments: {
		'high-availability': [ { 'ha-mode': 'hot-standby', 'ha-servers': {
			local: { role: 'primary', 'server-name': 'a', state: 'partner-down' },
			remote: { age: 8, 'communication-interrupted': true, 'in-touch': true,
				'last-state': 'unavailable', role: 'standby', 'server-name': 'b' }
		} } ],
		sockets: { status: 'ready' }
	} });

	equal(alone.ha[0].local.state, 'partner-down');
	equal(alone.ha[0].remote, { name: 'b', role: 'standby', state: 'unavailable',
		in_touch: true, interrupted: true, age: 8 });

	equal(runtime.daemon_state({ result: 0, arguments: {
		'dhcp-state': { 'globally-disabled': true }, sockets: { status: 'ready' } } }).serving, false);

	equal(runtime.daemon_state({ error: 'connect-failed' }), { reachable: false, reason: 'connect-failed' });
	equal(runtime.daemon_state({ result: 1, text: 'unsupported' }), { reachable: false, reason: 'refused' });
	equal(runtime.daemon_state(null), { reachable: false, reason: 'refused' });
});

// The client itself, against a socket that a second interpreter serves.
let sockets = null;

try {
	sockets = require('socket');
}
catch (e) {
}

if (sockets) {
	const interpreter = getenv('UCODE') ?? 'ucode';
	const server = sourcepath(0, true) + '/control-server.uc';
	const sctx = config.context({ root, run_dir: root + '/ctl' });
	const path = sctx.run_dir + '/kea4-ctrl-socket';

	config.mkdir_p(sctx.run_dir, 0o750);
	config.mkdir_p(sctx.conf_dir, 0o755);

	function serve(mode) {
		system(sprintf('%s %s %s %s >/dev/null 2>&1 &', config.shellquote(interpreter),
			config.shellquote(server), config.shellquote(path), mode));

		// Wait for the socket to be there.
		for (let i = 0; i < 50 && !fs.stat(path); i++)
			sockets.poll(100);
	}

	test('a command is sent over the control socket named in the configuration', () => {
		fs.writefile(config.path(sctx, 'dhcp4'),
			'{ "Dhcp4": { "control-socket": { "socket-type": "unix", "socket-name": "kea4-ctrl-socket" } } }');
		serve('reply');

		equal(runtime.control(sctx, 'dhcp4', 'status-get'),
			{ result: 0, arguments: { command: 'status-get', sockets: { status: 'ready' } } });
	});

	test('a daemon that takes the command and does not answer is not waited for', () => {
		serve('silent');

		let before = clock(true);
		let reply = runtime.control(sctx, 'dhcp4', 'status-get');
		let after = clock(true);
		let waited = (after[0] - before[0]) * 1000 + (after[1] - before[1]) / 1000000;

		equal(reply, { error: 'no-reply' });
		ok(waited < 3000, sprintf('gave up after %d ms', waited));
	});

	test('no socket to connect to, and none configured', () => {
		for (let i = 0; i < 60 && fs.stat(path); i++)
			sockets.poll(100);

		equal(runtime.control(sctx, 'dhcp4', 'status-get'), { error: 'connect-failed' });

		fs.writefile(config.path(sctx, 'dhcp4'), '{ "Dhcp4": { } }');
		equal(runtime.control(sctx, 'dhcp4', 'status-get'), { error: 'no-control-socket' });
		fs.unlink(config.path(sctx, 'dhcp4'));
	});
}
else {
	print('# skipped: the control socket tests need the ucode socket module\n');
}

// ---- version ----------------------------------------------------------------

test('the version is asked from the first Kea daemon that is installed', () => {
	let sbin = root + '/sbin';
	let vctx = config.context({ root, sbin_dir: sbin });

	config.mkdir_p(sbin, 0o755);
	equal(runtime.version(vctx), null, 'no daemon installed');

	fs.writefile(sbin + '/kea-dhcp6', '#!/bin/sh\n[ "$1" = -v ] && echo 3.0.4\n');
	fs.chmod(sbin + '/kea-dhcp6', 0o755);
	equal(runtime.version(vctx), '3.0.4');

	fs.writefile(sbin + '/kea-dhcp4', '#!/bin/sh\necho "Usage: something else"\n');
	fs.chmod(sbin + '/kea-dhcp4', 0o755);
	equal(runtime.version(vctx), '3.0.4', 'an answer that is no version is skipped');
});

rm_rf(root);
done();
