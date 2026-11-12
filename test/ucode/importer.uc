'use strict';

import * as fs from 'fs';
import { test, equal, ok, tmpdir, rm_rf, fixture, done } from './lib.uc';
import * as config from 'luci.kea.config';
import * as importer from 'luci.kea.importer';
import { parse } from 'luci.kea.jsonc';

function host(values) {
	return { '.name': 'cfg1', ...values };
}

function warnings(values) {
	return importer.classify(host(values)).warnings;
}

/* ---- classification ------------------------------------------------------ */

test('a complete IPv4 host is ready', () => {
	equal(importer.classify(host({ name: 'printer', mac: '12:00:78:59:29:8c', ip: '10.0.77.118' })), {
		source: 'cfg1',
		family: 'dhcp4',
		status: 'ready',
		enabled: true,
		name: 'printer',
		mac: '12:00:78:59:29:8c',
		ip: '10.0.77.118',
		duid: '',
		hostid: '',
		tag: '',
		networkid: '',
		warnings: []
	});
});

test('IPv4 problems disable the entry with a reason', () => {
	equal(warnings({ ip: '10.0.0.1' }), [ 'missing MAC address' ]);
	equal(warnings({ mac: '12:00:78:59:29:8c' }), [ 'missing IPv4 address' ]);
	equal(warnings({ mac: '12:00:78:59:29:8c', ip: '10.0.0.300' }), [ 'invalid IPv4 address' ]);
	equal(warnings({ mac: '12-00-78-59-29-8c', ip: '10.0.0.1' }), [ 'invalid MAC address' ]);

	let entry = importer.classify(host({ ip: '10.0.0.1' }));

	equal(entry.status, 'disabled');
	equal(entry.enabled, false);
});

test('a MAC list, as UCI stores it, needs manual review', () => {
	let entry = importer.classify(host({
		mac: [ '12:00:78:59:29:8c', '12:00:78:59:29:8d' ],
		ip: '10.0.0.1'
	}));

	equal(entry.mac, '12:00:78:59:29:8c 12:00:78:59:29:8d');
	equal(entry.warnings, [ 'multiple MAC addresses need manual review' ]);
});

test('a disabled source entry stays disabled', () => {
	equal(warnings({ mac: '12:00:78:59:29:8c', ip: '10.0.0.1', enable: '0' }),
		[ 'source dnsmasq host entry is disabled' ]);
	equal(warnings({ mac: '12:00:78:59:29:8c', ip: '10.0.0.1', enable: 'on' }), []);
});

test('a DUID or hostid makes the entry DHCPv6', () => {
	let entry = importer.classify(host({
		name: 'nut',
		duid: '00:04:e6:f8:c8:8f:a8:5f:d8:18:25:59:60:2d:e4:b5:fc:2e',
		ip: 'fd00:1234:abcd:1::ea4d'
	}));

	equal(entry.family, 'dhcp6');
	equal(entry.status, 'ready');
	equal(entry.duid, '00:04:e6:f8:c8:8f:a8:5f:d8:18:25:59:60:2d:e4:b5:fc:2e');
});

test('truncated DUIDs and unresolved host IDs are rejected', () => {
	for (let duid in [ '00', '*', '00:01' ])
		equal(warnings({ duid, ip: 'fd00::1' }),
			[ 'missing, invalid, or truncated DHCPv6 DUID/client-id' ], duid);

	equal(warnings({ duid: '00:01:02:03' }), [ 'missing DHCPv6 address or hostid' ]);
	equal(warnings({ duid: '00:01:02:03', hostid: '23' }),
		[ 'DHCPv6 hostid requires subnet prefix resolution before import' ]);
	equal(warnings({ hostid: '23' }), [
		'missing, invalid, or truncated DHCPv6 DUID/client-id',
		'DHCPv6 hostid requires subnet prefix resolution before import'
	]);
});

