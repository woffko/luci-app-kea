'use strict';

// Import preview and commit from a UCI fixture, read the way the rpcd plugin
// reads /etc/config/dhcp, and validated by the real Kea binaries. Needs the
// ucode "uci" module, kea-dhcp4 and kea-dhcp6, so it runs on OpenWrt.

import * as fs from 'fs';
import { cursor } from 'uci';
import { test, equal, ok, tmpdir, rm_rf, fixture, done } from '../lib.uc';
import * as config from 'luci.kea.config';
import * as importer from 'luci.kea.importer';
import { parse } from 'luci.kea.jsonc';

const root = tmpdir();
const ctx = config.context({ root, run_dir: root + '/run' });
const interfaces = [ { name: 'lan', device: 'br-lan', ipaddr: '192.168.1.1/24' } ];

config.mkdir_p(root + '/uci', 0o755);
config.mkdir_p(ctx.conf_dir, 0o755);
fs.writefile(root + '/uci/dhcp', fs.readfile(fixture('dhcp-static-leases.uci')));
fs.writefile(config.path(ctx, 'dhcp4'), fs.readfile(fixture('kea-dhcp4-rich.conf')));
fs.writefile(config.path(ctx, 'dhcp6'), fs.readfile(fixture('kea-dhcp6-rich.conf')));

let hosts = [];

cursor(root + '/uci').foreach('dhcp', 'host', s => push(hosts, s));

function entries() {
	let result = {};

	for (let entry in importer.preview(ctx, hosts, interfaces).entries)
		result[entry.key] = entry;

	return result;
}

test('UCI lists and options are read as the import expects', () => {
	equal(length(hosts), 8);
	equal(hosts[0].mac, [ '02:00:00:00:00:AA' ]);
	equal(hosts[0].duid, [ '00030001020000000aaa' ]);
	equal(hosts[3].mac, [ '02:00:00:00:00:b1', '02:00:00:00:00:b2' ]);
});

test('every static lease of the fixture is classified', () => {
	let found = entries();
	let statuses = {};

	for (let key, entry in found)
		statuses[key] = entry.status;

	equal(statuses, {
		'dual:dhcp4': 'ready',
		'dual:dhcp6': 'ready',
		'printer:dhcp4': 'review',
		'known:dhcp4': 'present',
		'docked:dhcp4': 'blocked',
		'elsewhere:dhcp4': 'blocked',
		'off:dhcp4': 'review',
		'truncated:dhcp6': 'blocked',
		'byname:dhcp4': 'blocked'
	});
	equal(found['dual:dhcp6'].address, 'fd00:1::77');
	equal(found['truncated:dhcp6'].notes, [ 'invalid or truncated DUID' ]);
});

test('Kea accepts both files after the import', () => {
	let result = importer.commit(ctx, hosts, interfaces, [ 'dual:dhcp4', 'dual:dhcp6', 'off:dhcp4', 'printer:dhcp4' ]);

	equal(result.result, true, result.validation);
	equal(result.imported, 4);
	equal(config.read(ctx, 'dhcp4').valid, true);
	equal(config.read(ctx, 'dhcp6').valid, true);

	let subnet6 = parse(fs.readfile(config.path(ctx, 'dhcp6'))).config.Dhcp6.subnet6[0];

	equal(subnet6.reservations[3],
		{ duid: '00:03:00:01:02:00:00:00:0a:aa', 'ip-addresses': [ 'fd00:1::77' ], hostname: 'laptop' });
});

test('a second import finds nothing left to do', () => {
	let found = entries();

	for (let key in [ 'dual:dhcp4', 'dual:dhcp6', 'off:dhcp4', 'printer:dhcp4' ])
		equal(found[key].status, 'present', key);

	let result = importer.commit(ctx, hosts, interfaces);

	equal(result.changed, false);
	equal(result.imported, 0);
});

/* ---- the installed command ------------------------------------------------- */

const COMMAND = '/usr/libexec/luci-app-kea/import-dnsmasq';

// Runs the command with the arguments and returns { status, output }.
function command(args) {
	let out = root + '/command.out';
	let status = system(sprintf('%s %s >%s 2>/dev/null', COMMAND, args, out));

	return { status, output: trim(fs.readfile(out) ?? '') };
}

