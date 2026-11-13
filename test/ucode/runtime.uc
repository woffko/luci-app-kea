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
	equal(reply.dhcp4, { file: root + '/var/lib/kea/kea-leases4.csv', exists: false, count: 0, truncated: false, items: [] });
	equal(reply.dhcp6.file, root + '/var/lib/kea/kea-leases6.csv');
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

test('the last Kea messages are returned, oldest first, and nothing else', () => {
	let logctx = config.context({ root, log_reader: () => join('\n', LOG) });
	let reply = runtime.log(logctx, 30);

	equal(reply.result, true);
	equal(map(reply.lines, line => line.daemon), [ 'kea-dhcp6', 'kea-dhcp4', 'kea-lfc' ]);
	equal(map(runtime.log(logctx, 2).lines, line => line.daemon), [ 'kea-dhcp4', 'kea-lfc' ]);
	equal(length(runtime.log(logctx, 'many').lines), 3, 'a wrong count falls back to the default');
	equal(runtime.log(config.context({ root, log_reader: () => '' }), 30), { result: true, lines: [] });
});

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