test('dnsmasq-only options are reported', () => {
	equal(warnings({
		mac: '12:00:78:59:29:8d',
		ip: '10.0.77.120',
		tag: 'special',
		match_tag: 'known',
		networkid: 'lan',
		dns: '1'
	}), [
		'dnsmasq tag import is not implemented yet',
		'dnsmasq match_tag import is not implemented yet',
		'dnsmasq networkid import is not implemented yet',
		'dns hostfile side effect is not represented in Kea reservation'
	]);
});

/* ---- merge --------------------------------------------------------------- */

function ready(name, mac, ip) {
	return importer.classify({ '.name': name, name, mac, ip });
}

test('merge adds ready IPv4 entries to the subnet that contains the address', () => {
	let conf = {
		Dhcp4: {
			subnet4: [
				{ id: 1, subnet: '192.168.1.0/24', relay: { 'ip-addresses': [ '192.168.1.254' ] } },
				{ id: 2, subnet: '10.0.0.0/8', reservations: [ { 'hw-address': '02:00:00:00:00:01', 'ip-address': '10.0.0.5' } ] }
			]
		}
	};
	let result = importer.merge(conf, [
		ready('laptop', '02:00:00:00:00:aa', '192.168.1.77'),
		ready('server', '02:00:00:00:00:bb', '10.1.2.3'),
		ready('elsewhere', '02:00:00:00:00:cc', '172.16.9.9'),
		importer.classify({ '.name': 'v6', duid: '00:01:02:03', ip: 'fd00::1' }),
		importer.classify({ '.name': 'broken', ip: '192.168.1.5' })
	]);

	equal(result, {
		result: true,
		changed: true,
		imported: 2,
		updated: 0,
		skipped: 3,
		staged: 5,
		skipped_entries: [
			{ source: 'elsewhere', reason: 'no matching Kea DHCPv4 subnet for 172.16.9.9' },
			{ source: 'v6', reason: 'only DHCPv4 direct Kea import is implemented' },
			{ source: 'broken', reason: 'entry is disabled or has warnings' }
		]
	});
	equal(conf.Dhcp4.subnet4[0], {
		id: 1,
		subnet: '192.168.1.0/24',
		relay: { 'ip-addresses': [ '192.168.1.254' ] },
		reservations: [ { 'hw-address': '02:00:00:00:00:aa', 'ip-address': '192.168.1.77', hostname: 'laptop' } ]
	});
	equal(length(conf.Dhcp4.subnet4[1].reservations), 2);
});

test('merge updates the reservation with the same MAC or IP and keeps its other fields', () => {
	let conf = {
		Dhcp4: {
			subnet4: [ {
				id: 1,
				subnet: '192.168.1.0/24',
				reservations: [
					{ 'hw-address': '02:00:00:00:00:aa', 'ip-address': '192.168.1.10', hostname: 'old', 'option-data': [ { name: 'routers', data: '192.168.1.2' } ] },
					{ 'hw-address': '02:00:00:00:00:bb', 'ip-address': '192.168.1.11', hostname: 'gone' }
				]
			} ]
		}
	};
	let result = importer.merge(conf, [
		ready('new', '02:00:00:00:00:aa', '192.168.1.77'),
		importer.classify({ '.name': 'anon', mac: '02:00:00:00:00:cc', ip: '192.168.1.11' })
	]);

	equal(result.imported, 0);
	equal(result.updated, 2);
	equal(conf.Dhcp4.subnet4[0].reservations, [
		{ 'hw-address': '02:00:00:00:00:aa', 'ip-address': '192.168.1.77', hostname: 'new', 'option-data': [ { name: 'routers', data: '192.168.1.2' } ] },
		{ 'hw-address': '02:00:00:00:00:cc', 'ip-address': '192.168.1.11' }
	]);
});