if (fs.access(COMMAND, 'x')) {
	test('the command answers its arguments with the exit status it promises', () => {
		equal(command('--help').status, 0);
		ok(index(command('--help').output, 'usage: import-dnsmasq') == 0);

		let wrong = command('--bogus');

		equal(wrong.status, 2);
		equal(json(wrong.output), { result: false, error: 'unknown argument: --bogus' });
	});

	// The system's own files: a dry run writes nothing.
	test('a dry run of the command on this system reads its files and writes nothing', () => {
		let before4 = fs.readfile('/etc/kea/kea-dhcp4.conf');
		let run = command('--dry-run');
		let reply = json(run.output);

		equal(run.status, reply.result ? 0 : 1);
		equal(reply.mode, 'dry-run');
		equal(sort(keys(reply.counts)), [ 'blocked', 'present', 'ready', 'review', 'update' ]);
		equal(type(reply.left), 'array');
		equal(fs.readfile('/etc/kea/kea-dhcp4.conf'), before4);
	});

	test('the leases of dnsmasq are not moved while kea-dhcp4 does not run', () => {
		if (system('pidof kea-dhcp4 >/dev/null') == 0)
			return;

		let run = command('--leases');

		equal(run.status, 1);
		equal(json(run.output), { result: false, reason: 'kea-not-running', added: 0, skipped: [] });
		equal(command('--leases --dry-run').status, 2);
	});
}

/* ---- the configuration made from dnsmasq's settings ------------------------ */

const SETUP = '/usr/libexec/luci-app-kea/setup-from-dnsmasq';

function setup_command(args, input) {
	let out = root + '/setup.out';
	let feed = root + '/setup.in';

	fs.writefile(feed, input ?? '');

	let status = system(sprintf('%s %s <%s >%s 2>/dev/null', SETUP, args, feed, out));

	return { status, output: trim(fs.readfile(out) ?? '') };
}

if (fs.access(SETUP, 'x')) {
	test('the setup command makes a configuration the real Kea accepts, and writes nothing in a dry run', () => {
		let before = fs.readfile('/etc/kea/kea-dhcp4.conf');
		let run = setup_command('--dry-run --cluster -', '{}');
		let reply = json(run.output);

		equal(run.status, 0, run.output);
		equal(reply.reason, 'dry-run');
		ok(reply.state in [ 'sample', 'own', 'missing' ], reply.state);
		equal(reply.check?.valid, true, reply.check?.output);
		ok(length(reply.subnets) > 0, 'dnsmasq serves at least lan on a test machine');
		equal(fs.readfile('/etc/kea/kea-dhcp4.conf'), before);
	});

	test('with a cluster, the pair of Kea servers it makes is accepted by Kea with its hooks', () => {
		if (!fs.access('/usr/lib/kea/hooks/libdhcp_ha.so'))
			return;

		let cluster = {
			dhcp_backend: 'kea',
			node: { name: 'node-a', address: '192.168.1.1', kea_role: 'primary' },
			peers: [ { name: 'node-b', address: '192.168.1.2', vrrp_only: false, kea_role: 'standby' } ],
			dhcp_interfaces: [ { interface: 'lan', device: 'br-lan', vip4: [ '192.168.1.254' ] } ]
		};
		let reply = json(setup_command('--dry-run --cluster -', sprintf('%J', cluster)).output);

		equal(reply.ha, { this: 'node-a', peers: [ 'node-a', 'node-b' ] });
		equal(reply.check?.valid, true, reply.check?.output);
		ok(index(reply.content, '"routers"') > 0 && index(reply.content, '192.168.1.254') > 0, 'the virtual address for the clients');
	});

	test('the setup command answers its arguments with the exit status it promises', () => {
		equal(setup_command('--bogus').status, 2);
		equal(setup_command('--cluster -', 'not json').status, 2);
		equal(json(setup_command('--cluster -', 'not json').output).reason, 'the --cluster input is not a JSON object');
		equal(setup_command('--help').status, 0);
	});
}

rm_rf(root);
done();
