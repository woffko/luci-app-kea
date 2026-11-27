'use strict';

import * as fs from 'fs';
import { test, equal, ok, tmpdir, rm_rf, fixture, done } from './lib.uc';
import * as config from 'luci.kea.config';
import * as setup from 'luci.kea.setup';
import { parse } from 'luci.kea.jsonc';

// The configuration made from dnsmasq's settings, and when it is written.

const HOOKS = { dir: '/usr/lib/kea/hooks', lease_cmds: true, ha: true, run_script: false, dns_hosts: false };

// A router as OpenWrt sets it up, plus a guest network and a VLAN.
function input(extra) {
	return {
		dhcp: [
			{ '.name': 'lan', interface: 'lan', start: '100', limit: '150', leasetime: '12h', dhcpv4: 'server' },
			{ '.name': 'guest', interface: 'guest', start: '10', limit: '500', leasetime: '2h',
			  dhcp_option: [ '6,1.1.1.1,9.9.9.9', 'option:ntp-server,0.0.0.0', 'tag:x,3,10.9.9.9', '252,"\\n"' ] },
			{ '.name': 'wan', interface: 'wan', ignore: '1' },
			{ '.name': 'iot', interface: 'iot', dhcpv4: 'disabled' }
		],
		dnsmasq: [ { domain: 'lan' } ],
		network: [
			{ '.name': 'lan', proto: 'static', device: 'br-lan', ipaddr: '192.168.1.1', netmask: '255.255.255.0' },
			{ '.name': 'guest', proto: 'static', device: 'br-guest', ipaddr: [ '192.168.50.1/24' ] },
			{ '.name': 'wan', proto: 'dhcp', device: 'eth1' },
			{ '.name': 'iot', proto: 'static', device: 'eth2.87', ipaddr: '10.0.87.1/24' }
		],
		cluster: null,
		hooks: HOOKS,
		scripts_dir: '/usr/share/kea/scripts',
		...(extra ?? {})
	};
}

test('every pool dnsmasq serves becomes a subnet, with its pool, lease time and options', () => {
	let made = setup.plan(input());
	let root = made.config.Dhcp4;

	equal(made.subnets, [
		{ subnet: '192.168.1.0/24', interface: 'lan', device: 'br-lan', pool: '192.168.1.100 - 192.168.1.249' },
		{ subnet: '192.168.50.0/24', interface: 'guest', device: 'br-guest', pool: '192.168.50.10 - 192.168.50.254' }
	]);
	equal(root['interfaces-config'], { interfaces: [ 'br-lan/192.168.1.1', 'br-guest/192.168.50.1' ], 'service-sockets-max-retries': 60, 'service-sockets-retry-wait-time': 2000 },
		'each device with the address of the router, so that Kea opens one socket on it');
	equal(root.subnet4[0], {
		id: 1, subnet: '192.168.1.0/24', interface: 'br-lan',
		'valid-lifetime': 43200, 'renew-timer': 21600, 'rebind-timer': 37800,
		pools: [ { pool: '192.168.1.100 - 192.168.1.249' } ],
		'option-data': [
			{ name: 'routers', data: '192.168.1.1' },
			{ name: 'domain-name-servers', data: '192.168.1.1' },
			{ name: 'domain-name', data: 'lan' }
		]
	});
	equal(root.subnet4[1]['option-data'], [
		{ name: 'routers', data: '192.168.50.1' },
		{ name: 'domain-name-servers', data: '1.1.1.1, 9.9.9.9' },
		{ name: 'domain-name', data: 'lan' },
		{ name: 'ntp-servers', data: '192.168.50.1' }
	], 'the options of the pool, 0.0.0.0 as this server');
	equal(root.subnet4[1]['valid-lifetime'], 7200);
	equal(map(made.left, item => item.what), [ 'guest: tag:x,3,10.9.9.9', 'guest: 252,"\\n"' ]);
	equal(root['hooks-libraries'], [ { library: '/usr/lib/kea/hooks/libdhcp_lease_cmds.so' } ]);
	equal(root['control-socket'], { 'socket-type': 'unix', 'socket-name': 'kea4-ctrl-socket' });
	equal(root.loggers, [ { name: 'kea-dhcp4', 'output-options': [ { output: 'syslog' } ], severity: 'INFO' } ]);
	equal(made.ha, null);
});