test('merge of nothing ready changes nothing', () => {
	let conf = { Dhcp4: { subnet4: [ { id: 1, subnet: '192.168.1.0/24' } ] } };
	let result = importer.merge(conf, [ importer.classify({ '.name': 'broken', ip: '192.168.1.5' }) ]);

	equal(result.changed, false);
	equal(conf, { Dhcp4: { subnet4: [ { id: 1, subnet: '192.168.1.0/24' } ] } });
});

/* ---- commit -------------------------------------------------------------- */

const root = tmpdir();
let accept = true;

const ctx = config.context({
	root,
	run_dir: root + '/run',
	clock: () => 1794415113,
	validator: () => accept ? { valid: true, output: 'ok' } : { valid: false, output: 'Kea says no' }
});

const file = config.path(ctx, 'dhcp4');
const rich = fs.readfile(fixture('kea-dhcp4-rich.conf'));
const hosts = [
	{ '.name': 'laptop', name: 'laptop', mac: '02:00:00:00:00:aa', ip: '192.168.1.77' },
	{ '.name': 'elsewhere', name: 'elsewhere', mac: '02:00:00:00:00:bb', ip: '172.16.9.9' },
	{ '.name': 'broken', ip: '192.168.1.5' }
];

test('commit reports a missing or unparsable config', () => {
	equal(importer.commit(ctx, hosts),
		{ result: false, error: 'DHCPv4 config file does not exist', path: file });

	config.mkdir_p(ctx.conf_dir, 0o755);
	fs.writefile(file, '{ broken');

	let result = importer.commit(ctx, hosts);

	equal(result.result, false);
	equal(result.error, 'DHCPv4 config cannot be parsed');
	equal(fs.readfile(file), '{ broken');
});

test('commit writes ready entries and leaves the rest of the config alone', () => {
	fs.writefile(file, rich);

	let result = importer.commit(ctx, hosts);

	equal(result.result, true);
	equal(result.imported, 1);
	equal(result.skipped, 2);
	equal(result.staged, 3);

	let before = parse(rich).config;
	let after = parse(fs.readfile(file)).config;

	equal(after.Dhcp4.subnet4[0].reservations[3],
		{ 'hw-address': '02:00:00:00:00:aa', 'ip-address': '192.168.1.77', hostname: 'laptop' });

	splice(after.Dhcp4.subnet4[0].reservations, 3, 1);
	equal(after, before, 'nothing but the new reservation changed');
});

test('commit backs up the previous file and records every entry', () => {
	equal(fs.readfile(ctx.backup_dir + '/kea-dhcp4.20261111T163833Z.conf'), rich);

	let staging = json(fs.readfile(ctx.staging_file));

	equal(staging.version, 1);
	equal(map(staging.entries, entry => entry.source), [ 'laptop', 'elsewhere', 'broken' ]);
	equal(staging.last_result.imported, 1);
});

test('importing the same hosts again updates instead of duplicating', () => {
	let result = importer.commit(ctx, hosts);

	equal(result.imported, 0);
	equal(result.updated, 1);
	equal(length(parse(fs.readfile(file)).config.Dhcp4.subnet4[0].reservations), 4);
});

test('commit with nothing to write leaves the file untouched, comments included', () => {
	fs.writefile(file, rich);

	let result = importer.commit(ctx, [ hosts[1], hosts[2] ]);

	equal(result.result, true);
	equal(result.changed, false);
	equal(fs.readfile(file), rich);
	equal(json(fs.readfile(ctx.staging_file)).last_result.skipped, 2);
});

test('commit does not write a config Kea rejects', () => {
	fs.writefile(file, rich);
	fs.unlink(ctx.staging_file);
	accept = false;

	let result = importer.commit(ctx, hosts);

	accept = true;

	equal(result, {
		result: false,
		error: 'imported DHCPv4 config failed validation',
		validation: 'Kea says no'
	});
	equal(fs.readfile(file), rich);
	equal(config.is_file(ctx.staging_file), false);
});

rm_rf(root);
done();