test('a cluster names the interfaces, the address clients are sent to, and the pair', () => {
	let cluster = {
		dhcp_backend: 'kea',
		node: { name: 'ha-10-0-87-2', address: '10.0.88.2', kea_role: 'primary' },
		peers: [ { name: 'ha-10-0-87-3', address: '10.0.88.3', vrrp_only: false, kea_role: 'standby' },
		         { name: 'witness', address: '10.0.88.9', vrrp_only: true } ],
		dhcp_interfaces: [ { interface: 'iot', device: 'bond0.87', vip4: [ '10.0.87.5' ] } ]
	};
	let made = setup.plan(input({ cluster, hooks: { ...HOOKS, run_script: true, dns_hosts: true } }));
	let root = made.config.Dhcp4;

	equal(made.subnets, [ { subnet: '10.0.87.0/24', interface: 'iot', device: 'bond0.87', pool: '10.0.87.100 - 10.0.87.249' } ],
		'the interface ha-cluster names, also with dhcpv4 off, on the device it names');
	equal(root.subnet4[0]['option-data'][0], { name: 'routers', data: '10.0.87.5' }, 'the virtual address');
	equal(root['interfaces-config'].interfaces, [ 'bond0.87/10.0.87.1' ], 'the address of the node, not the virtual one');
	equal(made.ha, { this: 'ha-10-0-87-2', peers: [ 'ha-10-0-87-2', 'ha-10-0-87-3' ] });
	equal(root['hooks-libraries'][1], { library: '/usr/lib/kea/hooks/libdhcp_ha.so', parameters: { 'high-availability': [ {
		'this-server-name': 'ha-10-0-87-2', mode: 'hot-standby',
		'heartbeat-delay': 3000, 'max-response-delay': 10000, 'max-ack-delay': 3000, 'max-unacked-clients': 0,
		peers: [
			{ name: 'ha-10-0-87-2', url: 'http://10.0.88.2:8001/', role: 'primary' },
			{ name: 'ha-10-0-87-3', url: 'http://10.0.88.3:8001/', role: 'standby' }
		] } ] } });
	equal(root['hooks-libraries'][2], { library: '/usr/lib/kea/hooks/libdhcp_run_script.so',
		parameters: { name: '/usr/share/kea/scripts/kea-dnsmasq-hosts', sync: false } });

	cluster.peers[0].kea_role = '';
	equal(setup.plan(input({ cluster })).ha, null, 'no pair without the roles');
});

test('an interface with several addresses of its own is served from the first, as dnsmasq does', () => {
	// As on a router of the owner: lan with 10.0.77.1/24 and 10.0.90.1/24.
	let made = setup.plan(input({
		dhcp: [ { '.name': 'lan', interface: 'lan', start: '10', limit: '11' } ],
		network: [ { '.name': 'lan', proto: 'static', device: 'br-lan', ipaddr: [ '10.0.77.1/24', '10.0.90.1/24' ] } ]
	}));

	equal(made.subnets, [ { subnet: '10.0.77.0/24', interface: 'lan', device: 'br-lan', pool: '10.0.77.10 - 10.0.77.20' } ]);
	equal(made.config.Dhcp4['interfaces-config'].interfaces, [ 'br-lan/10.0.77.1' ]);
});

test('what cannot be served is named with the reason, and nothing is made without a subnet', () => {
	let made = setup.plan(input({
		dhcp: [
			{ '.name': 'a', interface: 'lan', start: '300', limit: '10' },
			{ '.name': 'b', interface: 'guest', dynamicdhcp: '0', leasetime: 'infinite' },
			{ '.name': 'c', interface: 'wan' },
			{ '.name': 'd', interface: 'nowhere' }
		],
		hooks: { dir: '/usr/lib/kea/hooks' }
	}));

	equal(map(made.subnets, item => [ item.interface, item.pool ]), [ [ 'guest', null ] ], 'a pool of static leases only');
	equal(made.left, [
		{ what: 'lan', why: 'the pool lies outside the network of the interface' },
		{ what: 'guest: leasetime infinite', why: 'not a lease time Kea is given here; 12 hours are used' },
		{ what: 'wan', why: 'the interface has no static IPv4 address with a prefix in /etc/config/network' },
		{ what: 'nowhere', why: 'the interface has no static IPv4 address with a prefix in /etc/config/network' },
		{ what: 'kea-hook-lease-cmds', why: 'not installed: the leases of dnsmasq cannot be moved into Kea' }
	]);
	equal(setup.plan(input({ dhcp: [] })).config, null);
	equal(setup.lease_seconds('90m'), 5400);
	equal(setup.lease_seconds('1w'), 604800);
	equal(setup.lease_seconds('0'), null);
});

/* ---- the file on the router ---------------------------------------------- */

const root = tmpdir();
let audit = '';

fs.mkdir(root + '/db');
fs.writefile(root + '/db/installed', 'P:kea-dhcp4\nV:3.0.4-r1\nF:etc\nF:etc/kea\nR:kea-dhcp4.conf\na:0:0:640\nZ:Q1xyz=\n\nP:other\nF:usr\n');

const ctx = config.context({
	root,
	run_dir: root + '/run',
	clock: () => 1794415113,
	validator: (name, file) => ({ valid: type(json(fs.readfile(file))) == 'object', output: 'checked' }),
	apk_db: root + '/db/installed',
	apk_audit: () => audit
});
const file = config.path(ctx, 'dhcp4');

test('the file is the sample while apk finds it unchanged and owns it', () => {
	equal(setup.file_state(ctx), 'missing');
	config.mkdir_p(ctx.conf_dir, 0o755);
	fs.writefile(file, '{ "Dhcp4": { "interfaces-config": { "interfaces": [] }, "subnet4": [ { "id": 1, "subnet": "192.0.2.0/24" } ] } }');
	equal(setup.file_state(ctx), 'sample');
	audit = 'A etc/rc.d/S25kea\nU etc/kea/kea-dhcp4.conf\n';
	equal(setup.file_state(ctx), 'own');
	audit = 'U etc/kea/kea-dhcp6.conf\n';
	equal(setup.file_state(ctx), 'sample', 'another file changed');
	audit = null;
	equal(setup.file_state(ctx), 'own', 'apk failed: nothing tells the file is the sample');
	audit = '';

	let other = config.context({ root, run_dir: root + '/run', apk_db: root + '/db/none', apk_audit: () => '' });

	equal(setup.file_state(other), 'own', 'not known to the package database');
});

test('only the sample or a missing file is written; the reply says what was done', () => {
	audit = '';

	let dry = setup.run(ctx, input(), { dry_run: true });

	equal([ dry.result, dry.written, dry.reason, dry.state ], [ true, false, 'dry-run', 'sample' ]);
	equal(dry.check.valid, true);
	equal(parse(dry.content).config.Dhcp4.subnet4[0].subnet, '192.168.1.0/24');

	let written = setup.run(ctx, input(), {});

	equal([ written.result, written.written, written.reason ], [ true, true, 'written' ]);
	equal(written.backup, '20261111T163833Z', 'the sample is kept');
	equal(parse(fs.readfile(file)).config.Dhcp4.subnet4[1].subnet, '192.168.50.0/24');

	audit = 'U etc/kea/kea-dhcp4.conf\n';

	let before = fs.readfile(file);
	let own = setup.run(ctx, input(), {});

	equal([ own.result, own.written, own.reason, own.state ], [ true, false, 'own-config', 'own' ]);
	equal(fs.readfile(file), before, 'a changed file is left alone');

	let replaced = setup.run(ctx, input({ dhcp: [ input().dhcp[0] ] }), { replace: true });

	equal([ replaced.result, replaced.written, replaced.reason, replaced.state ], [ true, true, 'written', 'own' ],
		'the Setup page may replace a file of the user\'s own when asked');
	equal(replaced.backup, '20261111T163833Z_2', 'the file it replaced is kept');
	equal(parse(fs.readfile(ctx.backup_dir + '/kea-dhcp4.' + replaced.backup + '.conf')).config.Dhcp4.subnet4[1].subnet, '192.168.50.0/24');
	equal(length(parse(fs.readfile(file)).config.Dhcp4.subnet4), 1);

	let proposal = setup.run(ctx, input(), { dry_run: true });

	equal([ proposal.reason, proposal.state, type(proposal.content) ], [ 'dry-run', 'own', 'string' ],
		'a dry run still shows what would be written');
	equal(setup.run(ctx, input({ dhcp: [] }), {}).reason, 'nothing-to-set-up');
});

test('a server is not set up while its file is missing, the sample, or without interfaces or subnets', () => {
	audit = '';
	fs.unlink(file);
	equal(setup.unconfigured(ctx), [ 'missing' ]);
	fs.writefile(file, '{ "Dhcp4": {} }');
	equal(setup.unconfigured(ctx), [ 'sample' ]);
	audit = 'U etc/kea/kea-dhcp4.conf\n';
	equal(setup.unconfigured(ctx), [ 'no-interfaces', 'no-subnets' ]);
	fs.writefile(file, '{ "Dhcp4": { "interfaces-config": { "interfaces": [ "bond0.87" ] }, "subnet4": [ { "id": 1, "subnet": "10.0.87.0/24" } ] } }');
	equal(setup.unconfigured(ctx), []);
});

rm_rf(root);
done();
